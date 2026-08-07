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
  applyCombatPresets,
  attackKeywordsForWeapon,
  selectedAndAutomaticCombatPresets,
} from "../lib/combat-presets.mjs";

const defaults = {
  attackDice: 0,
  attackSides: 0,
  attacks: 1,
  attacksReplacement: 0,
  attacksMultiplier: 1,
  attacksModifier: 0,
  weaponCount: 1,
  hitOn: 4,
  strength: 4,
  strengthReplacement: 0,
  strengthMultiplier: 1,
  strengthModifier: 0,
  ap: 0,
  damageDice: 0,
  damageSides: 0,
  damage: 1,
  damageReplacement: null,
  firstFailedSaveDamageReplacement: null,
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
  toughness: 4,
  save: 3,
  invulnerable: 0,
  feelNoPain: 0,
  wounds: 1,
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
  attackerUnitModels: 0,
  nearbyEnemyModels: 0,
  attackerCharged: false,
  attackerRemainedStationary: false,
  attackerAttached: false,
  targetAttached: false,
  attackerWaaaghActive: false,
  targetWaaaghActive: false,
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

test("agent query parses a complete direct profile and compact rule names", () => {
  assert.equal(AGENT_SCHEMA_VERSION, 1);
  const profile = parseAgentProfile(
    "attacks=D6%2B2&weaponCount=2&hit=3&strength=12&ap=4&damage=D3%2B1" +
      "&toughness=10&save=2&invuln=4&fnp=5&wounds=12&models=2&reduction=1&damageDivisor=2" +
      "&firstFailedSaveDamageReplacement=0" +
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
  assert.equal(profile.damageDivisor, 2);
  assert.equal(profile.firstFailedSaveDamageReplacement, 0);
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
  assert.throws(
    () => parseAgentProfile("targetStrength=destroyed", defaults, false),
    /targetStrengthState must be full, below-starting, or below-half/i,
  );
});

test("canonical agent parameters round-trip every supported profile field", () => {
  const expected = {
    ...defaults,
    attackDice: 2,
    attackSides: 3,
    attacks: 1,
    attacksReplacement: 7,
    attacksMultiplier: 2,
    attacksModifier: -2,
    strengthReplacement: 11,
    strengthMultiplier: 3,
    damageDice: 1,
    damageSides: 6,
    damage: 2,
    damageReplacement: 0,
    firstFailedSaveDamageReplacement: 0,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 0,
    allocatedAttackDamageReplacementSkip: 0,
    damageMultiplier: 4,
    damageModifier: -1,
    characteristicModifierDice: 1,
    characteristicModifierSides: 3,
    characteristicModifierBonus: 1,
    characteristicModifierAttacks: true,
    characteristicModifierStrength: true,
    strengthModifier: 3,
    hitModifier: -1,
    woundModifier: 1,
    criticalWounds: 5,
    rapidFire: 2,
    targetDistance: 9,
    attackerUnitModels: 11,
    nearbyEnemyModels: 7,
    attackerCharged: true,
    attackerRemainedStationary: true,
    attackerAttached: true,
    targetAttached: true,
    attackerWaaaghActive: true,
    targetWaaaghActive: true,
    targetOathOfMoment: true,
    attackerOathWoundBonusEligible: true,
    attackerBattleShocked: true,
    targetBattleShocked: true,
    targetStrengthState: "below_half",
    blast: true,
    rerollWounds: true,
  };
  const search = canonicalAgentParameters(expected);
  const actual = parseAgentProfile(search, defaults);
  assert.deepEqual(actual, expected);
});

test("catalogue agent stationary state selects exact automatic rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const porphyrion = catalogue.units.find((unit) => unit.name === "Acastus Knight Porphyrion");
  const bastion = porphyrion.combatPresets.find((preset) => preset.name === "Bastion of Firepower");
  const weapon = porphyrion.weapons.find((entry) => entry.name === "Acastus autocannon");
  const selected = (stationary) =>
    selectedAndAutomaticCombatPresets(
      porphyrion.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      stationary,
    );
  assert.equal(bastion.requiresAttackerStationary, true);
  assert.deepEqual(selected(false), []);
  assert.deepEqual(
    selected(true).map((preset) => preset.name),
    ["Bastion of Firepower"],
  );
  assert.equal(
    parseAgentProfile("stationary=true", defaults, false).attackerRemainedStationary,
    true,
  );
});

test("catalogue agent Attached-unit state selects exact automatic leader rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const chaplain = catalogue.units.find((unit) => unit.name === "Chaplain");
  const litany = chaplain.combatPresets.find((preset) => preset.name === "Litany of Hate");
  const weapon = chaplain.weapons.find((entry) => entry.type === "Melee");
  const selected = (attached) =>
    selectedAndAutomaticCombatPresets(
      chaplain.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      attached,
    );
  assert.equal(litany.requiresAttachedUnit, true);
  assert.equal(
    selected(false).some((preset) => preset.name === "Litany of Hate"),
    false,
  );
  assert.equal(
    selected(true).some((preset) => preset.name === "Litany of Hate"),
    true,
  );
  assert.equal(parseAgentProfile("attackerAttached=true", defaults, false).attackerAttached, true);
  assert.equal(parseAgentProfile("targetAttached=true", defaults, false).targetAttached, true);
  assert.equal(parseAgentProfile("waaaghActive=true", defaults, false).attackerWaaaghActive, true);
  assert.equal(
    parseAgentProfile("targetWaaaghActive=true", defaults, false).targetWaaaghActive,
    true,
  );
  assert.equal(parseAgentProfile("oathTarget=true", defaults, false).targetOathOfMoment, true);
  assert.equal(
    parseAgentProfile("oathWoundBonus=true", defaults, false).attackerOathWoundBonusEligible,
    true,
  );
  assert.equal(parseAgentProfile("unitModels=12", defaults, false).attackerUnitModels, 12);
  assert.equal(parseAgentProfile("nearbyEnemyModels=9", defaults, false).nearbyEnemyModels, 9);
});

