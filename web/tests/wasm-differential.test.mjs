import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attackRollSucceeds,
  modifiedRollTarget,
  savingThrowTarget,
  woundTarget,
} from "../lib/thresholds.mjs";
import {
  allocateDamageToSequence,
  allocateDamageToUnit,
  targetSequencePosition,
} from "../lib/allocation.mjs";
import { abilityDiceValue } from "../lib/dice.mjs";
import { rulesInteractionCases } from "./rules-interaction-corpus.mjs";
import {
  applyChoiceSelectionChange,
  applyLoadoutSubjectCountChange,
  applyModelCountChange,
  armyListWeaponsFromGroups,
  choicePoolMaximum,
  choiceSelectionWeaponCounts,
  defaultWeaponCounts,
  defaultLoadoutSubjectCounts,
  equippedWeaponLines,
  groupWeaponProfiles,
  loadoutSubjectWeaponCounts,
  normalizeEquippedCount,
  sourceEquippedWeaponCounts,
  unitLoadoutWarnings,
  weaponAllocationErrors,
  weaponLimitMaximum,
} from "../lib/loadout.mjs";

globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = dirname(fileURLToPath(import.meta.url));
const { default: createCalculator } = await import("../public/wasm/calculator.js");
const wasmDirectory = new URL("../public/wasm/", import.meta.url);
const wasmBinary = await readFile(new URL("calculator.wasm", wasmDirectory));
const calculator = await createCalculator({
  locateFile: (file) => fileURLToPath(new URL(file, wasmDirectory)),
  wasmBinary,
});

test("WebAssembly exports the formally verified validators", () => {
  assert.equal(typeof calculator._dice_value_is_valid, "function");
  assert.equal(typeof calculator._probability_distribution_is_normalized, "function");
  assert.equal(typeof calculator._attack_plan_is_valid, "function");
  assert.equal(typeof calculator._whc_estimate_ordered_volley_complexity, "function");
});

