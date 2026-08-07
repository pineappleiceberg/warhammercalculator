import {
  attackRollSucceeds,
  modifiedRollTarget,
  savingThrowTarget,
  woundTarget,
} from "./thresholds.mjs";
import {
  allocateDamageToSequence,
  allocateDamageToUnit,
  targetSequenceCapacity,
  targetSequencePosition,
} from "./allocation.mjs";

export type CombatProfile = {
  weaponName: string;
  attackDice: number;
  attackSides: number;
  attacks: number;
  attacksReplacement: number;
  attacksMultiplier: number;
  attacksModifier: number;
  weaponCount: number;
  hitOn: number;
  strength: number;
  strengthReplacement: number;
  strengthMultiplier: number;
  strengthModifier: number;
  ap: number;
  damageDice: number;
  damageSides: number;
  damage: number;
  damageReplacement: number | null;
  firstFailedSaveDamageReplacement: number | null;
  allocatedAttackDamageReplacement: number;
  allocatedAttackDamageReplacementUses: number;
  allocatedAttackDamageReplacementSkip: number;
  damageMultiplier: number;
  damageModifier: number;
  characteristicModifierDice: number;
  characteristicModifierSides: number;
  characteristicModifierBonus: number;
  characteristicModifierAttacks: boolean;
  characteristicModifierStrength: boolean;
  characteristicModifierDamage: boolean;
  characteristicModifierGroup: string;
  criticalHits: number;
  toughness: number;
  save: number;
  invulnerable: number;
  feelNoPain: number;
  wounds: number;
  targetModels: number;
  reduction: number;
  damageDivisor: number;
  criticalWounds: number;
  hitModifier: number;
  woundModifier: number;
  sustainedHitsDice: number;
  sustainedHitsSides: number;
  sustainedHits: number;
  rapidFireDice: number;
  rapidFireSides: number;
  rapidFire: number;
  melta: number;
  targetDistance: number;
  attackerCharged: boolean;
  attackerBattleShocked: boolean;
  targetBattleShocked: boolean;
  targetStrengthState: TargetStrengthState;
  withinHalfRange: boolean;
  torrent: boolean;
  blast: boolean;
  heavyActive: boolean;
  lanceActive: boolean;
  targetCover: boolean;
  ignoresCover: boolean;
  indirect: boolean;
  lethalHits: boolean;
  devastatingWounds: boolean;
  twinLinked: boolean;
  rerollHits: boolean;
  rerollHitOnes: boolean;
  rerollWounds: boolean;
  rerollWoundOnes: boolean;
};

export type TargetStrengthState = "full" | "below_starting" | "below_half";

export type RollDetail = {
  label: string;
  hit: string;
  wound: string;
  save: string;
  fnp: string;
  damage: number;
  appliedDamage: number;
  wastedDamage: number;
  outcome: string;
  tone: "failed" | "saved" | "prevented" | "damage";
};

export type RollResult = {
  attacks: number;
  attacksResolved: number;
  hits: number;
  criticalHits: number;
  woundingAttacks: number;
  savedAttacks: number;
  unsavedAttacks: number;
  fnpPrevented: number;
  successfulAttacks: number;
  totalDamage: number;
  appliedDamage: number;
  wastedDamage: number;
  modelsDestroyed: number;
  targetWoundsRemaining: number;
  hitsOn: number;
  woundsOn: number;
  savesOn: number;
  details: RollDetail[];
};

