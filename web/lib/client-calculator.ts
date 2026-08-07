import type { CombatProfile } from "./combat";

export type DamageSummary = {
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  mean: number;
  exactMean: { numerator: string; denominator: string };
  appliedMinimum: number;
  appliedFirstQuartile: number;
  appliedMedian: number;
  appliedThirdQuartile: number;
  appliedMaximum: number;
  appliedMean: number;
  exactAppliedMean: { numerator: string; denominator: string };
};

export type OrderedTargetSegment = {
  toughness: number;
  save: number;
  invulnerable: number;
  feelNoPain: number;
  wounds: number;
  reduction: number;
  damageDivisor: number;
  modelCount: number;
};

export type OrderedVolleySummary = {
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  mean: number;
  cumulativeMeans: number[];
  incrementalMeans: number[];
  peakSparseStates: number;
};

export type ExactComplexity = {
  estimatedStateUpperBound: number;
  stateLimit: number;
  maximumAttackEvents: number;
  targetCapacity: number;
  usesDeferredStates: boolean;
  exactGuaranteedByBound: boolean;
};

export class ExactCalculationLimitError extends Error {
  constructor() {
    super("The exact state budget was exceeded; use the seeded simulation fallback");
    this.name = "ExactCalculationLimitError";
  }
}

type WasmModule = {
  _malloc(size: number): number;
  _free(pointer: number): void;
  _whc_calculate_summary(...values: number[]): number;
  _whc_calculate_ordered_volley_summary(...values: number[]): number;
  _whc_estimate_ordered_volley_complexity(...values: number[]): number;
  getValue(pointer: number, type: "i32"): number;
  setValue(pointer: number, value: number, type: "i32"): void;
};

let modulePromise: Promise<WasmModule> | null = null;

async function loadCalculator() {
  modulePromise ??= (async () => {
    const publicRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
    const modulePath = new URL("wasm/calculator.js", publicRoot).href;
    const importModule = Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<{
      default(options: { locateFile(file: string): string }): Promise<WasmModule>;
    }>;
    const imported = await importModule(modulePath);
    return imported.default({
      locateFile: (file) => new URL("wasm/" + file, publicRoot).href,
    });
  })();
  return modulePromise;
}

function weaponValues(profile: CombatProfile) {
  return [
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
  ];
}

function targetValues(target: OrderedTargetSegment) {
  return [
    target.toughness,
    target.save,
    target.invulnerable,
    target.feelNoPain,
    target.wounds,
    target.reduction,
    target.modelCount,
    target.damageDivisor,
  ];
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

export async function calculateProfile(profile: CombatProfile): Promise<DamageSummary> {
  const calculator = await loadCalculator();
  const output = calculator._malloc(72);
  const flags = profileFlags(profile);
  try {
    const ok = calculator._whc_calculate_summary(
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
      output,
    );
    if (!ok) throw new Error("That unit profile exceeds the exact calculator limits");
    const read = (index: number) => calculator.getValue(output + index * 4, "i32") >>> 0;
    const numerator = (BigInt(read(6)) << BigInt(32)) | BigInt(read(5));
    const denominator = (BigInt(read(8)) << BigInt(32)) | BigInt(read(7));
    const appliedNumerator = (BigInt(read(15)) << BigInt(32)) | BigInt(read(14));
    const appliedDenominator = (BigInt(read(17)) << BigInt(32)) | BigInt(read(16));
    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      mean: Number(numerator) / Number(denominator),
      exactMean: { numerator: numerator.toString(), denominator: denominator.toString() },
      appliedMinimum: read(9),
      appliedFirstQuartile: read(10),
      appliedMedian: read(11),
      appliedThirdQuartile: read(12),
      appliedMaximum: read(13),
      appliedMean: Number(appliedNumerator) / Number(appliedDenominator),
      exactAppliedMean: {
        numerator: appliedNumerator.toString(),
        denominator: appliedDenominator.toString(),
      },
    };
  } finally {
    calculator._free(output);
  }
}

