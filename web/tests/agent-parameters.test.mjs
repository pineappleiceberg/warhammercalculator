import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_SCHEMA_VERSION,
  canonicalAgentParameters,
  isCatalogueAgentQuery,
  parseAgentProfile,
  resolveAgentCatalogueSelection,
} from "../lib/agent-parameters.mjs";
import {
  attackKeywordsForWeapon,
  selectedAndAutomaticCombatPresets,
} from "../lib/combat-presets.mjs";

const defaults = {
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
};

test("agent query parses a complete direct profile and compact rule names", () => {
  assert.equal(AGENT_SCHEMA_VERSION, 1);
  const profile = parseAgentProfile(
    "attacks=D6%2B2&weaponCount=2&hit=3&strength=12&ap=4&damage=D3%2B1" +
      "&toughness=10&save=2&invuln=4&fnp=5&wounds=12&models=2&reduction=1" +
      "&sustainedHits=D3&rerollHits=ones&rules=lethal-hits%2Ctwin-linked%2Chalf-range",
    defaults,
  );
  assert.deepEqual(
    [profile.attackDice, profile.attackSides, profile.attacks, profile.weaponCount],
    [1, 6, 2, 2],
  );
  assert.deepEqual([profile.damageDice, profile.damageSides, profile.damage], [1, 3, 1]);
  assert.deepEqual(
    [profile.toughness, profile.save, profile.invulnerable, profile.feelNoPain],
    [10, 2, 4, 5],
  );
  assert.deepEqual(
    [profile.sustainedHitsDice, profile.sustainedHitsSides, profile.sustainedHits],
    [1, 3, 0],
  );
  assert.equal(profile.rerollHits, false);
  assert.equal(profile.rerollHitOnes, true);
  assert.equal(profile.lethalHits, true);
  assert.equal(profile.twinLinked, true);
  assert.equal(profile.withinHalfRange, true);
});

test("agent query rejects incomplete, unknown, duplicate, and inexact values", () => {
  assert.throws(
    () => parseAgentProfile("attacks=1", defaults),
    /missing required parameters.*hit.*strength.*damage/i,
  );
  assert.throws(
    () =>
      parseAgentProfile(
        "attacks=1&hit=3&strength=4&ap=0&damage=1&toughness=4&save=3&wounds=1&typo=1",
        defaults,
      ),
    /unknown parameter: typo/i,
  );
  assert.throws(
    () =>
      parseAgentProfile(
        "attacks=1&hit=3&hitOn=4&strength=4&ap=0&damage=1&toughness=4&save=3&wounds=1",
        defaults,
      ),
    /hitOn must be supplied once/i,
  );
  assert.throws(
    () =>
      parseAgentProfile(
        "attacks=D6-1&hit=3&strength=4&ap=0&damage=1&toughness=4&save=3&wounds=1",
        defaults,
      ),
    /negative dice modifier/i,
  );
  assert.throws(() => parseAgentProfile("format=xml", defaults, false), /format must be json/i);
});

test("canonical agent parameters round-trip every supported profile field", () => {
  const expected = {
    ...defaults,
    attackDice: 2,
    attackSides: 3,
    attacks: 1,
    attacksReplacement: 7,
    attacksModifier: -2,
    strengthReplacement: 11,
    damageDice: 1,
    damageSides: 6,
    damage: 2,
    damageReplacement: 0,
    damageModifier: -1,
    strengthModifier: 3,
    hitModifier: -1,
    woundModifier: 1,
    criticalWounds: 5,
    rapidFire: 2,
    blast: true,
    rerollWounds: true,
  };
  const search = canonicalAgentParameters(expected);
  const actual = parseAgentProfile(search, defaults);
  assert.deepEqual(actual, expected);
});

test("catalogue agent query resolves stable IDs or unambiguous names", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const names = "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Brutalis%20Dreadnought";
  assert.equal(isCatalogueAgentQuery(names), true);
  const selection = resolveAgentCatalogueSelection(names, catalogue);
  assert.equal(selection.attacker.id, "000000545");
  assert.equal(selection.weapon.id, 1531);
  assert.equal(selection.target.id, "000000136");
  assert.equal(selection.model.id, 117);

  const ids = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000000136&model=117",
    catalogue,
  );
  assert.equal(ids.weapon.name, "Heavy death ray");
  const nativeDefense = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=Redemptor%20Dreadnought",
    catalogue,
  );
  assert.equal(nativeDefense.model.reduction, 1);
  const psychicTarget = resolveAgentCatalogueSelection(
    "attacker=Culexus%20Assassin&weapon=Animus%20speculum&target=Exalted%20Sorcerer",
    catalogue,
  );
  const automatic = selectedAndAutomaticCombatPresets(
    psychicTarget.attacker.combatPresets,
    [],
    psychicTarget.weapon.type,
    psychicTarget.weapon.name,
    psychicTarget.model.keywords,
  );
  assert.deepEqual(
    automatic.map((preset) => preset.name),
    ["Psychic Assassin"],
  );
  const ordinaryTarget = resolveAgentCatalogueSelection(
    "attacker=Culexus%20Assassin&weapon=Animus%20speculum&target=Brutalis%20Dreadnought",
    catalogue,
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets(
      ordinaryTarget.attacker.combatPresets,
      [],
      ordinaryTarget.weapon.type,
      ordinaryTarget.weapon.name,
      ordinaryTarget.model.keywords,
    ),
    [],
  );
  const psychicDefense = resolveAgentCatalogueSelection(
    "attacker=Exalted%20Sorcerer&weapon=Astral%20Blast&target=Culexus%20Assassin",
    catalogue,
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets(
      psychicDefense.target.combatPresets,
      [],
      psychicDefense.weapon.type,
      psychicDefense.weapon.name,
      psychicDefense.model.keywords,
      attackKeywordsForWeapon(psychicDefense.weapon),
    ).map((preset) => preset.name),
    ["Abomination"],
  );
  const ordinaryDefense = resolveAgentCatalogueSelection(
    "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Culexus%20Assassin",
    catalogue,
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets(
      ordinaryDefense.target.combatPresets,
      [],
      ordinaryDefense.weapon.type,
      ordinaryDefense.weapon.name,
      ordinaryDefense.model.keywords,
      attackKeywordsForWeapon(ordinaryDefense.weapon),
    ),
    [],
  );
  assert.throws(
    () => resolveAgentCatalogueSelection("attacker=Doom%20Scythe&target=000000136", catalogue),
    /missing catalogue parameters: weapon/i,
  );
});
