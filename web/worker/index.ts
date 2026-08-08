import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import calculatorWasm from "../public/wasm/calculator.wasm?module";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  simulateAttack,
  simulateOrderedVolley,
  simulateOrderedVolleyPhase,
  type CombatProfile,
} from "../lib/combat";
import {
  createArmyList,
  deleteArmyList,
  importArmyLists,
  listArmyLists,
  updateArmyList,
} from "../db/army-lists";
import type { ArmyListInput, ArmyListRecord } from "../lib/army-list";
import {
  createArmyListBackup,
  normalizeArmyListInput,
  normalizeArmyListRecord,
  parseArmyListBackup,
} from "../lib/army-list-codec.mjs";
import {
  choiceSelectionWeaponCounts,
  loadoutSubjectWeaponCounts,
  sourceEquippedWeaponCounts,
  unitLoadoutWarnings,
} from "../lib/loadout.mjs";
import type { CatalogueCombatPreset } from "../lib/catalogue";
import { resolveFiringDeckSelections } from "../lib/firing-deck.mjs";
import { transportCapacityPools, transportPassengerEligibility } from "../lib/transport.mjs";

interface Env {
  ASSETS: Fetcher;
  ARMY_DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type Catalogue = {
  sourceUpdatedAt: string;
  factions: Array<{ id: string; name: string }>;
  units: Array<{
    id: string;
    factionId: string;
    name: string;
    models: unknown[];
    weapons: Array<{
      id: number;
      name: string;
      type: "Ranged" | "Melee";
      groupId: string;
      abilities: Array<{ name: string; value: string | null }>;
    }>;
    composition: Array<{ text: string; min: number | null; max: number | null }>;
    compositionModels: Array<{ name: string; min: number; max: number; source: string }>;
    loadout: string;
    defaultWeapons: Array<{
      groupId: string;
      groupName: string;
      terms: Array<{
        fixed: number;
        perModel: number;
        perIncrement: number;
        modelsPerIncrement: number;
        quantity: number;
        source: string;
      }>;
    }>;
    unresolvedLoadoutSubjects: Array<{
      id: string;
      subject: string;
      equipment: string;
      weapons: Array<{
        groupId: string;
        groupName: string;
        quantity: number;
      }>;
    }>;
    wargearOptions: string[];
    weaponLimits: Array<{
      groupId: string;
      groupName: string;
      terms: Array<{
        fixed: number;
        perIncrement: number;
        modelsPerIncrement: number;
        quantity: number;
        source: string;
      }>;
    }>;
    wargearChoicePools: Array<{
      id: string;
      fixed: number;
      perIncrement: number;
      modelsPerIncrement: number;
      source: string;
      replaces: Array<{ groupId: string; groupName: string; quantity: number }>;
      alternatives: Array<{
        id: string;
        label: string;
        weapons: Array<{ groupId: string; groupName: string; quantity: number }>;
      }>;
    }>;
    suggestedModelCount: number | null;
    maximumModelCount: number | null;
    combatPresets: CatalogueCombatPreset[];
    firingDeck: { capacity: number; abilityId: string | null } | null;
    firingDeckModelCost: number;
    transport: {
      capacity: number;
      exactRules: boolean;
      source: string;
      allowedKeywords: string[][];
      excluded: Array<{
        keywords: string[];
        minimumWounds: number | null;
        nonCharacter: boolean;
      }>;
      modelCosts: Array<{ keywords: string[]; minimumWounds: number | null; cost: number }>;
      capacityModifiers: Array<{ equipment: string; capacity: number }>;
    } | null;
    transportKeywords: string[];
  }>;
};

type CalculatorExports = {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  whc_calculate_summary_with_characteristic_roll(...values: number[]): number;
  whc_calculate_ordered_volley_summary(...values: number[]): number;
  whc_estimate_ordered_volley_complexity(...values: number[]): number;
};

type OrderedTargetSegment = {
  toughness: number;
  save: number;
  invulnerable: number;
  feelNoPain: number;
  wounds: number;
  reduction: number;
  damageDivisor: number;
  firstFailedSaveDamageReplacement: number | null;
  allocatedAttackDamageReplacement: number;
  allocatedAttackDamageReplacementUses: number;
  allocatedAttackDamageReplacementSkip: number;
  modelCount: number;
};

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Request-ID",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

let cataloguePromise: Promise<Catalogue> | null = null;
let calculatorPromise: Promise<CalculatorExports> | null = null;

class ServiceUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

class ExactStateLimitError extends Error {
  constructor() {
    super("Exact state budget exceeded; use POST /api/v1/volley/simulate");
    this.name = "ExactStateLimitError";
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, ...headers },
  });
}

function apiError(
  message: string,
  status = 400,
  code = status === 404 ? "NOT_FOUND" : "INVALID_REQUEST",
) {
  return json(
    {
      error: { message, status, code, retryable: status >= 500 },
      apiVersion: "v1",
    },
    status,
  );
}

