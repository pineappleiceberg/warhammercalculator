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
import { parseAgentProfile } from "../lib/agent-parameters.mjs";
import {
  applyCombatPresets,
  applyTargetCombatPresets,
  attackKeywordsForWeapon,
  combatPresetEffects,
  combatPresetMeetsEligibility,
  combatPresetRequiresActivation,
  combatPresetSubjectSummary,
  combatPresetSupportsRole,
  combatPresetSupportsWeapon,
  selectedAndAutomaticCombatPresets,
  updateCombatPresetSelection,
} from "../lib/combat-presets.mjs";
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

function calculateSummary(...values) {
  const output = values.pop();
  return calculator._whc_calculate_summary(...values, 1, 1, 1, output);
}

test("WebAssembly exports the formally verified validators", () => {
  assert.equal(typeof calculator._dice_value_is_valid, "function");
  assert.equal(typeof calculator._probability_distribution_is_normalized, "function");
  assert.equal(typeof calculator._attack_plan_is_valid, "function");
  assert.equal(typeof calculator._whc_estimate_ordered_volley_complexity, "function");
});

test("signed characteristic modifiers use per-weapon floors in C/Wasm", () => {
  const output = calculator._malloc(72);
  try {
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        0,
        2,
        2,
        10,
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
        16,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [40n, 9n]);
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        4,
        2,
        2,
        10,
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
        16,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.equal(calculator.getValue(output, "i32") >>> 0, 0);
    assert.equal(calculator.getValue(output + 16, "i32") >>> 0, 6);
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [5n, 1n]);
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        4,
        1,
        2,
        10,
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
        272,
        0,
        1,
        0,
        0,
        0,
        1,
        3,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.equal(calculator.getValue(output + 16, "i32") >>> 0, 6);
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [25n, 6n]);
    assert.equal(
      calculateSummary(
        0,
        0,
        1,
        0,
        1,
        2,
        2,
        0,
        1,
        6,
        0,
        6,
        7,
        7,
        0,
        0,
        10,
        0,
        528,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        -1,
        0,
        8,
        0,
        1,
        1,
        output,
      ),
      1,
    );
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [1n, 1n]);
  } finally {
    calculator._free(output);
  }
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

test("unit ability presets separate attacking and defensive effects", () => {
  const mixed = {
    weaponScope: "Melee",
    hitModifier: -1,
    woundModifier: 1,
    rerollHits: true,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: true,
    hitModifierRole: "target",
    hitModifierSubject: "enemy_unit",
    woundModifierRole: "attacker",
    woundModifierSubject: "self",
    hitRerollRole: "attacker",
    hitRerollSubject: "self",
    woundRerollRole: "attacker",
    woundRerollSubject: "self",
  };
  assert.equal(combatPresetSupportsRole(mixed, "attacker"), true);
  assert.equal(combatPresetSupportsRole(mixed, "target"), true);
  const outOfScope = combatPresetEffects([mixed], "Ranged", "attacker");
  assert.equal(outOfScope.hitModifier, 0);
  assert.equal(outOfScope.woundModifier, 0);
  assert.equal(outOfScope.rerollHits, false);
  assert.equal(outOfScope.apModifier, 0);
  assert.equal(outOfScope.lethalHits, false);
  const applied = applyCombatPresets(
    { hitModifier: 0, woundModifier: 0, ap: 4 },
    [mixed],
    [mixed],
    "Melee",
  );
  assert.equal(applied.hitModifier, -1);
  assert.equal(applied.woundModifier, 1);
  assert.equal(applied.rerollHits, true);
  assert.equal(applied.rerollHitOnes, false);
  assert.equal(applied.rerollWoundOnes, true);
  assert.equal(applied.ap, 4);
  assert.equal(combatPresetSubjectSummary(mixed, "attacker"), "this unit");
  assert.equal(combatPresetSubjectSummary(mixed, "target"), "enemy attacker");
  const selfPenalty = {
    ...mixed,
    hitModifier: -1,
    hitModifierRole: "attacker",
    hitModifierSubject: "self",
    woundModifier: 0,
    rerollHits: false,
    rerollWoundOnes: false,
  };
  assert.equal(combatPresetEffects([selfPenalty], "Melee", "attacker").hitModifier, -1);
  assert.equal(combatPresetEffects([selfPenalty], "Melee", "target").hitModifier, 0);
  assert.equal(
    applyCombatPresets(
      { hitModifier: 0, woundModifier: 0 },
      [
        { ...mixed, hitModifier: 1, hitModifierRole: "attacker" },
        { ...mixed, hitModifier: 1, hitModifierRole: "attacker" },
      ],
      [mixed],
      "Melee",
    ).hitModifier,
    1,
  );
});