export async function calculateOrderedVolley(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost = 0,
): Promise<OrderedVolleySummary> {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new Error("An ordered volley must contain 1 to 32 weapon profiles");
  }
  if (targets.length < 1 || targets.length > 16) {
    throw new Error("A target sequence must contain 1 to 16 profile segments");
  }
  const capacity = targets.reduce((sum, target) => sum + target.wounds * target.modelCount, 0);
  if (
    !Number.isInteger(initialWoundsLost) ||
    initialWoundsLost < 0 ||
    initialWoundsLost >= targets[0].wounds ||
    capacity > 1024
  ) {
    throw new Error("The target sequence exceeds the exact calculator limits");
  }

  const calculator = await loadCalculator();
  const weaponFields = 29;
  const targetFields = 8;
  const weaponsPointer = calculator._malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator._malloc(10 * 4);
  const meansPointer = calculator._malloc(profiles.length * 4 * 4);
  const write = (pointer: number, values: number[]) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  const read = (pointer: number, index: number) =>
    calculator.getValue(pointer + index * 4, "i32") >>> 0;
  const fraction = (pointer: number) => {
    const numerator = (BigInt(read(pointer, 1)) << 32n) | BigInt(read(pointer, 0));
    const denominator = (BigInt(read(pointer, 3)) << 32n) | BigInt(read(pointer, 2));
    return Number(numerator) / Number(denominator);
  };

  try {
    profiles.forEach((profile, index) => {
      write(weaponsPointer + index * weaponFields * 4, weaponValues(profile));
    });
    targets.forEach((target, index) => {
      write(targetsPointer + index * targetFields * 4, targetValues(target));
    });
    const ok = calculator._whc_calculate_ordered_volley_summary(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      summaryPointer,
      meansPointer,
    );
    if (!ok) throw new ExactCalculationLimitError();
    const cumulativeMeans = profiles.map((_, index) => fraction(meansPointer + index * 16));
    return {
      minimum: read(summaryPointer, 0),
      firstQuartile: read(summaryPointer, 1),
      median: read(summaryPointer, 2),
      thirdQuartile: read(summaryPointer, 3),
      maximum: read(summaryPointer, 4),
      mean: fraction(summaryPointer + 5 * 4),
      peakSparseStates: read(summaryPointer, 9),
      cumulativeMeans,
      incrementalMeans: cumulativeMeans.map(
        (mean, index) => mean - (index === 0 ? 0 : cumulativeMeans[index - 1]),
      ),
    };
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(summaryPointer);
    calculator._free(meansPointer);
  }
}

export async function estimateOrderedVolleyComplexity(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost = 0,
): Promise<ExactComplexity> {
  if (profiles.length < 1 || profiles.length > 32 || targets.length < 1 || targets.length > 16) {
    throw new Error("Choose a valid weapon and target sequence first");
  }
  const calculator = await loadCalculator();
  const weaponFields = 29;
  const targetFields = 8;
  const weaponsPointer = calculator._malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const outputPointer = calculator._malloc(6 * 4);
  const write = (pointer: number, values: number[]) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  const read = (index: number) => calculator.getValue(outputPointer + index * 4, "i32") >>> 0;
  try {
    profiles.forEach((profile, index) =>
      write(weaponsPointer + index * weaponFields * 4, weaponValues(profile)),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, targetValues(target)),
    );
    const ok = calculator._whc_estimate_ordered_volley_complexity(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      outputPointer,
    );
    if (!ok) throw new Error("The exact-complexity estimate could not be calculated");
    return {
      estimatedStateUpperBound: read(0),
      stateLimit: read(1),
      maximumAttackEvents: read(2),
      targetCapacity: read(3),
      usesDeferredStates: read(4) !== 0,
      exactGuaranteedByBound: read(5) !== 0,
    };
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(outputPointer);
  }
}
