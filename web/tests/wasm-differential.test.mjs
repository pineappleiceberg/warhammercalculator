import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { savingThrowTarget, woundTarget } from "../lib/thresholds.mjs";
import { allocateDamageToUnit } from "../lib/allocation.mjs";

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