test("unit ability presets compose weapon rules, AP, and critical thresholds", () => {
  const preset = {
    weaponScope: "Ranged",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "lethal_hits",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "ap_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "critical_hits",
        value: 5,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "sustained_hits",
        value: 0,
        diceCount: 1,
        diceSides: 3,
        role: "attacker",
        subject: "self",
      },
    ],
  };
  const applied = applyCombatPresets(
    {
      ap: 2,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 1,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
    },
    [preset],
    [],
    "Ranged",
  );
  assert.equal(applied.ap, 3);
  assert.equal(applied.criticalHits, 5);
  assert.equal(applied.lethalHits, true);
  assert.deepEqual(
    [applied.sustainedHits, applied.sustainedHitsDice, applied.sustainedHitsSides],
    [0, 1, 3],
  );
  assert.equal(combatPresetSubjectSummary(preset, "attacker"), "this unit");
});

test("unit ability presets compose direct weapon characteristic modifiers", () => {
  const preset = {
    weaponScope: "Melee",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
      {
        type: "strength_modifier",
        value: 2,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
      {
        type: "damage_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
    ],
  };
  const applied = applyCombatPresets(
    {
      attacks: 0,
      attackDice: 1,
      attackSides: 6,
      strength: 8,
      damage: 1,
      damageDice: 1,
      damageSides: 3,
      ap: 2,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 0,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
    },
    [preset],
    [],
    "Melee",
  );
  assert.deepEqual([applied.attackDice, applied.attackSides, applied.attacks], [1, 6, 0]);
  assert.equal(applied.attacksModifier, 1);
  assert.equal(applied.strength, 8);
  assert.equal(applied.strengthModifier, 2);
  assert.deepEqual([applied.damageDice, applied.damageSides, applied.damage], [1, 3, 1]);
  assert.equal(applied.damageModifier, 1);
  assert.equal(combatPresetEffects([preset], "Ranged", "attacker").attacksModifier, 0);
});

test("one source roll remains shared across random characteristic modifiers", () => {
  const preset = {
    id: "shared-d3",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: ["attacks_modifier", "strength_modifier"].map((type) => ({
      type,
      value: 0,
      diceCount: 1,
      diceSides: 3,
      role: "attacker",
      subject: "self",
    })),
  };
  const applied = applyCombatPresets(
    {
      weaponName: "Psychic weapon",
      attacksModifier: 0,
      strengthModifier: 0,
      damageModifier: 0,
      ap: 0,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 0,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
      rerollHits: false,
      rerollHitOnes: false,
      rerollWounds: false,
      rerollWoundOnes: false,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      reduction: 0,
    },
    [preset],
    [],
    "Ranged",
  );
  assert.deepEqual(
    [
      applied.characteristicModifierDice,
      applied.characteristicModifierSides,
      applied.characteristicModifierBonus,
      applied.characteristicModifierAttacks,
      applied.characteristicModifierStrength,
      applied.characteristicModifierDamage,
      applied.characteristicModifierGroup,
    ],
    [1, 3, 0, true, true, false, "shared-d3"],
  );
  assert.equal(applied.attacksModifier, 0);
  assert.equal(applied.strengthModifier, 0);
});

test("fixed characteristic replacements and multipliers compose and respect scope", () => {
  const preset = {
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_replacement",
        value: 12,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Dead Man’s Hand",
        role: "attacker",
        subject: "self",
      },
      ...["attacks_multiplier", "strength_multiplier", "damage_multiplier"].map((type) => ({
        type,
        value: 2,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Dead Man’s Hand",
        role: "attacker",
        subject: "self",
      })),
    ],
  };
  const base = {
    weaponName: "Dead Man’s Hand",
    attacksReplacement: 0,
    attacksMultiplier: 1,
    attacksModifier: -1,
    strengthMultiplier: 1,
    strengthModifier: 0,
    damageMultiplier: 1,
    damageModifier: 0,
    ap: 0,
    criticalHits: 6,
    criticalWounds: 0,
    lethalHits: false,
    devastatingWounds: false,
    twinLinked: false,
    ignoresCover: false,
    lanceActive: false,
    heavyActive: false,
    sustainedHits: 0,
    sustainedHitsDice: 0,
    sustainedHitsSides: 0,
    rapidFire: 0,
    rapidFireDice: 0,
    rapidFireSides: 0,
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
  };
  const applied = applyCombatPresets(base, [preset], [], "Melee");
  assert.equal(applied.attacksReplacement, 12);
  assert.deepEqual(
    [applied.attacksMultiplier, applied.strengthMultiplier, applied.damageMultiplier],
    [2, 2, 2],
  );
  assert.equal(combatPresetSupportsWeapon(preset, "Melee", "Dead Man's Hand"), true);
  assert.equal(combatPresetSupportsWeapon(preset, "Ranged", "Blood Song"), false);
  assert.equal(
    applyCombatPresets({ ...base, weaponName: "Blood Song" }, [preset], [], "Ranged")
      .attacksReplacement,
    0,
  );

  const characteristicPreset = {
    ...preset,
    effects: [
      {
        type: "strength_replacement",
        value: 9,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "damage_replacement",
        value: 0,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      },
    ],
  };
  const replaced = applyCombatPresets(
    { ...base, strengthReplacement: 0, damageReplacement: null },
    [characteristicPreset],
    [characteristicPreset],
    "Melee",
  );
  assert.equal(replaced.strengthReplacement, 9);
  assert.equal(replaced.damageReplacement, 0);
});