test("catalogue agent Waaagh state selects exact universal and direct rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const boyz = catalogue.units.find((unit) => unit.name === "Boyz");
  const melee = boyz.weapons.find((weapon) => weapon.type === "Melee");
  const selected = (active) =>
    selectedAndAutomaticCombatPresets(
      boyz.combatPresets,
      [],
      melee.type,
      melee.name,
      [],
      attackKeywordsForWeapon(melee),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      active,
    );
  assert.equal(
    selected(false).some((preset) => preset.name.startsWith("Waaagh! —")),
    false,
  );
  assert.deepEqual(
    selected(true)
      .filter((preset) => preset.name.startsWith("Waaagh! —"))
      .map((preset) => preset.name),
    ["Waaagh! — Melee weapons", "Waaagh! — Invulnerable save"],
  );
  const requested = parseAgentProfile("waaaghActive=true", defaults, false);
  const composed = applyCombatPresets(
    { ...requested, weaponName: melee.name },
    selected(requested.attackerWaaaghActive),
    [],
    melee.type,
    { attackerWaaaghActive: requested.attackerWaaaghActive },
  );
  assert.equal(composed.attacksModifier, 1);
  assert.equal(composed.strengthModifier, 1);
});

test("catalogue agent Oath state separates the Hit re-roll from the Codex Wound bonus", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const intercessors = catalogue.units.find((unit) => unit.name === "Intercessor Squad");
  const weapon = intercessors.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOathOfMoment, woundBonusEligible) =>
    selectedAndAutomaticCombatPresets(
      intercessors.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      targetOathOfMoment,
      woundBonusEligible,
    );
  assert.deepEqual(selected(false, false), []);
  assert.deepEqual(
    selected(true, false).map((preset) => preset.name),
    ["Oath of Moment — Hit re-roll"],
  );
  assert.deepEqual(
    selected(true, true).map((preset) => preset.name),
    ["Oath of Moment — Hit re-roll", "Oath of Moment — Codex Wound bonus"],
  );
  const hitOnly = applyCombatPresets(
    { ...defaults, weaponName: weapon.name, targetOathOfMoment: true },
    selected(true, false),
    [],
    weapon.type,
    { targetOathOfMoment: true },
  );
  assert.equal(hitOnly.rerollHits, true);
  assert.equal(hitOnly.woundModifier, 0);
  const full = applyCombatPresets(
    {
      ...defaults,
      weaponName: weapon.name,
      targetOathOfMoment: true,
      attackerOathWoundBonusEligible: true,
    },
    selected(true, true),
    [],
    weapon.type,
    { targetOathOfMoment: true, attackerOathWoundBonusEligible: true },
  );
  assert.equal(full.rerollHits, true);
  assert.equal(full.woundModifier, 1);
});