export type VolleyTarget = {
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

export type OrderedVolleyRollResult = {
  attacks: number;
  attacksResolved: number;
  hits: number;
  criticalHits: number;
  woundingAttacks: number;
  savedAttacks: number;
  unsavedAttacks: number;
  fnpPrevented: number;
  successfulAttacks: number;
  totalDamage: number;
  appliedDamage: number;
  wastedDamage: number;
  modelsDestroyed: number;
  targetWoundsRemaining: number;
  lines: RollResult[];
};

export type RandomUint32 = () => number;

export type RollOptions = {
  randomUint32?: RandomUint32;
  details?: boolean;
};

export type PhaseSimulationResult = {
  algorithm: "xoshiro128ss-v1";
  seed: number;
  trials: number;
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  mean: number;
  standardDeviation: number;
  zeroDamageChance: number;
  unitDestroyedChance: number;
  meanModelsDestroyed: number;
  means: {
    attacksResolved: number;
    hits: number;
    criticalHits: number;
    woundingAttacks: number;
    savedAttacks: number;
    fnpPrevented: number;
    successfulAttacks: number;
    wastedDamage: number;
  };
  histogram: Array<{ damage: number; count: number; probability: number }>;
};

export const DEFAULT_PROFILE: CombatProfile = {
  weaponName: "",
  attackDice: 0,
  attackSides: 0,
  attacks: 4,
  attacksReplacement: 0,
  attacksMultiplier: 1,
  attacksModifier: 0,
  weaponCount: 1,
  hitOn: 3,
  strength: 8,
  strengthReplacement: 0,
  strengthMultiplier: 1,
  strengthModifier: 0,
  ap: 2,
  damageDice: 1,
  damageSides: 6,
  damage: 1,
  damageReplacement: null,
  firstFailedSaveDamageReplacement: null,
  allocatedAttackDamageReplacement: 0,
  allocatedAttackDamageReplacementUses: 0,
  allocatedAttackDamageReplacementSkip: 0,
  damageMultiplier: 1,
  damageModifier: 0,
  characteristicModifierDice: 0,
  characteristicModifierSides: 0,
  characteristicModifierBonus: 0,
  characteristicModifierAttacks: false,
  characteristicModifierStrength: false,
  characteristicModifierDamage: false,
  characteristicModifierGroup: "",
  criticalHits: 6,
  toughness: 8,
  save: 3,
  invulnerable: 5,
  feelNoPain: 0,
  wounds: 12,
  targetModels: 1,
  reduction: 0,
  damageDivisor: 1,
  criticalWounds: 0,
  hitModifier: 0,
  woundModifier: 0,
  sustainedHitsDice: 0,
  sustainedHitsSides: 0,
  sustainedHits: 0,
  rapidFireDice: 0,
  rapidFireSides: 0,
  rapidFire: 0,
  melta: 0,
  targetDistance: 0,
  attackerCharged: false,
  attackerBattleShocked: false,
  targetBattleShocked: false,
  targetStrengthState: "full",
  withinHalfRange: false,
  torrent: false,
  blast: false,
  heavyActive: false,
  lanceActive: false,
  targetCover: false,
  ignoresCover: false,
  indirect: false,
  lethalHits: false,
  devastatingWounds: false,
  twinLinked: false,
  rerollHits: false,
  rerollHitOnes: false,
  rerollWounds: false,
  rerollWoundOnes: false,
};

export function normalizeProfile(input: unknown): CombatProfile {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("profile must be a JSON object");
  }
  const source = input as Record<string, unknown>;
  const numberValue = (key: keyof CombatProfile, minimum: number, maximum: number) => {
    const value = Object.hasOwn(source, key) ? source[key] : DEFAULT_PROFILE[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
  const optionalSave = (key: "invulnerable" | "feelNoPain") => {
    const value = numberValue(key, 0, 6);
    if (value === 1) throw new Error(`${key} must be 0 or an integer from 2 to 6`);
    return value;
  };
  const booleanValue = (key: keyof CombatProfile) => {
    const value = Object.hasOwn(source, key) ? source[key] : DEFAULT_PROFILE[key];
    if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
    return value;
  };
  const targetStrengthState = Object.hasOwn(source, "targetStrengthState")
    ? source.targetStrengthState
    : DEFAULT_PROFILE.targetStrengthState;
  if (!(["full", "below_starting", "below_half"] as unknown[]).includes(targetStrengthState)) {
    throw new Error("targetStrengthState must be full, below_starting, or below_half");
  }
  const nullableNumberValue = (
    key: "damageReplacement" | "firstFailedSaveDamageReplacement",
    minimum: number,
    maximum: number,
  ) => {
    const value = Object.hasOwn(source, key) ? source[key] : DEFAULT_PROFILE[key];
    if (value === null) return null;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(`${key} must be null or an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
  const weaponName = Object.hasOwn(source, "weaponName") ? source.weaponName : "";
  if (typeof weaponName !== "string" || weaponName.length > 160) {
    throw new Error("weaponName must be a string no longer than 160 characters");
  }
  const characteristicModifierGroup = Object.hasOwn(source, "characteristicModifierGroup")
    ? source.characteristicModifierGroup
    : "";
  if (typeof characteristicModifierGroup !== "string" || characteristicModifierGroup.length > 160) {
    throw new Error("characteristicModifierGroup must be a string no longer than 160 characters");
  }

  const profile: CombatProfile = {
    weaponName,
    attackDice: numberValue("attackDice", 0, 20),
    attackSides: numberValue("attackSides", 0, 100),
    attacks: numberValue("attacks", 0, 1024),
    attacksReplacement: numberValue("attacksReplacement", 0, 1024),
    attacksMultiplier: numberValue("attacksMultiplier", 1, 1024),
    attacksModifier: numberValue("attacksModifier", -1024, 1024),
    weaponCount: numberValue("weaponCount", 1, 100),
    hitOn: numberValue("hitOn", 2, 6),
    strength: numberValue("strength", 1, 1024),
    strengthReplacement: numberValue("strengthReplacement", 0, 1024),
    strengthMultiplier: numberValue("strengthMultiplier", 1, 1024),
    strengthModifier: numberValue("strengthModifier", -1024, 1024),
    ap: numberValue("ap", 0, 100),
    damageDice: numberValue("damageDice", 0, 20),
    damageSides: numberValue("damageSides", 0, 100),
    damage: numberValue("damage", 0, 1024),
    damageReplacement: nullableNumberValue("damageReplacement", 0, 1024),
    firstFailedSaveDamageReplacement: nullableNumberValue(
      "firstFailedSaveDamageReplacement",
      0,
      1024,
    ),
    allocatedAttackDamageReplacement: numberValue("allocatedAttackDamageReplacement", 0, 1024),
    allocatedAttackDamageReplacementUses: numberValue(
      "allocatedAttackDamageReplacementUses",
      0,
      1024,
    ),
    allocatedAttackDamageReplacementSkip: numberValue(
      "allocatedAttackDamageReplacementSkip",
      0,
      1024,
    ),
    damageMultiplier: numberValue("damageMultiplier", 1, 1024),
    damageModifier: numberValue("damageModifier", -1024, 1024),
    characteristicModifierDice: numberValue("characteristicModifierDice", 0, 20),
    characteristicModifierSides: numberValue("characteristicModifierSides", 0, 100),
    characteristicModifierBonus: numberValue("characteristicModifierBonus", 0, 1024),
    characteristicModifierAttacks: booleanValue("characteristicModifierAttacks"),
    characteristicModifierStrength: booleanValue("characteristicModifierStrength"),
    characteristicModifierDamage: booleanValue("characteristicModifierDamage"),
    characteristicModifierGroup,
    criticalHits: numberValue("criticalHits", 2, 6),
    toughness: numberValue("toughness", 1, 1024),
    save: numberValue("save", 2, 7),
    invulnerable: optionalSave("invulnerable"),
    feelNoPain: optionalSave("feelNoPain"),
    wounds: numberValue("wounds", 1, 1024),
    targetModels: numberValue("targetModels", 1, 1000),
    reduction: numberValue("reduction", 0, 1024),
    damageDivisor: numberValue("damageDivisor", 1, 1024),
    criticalWounds: numberValue("criticalWounds", 0, 6),
    hitModifier: numberValue("hitModifier", -10, 10),
    woundModifier: numberValue("woundModifier", -10, 10),
    sustainedHitsDice: numberValue("sustainedHitsDice", 0, 20),
    sustainedHitsSides: numberValue("sustainedHitsSides", 0, 100),
    sustainedHits: numberValue("sustainedHits", 0, 1024),
    rapidFireDice: numberValue("rapidFireDice", 0, 20),
    rapidFireSides: numberValue("rapidFireSides", 0, 100),
    rapidFire: numberValue("rapidFire", 0, 100),
    melta: numberValue("melta", 0, 100),
    targetDistance: numberValue("targetDistance", 0, 1000),
    attackerCharged: booleanValue("attackerCharged"),
    attackerBattleShocked: booleanValue("attackerBattleShocked"),
    targetBattleShocked: booleanValue("targetBattleShocked"),
    targetStrengthState: targetStrengthState as TargetStrengthState,
    withinHalfRange: booleanValue("withinHalfRange"),
    torrent: booleanValue("torrent"),
    blast: booleanValue("blast"),
    heavyActive: booleanValue("heavyActive"),
    lanceActive: booleanValue("lanceActive"),
    targetCover: booleanValue("targetCover"),
    ignoresCover: booleanValue("ignoresCover"),
    indirect: booleanValue("indirect"),
    lethalHits: booleanValue("lethalHits"),
    devastatingWounds: booleanValue("devastatingWounds"),
    twinLinked: booleanValue("twinLinked"),
    rerollHits: booleanValue("rerollHits"),
    rerollHitOnes: booleanValue("rerollHitOnes"),
    rerollWounds: booleanValue("rerollWounds"),
    rerollWoundOnes: booleanValue("rerollWoundOnes"),
  };
  if (profile.criticalWounds === 1) {
    throw new Error("criticalWounds must be 0 or an integer from 2 to 6");
  }
  if (
    profile.firstFailedSaveDamageReplacement !== null &&
    profile.allocatedAttackDamageReplacementUses > 0 &&
    profile.firstFailedSaveDamageReplacement !== profile.allocatedAttackDamageReplacement
  ) {
    throw new Error("Damage replacement rules with different values must be resolved separately");
  }
  if (profile.attackDice > 0 && profile.attackSides < 2) {
    throw new Error("attackSides must be at least 2 when attackDice is non-zero");
  }
  if (profile.damageDice > 0 && profile.damageSides < 2) {
    throw new Error("damageSides must be at least 2 when damageDice is non-zero");
  }
  if (profile.sustainedHitsDice > 0 && profile.sustainedHitsSides < 2) {
    throw new Error("sustainedHitsSides must be at least 2 when sustainedHitsDice is non-zero");
  }
  if (profile.rapidFireDice > 0 && profile.rapidFireSides < 2) {
    throw new Error("rapidFireSides must be at least 2 when rapidFireDice is non-zero");
  }
  const hasCharacteristicModifier =
    profile.characteristicModifierAttacks ||
    profile.characteristicModifierStrength ||
    profile.characteristicModifierDamage;
  if (hasCharacteristicModifier && profile.characteristicModifierDice === 0) {
    throw new Error("A random characteristic modifier must roll at least one die");
  }
  if (profile.characteristicModifierDice > 0 && profile.characteristicModifierSides < 2) {
    throw new Error(
      "characteristicModifierSides must be at least 2 when characteristicModifierDice is non-zero",
    );
  }
  if (
    !hasCharacteristicModifier &&
    (profile.characteristicModifierDice !== 0 ||
      profile.characteristicModifierSides !== 0 ||
      profile.characteristicModifierBonus !== 0)
  ) {
    throw new Error("Select at least one characteristic for the random modifier");
  }
  if (!hasCharacteristicModifier && profile.characteristicModifierGroup) {
    throw new Error("A shared characteristic-roll group requires a random modifier");
  }
  if (profile.rerollHits && profile.rerollHitOnes) {
    throw new Error("Choose either Hit re-rolls of 1 or failed Hit re-rolls");
  }
  if (profile.rerollWounds && profile.rerollWoundOnes) {
    throw new Error("Choose either Wound re-rolls of 1 or failed Wound re-rolls");
  }
  return profile;
}

function secureRandomUint32() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

function rotateLeft(value: number, shift: number) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export function createSeededRandom(seed: number): RandomUint32 {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error("seed must be an unsigned 32-bit integer");
  }
  let splitState = seed >>> 0;
  const splitMix32 = () => {
    splitState = (splitState + 0x9e37_79b9) >>> 0;
    let value = splitState;
    value = Math.imul(value ^ (value >>> 16), 0x21f0_aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a_2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
  let state0 = splitMix32();
  let state1 = splitMix32();
  let state2 = splitMix32();
  let state3 = splitMix32();
  return () => {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5) >>> 0, 7), 9) >>> 0;
    const shifted = state1 << 9;
    state2 ^= state0;
    state3 ^= state1;
    state1 ^= state2;
    state0 ^= state3;
    state2 ^= shifted;
    state3 = rotateLeft(state3, 11);
    return result;
  };
}

function randomBelow(exclusiveMaximum: number, randomUint32: RandomUint32) {
  if (!Number.isInteger(exclusiveMaximum) || exclusiveMaximum < 1)
    throw new Error("Invalid die size");
  const range = 0x1_0000_0000;
  const limit = range - (range % exclusiveMaximum);
  let value = 0;
  do {
    value = randomUint32() >>> 0;
  } while (value >= limit);
  return value % exclusiveMaximum;
}

function rollDie(sides: number, randomUint32: RandomUint32) {
  return randomBelow(sides, randomUint32) + 1;
}

function rollDiceValue(count: number, sides: number, modifier: number, randomUint32: RandomUint32) {
  let total = modifier;
  for (let die = 0; die < count; die += 1) total += rollDie(sides, randomUint32);
  return total;
}

type SharedCharacteristicRoll = {
  dice: number;
  sides: number;
  bonus: number;
  outcome: number;
};

function resolveCharacteristicModifier(
  profile: CombatProfile,
  randomUint32: RandomUint32,
  sharedRolls?: Map<string, SharedCharacteristicRoll>,
) {
  if (profile.characteristicModifierDice === 0) return profile;
  const group = profile.characteristicModifierGroup;
  const shared = group && sharedRolls ? sharedRolls.get(group) : undefined;
  if (
    shared &&
    (shared.dice !== profile.characteristicModifierDice ||
      shared.sides !== profile.characteristicModifierSides ||
      shared.bonus !== profile.characteristicModifierBonus)
  ) {
    throw new Error("Profiles in one shared characteristic-roll group must use the same dice");
  }
  const modifier =
    shared?.outcome ??
    rollDiceValue(
      profile.characteristicModifierDice,
      profile.characteristicModifierSides,
      profile.characteristicModifierBonus,
      randomUint32,
    );
  if (group && sharedRolls && !shared) {
    sharedRolls.set(group, {
      dice: profile.characteristicModifierDice,
      sides: profile.characteristicModifierSides,
      bonus: profile.characteristicModifierBonus,
      outcome: modifier,
    });
  }
  return {
    ...profile,
    attacksModifier:
      profile.attacksModifier + (profile.characteristicModifierAttacks ? modifier : 0),
    strengthModifier:
      profile.strengthModifier + (profile.characteristicModifierStrength ? modifier : 0),
    damageModifier: profile.damageModifier + (profile.characteristicModifierDamage ? modifier : 0),
    characteristicModifierDice: 0,
    characteristicModifierSides: 0,
    characteristicModifierBonus: 0,
    characteristicModifierAttacks: false,
    characteristicModifierStrength: false,
    characteristicModifierDamage: false,
    characteristicModifierGroup: "",
  };
}

function modifiedCharacteristic(value: number, modifier: number, multiplier = 1) {
  return Math.max(1, value * multiplier + modifier);
}

function modifiedDamageCharacteristic(
  profile: CombatProfile,
  base: number,
  damageDivisor = profile.damageDivisor,
  reduction = profile.reduction,
  replacement = profile.damageReplacement,
) {
  const minimum = replacement === 0 ? 0 : 1;
  const additions =
    profile.damageModifier + (profile.withinHalfRange ? profile.melta : 0) - reduction;
  return Math.max(
    minimum,
    Math.ceil((base * profile.damageMultiplier) / damageDivisor + additions),
  );
}

function rollAttackCount(profile: CombatProfile, targetModels: number, randomUint32: RandomUint32) {
  let total = 0;
  for (let weapon = 0; weapon < profile.weaponCount; weapon += 1) {
    const base =
      profile.attacksReplacement > 0
        ? profile.attacksReplacement
        : rollDiceValue(profile.attackDice, profile.attackSides, profile.attacks, randomUint32);
    const additions =
      profile.attacksModifier +
      (profile.withinHalfRange
        ? rollDiceValue(
            profile.rapidFireDice,
            profile.rapidFireSides,
            profile.rapidFire,
            randomUint32,
          )
        : 0) +
      (profile.blast ? Math.floor(targetModels / 5) : 0);
    total += modifiedCharacteristic(base, additions, profile.attacksMultiplier);
  }
  return total;
}

function rollCheck(
  succeedsOn: number,
  criticalOn = 0,
  rerollFailures = false,
  autoFailsThrough = 0,
  randomUint32: RandomUint32,
  rerollOnes = false,
) {
  const first = rollDie(6, randomUint32);
  const succeeds = (face: number) =>
    attackRollSucceeds(face, succeedsOn, criticalOn, autoFailsThrough);
  if (!(rerollOnes && first === 1) && (!rerollFailures || succeeds(first))) {
    return { face: first, label: String(first) };
  }
  const second = rollDie(6, randomUint32);
  return { face: second, label: `${first}→${second}` };
}

export function simulateAttack(profile: CombatProfile, options: RollOptions = {}): RollResult {
  if (
    profile.firstFailedSaveDamageReplacement !== null &&
    profile.allocatedAttackDamageReplacementUses > 0 &&
    profile.firstFailedSaveDamageReplacement !== profile.allocatedAttackDamageReplacement
  ) {
    throw new Error("Damage replacement rules with different values must be resolved separately");
  }
  const randomUint32 = options.randomUint32 ?? secureRandomUint32;
  const includeDetails = options.details ?? true;
  profile = resolveCharacteristicModifier(profile, randomUint32);
  if (profile.torrent && profile.indirect) {
    throw new Error("Torrent weapons cannot fire indirectly when the target is not visible");
  }
  const attacks = rollAttackCount(profile, profile.targetModels, randomUint32);
  if (attacks > 10_000) {
    throw new Error("This roll is too large. Reduce the attack or weapon count.");
  }

  const hitsOn = modifiedRollTarget(
    profile.hitOn,
    profile.hitModifier + (profile.heavyActive ? 1 : 0) - (profile.indirect ? 1 : 0),
  );
  const woundsOn = modifiedRollTarget(
    woundTarget(
      modifiedCharacteristic(
        profile.strengthReplacement > 0 ? profile.strengthReplacement : profile.strength,
        profile.strengthModifier,
        profile.strengthMultiplier,
      ),
      profile.toughness,
    ),
    profile.woundModifier + (profile.lanceActive ? 1 : 0),
  );
  const savesOn = savingThrowTarget(
    profile.save,
    profile.invulnerable,
    profile.ap,
    (profile.targetCover || profile.indirect) && !profile.ignoresCover,
  );

  const result: RollResult = {
    attacks,
    attacksResolved: 0,
    hits: 0,
    criticalHits: 0,
    woundingAttacks: 0,
    savedAttacks: 0,
    unsavedAttacks: 0,
    fnpPrevented: 0,
    successfulAttacks: 0,
    totalDamage: 0,
    appliedDamage: 0,
    wastedDamage: 0,
    modelsDestroyed: 0,
    targetWoundsRemaining: profile.wounds,
    hitsOn,
    woundsOn,
    savesOn,
    details: [],
  };
  const addDetail = (detail: RollDetail) => {
    if (includeDetails) result.details.push(detail);
  };
  let firstFailedSaveReplacementRemaining = profile.firstFailedSaveDamageReplacement !== null;
  let allocatedReplacementUsesRemaining = profile.allocatedAttackDamageReplacementUses;
  let allocatedReplacementSkipRemaining = profile.allocatedAttackDamageReplacementSkip;

  const resolveHit = (
    label: string,
    hitLabel: string,
    lethalWound: boolean,
    allocatedDamageReplacement: number | null,
  ) => {
    result.hits += 1;
    let woundLabel = "Lethal ✓";
    let criticalWound = false;
    if (!lethalWound) {
      const wound = rollCheck(
        woundsOn,
        profile.criticalWounds || 6,
        profile.twinLinked || profile.rerollWounds,
        0,
        randomUint32,
        profile.rerollWoundOnes,
      );
      criticalWound = wound.face >= (profile.criticalWounds || 6);
      const wounded = criticalWound || wound.face >= woundsOn;
      woundLabel = `${wound.label}${criticalWound ? "★" : ""} ${wounded ? "✓" : "✕"}`;
      if (!wounded) {
        addDetail({
          label,
          hit: hitLabel,
          wound: woundLabel,
          save: "Not reached",
          fnp: "Not reached",
          damage: 0,
          appliedDamage: 0,
          wastedDamage: 0,
          outcome: "Failed to wound",
          tone: "failed",
        });
        return;
      }
    }

    result.woundingAttacks += 1;
    const bypassSave = criticalWound && profile.devastatingWounds;
    let saveLabel = "Bypassed";
    if (!bypassSave) {
      const save = rollDie(6, randomUint32);
      const saved = save >= savesOn;
      saveLabel = `${save} ${saved ? "✓" : "✕"}`;
      if (saved) {
        result.savedAttacks += 1;
        addDetail({
          label,
          hit: hitLabel,
          wound: woundLabel,
          save: saveLabel,
          fnp: "Not reached",
          damage: 0,
          appliedDamage: 0,
          wastedDamage: 0,
          outcome: "Saved",
          tone: "saved",
        });
        return;
      }
    }

    result.unsavedAttacks += 1;
    const failedSaveDamageReplacement =
      !bypassSave && firstFailedSaveReplacementRemaining
        ? profile.firstFailedSaveDamageReplacement
        : null;
    if (failedSaveDamageReplacement !== null) firstFailedSaveReplacementRemaining = false;
    const effectiveDamageReplacement =
      allocatedDamageReplacement ?? failedSaveDamageReplacement ?? profile.damageReplacement;
    const rawDamage = modifiedDamageCharacteristic(
      profile,
      allocatedDamageReplacement ??
        failedSaveDamageReplacement ??
        (profile.damageReplacement === null
          ? rollDiceValue(profile.damageDice, profile.damageSides, profile.damage, randomUint32)
          : profile.damageReplacement),
      profile.damageDivisor,
      profile.reduction,
      effectiveDamageReplacement,
    );
    let prevented = 0;
    if (profile.feelNoPain > 0) {
      for (let point = 0; point < rawDamage; point += 1) {
        if (rollDie(6, randomUint32) >= profile.feelNoPain) prevented += 1;
      }
    }
    const damage = rawDamage - prevented;
    result.fnpPrevented += prevented;
    result.totalDamage += damage;
    const allocation = allocateDamageToUnit(
      result.appliedDamage,
      damage,
      profile.wounds,
      profile.targetModels,
    );
    result.appliedDamage = allocation.applied;
    result.wastedDamage += allocation.wasted;
    result.modelsDestroyed = allocation.modelsDestroyed;
    result.targetWoundsRemaining = allocation.woundsRemaining;
    if (damage > 0) result.successfulAttacks += 1;
    addDetail({
      label,
      hit: hitLabel,
      wound: woundLabel,
      save: saveLabel,
      fnp: profile.feelNoPain > 0 ? `${prevented} prevented` : "None",
      damage,
      appliedDamage: allocation.appliedThisAttack,
      wastedDamage: allocation.wasted,
      outcome:
        damage === 0
          ? rawDamage === 0
            ? "Damage changed to 0"
            : "Stopped by FNP"
          : allocation.wasted > 0
            ? `${allocation.appliedThisAttack} applied · ${allocation.wasted} lost`
            : `${allocation.appliedThisAttack} applied`,
      tone: damage > 0 ? "damage" : "prevented",
    });
  };

  for (let attack = 1; attack <= attacks; attack += 1) {
    if (result.modelsDestroyed >= profile.targetModels) break;
    result.attacksResolved += 1;
    let allocatedDamageReplacement: number | null = null;
    if (allocatedReplacementSkipRemaining > 0) allocatedReplacementSkipRemaining -= 1;
    else if (allocatedReplacementUsesRemaining > 0) {
      allocatedReplacementUsesRemaining -= 1;
      allocatedDamageReplacement = profile.allocatedAttackDamageReplacement;
    }
    if (profile.torrent) {
      resolveHit(`#${attack}`, "Auto ✓", false, allocatedDamageReplacement);
      continue;
    }
    const autoFailsThrough = profile.indirect ? 3 : 0;
    const hit = rollCheck(
      hitsOn,
      profile.criticalHits,
      profile.rerollHits,
      autoFailsThrough,
      randomUint32,
      profile.rerollHitOnes,
    );
    const hitSucceeded = attackRollSucceeds(
      hit.face,
      hitsOn,
      profile.criticalHits,
      autoFailsThrough,
    );
    const criticalHit = hitSucceeded && hit.face >= profile.criticalHits;
    const hitLabel = `${hit.label}${criticalHit ? "★" : ""} ${hitSucceeded ? "✓" : "✕"}`;
    if (!hitSucceeded) {
      addDetail({
        label: `#${attack}`,
        hit: hitLabel,
        wound: "Not reached",
        save: "Not reached",
        fnp: "Not reached",
        damage: 0,
        appliedDamage: 0,
        wastedDamage: 0,
        outcome: "Missed",
        tone: "failed",
      });
      continue;
    }
    if (criticalHit) result.criticalHits += 1;
    resolveHit(
      `#${attack}`,
      hitLabel,
      criticalHit && profile.lethalHits,
      allocatedDamageReplacement,
    );
    if (criticalHit) {
      const sustainedHits = rollDiceValue(
        profile.sustainedHitsDice,
        profile.sustainedHitsSides,
        profile.sustainedHits,
        randomUint32,
      );
      for (let extra = 1; extra <= sustainedHits; extra += 1) {
        if (result.modelsDestroyed >= profile.targetModels) break;
        resolveHit(`#${attack}.S${extra}`, "Sustained ✓", false, allocatedDamageReplacement);
      }
    }
  }
  return result;
}

export function simulateOrderedVolley(
  profiles: CombatProfile[],
  targets: VolleyTarget[],
  initialWoundsLost = 0,
  options: RollOptions = {},
): OrderedVolleyRollResult {
  const randomUint32 = options.randomUint32 ?? secureRandomUint32;
  const includeDetails = options.details ?? true;
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  const capacity = targetSequenceCapacity(targets);
  if (
    !Number.isSafeInteger(initialWoundsLost) ||
    initialWoundsLost < 0 ||
    initialWoundsLost >= targets[0].wounds
  ) {
    throw new Error("initialWoundsLost must fit on the first target model");
  }
  const targetModels = targets.reduce((total, target) => total + target.modelCount, 0);
  let appliedState = initialWoundsLost;
  const lines: RollResult[] = [];
  const sharedCharacteristicRolls = new Map<string, SharedCharacteristicRoll>();
  const replacementValues = targets.map((target) => target.firstFailedSaveDamageReplacement);
  if (new Set(replacementValues.map((value) => String(value))).size > 1) {
    throw new Error("Target segments must share the same first-failed-save Damage replacement");
  }
  let firstFailedSaveReplacementRemaining = replacementValues[0] !== null;
  const allocatedReplacementConfigs = targets.map((target) =>
    JSON.stringify([
      target.allocatedAttackDamageReplacement,
      target.allocatedAttackDamageReplacementUses,
      target.allocatedAttackDamageReplacementSkip,
    ]),
  );
  if (new Set(allocatedReplacementConfigs).size > 1) {
    throw new Error("Target segments must share the allocated-attack Damage replacement policy");
  }
  let allocatedReplacementUsesRemaining = targets[0].allocatedAttackDamageReplacementUses;
  let allocatedReplacementSkipRemaining = targets[0].allocatedAttackDamageReplacementSkip;
  if (
    firstFailedSaveReplacementRemaining &&
    allocatedReplacementUsesRemaining > 0 &&
    targets[0].firstFailedSaveDamageReplacement !== targets[0].allocatedAttackDamageReplacement
  ) {
    throw new Error("Damage replacement rules with different values must be resolved separately");
  }
  const deferredDevastatingWounds: Array<() => void> = [];

  for (const sourceProfile of profiles) {
    if (sourceProfile.torrent && sourceProfile.indirect) {
      throw new Error("Torrent weapons cannot fire indirectly when the target is not visible");
    }
    const profile = resolveCharacteristicModifier(
      { ...sourceProfile, targetModels },
      randomUint32,
      sharedCharacteristicRolls,
    );
    const attacks = rollAttackCount(profile, targetModels, randomUint32);
    if (attacks > 10_000) {
      throw new Error("This roll is too large. Reduce the attack or weapon count.");
    }
    const hitsOn = modifiedRollTarget(
      profile.hitOn,
      profile.hitModifier + (profile.heavyActive ? 1 : 0) - (profile.indirect ? 1 : 0),
    );
    const line: RollResult = {
      attacks,
      attacksResolved: 0,
      hits: 0,
      criticalHits: 0,
      woundingAttacks: 0,
      savedAttacks: 0,
      unsavedAttacks: 0,
      fnpPrevented: 0,
      successfulAttacks: 0,
      totalDamage: 0,
      appliedDamage: 0,
      wastedDamage: 0,
      modelsDestroyed: 0,
      targetWoundsRemaining: capacity - appliedState,
      hitsOn,
      woundsOn: 0,
      savesOn: 0,
      details: [],
    };
    const addDetail = (detail: RollDetail) => {
      if (includeDetails) line.details.push(detail);
    };
    const resolveHit = (
      label: string,
      hitLabel: string,
      lethalWound: boolean,
      allocatedDamageReplacement: number | null,
    ) => {
      const position = targetSequencePosition(appliedState, targets);
      if (!position) return;
      const target = targets[position.segmentIndex];
      const woundsOn = modifiedRollTarget(
        woundTarget(
          modifiedCharacteristic(
            profile.strengthReplacement > 0 ? profile.strengthReplacement : profile.strength,
            profile.strengthModifier,
            profile.strengthMultiplier,
          ),
          target.toughness,
        ),
        profile.woundModifier + (profile.lanceActive ? 1 : 0),
      );
      const savesOn = savingThrowTarget(
        target.save,
        target.invulnerable,
        profile.ap,
        (profile.targetCover || profile.indirect) && !profile.ignoresCover,
      );
      line.woundsOn = woundsOn;
      line.savesOn = savesOn;
      line.hits += 1;
      let woundLabel = "Lethal ✓";
      let criticalWound = false;
      if (!lethalWound) {
        const wound = rollCheck(
          woundsOn,
          profile.criticalWounds || 6,
          profile.twinLinked || profile.rerollWounds,
          0,
          randomUint32,
          profile.rerollWoundOnes,
        );
        criticalWound = wound.face >= (profile.criticalWounds || 6);
        const wounded = criticalWound || wound.face >= woundsOn;
        woundLabel = `${wound.label}${criticalWound ? "★" : ""} ${wounded ? "✓" : "✕"}`;
        if (!wounded) {
          addDetail({
            label,
            hit: hitLabel,
            wound: woundLabel,
            save: "Not reached",
            fnp: "Not reached",
            damage: 0,
            appliedDamage: 0,
            wastedDamage: 0,
            outcome: "Failed to wound",
            tone: "failed",
          });
          return;
        }
      }
      line.woundingAttacks += 1;
      const bypassSave = criticalWound && profile.devastatingWounds;
      let saveLabel = "Bypassed";
      if (!bypassSave) {
        const save = rollDie(6, randomUint32);
        const saved = save >= savesOn;
        saveLabel = `${save} ${saved ? "✓" : "✕"}`;
        if (saved) {
          line.savedAttacks += 1;
          addDetail({
            label,
            hit: hitLabel,
            wound: woundLabel,
            save: saveLabel,
            fnp: "Not reached",
            damage: 0,
            appliedDamage: 0,
            wastedDamage: 0,
            outcome: "Saved",
            tone: "saved",
          });
          return;
        }
      }
      line.unsavedAttacks += 1;
      const failedSaveDamageReplacement =
        !bypassSave && firstFailedSaveReplacementRemaining
          ? target.firstFailedSaveDamageReplacement
          : null;
      if (failedSaveDamageReplacement !== null) firstFailedSaveReplacementRemaining = false;
      const effectiveDamageReplacement =
        allocatedDamageReplacement ?? failedSaveDamageReplacement ?? profile.damageReplacement;
      const detail: RollDetail = {
        label,
        hit: hitLabel,
        wound: woundLabel,
        save: saveLabel,
        fnp: bypassSave ? "Deferred" : "Not reached",
        damage: 0,
        appliedDamage: 0,
        wastedDamage: 0,
        outcome: bypassSave ? "Devastating Wounds · resolves last" : "Resolving",
        tone: "damage",
      };
      addDetail(detail);

      const resolveDamage = () => {
        const allocationPosition = targetSequencePosition(appliedState, targets);
        if (!allocationPosition) {
          detail.fnp = "Not reached";
          detail.outcome = "Target already destroyed";
          detail.tone = "failed";
          return;
        }
        const allocationTarget = targets[allocationPosition.segmentIndex];
        const rawDamage = modifiedDamageCharacteristic(
          profile,
          allocatedDamageReplacement ??
            failedSaveDamageReplacement ??
            (profile.damageReplacement === null
              ? rollDiceValue(profile.damageDice, profile.damageSides, profile.damage, randomUint32)
              : profile.damageReplacement),
          allocationTarget.damageDivisor,
          allocationTarget.reduction,
          effectiveDamageReplacement,
        );
        let prevented = 0;
        if (allocationTarget.feelNoPain > 0) {
          for (let point = 0; point < rawDamage; point += 1) {
            if (rollDie(6, randomUint32) >= allocationTarget.feelNoPain) prevented += 1;
          }
        }
        const damage = rawDamage - prevented;
        line.fnpPrevented += prevented;
        line.totalDamage += damage;
        const modelsBefore = allocationPosition.modelsDestroyed;
        const allocation = allocateDamageToSequence(appliedState, damage, targets);
        appliedState = allocation.applied;
        line.appliedDamage += allocation.appliedThisAttack;
        line.wastedDamage += allocation.wasted;
        line.modelsDestroyed += allocation.modelsDestroyed - modelsBefore;
        line.targetWoundsRemaining = capacity - appliedState;
        if (damage > 0) line.successfulAttacks += 1;
        detail.fnp = allocationTarget.feelNoPain > 0 ? `${prevented} prevented` : "None";
        detail.damage = damage;
        detail.appliedDamage = allocation.appliedThisAttack;
        detail.wastedDamage = allocation.wasted;
        detail.outcome =
          damage === 0
            ? rawDamage === 0
              ? "Damage changed to 0"
              : "Stopped by FNP"
            : allocation.wasted > 0
              ? `${allocation.appliedThisAttack} applied · ${allocation.wasted} lost`
              : `${allocation.appliedThisAttack} applied`;
        detail.tone = damage > 0 ? "damage" : "prevented";
      };

      if (bypassSave) deferredDevastatingWounds.push(resolveDamage);
      else resolveDamage();
    };

    for (let attack = 1; attack <= attacks && appliedState < capacity; attack += 1) {
      line.attacksResolved += 1;
      let allocatedDamageReplacement: number | null = null;
      if (allocatedReplacementSkipRemaining > 0) allocatedReplacementSkipRemaining -= 1;
      else if (allocatedReplacementUsesRemaining > 0) {
        allocatedReplacementUsesRemaining -= 1;
        allocatedDamageReplacement = targets[0].allocatedAttackDamageReplacement;
      }
      if (profile.torrent) {
        resolveHit(`#${attack}`, "Auto ✓", false, allocatedDamageReplacement);
        continue;
      }
      const autoFailsThrough = profile.indirect ? 3 : 0;
      const hit = rollCheck(
        hitsOn,
        profile.criticalHits,
        profile.rerollHits,
        autoFailsThrough,
        randomUint32,
        profile.rerollHitOnes,
      );
      const hitSucceeded = attackRollSucceeds(
        hit.face,
        hitsOn,
        profile.criticalHits,
        autoFailsThrough,
      );
      const criticalHit = hitSucceeded && hit.face >= profile.criticalHits;
      const hitLabel = `${hit.label}${criticalHit ? "★" : ""} ${hitSucceeded ? "✓" : "✕"}`;
      if (!hitSucceeded) {
        addDetail({
          label: `#${attack}`,
          hit: hitLabel,
          wound: "Not reached",
          save: "Not reached",
          fnp: "Not reached",
          damage: 0,
          appliedDamage: 0,
          wastedDamage: 0,
          outcome: "Missed",
          tone: "failed",
        });
        continue;
      }
      if (criticalHit) line.criticalHits += 1;
      resolveHit(
        `#${attack}`,
        hitLabel,
        criticalHit && profile.lethalHits,
        allocatedDamageReplacement,
      );
      if (criticalHit) {
        const sustainedHits = rollDiceValue(
          profile.sustainedHitsDice,
          profile.sustainedHitsSides,
          profile.sustainedHits,
          randomUint32,
        );
        for (let extra = 1; extra <= sustainedHits && appliedState < capacity; extra += 1) {
          resolveHit(`#${attack}.S${extra}`, "Sustained ✓", false, allocatedDamageReplacement);
        }
      }
    }
    line.targetWoundsRemaining = capacity - appliedState;
    lines.push(line);
  }

  for (const resolveDamage of deferredDevastatingWounds) resolveDamage();

  const sum = (key: keyof RollResult) =>
    lines.reduce((total, line) => total + (line[key] as number), 0);
  return {
    attacks: sum("attacks"),
    attacksResolved: sum("attacksResolved"),
    hits: sum("hits"),
    criticalHits: sum("criticalHits"),
    woundingAttacks: sum("woundingAttacks"),
    savedAttacks: sum("savedAttacks"),
    unsavedAttacks: sum("unsavedAttacks"),
    fnpPrevented: sum("fnpPrevented"),
    successfulAttacks: sum("successfulAttacks"),
    totalDamage: sum("totalDamage"),
    appliedDamage: appliedState - initialWoundsLost,
    wastedDamage: sum("wastedDamage"),
    modelsDestroyed: targetSequencePosition(appliedState, targets)?.modelsDestroyed ?? targetModels,
    targetWoundsRemaining: capacity - appliedState,
    lines,
  };
}

export function simulateOrderedVolleyPhase(
  profiles: CombatProfile[],
  targets: VolleyTarget[],
  seed: number,
  trials: number,
  initialWoundsLost = 0,
): PhaseSimulationResult {
  if (!Number.isInteger(trials) || trials < 100 || trials > 100_000) {
    throw new Error("trials must be an integer from 100 to 100000");
  }
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  targetSequenceCapacity(targets);
  const targetModels = targets.reduce((total, target) => total + target.modelCount, 0);
  const hasFeelNoPain = targets.some((target) => target.feelNoPain > 0);
  const countedCharacteristicGroups = new Set<string>();
  const randomDrawsPerVolley = profiles.reduce((total, profile) => {
    const maximumCharacteristicModifier =
      profile.characteristicModifierBonus +
      profile.characteristicModifierDice * profile.characteristicModifierSides;
    const randomAttackDraws =
      profile.attacksReplacement > 0 ? 0 : profile.attackDice * profile.weaponCount;
    const rapidFireDraws = profile.withinHalfRange
      ? profile.rapidFireDice * profile.weaponCount
      : 0;
    const maximumBaseAttacks =
      profile.attacksReplacement > 0
        ? profile.attacksReplacement
        : profile.attacks + profile.attackDice * profile.attackSides;
    const maximumAdditionalAttacks =
      profile.attacksModifier +
      (profile.characteristicModifierAttacks ? maximumCharacteristicModifier : 0) +
      (profile.blast ? Math.floor(targetModels / 5) : 0) +
      (profile.withinHalfRange
        ? profile.rapidFire + profile.rapidFireDice * profile.rapidFireSides
        : 0);
    const maximumAttacks =
      profile.weaponCount *
      modifiedCharacteristic(
        maximumBaseAttacks,
        maximumAdditionalAttacks,
        profile.attacksMultiplier,
      );
    const maximumSustainedHits =
      profile.sustainedHits + profile.sustainedHitsDice * profile.sustainedHitsSides;
    const maximumResolvedHits = maximumAttacks * (1 + maximumSustainedHits);
    const maximumDamage = modifiedDamageCharacteristic(
      {
        ...profile,
        damageModifier:
          profile.damageModifier +
          (profile.characteristicModifierDamage ? maximumCharacteristicModifier : 0),
      },
      profile.damageReplacement === null
        ? profile.damage + profile.damageDice * profile.damageSides
        : profile.damageReplacement,
      1,
      0,
    );
    const drawsPerResolvedHit =
      (profile.torrent ? 0 : profile.rerollHits || profile.rerollHitOnes ? 2 : 1) +
      (profile.twinLinked || profile.rerollWounds || profile.rerollWoundOnes ? 2 : 1) +
      1 +
      (profile.damageReplacement === null ? profile.damageDice : 0) +
      (hasFeelNoPain ? maximumDamage : 0);
    const characteristicDraws =
      profile.characteristicModifierGroup &&
      countedCharacteristicGroups.has(profile.characteristicModifierGroup)
        ? 0
        : profile.characteristicModifierDice;
    if (profile.characteristicModifierGroup) {
      countedCharacteristicGroups.add(profile.characteristicModifierGroup);
    }
    return (
      total +
      characteristicDraws +
      randomAttackDraws +
      rapidFireDraws +
      maximumAttacks * profile.sustainedHitsDice +
      maximumResolvedHits * drawsPerResolvedHit
    );
  }, 0);
  if (randomDrawsPerVolley * trials > 25_000_000) {
    throw new Error("This simulation is too large. Reduce the trial, attack, or weapon count.");
  }
  const randomUint32 = createSeededRandom(seed);
  const histogram = new Map<number, number>();
  const metricKeys = [
    "attacksResolved",
    "hits",
    "criticalHits",
    "woundingAttacks",
    "savedAttacks",
    "fnpPrevented",
    "successfulAttacks",
    "wastedDamage",
  ] as const;
  const totals = Object.fromEntries(metricKeys.map((key) => [key, 0])) as Record<
    (typeof metricKeys)[number],
    number
  >;
  let damageTotal = 0;
  let damageSquaredTotal = 0;
  let destroyedTrials = 0;
  let modelsDestroyedTotal = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const result = simulateOrderedVolley(profiles, targets, initialWoundsLost, {
      randomUint32,
      details: false,
    });
    histogram.set(result.appliedDamage, (histogram.get(result.appliedDamage) ?? 0) + 1);
    damageTotal += result.appliedDamage;
    damageSquaredTotal += result.appliedDamage * result.appliedDamage;
    if (result.targetWoundsRemaining === 0) destroyedTrials += 1;
    modelsDestroyedTotal += result.modelsDestroyed;
    for (const key of metricKeys) totals[key] += result[key];
  }

  const outcomes = [...histogram].sort(([left], [right]) => left - right);
  const quantile = (fraction: number) => {
    const rank = Math.ceil(trials * fraction);
    let cumulative = 0;
    for (const [damage, count] of outcomes) {
      cumulative += count;
      if (cumulative >= rank) return damage;
    }
    return outcomes.at(-1)?.[0] ?? 0;
  };
  const mean = damageTotal / trials;
  return {
    algorithm: "xoshiro128ss-v1",
    seed: seed >>> 0,
    trials,
    minimum: outcomes[0]?.[0] ?? 0,
    firstQuartile: quantile(0.25),
    median: quantile(0.5),
    thirdQuartile: quantile(0.75),
    maximum: outcomes.at(-1)?.[0] ?? 0,
    mean,
    standardDeviation: Math.sqrt(Math.max(0, damageSquaredTotal / trials - mean * mean)),
    zeroDamageChance: (histogram.get(0) ?? 0) / trials,
    unitDestroyedChance: destroyedTrials / trials,
    meanModelsDestroyed: modelsDestroyedTotal / trials,
    means: Object.fromEntries(metricKeys.map((key) => [key, totals[key] / trials])) as Record<
      (typeof metricKeys)[number],
      number
    >,
    histogram: outcomes.map(([damage, count]) => ({
      damage,
      count,
      probability: count / trials,
    })),
  };
}