test("automatic target-keyword presets apply only to eligible weapons and targets", () => {
  const psychicAssassin = {
    id: "culexus:psychic-assassin",
    activation: "automatic",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_replacement",
        value: 6,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Animus speculum",
        requiredTargetKeyword: "psyker",
        role: "attacker",
        subject: "self",
      },
    ],
  };
  assert.equal(combatPresetRequiresActivation(psychicAssassin), false);
  assert.equal(combatPresetMeetsEligibility(psychicAssassin, ["Infantry", "PSYKER"]), true);
  assert.equal(combatPresetMeetsEligibility(psychicAssassin, ["Infantry"]), false);
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Ranged", "Animus Speculum", [
      "psyker",
    ]),
    [psychicAssassin],
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Melee", "Life-draining touch", [
      "psyker",
    ]),
    [],
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Ranged", "Animus speculum", [
      "vehicle",
    ]),
    [],
  );
});

test("Psychic-only defenses apply by attack keyword and reject incompatible volleys", () => {
  const abomination = {
    id: "culexus:abomination",
    activation: "automatic",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "feel_no_pain",
        value: 2,
        diceCount: 0,
        diceSides: 0,
        requiredAttackKeyword: "psychic",
        role: "target",
        subject: "self",
      },
    ],
  };
  const psychicKeywords = attackKeywordsForWeapon({
    type: "Ranged",
    abilities: [{ name: "psychic" }, { name: "precision" }],
  });
  assert.deepEqual(psychicKeywords, ["ranged", "psychic", "precision"]);
  assert.equal(combatPresetMeetsEligibility(abomination, [], psychicKeywords), true);
  assert.equal(combatPresetMeetsEligibility(abomination, [], ["ranged"]), false);
  assert.deepEqual(
    selectedAndAutomaticCombatPresets(
      [abomination],
      [],
      "Ranged",
      "Psychic weapon",
      [],
      psychicKeywords,
    ),
    [abomination],
  );
  const target = {
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
    keywords: ["psyker"],
  };
  assert.equal(
    applyTargetCombatPresets(
      [target],
      [abomination],
      [{ weaponType: "Ranged", attackKeywords: psychicKeywords }],
    )[0].feelNoPain,
    2,
  );
  const selectedDefense = selectedAndAutomaticCombatPresets(
    [abomination],
    [],
    "Ranged",
    "Psychic weapon",
    [],
    psychicKeywords,
  );
  assert.equal(
    applyCombatPresets(target, [], selectedDefense, "Ranged", {
      attackKeywords: psychicKeywords,
    }).feelNoPain,
    2,
  );
  assert.equal(
    applyTargetCombatPresets(
      [target],
      [abomination],
      [{ weaponType: "Ranged", attackKeywords: ["ranged"] }],
    )[0].feelNoPain,
    0,
  );
  assert.throws(
    () =>
      applyTargetCombatPresets(
        [target],
        [abomination],
        [
          { weaponType: "Ranged", attackKeywords: psychicKeywords },
          { weaponType: "Ranged", attackKeywords: ["ranged"] },
        ],
      ),
    /different defensive eligibility/i,
  );
});

