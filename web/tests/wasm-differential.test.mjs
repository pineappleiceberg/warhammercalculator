import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attackRollSucceeds, savingThrowTarget, woundTarget } from "../lib/thresholds.mjs";
import { allocateDamageToUnit } from "../lib/allocation.mjs";
import { abilityDiceValue } from "../lib/dice.mjs";
import {
  armyListWeaponsFromGroups,
  equippedWeaponLines,
  groupWeaponProfiles,
  normalizeEquippedCount,
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

function readUint64(pointer, lowIndex, highIndex) {
  const low = calculator.getValue(pointer + lowIndex * 4, "i32") >>> 0;
  const high = calculator.getValue(pointer + highIndex * 4, "i32") >>> 0;
  return (BigInt(high) << 32n) | BigInt(low);
}

function exactMean({ ap = 0, save = 3, invulnerable = 0, feelNoPain = 0, flags = 0 } = {}) {
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

test("JavaScript and C agree on wound thresholds", () => {
  for (let strength = 1; strength <= 24; strength += 1) {
    for (let toughness = 1; toughness <= 24; toughness += 1) {
      assert.equal(calculator._wounds_on(strength, toughness), woundTarget(strength, toughness));
    }
  }
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