async function loadCatalogue(request: Request, env: Env) {
  cataloguePromise ??= env.ASSETS.fetch(new Request(new URL("/profile-data.json", request.url)))
    .then(async (response) => {
      if (!response.ok) {
        throw new ServiceUnavailableError(
          "Profile catalogue is unavailable",
          "PROFILE_CATALOGUE_UNAVAILABLE",
        );
      }
      const catalogue = (await response.json()) as Catalogue;
      if (
        !catalogue ||
        typeof catalogue.sourceUpdatedAt !== "string" ||
        !Array.isArray(catalogue.factions) ||
        !Array.isArray(catalogue.units)
      ) {
        throw new ServiceUnavailableError(
          "Profile catalogue is invalid",
          "PROFILE_CATALOGUE_INVALID",
        );
      }
      return catalogue;
    })
    .catch((error: unknown) => {
      cataloguePromise = null;
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError(
        "Profile catalogue could not be loaded",
        "PROFILE_CATALOGUE_UNAVAILABLE",
      );
    });
  return cataloguePromise;
}

async function loadCalculator() {
  calculatorPromise ??= (async () => {
    let calculator: CalculatorExports | null = null;
    const imports = {
      env: {
        emscripten_resize_heap(requestedSize: number) {
          if (!calculator) return 0;
          const memory = calculator.memory;
          const missing = requestedSize - memory.buffer.byteLength;
          if (missing <= 0) return 1;
          try {
            memory.grow(Math.ceil(missing / 65_536));
            return 1;
          } catch {
            return 0;
          }
        },
        emscripten_memcpy_big(destination: number, source: number, count: number) {
          if (!calculator) return destination;
          new Uint8Array(calculator.memory.buffer).copyWithin(destination, source, source + count);
          return destination;
        },
      },
    };
    const instantiated = await WebAssembly.instantiate(calculatorWasm, imports);
    calculator = instantiated.exports as unknown as CalculatorExports;
    if (
      typeof calculator.__wasm_call_ctors !== "function" ||
      typeof calculator.whc_calculate_summary_with_characteristic_roll !== "function" ||
      typeof calculator.whc_calculate_ordered_volley_summary !== "function" ||
      typeof calculator.whc_estimate_ordered_volley_complexity !== "function"
    ) {
      throw new ServiceUnavailableError(
        "Calculator engine exports are invalid",
        "CALCULATOR_ENGINE_INVALID",
      );
    }
    calculator.__wasm_call_ctors();
    return calculator;
  })().catch((error: unknown) => {
    calculatorPromise = null;
    if (error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError(
      "Calculator engine could not be loaded",
      "CALCULATOR_ENGINE_UNAVAILABLE",
    );
  });
  return calculatorPromise;
}

async function withStorage<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch {
    throw new ServiceUnavailableError(
      "Cloud list storage is temporarily unavailable",
      "LIST_STORAGE_UNAVAILABLE",
    );
  }
}

async function healthCheck(name: string, operation: () => Promise<Record<string, unknown> | void>) {
  const startedAt = performance.now();
  try {
    const detail = (await operation()) ?? {};
    return {
      name,
      status: "ok" as const,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...detail,
    };
  } catch (error) {
    return {
      name,
      status: "failed" as const,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      code: error instanceof ServiceUnavailableError ? error.code : "DEPENDENCY_UNAVAILABLE",
    };
  }
}

function profileFlags(profile: CombatProfile) {
  return (
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && (profile.rapidFire > 0 || profile.rapidFireDice > 0) ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0) |
    (profile.rerollHitOnes ? 8192 : 0) |
    (profile.rerollWounds ? 16384 : 0) |
    (profile.rerollWoundOnes ? 32768 : 0)
  );
}

function characteristicModifierFlags(profile: CombatProfile) {
  return (
    (profile.characteristicModifierAttacks ? 1 : 0) |
    (profile.characteristicModifierStrength ? 2 : 0) |
    (profile.characteristicModifierDamage ? 4 : 0)
  );
}

function characteristicModifierGroups(profiles: CombatProfile[]) {
  const groups = new Map<string, number>();
  return profiles.map((profile) => {
    if (!profile.characteristicModifierGroup) return 0;
    if (!groups.has(profile.characteristicModifierGroup)) {
      groups.set(profile.characteristicModifierGroup, groups.size + 1);
    }
    return groups.get(profile.characteristicModifierGroup) ?? 0;
  });
}