test("defensive presets compose editable profiles and every ordered target segment", () => {
  const preset = {
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      ...[
        ["save_target", 2],
        ["invulnerable_save", 4],
        ["feel_no_pain", 5],
        ["damage_reduction", 1],
        ["first_failed_save_damage_replacement", 0],
      ].map(([type, value]) => ({
        type,
        value,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      })),
      {
        type: "allocated_attack_damage_replacement",
        value: 0,
        uses: 2,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      },
    ],
  };
  const base = {
    save: 3,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
    firstFailedSaveDamageReplacement: null,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 0,
    allocatedAttackDamageReplacementSkip: 3,
    hitModifier: 0,
    woundModifier: 0,
  };
  const applied = applyCombatPresets(base, [], [preset], "Ranged");
  assert.deepEqual(
    [
      applied.save,
      applied.invulnerable,
      applied.feelNoPain,
      applied.reduction,
      applied.firstFailedSaveDamageReplacement,
      applied.allocatedAttackDamageReplacement,
      applied.allocatedAttackDamageReplacementUses,
      applied.allocatedAttackDamageReplacementSkip,
    ],
    [2, 4, 5, 1, 0, 0, 2, 3],
  );
  const targets = applyTargetCombatPresets(
    [
      { ...base, modelCount: 2 },
      { ...base, save: 2, invulnerable: 3, feelNoPain: 6, reduction: 2, modelCount: 1 },
    ],
    [preset],
    ["Ranged", "Melee"],
  );
  assert.deepEqual(
    targets.map((target) => [
      target.save,
      target.invulnerable,
      target.feelNoPain,
      target.reduction,
      target.firstFailedSaveDamageReplacement,
      target.allocatedAttackDamageReplacement,
      target.allocatedAttackDamageReplacementUses,
      target.allocatedAttackDamageReplacementSkip,
    ]),
    [
      [2, 4, 5, 1, 0, 0, 2, 3],
      [2, 3, 5, 2, 0, 0, 2, 3],
    ],
  );
  const rangedOnly = { ...preset, weaponScope: "Ranged" };
  assert.throws(
    () => applyTargetCombatPresets([base], [rangedOnly], ["Ranged", "Melee"]),
    /different defensive eligibility/i,
  );
  const redundantRangedSave = {
    ...rangedOnly,
    effects: [rangedOnly.effects.find((effect) => effect.type === "invulnerable_save")],
  };
  assert.equal(
    applyTargetCombatPresets(
      [{ ...base, invulnerable: 3 }],
      [redundantRangedSave],
      ["Ranged", "Melee"],
    )[0].invulnerable,
    3,
  );
});

test("mutually exclusive ability modes replace the prior selection", () => {
  const presets = [
    { id: "unit:3", choiceGroup: "unit:3" },
    { id: "unit:3:2", choiceGroup: "unit:3" },
    { id: "unit:7", choiceGroup: null },
  ];
  assert.deepEqual(updateCombatPresetSelection(presets, ["unit:3", "unit:7"], "unit:3:2", true), [
    "unit:7",
    "unit:3:2",
  ]);
  assert.deepEqual(updateCombatPresetSelection(presets, ["unit:3:2"], "unit:3:2", false), []);
});

