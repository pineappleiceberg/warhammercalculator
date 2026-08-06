import type { CombatProfile } from "./combat";

export type DamageSummary = {
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  mean: number;
  appliedMinimum: number;
  appliedFirstQuartile: number;
  appliedMedian: number;
  appliedThirdQuartile: number;
  appliedMaximum: number;
  appliedMean: number;
};

type WasmModule = {
  _malloc(size: number): number;
  _free(pointer: number): void;
  _whc_calculate_summary(...values: number[]): number;
  getValue(pointer: number, type: "i32"): number;
};

let modulePromise: Promise<WasmModule> | null = null;

async function loadCalculator() {
  modulePromise ??= (async () => {
    const modulePath = new URL("wasm/calculator.js", document.baseURI).href;
    const importModule = Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<{
      default(options: { locateFile(file: string): string }): Promise<WasmModule>;
    }>;
    const imported = await importModule(modulePath);
    return imported.default({
      locateFile: (file) => new URL(`wasm/${file}`, document.baseURI).href,
    });
  })();
  return modulePromise;
}

export async function calculateProfile(profile: CombatProfile): Promise<DamageSummary> {
  const calculator = await loadCalculator();
  const output = calculator._malloc(72);
  const flags =
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && profile.rapidFire > 0 ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0);
  try {
    const ok = calculator._whc_calculate_summary(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
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
      profile.sustainedHits,
      profile.rapidFire,
      profile.melta,
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
      appliedMinimum: read(9),
      appliedFirstQuartile: read(10),
      appliedMedian: read(11),
      appliedThirdQuartile: read(12),
      appliedMaximum: read(13),
      appliedMean: Number(appliedNumerator) / Number(appliedDenominator),
    };
  } finally {
    calculator._free(output);
  }
}