async function exactCalculation(profile: CombatProfile) {
  const calculator = await loadCalculator();
  const output = calculator.malloc(72);
  const flags = profileFlags(profile);

  try {
    const ok = calculator.whc_calculate_summary_with_characteristic_roll(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
      profile.attacksReplacement,
      profile.weaponCount,
      profile.hitOn,
      profile.strength,
      profile.ap,
      profile.damageDice,
      profile.damageSides,
      profile.damage,
      profile.criticalHits,
      profile.toughness,
      profile.save,
      profile.invulnerable,
      profile.feelNoPain,
      profile.wounds,
      profile.reduction,
      flags,
      profile.criticalWounds,
      profile.targetModels,
      profile.sustainedHitsDice,
      profile.sustainedHitsSides,
      profile.sustainedHits,
      profile.rapidFireDice,
      profile.rapidFireSides,
      profile.rapidFire,
      profile.melta,
      profile.hitModifier,
      profile.woundModifier,
      profile.attacksModifier,
      profile.strengthModifier,
      profile.damageModifier,
      profile.strengthReplacement,
      profile.damageReplacement ?? 0,
      profile.damageReplacement === null ? 0 : 1,
      profile.damageDivisor,
      profile.attacksMultiplier,
      profile.strengthMultiplier,
      profile.damageMultiplier,
      profile.characteristicModifierDice,
      profile.characteristicModifierSides,
      profile.characteristicModifierBonus,
      characteristicModifierFlags(profile),
      profile.firstFailedSaveDamageReplacement ?? 0,
      profile.firstFailedSaveDamageReplacement === null ? 0 : 1,
      profile.allocatedAttackDamageReplacement,
      profile.allocatedAttackDamageReplacementUses,
      profile.allocatedAttackDamageReplacementSkip,
      output,
    );
    if (!ok) throw new Error("Profile exceeds the calculator's exact-distribution limits");
    const view = new DataView(calculator.memory.buffer);
    const read = (index: number) => view.getUint32(output + index * 4, true);
    const numerator = (BigInt(read(6)) << 32n) | BigInt(read(5));
    const denominator = (BigInt(read(8)) << 32n) | BigInt(read(7));
    const appliedNumerator = (BigInt(read(15)) << 32n) | BigInt(read(14));
    const appliedDenominator = (BigInt(read(17)) << 32n) | BigInt(read(16));
    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      mean: Number(numerator) / Number(denominator),
      exact: { numerator: numerator.toString(), denominator: denominator.toString() },
      applied: {
        minimum: read(9),
        firstQuartile: read(10),
        median: read(11),
        thirdQuartile: read(12),
        maximum: read(13),
        mean: Number(appliedNumerator) / Number(appliedDenominator),
        estimated: {
          numerator: appliedNumerator.toString(),
          denominator: appliedDenominator.toString(),
        },
      },
    };
  } finally {
    calculator.free(output);
  }
}

async function exactVolley(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost: number,
) {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  if (targets.length < 1 || targets.length > 16) {
    throw new Error("targets must contain 1 to 16 ordered profile segments");
  }
  const capacity = targets.reduce((sum, target) => sum + target.wounds * target.modelCount, 0);
  if (
    !Number.isInteger(initialWoundsLost) ||
    initialWoundsLost < 0 ||
    initialWoundsLost >= targets[0].wounds ||
    capacity > 1024
  ) {
    throw new Error("initialWoundsLost or target capacity exceeds the exact calculator limits");
  }

  const calculator = await loadCalculator();
  const weaponFields = 37;
  const targetFields = 13;
  const weaponsPointer = calculator.malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator.malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator.malloc(10 * 4);
  const meansPointer = calculator.malloc(profiles.length * 4 * 4);
  const characteristicGroups = characteristicModifierGroups(profiles);
  try {
    let view = new DataView(calculator.memory.buffer);
    const write = (pointer: number, values: number[]) =>
      values.forEach((value, index) => view.setUint32(pointer + index * 4, value, true));
    const read = (pointer: number, index: number) => view.getUint32(pointer + index * 4, true);
    const fraction = (pointer: number) => {
      const numerator = (BigInt(read(pointer, 1)) << 32n) | BigInt(read(pointer, 0));
      const denominator = (BigInt(read(pointer, 3)) << 32n) | BigInt(read(pointer, 2));
      return {
        mean: Number(numerator) / Number(denominator),
        exact: { numerator: numerator.toString(), denominator: denominator.toString() },
      };
    };
    profiles.forEach((profile, index) =>
      write(weaponsPointer + index * weaponFields * 4, [
        profile.attackDice,
        profile.attackSides,
        profile.attacks,
        profile.attacksReplacement,
        profile.weaponCount,
        profile.hitOn,
        profile.strength,
        profile.ap,
        profile.damageDice,
        profile.damageSides,
        profile.damage,
        profile.criticalHits,
        profileFlags(profile),
        profile.criticalWounds,
        profile.sustainedHitsDice,
        profile.sustainedHitsSides,
        profile.sustainedHits,
        profile.rapidFireDice,
        profile.rapidFireSides,
        profile.rapidFire,
        profile.melta,
        profile.hitModifier,
        profile.woundModifier,
        profile.attacksModifier,
        profile.strengthModifier,
        profile.damageModifier,
        profile.strengthReplacement,
        profile.damageReplacement ?? 0,
        profile.damageReplacement === null ? 0 : 1,
        profile.attacksMultiplier,
        profile.strengthMultiplier,
        profile.damageMultiplier,
        profile.characteristicModifierDice,
        profile.characteristicModifierSides,
        profile.characteristicModifierBonus,
        characteristicModifierFlags(profile),
        characteristicGroups[index],
      ]),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, [
        target.toughness,
        target.save,
        target.invulnerable,
        target.feelNoPain,
        target.wounds,
        target.reduction,
        target.modelCount,
        target.damageDivisor,
        target.firstFailedSaveDamageReplacement ?? 0,
        target.firstFailedSaveDamageReplacement === null ? 0 : 1,
        target.allocatedAttackDamageReplacement,
        target.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementSkip,
      ]),
    );
    const ok = calculator.whc_calculate_ordered_volley_summary(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      summaryPointer,
      meansPointer,
    );
    if (!ok) throw new ExactStateLimitError();
    view = new DataView(calculator.memory.buffer);
    const cumulative = profiles.map((_, index) => fraction(meansPointer + index * 16));
    const total = fraction(summaryPointer + 5 * 4);
    return {
      minimum: read(summaryPointer, 0),
      firstQuartile: read(summaryPointer, 1),
      median: read(summaryPointer, 2),
      thirdQuartile: read(summaryPointer, 3),
      maximum: read(summaryPointer, 4),
      mean: total.mean,
      exact: total.exact,
      peakSparseStates: read(summaryPointer, 9),
      cumulative,
      incrementalMeans: cumulative.map(
        (entry, index) => entry.mean - (index === 0 ? 0 : cumulative[index - 1].mean),
      ),
    };
  } finally {
    calculator.free(weaponsPointer);
    calculator.free(targetsPointer);
    calculator.free(summaryPointer);
    calculator.free(meansPointer);
  }
}