test("inherent defenses are native profile values rather than activation choices", () => {
  assert.equal(combatPresetRequiresActivation({ activation: "inherent" }), false);
  assert.equal(combatPresetRequiresActivation({ activation: "situational" }), true);
  assert.equal(combatPresetRequiresActivation({}), true);
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

test("parameterized agent profile reaches the C/Wasm exact engine unchanged", () => {
  const profile = parseAgentProfile(
    "attacks=1&hit=2&strength=4&ap=0&damage=1&toughness=4&save=7&wounds=10",
    {
      attackDice: 0,
      attackSides: 0,
      attacks: 1,
      attacksReplacement: 0,
      attacksModifier: 0,
      weaponCount: 1,
      hitOn: 4,
      strength: 4,
      strengthReplacement: 0,
      strengthModifier: 0,
      ap: 0,
      damageDice: 0,
      damageSides: 0,
      damage: 1,
      damageReplacement: null,
      damageModifier: 0,
      criticalHits: 6,
      toughness: 4,
      save: 3,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 1,
      targetModels: 1,
      reduction: 0,
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
    },
  );
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
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
      0,
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
    assert.equal(ok, 1);
    const expectedNumerator = readUint64(output, 5, 6);
    const expectedDenominator = readUint64(output, 7, 8);
    const appliedNumerator = readUint64(output, 14, 15);
    const appliedDenominator = readUint64(output, 16, 17);

    assert.deepEqual([expectedNumerator, expectedDenominator], [5n, 12n]);
    assert.ok(Math.abs(Number(appliedNumerator) / Number(appliedDenominator) - 5 / 12) < 1e-9);
  } finally {
    calculator._free(output);
  }
});

function interactionMeans(testCase) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      testCase.attacks,
      0,
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
      0,
      0,
      0,
      0,
      0,
      0,
      1,
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
  attacks = 4,
  attacksReplacement = 0,
  ap = 0,
  save = 3,
  invulnerable = 0,
  feelNoPain = 0,
  reduction = 0,
  damageDivisor = 1,
  flags = 0,
  sustainedHits = 0,
  hitModifier = 0,
  woundModifier = 0,
} = {}) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      attacks,
      attacksReplacement,
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
      reduction,
      flags,
      0,
      1,
      0,
      0,
      sustainedHits,
      0,
      0,
      0,
      0,
      hitModifier,
      woundModifier,
      0,
      0,
      0,
      0,
      0,
      0,
      damageDivisor,
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

function currentWeaponInput(weapon) {
  if (weapon.length === 37) return weapon;
  if (weapon.length === 36) return [...weapon, 0];
  if (weapon.length === 32) return [...weapon, 0, 0, 0, 0, 0];
  if (weapon.length === 29) return [...weapon, 1, 1, 1, 0, 0, 0, 0, 0];
  if (weapon.length === 26) return [...weapon, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0];
  const withReplacement = [...weapon.slice(0, 3), 0, ...weapon.slice(3)];
  const current = withReplacement.length === 26 ? withReplacement : [...withReplacement, 0, 0, 0];
  return [...current, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0];
}

function currentTargetInput(target) {
  if (target.length === 13) return target;
  if (target.length === 10) return [...target, 0, 0, 0];
  const current = target.length === 8 ? target : [...target, 1];
  return [...current, 0, 0, 0, 0, 0];
}

function orderedVolley(weapons, targets, initialWoundsLost = 0) {
  const weaponFields = 37;
  const targetFields = 13;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator._malloc(10 * 4);
  const meansPointer = calculator._malloc(weapons.length * 4 * 4);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) =>
      write(weaponsPointer + index * weaponFields * 4, currentWeaponInput(weapon)),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, currentTargetInput(target)),
    );
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
      peakSparseStates: calculator.getValue(summaryPointer + 36, "i32") >>> 0,
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
  const weaponFields = 37;
  const targetFields = 13;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const outputPointer = calculator._malloc(24);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) =>
      write(weaponsPointer + index * weaponFields * 4, currentWeaponInput(weapon)),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, currentTargetInput(target)),
    );
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

  const prefixOrdinary = [...ordinary];
  prefixOrdinary[2] = 8;
  prefixOrdinary[9] = 1;
  devastating[2] = 1;
  const tightened = orderedVolleyComplexity([prefixOrdinary, devastating], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.deepEqual(tightened, [1134, 2047, 9, 6, 1, 1]);
  assert.ok(tightened[0] < 2268);
  const exact = orderedVolley([prefixOrdinary, devastating], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.equal(exact.peakSparseStates, 13);
  assert.ok(exact.peakSparseStates <= tightened[0]);
});

test("C/Wasm consumes first-failed-save Damage replacement exactly once", () => {
  const weapon = Array(37).fill(0);
  weapon[2] = 2;
  weapon[4] = 1;
  weapon[5] = 2;
  weapon[6] = 10;
  weapon[10] = 3;
  weapon[11] = 6;
  weapon[12] = 16;
  weapon[29] = 1;
  weapon[30] = 1;
  weapon[31] = 1;
  const protectedTarget = [1, 7, 0, 0, 20, 0, 1, 1, 0, 1];
  const unprotectedTarget = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0];

  const protectedResult = orderedVolley([weapon], [protectedTarget]);
  const unprotectedResult = orderedVolley([weapon], [unprotectedTarget]);
  assert.equal(protectedResult.maximum, 3);
  assert.equal(unprotectedResult.maximum, 6);
  assert.ok(
    Math.abs(
      Number(protectedResult.mean.numerator) / Number(protectedResult.mean.denominator) - 25 / 12,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      Number(unprotectedResult.mean.numerator) / Number(unprotectedResult.mean.denominator) - 5,
    ) < 1e-8,
  );
  assert.equal(orderedVolleyComplexity([weapon], [protectedTarget])[4], 1);

  weapon[12] = 16 | 2;
  const devastating = orderedVolley([weapon], [protectedTarget]);
  assert.ok(
    Math.abs(Number(devastating.mean.numerator) / Number(devastating.mean.denominator) - 7 / 3) <
      1e-8,
  );
});