test("catalogue agent model counts compose exact automatic Attacks scaling", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const gabriel = catalogue.units.find((unit) => unit.name === "Gabriel Seth");
  const weapon = gabriel.weapons.find((entry) => entry.name === "Blood Reaver");
  const requested = parseAgentProfile("nearbyEnemyModels=12", defaults, false);
  const presets = selectedAndAutomaticCombatPresets(
    gabriel.combatPresets,
    [],
    weapon.type,
    weapon.name,
    [],
    attackKeywordsForWeapon(weapon),
  );
  const profile = applyCombatPresets(
    { ...requested, weaponName: weapon.name },
    presets,
    [],
    weapon.type,
    { nearbyEnemyModels: requested.nearbyEnemyModels },
  );
  assert.equal(profile.attacksModifier, 2);
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

test("source-backed target-distance presets require a known in-range target", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const warbikers = catalogue.units.find((unit) => unit.name === "Warbikers");
  const preset = warbikers.combatPresets.find((entry) => entry.name === "Drive-by Dakka");
  const weapon = warbikers.weapons.find((entry) => entry.type === "Ranged");
  const selected = (distance) =>
    selectedAndAutomaticCombatPresets(
      warbikers.combatPresets,
      [preset.id],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      distance,
    );
  assert.equal(preset.maximumTargetDistance, 9);
  assert.equal(selected(0).length, 0);
  assert.equal(selected(9).length, 1);
  assert.equal(selected(10).length, 0);
});

test("catalogue agent Battle-shock state selects only exact automatic rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const furies = catalogue.units.find((unit) => unit.name === "Furies");
  const prey = furies.combatPresets.find((preset) => preset.name === "Prey on the Weak");
  const weapon = furies.weapons[0];
  const selectedFuries = (targetBattleShocked) =>
    selectedAndAutomaticCombatPresets(
      furies.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      targetBattleShocked,
    );
  assert.equal(prey.requiresTargetBattleShocked, true);
  assert.deepEqual(selectedFuries(false), []);
  assert.deepEqual(
    selectedFuries(true).map((preset) => preset.name),
    ["Prey on the Weak"],
  );

  const priest = catalogue.units.find((unit) => unit.name === "Ministorum Priest");
  const holyPiety = priest.combatPresets.find((preset) => preset.name === "Holy Piety");
  const priestWeapon = priest.weapons.find((entry) => entry.type === "Melee");
  const selectedPriest = (attackerBattleShocked) =>
    selectedAndAutomaticCombatPresets(
      priest.combatPresets,
      [],
      priestWeapon.type,
      priestWeapon.name,
      [],
      attackKeywordsForWeapon(priestWeapon),
      0,
      false,
      attackerBattleShocked,
      false,
    );
  assert.equal(holyPiety.requiresAttackerNotBattleShocked, true);
  assert.deepEqual(
    selectedPriest(false).map((preset) => preset.name),
    ["Holy Piety"],
  );
  assert.deepEqual(selectedPriest(true), []);
});

test("catalogue agent target strength state handles Below Half-strength boundaries", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const ballistus = catalogue.units.find((unit) => unit.name === "Ballistus Dreadnought");
  const strike = ballistus.combatPresets.find((preset) => preset.name === "Ballistus Strike");
  const ranged = ballistus.weapons.find((weapon) => weapon.type === "Ranged");
  const ballistusSelection = (state) =>
    selectedAndAutomaticCombatPresets(
      ballistus.combatPresets,
      [],
      ranged.type,
      ranged.name,
      [],
      attackKeywordsForWeapon(ranged),
      0,
      false,
      false,
      false,
      state,
    );
  assert.equal(strike.requiredTargetStrengthState, "not_below_half");
  assert.deepEqual(
    ballistusSelection("full").map((preset) => preset.name),
    ["Ballistus Strike"],
  );
  assert.deepEqual(
    ballistusSelection("below_starting").map((preset) => preset.name),
    ["Ballistus Strike"],
  );
  assert.deepEqual(ballistusSelection("below_half"), []);

  const cyberwolf = catalogue.units.find((unit) => unit.name === "Cyberwolf");
  const closeIn = cyberwolf.combatPresets.find((preset) => preset.name === "Close In for the Kill");
  const melee = cyberwolf.weapons.find((weapon) => weapon.type === "Melee");
  const cyberwolfSelection = (state) =>
    selectedAndAutomaticCombatPresets(
      cyberwolf.combatPresets,
      [],
      melee.type,
      melee.name,
      [],
      attackKeywordsForWeapon(melee),
      0,
      false,
      false,
      false,
      state,
    );
  assert.equal(closeIn.requiredTargetStrengthState, "below_half");
  assert.deepEqual(cyberwolfSelection("full"), []);
  assert.deepEqual(cyberwolfSelection("below_starting"), []);
  assert.deepEqual(
    cyberwolfSelection("below_half").map((preset) => preset.name),
    ["Close In for the Kill"],
  );
});