async function volleyComplexity(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost: number,
) {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  if (targets.length < 1 || targets.length > 16) {
    throw new Error("targets must contain 1 to 16 ordered profile segments");
  }
  const calculator = await loadCalculator();
  const weaponFields = 37;
  const targetFields = 13;
  const weaponsPointer = calculator.malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator.malloc(targets.length * targetFields * 4);
  const outputPointer = calculator.malloc(6 * 4);
  const characteristicGroups = characteristicModifierGroups(profiles);
  try {
    let view = new DataView(calculator.memory.buffer);
    const write = (pointer: number, values: number[]) =>
      values.forEach((value, index) => view.setUint32(pointer + index * 4, value, true));
    profiles.forEach((profile, index) =>
      write(weaponsPointer + index * weaponFields * 4, [
        profile.attackDice,
        profile.attackSides,
        profile.attacks,
        profile.attacksReplacement,
        profile.weaponCount,
        profile.hitOn,
        profile.strength,
        profile.ap,
        profile.damageDice,
        profile.damageSides,
        profile.damage,
        profile.criticalHits,
        profileFlags(profile),
        profile.criticalWounds,
        profile.sustainedHitsDice,
        profile.sustainedHitsSides,
        profile.sustainedHits,
        profile.rapidFireDice,
        profile.rapidFireSides,
        profile.rapidFire,
        profile.melta,
        profile.hitModifier,
        profile.woundModifier,
        profile.attacksModifier,
        profile.strengthModifier,
        profile.damageModifier,
        profile.strengthReplacement,
        profile.damageReplacement ?? 0,
        profile.damageReplacement === null ? 0 : 1,
        profile.attacksMultiplier,
        profile.strengthMultiplier,
        profile.damageMultiplier,
        profile.characteristicModifierDice,
        profile.characteristicModifierSides,
        profile.characteristicModifierBonus,
        characteristicModifierFlags(profile),
        characteristicGroups[index],
      ]),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, [
        target.toughness,
        target.save,
        target.invulnerable,
        target.feelNoPain,
        target.wounds,
        target.reduction,
        target.modelCount,
        target.damageDivisor,
        target.firstFailedSaveDamageReplacement ?? 0,
        target.firstFailedSaveDamageReplacement === null ? 0 : 1,
        target.allocatedAttackDamageReplacement,
        target.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementSkip,
      ]),
    );
    const ok = calculator.whc_estimate_ordered_volley_complexity(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      outputPointer,
    );
    if (!ok) throw new Error("Volley complexity could not be estimated");
    view = new DataView(calculator.memory.buffer);
    const read = (index: number) => view.getUint32(outputPointer + index * 4, true);
    return {
      estimatedStateUpperBound: read(0),
      stateLimit: read(1),
      maximumAttackEvents: read(2),
      targetCapacity: read(3),
      usesDeferredStates: read(4) !== 0,
      exactGuaranteedByBound: read(5) !== 0,
      estimateKind: "prefix-aware-conservative-upper-bound",
      fallbackEndpoint: "/api/v1/volley/simulate",
    };
  } finally {
    calculator.free(weaponsPointer);
    calculator.free(targetsPointer);
    calculator.free(outputPointer);
  }
}

async function requestProfile(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  const candidate =
    body && typeof body === "object" && "profile" in body
      ? (body as { profile: unknown }).profile
      : body;
  return normalizeProfile(candidate);
}