test("C/Wasm applies deterministic allocated-attack Damage replacement", () => {
  const weapon = Array(37).fill(0);
  weapon[2] = 2;
  weapon[4] = 1;
  weapon[5] = 6;
  weapon[6] = 2;
  weapon[10] = 3;
  weapon[11] = 6;
  weapon[29] = 1;
  weapon[30] = 1;
  weapon[31] = 1;
  const target = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 0];
  const result = orderedVolley([weapon], [target]);
  assert.equal(result.maximum, 3);
  assert.ok(
    Math.abs(Number(result.mean.numerator) / Number(result.mean.denominator) - 5 / 12) < 1e-8,
  );
  assert.equal(orderedVolleyComplexity([weapon], [target])[4], 1);

  const first = [...weapon];
  first[2] = 1;
  first[5] = 2;
  first[10] = 1;
  first[12] = 16;
  const second = [...first];
  second[10] = 5;
  const skipFirst = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 0];
  const skipSecond = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 1];
  const firstProtected = orderedVolley([first, second], [skipFirst]).mean;
  const secondProtected = orderedVolley([first, second], [skipSecond]).mean;
  assert.ok(
    Math.abs(Number(firstProtected.numerator) / Number(firstProtected.denominator) - 25 / 6) < 1e-8,
  );
  assert.ok(
    Math.abs(Number(secondProtected.numerator) / Number(secondProtected.denominator) - 5 / 6) <
      1e-8,
  );

  const sustained = [...weapon];
  sustained[2] = 1;
  sustained[11] = 6;
  sustained[16] = 1;
  assert.equal(orderedVolley([sustained], [target]).maximum, 0);
  const devastating = [...first];
  devastating[12] = 16 | 2;
  assert.equal(orderedVolley([devastating], [target]).maximum, 0);
});

function variableRuleMean({ flags = 0, sustained = [0, 0, 0], rapid = [0, 0, 0] }) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      1,
      0,
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
      0,
      0,
      0,
      0,
      0,
      0,
      1,
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

test("C/Wasm shares one characteristic roll across grouped ordered weapon profiles", () => {
  const weapon = [
    0, 0, 1, 0, 1, 2, 3, 0, 0, 0, 1, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
    1, 3, 0, 3, 42,
  ];
  const grouped = orderedVolley([weapon, weapon], [[5, 7, 0, 0, 2, 0, 1, 1]]);
  const independentWeapon = [...weapon];
  independentWeapon[36] = 43;
  const independent = orderedVolley([weapon, independentWeapon], [[5, 7, 0, 0, 2, 0, 1, 1]]);
  assert.notEqual(
    grouped.mean.numerator * independent.mean.denominator,
    independent.mean.numerator * grouped.mean.denominator,
  );
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

test("source-backed target distance changes preset composition at its exact boundary", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const warbikers = catalogue.units.find((unit) => unit.name === "Warbikers");
  const driveBy = warbikers.combatPresets.find((preset) => preset.name === "Drive-by Dakka");
  const base = { weaponName: "Twin dakkagun", ap: 0, targetDistance: 0 };
  assert.equal(applyCombatPresets(base, [driveBy], [], "Ranged").ap, 0);
  assert.equal(applyCombatPresets({ ...base, targetDistance: 9 }, [driveBy], [], "Ranged").ap, 1);
  assert.equal(applyCombatPresets({ ...base, targetDistance: 10 }, [driveBy], [], "Ranged").ap, 0);
});

test("source-backed charge rules require the explicit attacker charge state", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const beastboss = catalogue.units.find((unit) => unit.name === "Beastboss");
  const beastlyRage = beastboss.combatPresets.find((preset) => preset.name === "Beastly Rage");
  const weapon = beastboss.weapons.find((entry) => entry.type === "Melee");
  const selected = (charged) =>
    selectedAndAutomaticCombatPresets(
      beastboss.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      charged,
    );
  assert.equal(beastlyRage.requiresAttackerCharge, true);
  assert.equal(beastlyRage.activation, "automatic");
  assert.equal(selected(false).length, 0);
  assert.deepEqual(
    selected(true).map((preset) => preset.name),
    ["Beastly Rage"],
  );

  const base = { weaponName: weapon.name, attackerCharged: false, devastatingWounds: false };
  assert.equal(applyCombatPresets(base, [beastlyRage], [], "Melee").devastatingWounds, false);
  assert.equal(
    applyCombatPresets({ ...base, attackerCharged: true }, [beastlyRage], [], "Melee")
      .devastatingWounds,
    true,
  );

  const catachan = catalogue.units.find((unit) => unit.name === "Catachan Jungle Fighters");
  const jungleFighters = catachan.combatPresets.find((preset) => preset.name === "Jungle Fighters");
  assert.equal(jungleFighters.requiresAttackerCharge, undefined);

  const reaveCaptain = catalogue.units.find((unit) => unit.name === "Red Corsairs Reave-Captain");
  const brutalRaider = reaveCaptain.combatPresets.find((preset) => preset.name === "Brutal Raider");
  const raiderProfile = applyCombatPresets(
    { ...base, attackerCharged: true, strengthModifier: 0, ap: 0 },
    [brutalRaider],
    [],
    "Melee",
  );
  assert.equal(raiderProfile.strengthModifier, 1);
  assert.equal(raiderProfile.ap, 1);
});

