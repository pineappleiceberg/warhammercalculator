import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../../tests/rules_interaction_cases.inc", import.meta.url),
  "utf8",
);

export const rulesInteractionCases = [...source.matchAll(/WHC_RULE_CASE\(([^)]+)\)/g)].map(
  (match) => {
    const [name, ...rawValues] = match[1].split(",").map((value) => value.trim());
    const values = rawValues.map(Number);
    if (values.length !== 21 || values.some((value) => !Number.isSafeInteger(value))) {
      throw new Error(`Invalid rules interaction case: ${name}`);
    }
    const [
      attacks,
      hitOn,
      strength,
      ap,
      damage,
      criticalHits,
      toughness,
      save,
      invulnerable,
      feelNoPain,
      wounds,
      targetModels,
      flags,
      criticalWounds,
      sustainedHits,
      hitModifier,
      woundModifier,
      expectedNumerator,
      expectedDenominator,
      appliedNumerator,
      appliedDenominator,
    ] = values;
    return Object.freeze({
      name,
      attacks,
      hitOn,
      strength,
      ap,
      damage,
      criticalHits,
      toughness,
      save,
      invulnerable,
      feelNoPain,
      wounds,
      targetModels,
      flags,
      criticalWounds,
      sustainedHits,
      hitModifier,
      woundModifier,
      expected: Object.freeze({
        numerator: BigInt(expectedNumerator),
        denominator: BigInt(expectedDenominator),
      }),
      applied: Object.freeze({
        numerator: BigInt(appliedNumerator),
        denominator: BigInt(appliedDenominator),
      }),
    });
  },
);

if (rulesInteractionCases.length === 0) {
  throw new Error("Rules interaction corpus is empty");
}
if (
  new Set(rulesInteractionCases.map((testCase) => testCase.name)).size !==
    rulesInteractionCases.length ||
  rulesInteractionCases.some(
    (testCase) => testCase.expected.denominator <= 0n || testCase.applied.denominator <= 0n,
  )
) {
  throw new Error("Rules interaction corpus has duplicate names or invalid fractions");
}