function orderedTargets(value: unknown): OrderedTargetSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new Error("targets must contain 1 to 16 ordered profile segments");
  }
  const targets = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Each target segment must be an object");
    }
    const target = candidate as Record<string, unknown>;
    const integer = (key: string, minimum: number, maximum: number) => {
      const result = target[key];
      if (
        !Number.isInteger(result) ||
        (result as number) < minimum ||
        (result as number) > maximum
      ) {
        throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
      }
      return result as number;
    };
    const optionalSave = (key: string) => {
      const result = integer(key, 0, 6);
      if (result === 1) throw new Error(`${key} must be 0 or an integer from 2 to 6`);
      return result;
    };
    return {
      toughness: integer("toughness", 1, 65535),
      save: integer("save", 2, 7),
      invulnerable: optionalSave("invulnerable"),
      feelNoPain: optionalSave("feelNoPain"),
      wounds: integer("wounds", 1, 1024),
      reduction: integer("reduction", 0, 1024),
      damageDivisor: target.damageDivisor === undefined ? 1 : integer("damageDivisor", 1, 1024),
      firstFailedSaveDamageReplacement:
        target.firstFailedSaveDamageReplacement === undefined ||
        target.firstFailedSaveDamageReplacement === null
          ? null
          : integer("firstFailedSaveDamageReplacement", 0, 1024),
      allocatedAttackDamageReplacement:
        target.allocatedAttackDamageReplacement === undefined
          ? 0
          : integer("allocatedAttackDamageReplacement", 0, 1024),
      allocatedAttackDamageReplacementUses:
        target.allocatedAttackDamageReplacementUses === undefined
          ? 0
          : integer("allocatedAttackDamageReplacementUses", 0, 1024),
      allocatedAttackDamageReplacementSkip:
        target.allocatedAttackDamageReplacementSkip === undefined
          ? 0
          : integer("allocatedAttackDamageReplacementSkip", 0, 1024),
      modelCount: integer("modelCount", 1, 1000),
    };
  });
  if (new Set(targets.map((target) => String(target.firstFailedSaveDamageReplacement))).size > 1) {
    throw new Error("Target segments must share the same first-failed-save Damage replacement");
  }
  if (
    new Set(
      targets.map((target) =>
        JSON.stringify([
          target.allocatedAttackDamageReplacement,
          target.allocatedAttackDamageReplacementUses,
          target.allocatedAttackDamageReplacementSkip,
        ]),
      ),
    ).size > 1
  ) {
    throw new Error("Target segments must share the allocated-attack Damage replacement policy");
  }
  return targets;
}