test("source-backed Battle-shock rules require their exact attacker or target state", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const furies = catalogue.units.find((unit) => unit.name === "Furies");
  const prey = furies.combatPresets.find((preset) => preset.name === "Prey on the Weak");
  const furiesBase = {
    weaponName: furies.weapons[0].name,
    woundModifier: 0,
    targetBattleShocked: false,
  };
  assert.equal(applyCombatPresets(furiesBase, [prey], [], "Melee").woundModifier, 0);
  assert.equal(
    applyCombatPresets({ ...furiesBase, targetBattleShocked: true }, [prey], [], "Melee")
      .woundModifier,
    1,
  );

  const priest = catalogue.units.find((unit) => unit.name === "Ministorum Priest");
  const holyPiety = priest.combatPresets.find((preset) => preset.name === "Holy Piety");
  const priestBase = {
    weaponName: priest.weapons.find((weapon) => weapon.type === "Melee").name,
    rerollHits: false,
    rerollHitOnes: false,
    attackerBattleShocked: false,
  };
  assert.equal(applyCombatPresets(priestBase, [holyPiety], [], "Melee").rerollHits, true);
  assert.equal(
    applyCombatPresets({ ...priestBase, attackerBattleShocked: true }, [holyPiety], [], "Melee")
      .rerollHits,
    false,
  );
});

test("source-backed situational Attacks replacements reach C/Wasm exactly", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const harker = catalogue.units.find((unit) => unit.name === "Sergeant Harker");
  const payback = harker.combatPresets.find((preset) => preset.name === "Payback Time");
  const base = {
    weaponName: "Payback",
    attacksReplacement: 0,
    attacksMultiplier: 1,
    attacksModifier: 0,
    strengthReplacement: 0,
    strengthMultiplier: 1,
    strengthModifier: 0,
    damageReplacement: null,
    damageMultiplier: 1,
    damageModifier: 0,
    ap: 0,
    criticalHits: 6,
    criticalWounds: 0,
    lethalHits: false,
    devastatingWounds: false,
    twinLinked: false,
    ignoresCover: false,
    lanceActive: false,
    heavyActive: false,
    sustainedHits: 1,
    sustainedHitsDice: 0,
    sustainedHitsSides: 0,
    rapidFire: 0,
    rapidFireDice: 0,
    rapidFireSides: 0,
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
  };
  const active = applyCombatPresets(base, [payback], [], "Ranged");
  assert.equal(active.attacksReplacement, 6);
  assert.equal(active.sustainedHits, 3);
  const wrongPhase = applyCombatPresets(base, [payback], [], "Melee");
  assert.equal(wrongPhase.attacksReplacement, 0);
  assert.equal(wrongPhase.sustainedHits, 1);
  const inactiveMean = exactMean({ attacks: 3, sustainedHits: 1, save: 7 });
  const activeMean = exactMean({
    attacks: 3,
    attacksReplacement: active.attacksReplacement,
    sustainedHits: active.sustainedHits,
    save: 7,
  });
  assert.deepEqual(inactiveMean, { numerator: 5n, denominator: 2n });
  assert.deepEqual(activeMean, { numerator: 7n, denominator: 1n });

  const flashGitz = catalogue.units.find((unit) => unit.name === "Flash Gitz");
  const showOffs = flashGitz.combatPresets.find((preset) => preset.name === "Gun-crazy Show-offs");
  assert.equal(
    applyCombatPresets({ ...base, weaponName: "Snazzgun" }, [showOffs], [], "Ranged")
      .attacksReplacement,
    4,
  );
  assert.equal(
    applyCombatPresets({ ...base, weaponName: "Choppa" }, [showOffs], [], "Melee")
      .attacksReplacement,
    0,
  );

  const kommandos = catalogue.units.find((unit) => unit.name === "Kommandos");
  const distractionGrot = kommandos.combatPresets.find(
    (preset) => preset.name === "Distraction Grot",
  );
  assert.equal(distractionGrot.weaponScope, "Ranged");
  assert.equal(combatPresetSupportsWeapon(distractionGrot, "Ranged"), true);
  assert.equal(combatPresetSupportsWeapon(distractionGrot, "Melee"), false);

  const ridgerunners = catalogue.units.find((unit) => unit.name === "Achilles Ridgerunners");
  const crossfire = ridgerunners.combatPresets.find((preset) => preset.name === "Crossfire");
  assert.equal(crossfire.weaponScope, "Any");
  assert.equal(combatPresetSupportsWeapon(crossfire, "Ranged"), true);
  assert.equal(combatPresetSupportsWeapon(crossfire, "Melee"), true);
});