test("source choice pools share allowances and preserve compound bundles", () => {
  const unit = {
    name: "Dreadnought",
    suggestedModelCount: 1,
    maximumModelCount: 1,
    weaponLimits: [],
    weapons: [
      { groupId: "unit:flamer", groupName: "Flamer" },
      { groupId: "unit:bolter", groupName: "Bolter" },
    ],
    defaultWeapons: [
      {
        groupId: "unit:bolter",
        groupName: "Bolter",
        terms: [
          {
            fixed: 2,
            perModel: 0,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "This model is equipped with 2 bolters",
          },
        ],
      },
    ],
    wargearChoicePools: [
      {
        id: "unit:pool",
        fixed: 1,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "Choose one replacement",
        replaces: [{ groupId: "unit:bolter", groupName: "Bolter", quantity: 2 }],
        alternatives: [
          {
            id: "unit:pool:1",
            label: "2 flamers",
            weapons: [{ groupId: "unit:flamer", groupName: "Flamer", quantity: 2 }],
          },
          {
            id: "unit:pool:2",
            label: "1 flamer and 1 bolter",
            weapons: [
              { groupId: "unit:flamer", groupName: "Flamer", quantity: 1 },
              { groupId: "unit:bolter", groupName: "Bolter", quantity: 1 },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(choicePoolMaximum(unit.wargearChoicePools[0], 1), 1);
  assert.deepEqual(choiceSelectionWeaponCounts(unit, { "unit:pool:2": 1 }), {
    "unit:flamer": 1,
    "unit:bolter": 1,
  });
  assert.deepEqual(defaultWeaponCounts(unit, 1), { "unit:bolter": 2 });
  assert.deepEqual(sourceEquippedWeaponCounts(unit, 1, { "unit:pool:2": 1 }), {
    "unit:bolter": 1,
    "unit:flamer": 1,
  });
  assert.deepEqual(
    applyChoiceSelectionChange(
      { "unit:bolter": 2, "unit:flamer": 0 },
      unit.wargearChoicePools[0],
      unit.wargearChoicePools[0].alternatives[1],
      0,
      1,
    ),
    { "unit:bolter": 1, "unit:flamer": 1 },
  );
  assert.deepEqual(
    unitLoadoutWarnings(unit, 1, {}, { "unit:flamer": 1, "unit:bolter": 1 }, { "unit:pool:2": 1 }),
    [],
  );
  assert.match(
    unitLoadoutWarnings(
      unit,
      1,
      {},
      { "unit:flamer": 4, "unit:bolter": 0 },
      { "unit:pool:1": 2 },
    )[0],
    /2 selections exceeds the shared limit of 1/i,
  );
});

test("source defaults scale with model count without discarding editable overrides", () => {
  const unit = {
    defaultWeapons: [
      {
        groupId: "unit:rifle",
        groupName: "Rifle",
        terms: [
          {
            fixed: 0,
            perModel: 1,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "Every model",
          },
        ],
      },
      {
        groupId: "unit:pistol",
        groupName: "Pistol",
        terms: [
          {
            fixed: 1,
            perModel: 0,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "This model",
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultWeaponCounts(unit, 5), { "unit:rifle": 5, "unit:pistol": 1 });
  assert.deepEqual(applyModelCountChange({ "unit:rifle": 7, "unit:pistol": 1 }, unit, 5, 10), {
    "unit:rifle": 12,
    "unit:pistol": 1,
  });
});

test("mixed-model defaults support fixed leaders and unit-size increments", () => {
  const unit = {
    defaultWeapons: [
      {
        groupId: "unit:lasgun",
        groupName: "Lasgun",
        terms: [
          {
            fixed: 0,
            perModel: 0,
            perIncrement: 9,
            modelsPerIncrement: 10,
            quantity: 1,
            source: "Every Shock Trooper",
          },
        ],
      },
      {
        groupId: "unit:choppa",
        groupName: "Choppa",
        terms: [
          {
            fixed: -1,
            perModel: 1,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "Every Boy",
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultWeaponCounts(unit, 10), { "unit:lasgun": 9, "unit:choppa": 9 });
  assert.deepEqual(defaultWeaponCounts(unit, 20), { "unit:lasgun": 18, "unit:choppa": 19 });
});

test("explicit model composition derives unresolved source loadouts", () => {
  const unit = {
    name: "Accursed Cultists",
    suggestedModelCount: 8,
    maximumModelCount: 16,
    defaultWeapons: [],
    weaponLimits: [],
    wargearChoicePools: [],
    weapons: [
      { groupId: "cultists:mutations", groupName: "Hideous mutations" },
      { groupId: "cultists:appendages", groupName: "Blasphemous appendages" },
    ],
    unresolvedLoadoutSubjects: [
      {
        id: "cultists:1",
        subject: "Every Torment",
        equipment: "hideous mutations",
        weapons: [{ groupId: "cultists:mutations", groupName: "Hideous mutations", quantity: 1 }],
      },
      {
        id: "cultists:2",
        subject: "Every Mutant",
        equipment: "blasphemous appendages",
        weapons: [
          {
            groupId: "cultists:appendages",
            groupName: "Blasphemous appendages",
            quantity: 1,
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultLoadoutSubjectCounts(unit), { "cultists:1": 0, "cultists:2": 0 });
  const composition = { "cultists:1": 3, "cultists:2": 5 };
  assert.deepEqual(loadoutSubjectWeaponCounts(unit, composition), {
    "cultists:mutations": 3,
    "cultists:appendages": 5,
  });
  assert.deepEqual(defaultWeaponCounts(unit, 8, composition), {
    "cultists:mutations": 3,
    "cultists:appendages": 5,
  });
  assert.deepEqual(
    applyLoadoutSubjectCountChange(
      { "cultists:mutations": 0, "cultists:appendages": 0 },
      unit.unresolvedLoadoutSubjects[0],
      0,
      3,
    ),
    { "cultists:mutations": 3, "cultists:appendages": 0 },
  );
  assert.deepEqual(
    unitLoadoutWarnings(
      unit,
      8,
      {},
      { "cultists:mutations": 3, "cultists:appendages": 5 },
      {},
      composition,
    ),
    [],
  );
  assert.match(
    unitLoadoutWarnings(
      unit,
      8,
      {},
      { "cultists:mutations": 9, "cultists:appendages": 0 },
      {},
      { "cultists:1": 9 },
    )[0],
    /exceeds the unit total/i,
  );
});

test("mixed target allocation never spills damage between models", () => {
  const targets = [
    { wounds: 1, modelCount: 1 },
    { wounds: 2, modelCount: 2 },
  ];
  const first = allocateDamageToSequence(0, 2, targets);
  assert.deepEqual(first, {
    applied: 1,
    appliedThisAttack: 1,
    wasted: 1,
    modelsDestroyed: 1,
    woundsRemaining: 2,
    segmentIndex: 1,
  });
  const partial = allocateDamageToSequence(2, 4, targets);
  assert.equal(partial.appliedThisAttack, 1);
  assert.equal(partial.wasted, 3);
  assert.equal(partial.modelsDestroyed, 2);
  assert.equal(targetSequencePosition(3, targets).woundsRemaining, 2);
});

function readUint64(pointer, lowIndex, highIndex) {
  const low = calculator.getValue(pointer + lowIndex * 4, "i32") >>> 0;
  const high = calculator.getValue(pointer + highIndex * 4, "i32") >>> 0;
  return (BigInt(high) << 32n) | BigInt(low);
}

function interactionMeans(testCase) {
  const output = calculator._malloc(72);
  try {
    const ok = calculator._whc_calculate_summary(
      0,
      0,
      testCase.attacks,
      1,
      testCase.hitOn,
      testCase.strength,
      testCase.ap,
      0,
      0,
      testCase.damage,
      testCase.criticalHits,
      testCase.toughness,
      testCase.save,
      testCase.invulnerable,
      testCase.feelNoPain,
      testCase.wounds,
      0,
      testCase.flags,
      testCase.criticalWounds,
      testCase.targetModels,
      0,
      0,
      testCase.sustainedHits,
      0,
      0,
      0,
      0,
      testCase.hitModifier,
      testCase.woundModifier,
      output,
    );
    assert.equal(ok, 1, testCase.name);
    return {
      expected: {
        numerator: readUint64(output, 5, 6),
        denominator: readUint64(output, 7, 8),
      },
      applied: {
        numerator: readUint64(output, 14, 15),
        denominator: readUint64(output, 16, 17),
      },
    };
  } finally {
    calculator._free(output);
  }
}

function exactMean({
  ap = 0,
  save = 3,
  invulnerable = 0,
  feelNoPain = 0,
  flags = 0,
  hitModifier = 0,
  woundModifier = 0,
} = {}) {
  const output = calculator._malloc(72);
  try {
    const ok = calculator._whc_calculate_summary(
      0,
      0,
      4,
      1,
      3,
      10,
      ap,
      0,
      0,
      2,
      6,
      10,
      save,
      invulnerable,
      feelNoPain,
      12,
      0,
      flags,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      hitModifier,
      woundModifier,
      output,
    );
    assert.equal(ok, 1);
    return {
      numerator: readUint64(output, 5, 6),
      denominator: readUint64(output, 7, 8),
    };
  } finally {
    calculator._free(output);
  }
}

function lessThanOrEqual(left, right) {
  return left.numerator * right.denominator <= right.numerator * left.denominator;
}

function orderedVolley(weapons, targets, initialWoundsLost = 0) {
  const weaponFields = 22;
  const targetFields = 7;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator._malloc(9 * 4);
  const meansPointer = calculator._malloc(weapons.length * 4 * 4);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) => write(weaponsPointer + index * weaponFields * 4, weapon));
    targets.forEach((target, index) => write(targetsPointer + index * targetFields * 4, target));
    assert.equal(
      calculator._whc_calculate_ordered_volley_summary(
        weaponsPointer,
        weapons.length,
        targetsPointer,
        targets.length,
        initialWoundsLost,
        summaryPointer,
        meansPointer,
      ),
      1,
    );
    const fraction = (pointer) => ({
      numerator: readUint64(pointer, 0, 1),
      denominator: readUint64(pointer, 2, 3),
    });
    return {
      minimum: calculator.getValue(summaryPointer, "i32") >>> 0,
      maximum: calculator.getValue(summaryPointer + 16, "i32") >>> 0,
      mean: fraction(summaryPointer + 20),
      cumulative: weapons.map((_, index) => fraction(meansPointer + index * 16)),
    };
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(summaryPointer);
    calculator._free(meansPointer);
  }
}

function orderedVolleyComplexity(weapons, targets, initialWoundsLost = 0) {
  const weaponFields = 22;
  const targetFields = 7;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const outputPointer = calculator._malloc(24);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) => write(weaponsPointer + index * weaponFields * 4, weapon));
    targets.forEach((target, index) => write(targetsPointer + index * targetFields * 4, target));
    assert.equal(
      calculator._whc_estimate_ordered_volley_complexity(
        weaponsPointer,
        weapons.length,
        targetsPointer,
        targets.length,
        initialWoundsLost,
        outputPointer,
      ),
      1,
    );
    return Array.from(
      { length: 6 },
      (_, index) => calculator.getValue(outputPointer + index * 4, "i32") >>> 0,
    );
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(outputPointer);
  }
}

test("C/Wasm reports conservative deferred-state complexity before exact volleys", () => {
  const devastating = [0, 0, 1, 1, 2, 10, 6, 0, 0, 2, 6, 2 | 16, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const ordinary = [0, 0, 1, 1, 2, 10, 6, 0, 0, 3, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(
    orderedVolleyComplexity([devastating, ordinary], [[1, 7, 0, 0, 3, 0, 2]]),
    [112, 2047, 2, 6, 1, 1],
  );
  devastating[2] = 20;
  const high = orderedVolleyComplexity([devastating, ordinary], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.ok(high[0] > high[1]);
  assert.equal(high[5], 0);
});

function variableRuleMean({ flags = 0, sustained = [0, 0, 0], rapid = [0, 0, 0] }) {
  const output = calculator._malloc(72);
  try {
    const ok = calculator._whc_calculate_summary(
      0,
      0,
      1,
      1,
      6,
      2,
      0,
      0,
      0,
      1,
      6,
      1,
      7,
      0,
      0,
      10,
      0,
      flags,
      0,
      1,
      ...sustained,
      ...rapid,
      0,
      0,
      0,
      output,
    );
    assert.equal(ok, 1);
    return {
      numerator: readUint64(output, 5, 6),
      denominator: readUint64(output, 7, 8),
    };
  } finally {
    calculator._free(output);
  }
}

test("C/Wasm preserves variable Sustained Hits and Rapid Fire values", () => {
  assert.deepEqual(abilityDiceValue({ value: "d3" }), { count: 1, sides: 3, modifier: 0 });
  assert.deepEqual(abilityDiceValue({ value: "D6+3" }), { count: 1, sides: 6, modifier: 3 });
  assert.deepEqual(variableRuleMean({ sustained: [1, 3, 0] }), {
    numerator: 5n,
    denominator: 12n,
  });
  assert.deepEqual(variableRuleMean({ flags: 16 | 256, rapid: [1, 3, 0] }), {
    numerator: 5n,
    denominator: 2n,
  });
});

test("unit loadouts group mutually exclusive profiles and allocate equipped copies", () => {
  const weapons = [
    {
      id: 1,
      name: "Plasma pistol – standard",
      groupId: "unit:7",
      groupName: "Plasma pistol",
      profileIndex: 1,
    },
    {
      id: 2,
      name: "Plasma pistol – supercharge",
      groupId: "unit:7",
      groupName: "Plasma pistol",
      profileIndex: 2,
    },
    {
      id: 3,
      name: "Boltgun",
      groupId: "unit:8",
      groupName: "Boltgun",
      profileIndex: 1,
    },
  ];
  const groups = groupWeaponProfiles(weapons);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].profiles.length, 2);
  assert.deepEqual(armyListWeaponsFromGroups(groups), [
    { weaponId: 1, groupId: "unit:7", name: "Plasma pistol", count: 0, optionCount: 0 },
    { weaponId: 3, groupId: "unit:8", name: "Boltgun", count: 0, optionCount: 0 },
  ]);
  assert.deepEqual(equippedWeaponLines(groups, { "unit:7": 5, "unit:8": 7 }, { 1: 3, 2: 2 }), [
    { weapon: weapons[0], count: 3 },
    { weapon: weapons[1], count: 2 },
    { weapon: weapons[2], count: 7 },
  ]);
  assert.deepEqual(weaponAllocationErrors(groups, { "unit:7": 5 }, { 1: 4, 2: 2 }), [
    "Plasma pistol allocates 6 profiles across 5 equipped copies",
  ]);
  assert.deepEqual(weaponAllocationErrors(groups, { "unit:7": 5 }, {}), [
    "Choose firing profiles for Plasma pistol",
  ]);
  assert.equal(normalizeEquippedCount(2.9), 2);
  assert.equal(normalizeEquippedCount(-1), 0);
  assert.equal(normalizeEquippedCount(Number.NaN), 0);
});

test("source-backed loadout limits scale with unit size and remain overridable warnings", () => {
  const unit = {
    name: "Assault Squad",
    suggestedModelCount: 5,
    maximumModelCount: 10,
    weaponLimits: [
      {
        groupId: "assault:eviscerator",
        groupName: "Eviscerator",
        terms: [
          {
            fixed: 0,
            perIncrement: 1,
            modelsPerIncrement: 5,
            quantity: 1,
            source: "For every 5 models in this unit, 1 model can take an eviscerator.",
          },
        ],
      },
    ],
  };
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 4), 0);
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 5), 1);
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 10), 2);
  assert.deepEqual(
    unitLoadoutWarnings(unit, 10, { "assault:eviscerator": 2 }, { "assault:eviscerator": 2 }),
    [],
  );
  assert.match(
    unitLoadoutWarnings(unit, 5, { "assault:eviscerator": 2 }, { "assault:eviscerator": 2 })[0],
    /2 option-selected copies exceeds.*limit of 1/i,
  );
  assert.match(unitLoadoutWarnings(unit, 3, {}, {})[0], /may represent battlefield casualties/i);
  assert.match(unitLoadoutWarnings(unit, 11, {}, {})[0], /at most 10 models/i);
  assert.match(
    unitLoadoutWarnings(unit, 10, { "assault:eviscerator": 2 }, { "assault:eviscerator": 1 })[0],
    /exceeds 1 total equipped/i,
  );
});

test("C/Wasm carries ordered damage across partial wounds and mixed target profiles", () => {
  const light = [0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const heavy = [0, 0, 1, 1, 2, 10, 6, 0, 0, 2, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const mixedTargets = [
    [1, 7, 0, 0, 1, 0, 1],
    [1, 2, 0, 0, 2, 0, 1],
  ];
  const forward = orderedVolley([light, heavy], mixedTargets);
  const reverse = orderedVolley([heavy, light], mixedTargets);
  assert.equal(forward.maximum, 3);
  assert.equal(reverse.maximum, 2);
  assert.ok(
    forward.mean.numerator * reverse.mean.denominator >
      reverse.mean.numerator * forward.mean.denominator,
  );
  assert.ok(
    forward.cumulative[1].numerator * forward.cumulative[0].denominator >=
      forward.cumulative[0].numerator * forward.cumulative[1].denominator,
  );

  const partial = orderedVolley([heavy], [[1, 7, 0, 0, 2, 0, 2]], 1);
  assert.equal(partial.maximum, 1);
});

test("JavaScript and C agree on wound thresholds", () => {
  for (let strength = 1; strength <= 24; strength += 1) {
    for (let toughness = 1; toughness <= 24; toughness += 1) {
      assert.equal(calculator._wounds_on(strength, toughness), woundTarget(strength, toughness));
    }
  }
});

test("JavaScript and C agree on capped Hit and Wound modifiers", () => {
  for (let succeedsOn = 2; succeedsOn <= 6; succeedsOn += 1) {
    for (let modifier = -10; modifier <= 10; modifier += 1) {
      assert.equal(
        calculator._modified_roll_threshold(succeedsOn, modifier),
        modifiedRollTarget(succeedsOn, modifier),
      );
    }
  }
});

test("C/Wasm matches the shared 10th-edition rules interaction corpus", () => {
  for (const testCase of rulesInteractionCases) {
    const actual = interactionMeans(testCase);
    assert.deepEqual(actual.expected, testCase.expected, testCase.name);
    assert.ok(
      Math.abs(
        Number(actual.applied.numerator) / Number(actual.applied.denominator) -
          Number(testCase.applied.numerator) / Number(testCase.applied.denominator),
      ) < 1e-8,
      testCase.name,
    );
  }
});

test("exact re-roll and modifier interactions match hand-derived probabilities", () => {
  assert.deepEqual(exactMean({ save: 7 }), { numerator: 8n, denominator: 3n });
  assert.deepEqual(exactMean({ save: 7, flags: 8192 }), {
    numerator: 28n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 32768 }), {
    numerator: 28n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 8192 | 32768 }), {
    numerator: 98n,
    denominator: 27n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 8 | 16384 }), {
    numerator: 16n,
    denominator: 3n,
  });
  assert.deepEqual(exactMean({ save: 7, hitModifier: 8, woundModifier: 8 }), {
    numerator: 40n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, hitModifier: -8, woundModifier: -8 }), {
    numerator: 4n,
    denominator: 3n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 32, hitModifier: -1 }), {
    numerator: 8n,
    denominator: 3n,
  });
});

test("JavaScript and C agree on armour, invulnerable, AP, and cover thresholds", () => {
  for (let save = 2; save <= 7; save += 1) {
    for (const invulnerable of [0, 2, 3, 4, 5, 6]) {
      for (let ap = 0; ap <= 12; ap += 1) {
        assert.equal(
          calculator._saves_on(save, invulnerable, ap),
          savingThrowTarget(save, invulnerable, ap),
        );
        assert.equal(
          calculator._saves_on_with_cover(save, invulnerable, ap),
          savingThrowTarget(save, invulnerable, ap, true),
        );
      }
    }
  }
});

test("JavaScript and C agree on model-by-model damage allocation", () => {
  for (let wounds = 1; wounds <= 10; wounds += 1) {
    for (let models = 1; models <= 10; models += 1) {
      const capacity = wounds * models;
      for (let applied = 0; applied <= capacity; applied += 1) {
        for (let incoming = 0; incoming <= 20; incoming += 1) {
          assert.equal(
            calculator._allocate_damage_to_unit(applied, incoming, wounds, models),
            allocateDamageToUnit(applied, incoming, wounds, models).applied,
          );
        }
      }
    }
  }
});

test("JavaScript and C agree on hit rolls that always fail", () => {
  for (let face = 1; face <= 6; face += 1) {
    for (let succeedsOn = 2; succeedsOn <= 7; succeedsOn += 1) {
      for (let criticalOn = 0; criticalOn <= 6; criticalOn += 1) {
        for (let autoFailsThrough = 0; autoFailsThrough <= 3; autoFailsThrough += 1) {
          assert.equal(
            calculator._attack_roll_succeeds(face, succeedsOn, criticalOn, autoFailsThrough),
            Number(attackRollSucceeds(face, succeedsOn, criticalOn, autoFailsThrough)),
          );
        }
      }
    }
  }
});

test("AP and weaker armour cannot reduce exact expected damage", () => {
  let previous = exactMean({ ap: 0, save: 2 });
  for (let ap = 1; ap <= 6; ap += 1) {
    const current = exactMean({ ap, save: 2 });
    assert.ok(lessThanOrEqual(previous, current));
    previous = current;
  }

  previous = exactMean({ ap: 2, save: 2 });
  for (let save = 3; save <= 7; save += 1) {
    const current = exactMean({ ap: 2, save });
    assert.ok(lessThanOrEqual(previous, current));
    previous = current;
  }
});

test("defensive rules cannot increase exact expected damage", () => {
  const baseline = exactMean({ ap: 3, save: 2 });
  const invulnerable = exactMean({ ap: 3, save: 2, invulnerable: 4 });
  const feelNoPain = exactMean({ ap: 3, save: 2, feelNoPain: 5 });
  const cover = exactMean({ ap: 3, save: 2, flags: 1024 });

  assert.ok(lessThanOrEqual(invulnerable, baseline));
  assert.ok(lessThanOrEqual(feelNoPain, baseline));
  assert.ok(lessThanOrEqual(cover, baseline));
});