async function requestArmyList(request: Request): Promise<ArmyListInput> {
  return normalizeArmyListInput(await request.json()) as ArmyListInput;
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: API_HEADERS });

  try {
    if (url.pathname === "/api/v1" && request.method === "GET") {
      return json({
        name: "Warhammer Damage Calculator API",
        apiVersion: "v1",
        endpoints: {
          health: "GET /api/v1/health",
          factions: "GET /api/v1/factions",
          units: "GET /api/v1/units?faction={factionId}&kind={attacker|target|all}",
          weapons: "GET /api/v1/weapons?unit={datasheetId}",
          loadout: "GET /api/v1/loadout?unit={datasheetId}",
          validateLoadout: "POST /api/v1/validate-loadout",
          firingDeck:
            "GET /api/v1/firing-deck?unit={transportDatasheetId}&passenger={passengerDatasheetId}&attached={attachedDatasheetId}",
          transport:
            "GET /api/v1/transport?unit={transportDatasheetId}&passenger={passengerDatasheetId}&attached={attachedDatasheetId}&models={modelCount}",
          validateFiringDeck: "POST /api/v1/validate-firing-deck",
          targets: "GET /api/v1/targets?unit={datasheetId}",
          profiles: "GET /api/v1/profiles",
          calculate: "POST /api/v1/calculate",
          volley: "POST /api/v1/volley",
          volleyComplexity: "POST /api/v1/volley/complexity",
          roll: "POST /api/v1/roll?details={true|false}",
          volleyRoll: "POST /api/v1/volley/roll?details={true|false}",
          volleySimulate: "POST /api/v1/volley/simulate",
          lists:
            "GET|POST /api/v1/lists; PUT|DELETE /api/v1/lists/{id}; GET /api/v1/lists/export; POST /api/v1/lists/import",
        },
        request: { profile: DEFAULT_PROFILE },
      });
    }

    if (url.pathname === "/api/v1/health" && request.method === "GET") {
      const checks = await Promise.all([
        healthCheck("profile-catalogue", async () => {
          const catalogue = await loadCatalogue(request, env);
          return {
            sourceUpdatedAt: catalogue.sourceUpdatedAt,
            factions: catalogue.factions.length,
            units: catalogue.units.length,
          };
        }),
        healthCheck("calculator-engine", async () => {
          await loadCalculator();
        }),
        healthCheck("list-storage", async () => {
          await withStorage(() => env.ARMY_DB.prepare("SELECT 1 AS healthy").first());
        }),
      ]);
      const healthy = checks.every((check) => check.status === "ok");
      return json(
        {
          status: healthy ? "ok" : "degraded",
          apiVersion: "v1",
          checkedAt: new Date().toISOString(),
          checks,
        },
        healthy ? 200 : 503,
        { "Cache-Control": "no-store" },
      );
    }

    if (url.pathname === "/api/v1/profiles" && request.method === "GET") {
      return json(await loadCatalogue(request, env), 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    if (url.pathname === "/api/v1/factions" && request.method === "GET") {
      const catalogue = await loadCatalogue(request, env);
      return json({ data: catalogue.factions, sourceUpdatedAt: catalogue.sourceUpdatedAt });
    }

    if (url.pathname === "/api/v1/units" && request.method === "GET") {
      const faction = url.searchParams.get("faction");
      if (!faction) return apiError("Missing required faction query parameter");
      const kind = url.searchParams.get("kind") ?? "all";
      if (!["attacker", "target", "all"].includes(kind)) {
        return apiError("kind must be attacker, target, or all");
      }
      const catalogue = await loadCatalogue(request, env);
      const data = catalogue.units
        .filter((unit) => unit.factionId === faction)
        .filter(
          (unit) =>
            kind === "all" ||
            (kind === "attacker" ? unit.weapons.length > 0 : unit.models.length > 0),
        )
        .map((unit) => ({
          id: unit.id,
          factionId: unit.factionId,
          name: unit.name,
          modelProfileCount: unit.models.length,
          weaponProfileCount: unit.weapons.length,
          weaponGroupCount: new Set(unit.weapons.map((weapon) => weapon.groupId)).size,
          firingDeck: unit.firingDeck,
          transport: unit.transport,
          suggestedModelCount: unit.suggestedModelCount,
          maximumModelCount: unit.maximumModelCount,
        }));
      return json({ data, faction });
    }

    if (url.pathname === "/api/v1/loadout" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === unitId);
      if (!unit) return apiError("Unit not found", 404);
      return json({
        data: {
          id: unit.id,
          factionId: unit.factionId,
          name: unit.name,
          composition: unit.composition,
          compositionModels: unit.compositionModels,
          loadout: unit.loadout,
          defaultWeapons: unit.defaultWeapons,
          unresolvedLoadoutSubjects: unit.unresolvedLoadoutSubjects,
          wargearOptions: unit.wargearOptions,
          weaponLimits: unit.weaponLimits,
          wargearChoicePools: unit.wargearChoicePools,
          firingDeck: unit.firingDeck,
          firingDeckModelCost: unit.firingDeckModelCost,
          transport: unit.transport,
          transportKeywords: unit.transportKeywords,
          suggestedModelCount: unit.suggestedModelCount,
          maximumModelCount: unit.maximumModelCount,
          weapons: unit.weapons,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/firing-deck" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      const passengerId = url.searchParams.get("passenger");
      if (!unitId || !passengerId) {
        return apiError("Missing required unit or passenger query parameter");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === unitId);
      if (!transport) return apiError("Transport not found", 404);
      if (!transport.firingDeck) return apiError("Unit has no Firing Deck", 409);
      const passenger = catalogue.units.find((entry) => entry.id === passengerId);
      if (!passenger) return apiError("Passenger unit not found", 404);
      const attachedId = url.searchParams.get("attached");
      const attached = attachedId ? catalogue.units.find((entry) => entry.id === attachedId) : null;
      if (attachedId && !attached) return apiError("Attached unit not found", 404);
      if (passenger.id === transport.id) return apiError("A transport cannot be its own passenger");
      const transportEligibility = transportPassengerEligibility(transport, passenger, {
        attachedUnit: attached,
      });
      if (!transportEligibility.eligible) return apiError(transportEligibility.reason, 409);
      return json({
        data: {
          transport: { id: transport.id, name: transport.name },
          capacity: transport.firingDeck.capacity,
          passenger: {
            id: passenger.id,
            name: passenger.name,
            modelCost: passenger.firingDeckModelCost,
            weapons: passenger.weapons.filter(
              (weapon) =>
                weapon.type === "Ranged" &&
                !weapon.abilities.some((ability) => ability.name.toLowerCase() === "one shot"),
            ),
          },
          attached: attached ? { id: attached.id, name: attached.name } : null,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/transport" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      const passengerId = url.searchParams.get("passenger");
      if (!unitId || !passengerId) {
        return apiError("Missing required unit or passenger query parameter");
      }
      const models = Number(url.searchParams.get("models") ?? "1");
      if (!Number.isSafeInteger(models) || models < 1 || models > 1000) {
        return apiError("models must be an integer from 1 to 1000");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === unitId);
      const passenger = catalogue.units.find((entry) => entry.id === passengerId);
      if (!transport || !passenger) return apiError("Transport or passenger unit not found", 404);
      const attachedId = url.searchParams.get("attached");
      const attached = attachedId ? catalogue.units.find((entry) => entry.id === attachedId) : null;
      if (attachedId && !attached) return apiError("Attached unit not found", 404);
      const eligibility = transportPassengerEligibility(transport, passenger, {
        attachedUnit: attached,
      });
      return json({
        data: {
          transport: { id: transport.id, name: transport.name },
          passenger: { id: passenger.id, name: passenger.name },
          attached: attached ? { id: attached.id, name: attached.name } : null,
          capacity: eligibility.poolCapacity ?? transport.transport?.capacity ?? 0,
          pool: eligibility.eligible
            ? {
                position: eligibility.poolPosition,
                kind: eligibility.poolKind,
                label: eligibility.poolLabel,
                capacity: eligibility.poolCapacity,
                maximumWounds: eligibility.poolMaximumWounds,
              }
            : null,
          sharedAllowance: eligibility.eligible
            ? (transport.transport?.sharedAllowances.find(
                (allowance) => allowance.position === eligibility.sharedAllowancePosition,
              ) ?? null)
            : null,
          sharedAllowances: transport.transport?.sharedAllowances ?? [],
          pools: transportCapacityPools(transport).map((pool) => ({
            position: pool.position,
            kind: pool.kind,
            label: pool.label,
            capacity: pool.capacity,
            maximumWounds: pool.maximumWounds,
            allowedKeywords: pool.allowedKeywords,
          })),
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          modelCost: eligibility.modelCost ?? null,
          models,
          slots: eligibility.eligible ? models * eligibility.modelCost : null,
          fits:
            eligibility.eligible &&
            models * eligibility.modelCost <= eligibility.poolCapacity &&
            (eligibility.sharedAllowanceMaximumModels === null ||
              models <= eligibility.sharedAllowanceMaximumModels),
          source: transport.transport?.source ?? null,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/validate-firing-deck" && request.method === "POST") {
      const body = (await request.json()) as { transportId?: unknown; selections?: unknown };
      if (typeof body?.transportId !== "string" || !Array.isArray(body.selections)) {
        return apiError("transportId and selections are required");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === body.transportId);
      if (!transport) return apiError("Transport not found", 404);
      const result = resolveFiringDeckSelections(catalogue, transport, body.selections);
      return json({
        data: {
          capacity: result.capacity,
          slotsUsed: result.slots,
          selections: result.selections.map((selection) => ({
            passengerUnitId: selection.passengerUnitId,
            passengerUnitName: selection.passengerUnitName,
            attachedUnitId: selection.attachedUnitId,
            attachedUnitName: selection.attachedUnitName,
            weaponId: selection.weaponId,
            weaponName: selection.weaponName,
            modelCount: selection.modelCount,
            modelCost: selection.modelCost,
            slots: selection.slots,
            bearerUnitId: transport.id,
          })),
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/validate-loadout" && request.method === "POST") {
      const body = (await request.json()) as {
        unitId?: unknown;
        modelCount?: unknown;
        weaponCounts?: unknown;
        optionCounts?: unknown;
        choiceSelections?: unknown;
        loadoutSubjectCounts?: unknown;
      };
      if (
        !body ||
        typeof body.unitId !== "string" ||
        !Number.isInteger(body.modelCount) ||
        (body.modelCount as number) < 1 ||
        (body.modelCount as number) > 1000 ||
        !body.weaponCounts ||
        typeof body.weaponCounts !== "object" ||
        Array.isArray(body.weaponCounts)
      ) {
        return apiError("unitId, modelCount, and weaponCounts are required");
      }
      const counts = body.weaponCounts as Record<string, unknown>;
      const optionCounts = (body.optionCounts ?? {}) as Record<string, unknown>;
      const choiceSelections = (body.choiceSelections ?? {}) as Record<string, unknown>;
      const loadoutSubjectCounts = (body.loadoutSubjectCounts ?? {}) as Record<string, unknown>;
      if (
        Object.keys(counts).length > 200 ||
        !optionCounts ||
        typeof optionCounts !== "object" ||
        Array.isArray(optionCounts) ||
        Object.keys(optionCounts).length > 200 ||
        !choiceSelections ||
        typeof choiceSelections !== "object" ||
        Array.isArray(choiceSelections) ||
        Object.keys(choiceSelections).length > 500 ||
        !loadoutSubjectCounts ||
        typeof loadoutSubjectCounts !== "object" ||
        Array.isArray(loadoutSubjectCounts) ||
        Object.keys(loadoutSubjectCounts).length > 100 ||
        Object.values(counts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(optionCounts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(choiceSelections).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(loadoutSubjectCounts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 1000,
        )
      ) {
        return apiError("Loadout count values must be integers within their supported ranges");
      }
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === body.unitId);
      if (!unit) return apiError("Unit not found", 404);
      const groupIds = new Set(unit.weapons.map((weapon) => weapon.groupId));
      const alternativeIds = new Set(
        unit.wargearChoicePools.flatMap((pool) =>
          pool.alternatives.map((alternative) => alternative.id),
        ),
      );
      const loadoutSubjectIds = new Set(
        unit.unresolvedLoadoutSubjects.map((subject) => subject.id),
      );
      if (
        [...Object.keys(counts), ...Object.keys(optionCounts)].some(
          (groupId) => !groupIds.has(groupId),
        )
      ) {
        return apiError("weaponCounts and optionCounts must use weapon group IDs from this unit");
      }
      if (
        Object.keys(choiceSelections).some((alternativeId) => !alternativeIds.has(alternativeId))
      ) {
        return apiError("choiceSelections must use alternative IDs from this unit");
      }
      if (
        Object.keys(loadoutSubjectCounts).some((subjectId) => !loadoutSubjectIds.has(subjectId))
      ) {
        return apiError("loadoutSubjectCounts must use unresolved subject IDs from this unit");
      }
      const warnings = unitLoadoutWarnings(
        unit,
        body.modelCount as number,
        optionCounts,
        counts,
        choiceSelections,
        loadoutSubjectCounts,
      );
      return json({
        data: {
          valid: warnings.length === 0,
          warnings,
          weaponLimits: unit.weaponLimits,
          wargearChoicePools: unit.wargearChoicePools,
          selectedWeaponCounts: choiceSelectionWeaponCounts(unit, choiceSelections),
          compositionWeaponCounts: loadoutSubjectWeaponCounts(unit, loadoutSubjectCounts),
          suggestedEquippedCounts: sourceEquippedWeaponCounts(
            unit,
            body.modelCount as number,
            choiceSelections,
            loadoutSubjectCounts,
          ),
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (
      (url.pathname === "/api/v1/weapons" || url.pathname === "/api/v1/targets") &&
      request.method === "GET"
    ) {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === unitId);
      if (!unit) return apiError("Unit not found", 404);
      const data = url.pathname.endsWith("weapons") ? unit.weapons : unit.models;
      return json({ data, unit: { id: unit.id, name: unit.name, factionId: unit.factionId } });
    }

    if (url.pathname === "/api/v1/calculate" && request.method === "POST") {
      const profile = await requestProfile(request);
      return json({
        data: await exactCalculation(profile),
        profile,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      return json({
        data: await exactVolley(profiles, targets, initialWoundsLost as number),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley/complexity" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      return json({
        data: await volleyComplexity(profiles, targets, initialWoundsLost as number),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/roll" && request.method === "POST") {
      const profile = await requestProfile(request);
      const rolled = simulateAttack(profile);
      if (url.searchParams.get("details") === "false") rolled.details = [];
      return json({ data: rolled, profile, apiVersion: "v1" });
    }

    if (url.pathname === "/api/v1/volley/roll" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      const rolled = simulateOrderedVolley(profiles, targets, initialWoundsLost as number);
      if (url.searchParams.get("details") === "false") {
        for (const line of rolled.lines) line.details = [];
      }
      return json({
        data: rolled,
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley/simulate" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
        seed?: unknown;
        trials?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      const seed = body.seed;
      const trials = body.trials ?? 10_000;
      if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffff_ffff) {
        return apiError("seed must be an unsigned 32-bit integer");
      }
      return json({
        data: simulateOrderedVolleyPhase(
          profiles,
          targets,
          seed as number,
          trials as number,
          initialWoundsLost as number,
        ),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "GET") {
      return json({
        data: await withStorage(() => listArmyLists(env.ARMY_DB)),
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "POST") {
      if ((await withStorage(() => listArmyLists(env.ARMY_DB))).length >= 100) {
        throw new Error("Cloud storage supports at most 100 army lists");
      }
      const input = await requestArmyList(request);
      return json({ data: await withStorage(() => createArmyList(env.ARMY_DB, input)) }, 201);
    }

    if (url.pathname === "/api/v1/lists/export" && request.method === "GET") {
      const catalogue = await loadCatalogue(request, env);
      return json(
        createArmyListBackup(
          await withStorage(() => listArmyLists(env.ARMY_DB)),
          new Date().toISOString(),
          catalogue.sourceUpdatedAt,
        ),
      );
    }

    if (url.pathname === "/api/v1/lists/import" && request.method === "POST") {
      const backup = parseArmyListBackup(await request.json()) as { lists: unknown[] };
      const records = backup.lists.map(
        (record) => normalizeArmyListRecord(record) as ArmyListRecord,
      );
      const mergedIds = new Set(
        (await withStorage(() => listArmyLists(env.ARMY_DB))).map((record) => record.id),
      );
      for (const record of records) mergedIds.add(record.id);
      if (mergedIds.size > 100) throw new Error("Cloud storage supports at most 100 army lists");
      return json({
        data: await withStorage(() => importArmyLists(env.ARMY_DB, records)),
        imported: records.length,
      });
    }

    const listMatch = /^\/api\/v1\/lists\/([0-9a-f-]+)$/i.exec(url.pathname);
    if (listMatch && request.method === "PUT") {
      const input = await requestArmyList(request);
      const updated = await withStorage(() => updateArmyList(env.ARMY_DB, listMatch[1], input));
      return updated ? json({ data: updated }) : apiError("Army list not found", 404);
    }
    if (listMatch && request.method === "DELETE") {
      return (await withStorage(() => deleteArmyList(env.ARMY_DB, listMatch[1])))
        ? json({ deleted: true })
        : apiError("Army list not found", 404);
    }

    return apiError("API endpoint not found", 404);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return apiError(error.message, 503, error.code);
    }
    if (error instanceof SyntaxError) {
      return apiError("Request body must contain valid JSON", 400, "INVALID_JSON");
    }
    if (error instanceof ExactStateLimitError) {
      return apiError(error.message, 422, "EXACT_STATE_LIMIT");
    }
    return apiError(error instanceof Error ? error.message : "Request failed");
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname === "/api/") {
      return Response.redirect(new URL("/api/v1", request.url), 308);
    }
    if (url.pathname.startsWith("/api/v1")) {
      const response = await handleApi(request, env);
      response.headers.set("X-Request-ID", crypto.randomUUID());
      return response;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