test("source-backed defensive profile values reduce C/Wasm exact damage", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const redemptor = catalogue.units.find((unit) => unit.name === "Redemptor Dreadnought");
  const model = redemptor.models[0];
  assert.equal(model.reduction, 1);
  const baseline = exactMean({
    ap: 2,
    save: model.save,
    invulnerable: model.invuln ?? 0,
    reduction: 0,
  });
  const defended = exactMean({
    ap: 2,
    save: model.save,
    invulnerable: model.invuln ?? 0,
    feelNoPain: model.feelNoPain,
    reduction: model.reduction,
  });
  assert.ok(lessThanOrEqual(defended, baseline));
  assert.notDeepEqual(defended, baseline);

  const avatar = catalogue.units.find((unit) => unit.name === "Avatar of Khaine");
  const avatarModel = avatar.models[0];
  assert.equal(avatarModel.damageDivisor, 2);
  const undivided = exactMean({
    ap: 2,
    save: avatarModel.save,
    invulnerable: avatarModel.invuln ?? 0,
  });
  const divided = exactMean({
    ap: 2,
    save: avatarModel.save,
    invulnerable: avatarModel.invuln ?? 0,
    damageDivisor: avatarModel.damageDivisor,
  });
  assert.ok(lessThanOrEqual(divided, undivided));
  assert.notDeepEqual(divided, undivided);
});

test("single-model bearer wargear composes exact optional defenses", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const commander = catalogue.units.find(
    (unit) => unit.name === "Commander In Coldstar Battlesuit",
  );
  const shield = commander.combatPresets.find((preset) => preset.name === "Shield Generator");
  const base = { weaponName: "", ap: 4, save: 3, invulnerable: 0, reduction: 0 };
  const defended = applyCombatPresets(base, [], [shield], "Ranged");
  assert.equal(defended.invulnerable, 4);
  const shieldedMean = exactMean({ ap: 4, save: 3, invulnerable: defended.invulnerable });
  const unshieldedMean = exactMean({ ap: 4, save: 3, invulnerable: 0 });
  assert.ok(lessThanOrEqual(shieldedMean, unshieldedMean));
  assert.notDeepEqual(shieldedMean, unshieldedMean);

  const wraithknight = catalogue.units.find((unit) => unit.name === "Wraithknight");
  const scattershield = wraithknight.combatPresets.find(
    (preset) => preset.name === "Scattershield",
  );
  const compound = applyCombatPresets(base, [], [scattershield], "Ranged");
  assert.equal(compound.invulnerable, 4);
  assert.equal(compound.reduction, 1);

  const lychguard = catalogue.units.find((unit) => unit.name === "Lychguard");
  assert.equal(
    lychguard.combatPresets.some((preset) => preset.name === "Dispersion Shield"),
    false,
  );
});
