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
  combatPresetMatchesSourceRelationship,
  selectedAndAutomaticCombatPresets,
} from "../lib/combat-presets.mjs";
import { firingDeckWeapons, resolveFiringDeckSelections } from "../lib/firing-deck.mjs";

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
  attackerSourceTargetDistance: 0,
  targetSourceAttackerDistance: 0,
  attackerUnitModels: 0,
  nearbyEnemyModels: 0,
  nearbyEnemyUnits: 0,
  enemyCharacterModelsDestroyed: 0,
  destructiveFightPhases: 0,
  embarkedModels: 0,
  embarkedWracksModels: 0,
  attackerCharged: false,
  attackerRemainedStationary: false,
  attackerAttached: false,
  targetAttached: false,
  attackerWaaaghActive: false,
  targetWaaaghActive: false,
  attackerSourceCanSeeTarget: false,
  targetSourceCanSeeAttacker: false,
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
  assert.throws(
    () => parseAgentProfile("targetObjectiveOwner=both", defaults, false),
    /targetObjectiveOwner must be unknown, attacker, target, or uncontrolled/i,
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
    attackerSourceTargetDistance: 24,
    targetSourceAttackerDistance: 12,
    supportDistance: 8,
    targetSupportDistance: 5,
    attackerUnitModels: 11,
    nearbyEnemyModels: 7,
    nearbyEnemyUnits: 3,
    enemyCharacterModelsDestroyed: 2,
    destructiveFightPhases: 4,
    embarkedModels: 10,
    embarkedWracksModels: 6,
    attackerCharged: true,
    attackerRemainedStationary: true,
    attackerAttached: true,
    targetAttached: true,
    attackerWaaaghActive: true,
    targetWaaaghActive: true,
    targetOathOfMoment: true,
    attackerOathWoundBonusEligible: true,
    attackerOnObjective: true,
    targetOnObjective: true,
    attackerObjectiveOwner: "attacker",
    targetObjectiveOwner: "target",
    attackerOnAttackerSelectedObjective: true,
    targetOnAttackerSelectedObjective: true,
    attackerOnTargetSelectedObjective: true,
    targetOnTargetSelectedObjective: true,
    attackerGuidedAgainstTarget: true,
    targetSpotted: true,
    targetSpottedByMarkerlightObserver: true,
    targetClosestEligible: true,
    attackerSourceCanSeeTarget: true,
    targetSourceCanSeeAttacker: true,
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
  assert.equal(
    parseAgentProfile("attackerObjective=true", defaults, false).attackerOnObjective,
    true,
  );
  assert.equal(parseAgentProfile("targetObjective=true", defaults, false).targetOnObjective, true);
  assert.equal(
    parseAgentProfile("attackerObjectiveControl=attacker", defaults, false).attackerObjectiveOwner,
    "attacker",
  );
  assert.equal(
    parseAgentProfile("targetObjectiveControl=uncontrolled", defaults, false).targetObjectiveOwner,
    "uncontrolled",
  );
  assert.equal(
    parseAgentProfile("attackerOnOwnSelectedObjective=true", defaults, false)
      .attackerOnAttackerSelectedObjective,
    true,
  );
  assert.equal(
    parseAgentProfile("targetOnOwnSelectedObjective=true", defaults, false)
      .targetOnTargetSelectedObjective,
    true,
  );
  assert.equal(parseAgentProfile("unitModels=12", defaults, false).attackerUnitModels, 12);
  assert.equal(parseAgentProfile("nearbyEnemyModels=9", defaults, false).nearbyEnemyModels, 9);
  assert.equal(parseAgentProfile("nearbyEnemyUnits=3", defaults, false).nearbyEnemyUnits, 3);
  assert.equal(
    parseAgentProfile("characterKills=2", defaults, false).enemyCharacterModelsDestroyed,
    2,
  );
  assert.equal(parseAgentProfile("soulEaterStacks=4", defaults, false).destructiveFightPhases, 4);
  assert.equal(parseAgentProfile("passengers=10", defaults, false).embarkedModels, 10);
  assert.equal(
    parseAgentProfile("passengers=10&wrackPassengers=6", defaults, false).embarkedWracksModels,
    6,
  );
  assert.throws(
    () => parseAgentProfile("passengers=5&wrackPassengers=6", defaults, false),
    /cannot exceed/,
  );
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

test("Firing Deck catalogue requests enforce selection limits and transport bearer semantics", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const trukk = catalogue.units.find((unit) => unit.id === "000000026");
  const boyz = catalogue.units.find((unit) => unit.id === "000000016");
  const stormlord = catalogue.units.find((unit) => unit.id === "000000708");
  const heavyWeapons = catalogue.units.find((unit) => unit.id === "000000686");
  const target = catalogue.units.find((unit) => unit.name === "Brutalis Dreadnought");
  assert.equal(trukk.firingDeck.capacity, 12);
  assert.equal(heavyWeapons.firingDeckModelCost, 2);
  assert.equal(
    firingDeckWeapons(boyz).some((weapon) => weapon.type !== "Ranged"),
    false,
  );

  const selection = resolveAgentCatalogueSelection(
    `attacker=${trukk.id}&passenger=${boyz.id}&weapon=59&firingDeckModels=12&target=${target.id}`,
    catalogue,
  );
  assert.equal(selection.attacker.id, trukk.id);
  assert.equal(selection.passenger.id, boyz.id);
  assert.equal(selection.weapon.id, 59);
  assert.equal(selection.firingDeck.modelCount, 12);
  assert.equal(selection.firingDeck.slots, 12);

  const rhino = catalogue.units.find((unit) => unit.id === "000002723");
  const captain = catalogue.units.find((unit) => unit.id === "000000073");
  const tacticalSquad = catalogue.units.find((unit) => unit.id === "000000070");
  const captainWeapon = captain.weapons.find((weapon) => weapon.type === "Ranged");
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        `attacker=${rhino.id}&passenger=${captain.id}&weapon=${captainWeapon.id}&target=${target.id}`,
        catalogue,
      ),
    /exclusion/i,
  );
  const attachedSelection = resolveAgentCatalogueSelection(
    `attacker=${rhino.id}&passenger=${captain.id}&attached=${tacticalSquad.id}&weapon=${captainWeapon.id}&target=${target.id}`,
    catalogue,
  );
  assert.equal(attachedSelection.attached.id, tacticalSquad.id);
  assert.equal(attachedSelection.firingDeck.attachedUnitId, tacticalSquad.id);

  const heavySelection = resolveFiringDeckSelections(catalogue, stormlord, [
    {
      passengerUnitId: heavyWeapons.id,
      weaponId: heavyWeapons.weapons.find((weapon) => weapon.name === "Lascannon").id,
      modelCount: 6,
      unitAlreadyShot: false,
    },
  ]);
  assert.equal(heavySelection.slots, 12);
  assert.throws(
    () =>
      resolveFiringDeckSelections(catalogue, trukk, [
        {
          passengerUnitId: heavyWeapons.id,
          weaponId: heavyWeapons.weapons.find((weapon) => weapon.name === "Lascannon").id,
          modelCount: 1,
        },
      ]),
    /required Transport keywords/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        `attacker=${trukk.id}&passenger=${boyz.id}&weapon=59&firingDeckModels=13&target=${target.id}`,
        catalogue,
      ),
    /allows 12/,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        `attacker=${trukk.id}&passenger=${boyz.id}&weapon=61&target=${target.id}`,
        catalogue,
      ),
    /only ranged weapons/,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        `attacker=${trukk.id}&passenger=${boyz.id}&weapon=59&passengerAlreadyShot=true&target=${target.id}`,
        catalogue,
      ),
    /already shot/,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        `attacker=${trukk.id}&passenger=${boyz.id}&weapon=59&firingDeckModels=2&weaponCount=3&target=${target.id}`,
        catalogue,
      ),
    /must match firingDeckModels/,
  );
  const fortress = catalogue.units.find((unit) => unit.id === "000000243");
  const oneShotPassenger = catalogue.units.find((unit) => unit.id === "000003716");
  const oneShotWeapon = oneShotPassenger.weapons.find(
    (weapon) =>
      weapon.type === "Ranged" &&
      weapon.abilities.some((ability) => ability.name.toLowerCase() === "one shot"),
  );
  assert.throws(
    () =>
      resolveFiringDeckSelections(catalogue, fortress, [
        {
          passengerUnitId: oneShotPassenger.id,
          weaponId: oneShotWeapon.id,
          modelCount: 1,
        },
      ]),
    /One Shot/,
  );
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

test("catalogue agent objective state separates a base re-roll from its objective upgrade", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const breachers = catalogue.units.find((unit) => unit.name === "Imperial Navy Breachers");
  const weapon = breachers.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOnObjective) =>
    selectedAndAutomaticCombatPresets(
      breachers.combatPresets,
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
      false,
      false,
      false,
      targetOnObjective,
    );
  assert.deepEqual(
    selected(false).map((preset) => preset.name),
    ["Breaching Team — Base re-roll"],
  );
  assert.deepEqual(
    selected(true).map((preset) => preset.name),
    ["Breaching Team — Base re-roll", "Breaching Team — Objective re-roll"],
  );
  const baseline = applyCombatPresets({}, selected(false), [], weapon.type);
  const objective = applyCombatPresets(
    { targetOnObjective: true },
    selected(true),
    [],
    weapon.type,
    { targetOnObjective: true },
  );
  assert.equal(baseline.rerollWoundOnes, true);
  assert.equal(baseline.rerollWounds, false);
  assert.equal(objective.rerollWounds, true);
  assert.equal(objective.rerollWoundOnes, false);
});

test("catalogue agent objective ownership activates only exact control relationships", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const russ = catalogue.units.find((unit) => unit.name === "Leman Russ Battle Tank");
  const weapon = russ.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOnObjective, targetNotControlledBySource) =>
    selectedAndAutomaticCombatPresets(
      russ.combatPresets,
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
      false,
      false,
      false,
      targetOnObjective,
      false,
      targetNotControlledBySource,
    ).filter((preset) => preset.name.startsWith("Armoured Spearhead —"));
  assert.deepEqual(
    [...new Set(selected(false, false).map((preset) => preset.name))],
    ["Armoured Spearhead — Base re-roll"],
  );
  assert.deepEqual(
    [...new Set(selected(true, false).map((preset) => preset.name))],
    ["Armoured Spearhead — Base re-roll"],
  );
  assert.deepEqual(
    [...new Set(selected(true, true).map((preset) => preset.name))],
    ["Armoured Spearhead — Base re-roll", "Armoured Spearhead — Objective-control re-roll"],
  );
  const unknown = applyCombatPresets(
    { targetOnObjective: true, targetObjectiveOwner: "unknown" },
    selected(true, false),
    [],
    weapon.type,
  );
  const opponent = applyCombatPresets(
    { targetOnObjective: true, targetObjectiveOwner: "target" },
    selected(true, true),
    [],
    weapon.type,
  );
  assert.equal(unknown.rerollHitOnes, true);
  assert.equal(unknown.rerollHits, false);
  assert.equal(opponent.rerollHits, true);
  assert.equal(opponent.rerollHitOnes, false);
});

test("catalogue agent selected-objective state activates only the exact directional relationship", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const lieutenant = catalogue.units.find((unit) => unit.name === "Lieutenant With Combi-weapon");
  const priority = lieutenant.combatPresets.find(
    (preset) => preset.name === "Priority Objective Identified",
  );
  const weapon = lieutenant.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOnSelectedObjective) =>
    selectedAndAutomaticCombatPresets(
      lieutenant.combatPresets,
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
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      targetOnSelectedObjective,
    );
  assert.equal(priority.activation, "automatic");
  assert.equal(priority.requiresTargetOnSourceSelectedObjective, true);
  assert.deepEqual(selected(false), []);
  assert.deepEqual(
    selected(true).map((preset) => preset.name),
    ["Priority Objective Identified"],
  );
  const inactive = applyCombatPresets(defaults, selected(false), [], weapon.type);
  const active = applyCombatPresets(
    { ...defaults, targetOnAttackerSelectedObjective: true },
    selected(true),
    [],
    weapon.type,
  );
  assert.equal(inactive.rerollWoundOnes, false);
  assert.equal(active.rerollWoundOnes, true);

  const hand = catalogue.units.find((unit) => unit.name === "Hand of the Archon");
  const archon = hand.combatPresets.find((preset) => preset.name === "Archon’s Will");
  const archonWeapon = hand.weapons.find((entry) => entry.type === "Ranged");
  const selectedArchon = (sourceOnSelectedObjective, sourceBattleShocked) =>
    selectedAndAutomaticCombatPresets(
      hand.combatPresets,
      [],
      archonWeapon.type,
      archonWeapon.name,
      [],
      attackKeywordsForWeapon(archonWeapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      sourceOnSelectedObjective,
      false,
      sourceBattleShocked,
    );
  assert.equal(archon.requiresSourceOnSelectedObjective, true);
  assert.equal(archon.requiresSourceNotBattleShocked, true);
  assert.deepEqual(selectedArchon(false, false), []);
  assert.deepEqual(selectedArchon(true, true), []);
  const defended = applyCombatPresets(
    defaults,
    [],
    selectedArchon(true, false),
    archonWeapon.type,
    { targetOnTargetSelectedObjective: true, targetBattleShocked: false },
  );
  assert.equal(defended.invulnerable, 5);
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

  const huntaRig = catalogue.units.find((unit) => unit.name === "Hunta Rig");
  const butchaBoyz = huntaRig.weapons.find((entry) => entry.name === "Butcha boyz");
  const huntaRequested = parseAgentProfile("passengers=10", defaults, false);
  const huntaPresets = selectedAndAutomaticCombatPresets(
    huntaRig.combatPresets,
    [],
    butchaBoyz.type,
    butchaBoyz.name,
    [],
    attackKeywordsForWeapon(butchaBoyz),
  );
  assert.equal(
    applyCombatPresets(
      { ...huntaRequested, weaponName: butchaBoyz.name },
      huntaPresets,
      [],
      butchaBoyz.type,
    ).attacksModifier,
    6,
  );

  const raider = catalogue.units.find((unit) => unit.name === "Raider");
  const bladevanes = raider.weapons.find((entry) => entry.name === "Bladevanes and chainsnares");
  const raiderRequested = parseAgentProfile(
    "embarkedModels=10&embarkedWracksModels=4",
    defaults,
    false,
  );
  const raiderPresets = selectedAndAutomaticCombatPresets(
    raider.combatPresets,
    [],
    bladevanes.type,
    bladevanes.name,
    [],
    attackKeywordsForWeapon(bladevanes),
  );
  assert.equal(
    applyCombatPresets(
      { ...raiderRequested, weaponName: bladevanes.name },
      raiderPresets,
      [],
      bladevanes.type,
    ).attacksModifier,
    4,
  );

  const marshal = catalogue.units.find((unit) => unit.name === "Marshal");
  const marshalWeapon = marshal.weapons.find(
    (entry) => entry.name.toLowerCase() === "master-crafted power weapon",
  );
  const marshalRequested = parseAgentProfile("nearbyEnemyUnits=8", defaults, false);
  const marshalPresets = selectedAndAutomaticCombatPresets(
    marshal.combatPresets,
    [],
    marshalWeapon.type,
    marshalWeapon.name,
    [],
    attackKeywordsForWeapon(marshalWeapon),
  );
  const marshalProfile = applyCombatPresets(
    { ...marshalRequested, weaponName: marshalWeapon.name },
    marshalPresets,
    [],
    marshalWeapon.type,
  );
  assert.equal(marshalProfile.attacksModifier, 3);
});

test("catalogue agent applies Guided, Spotted, and Markerlight rules at exact boundaries", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const select = (
    unit,
    weapon,
    guided,
    spotted,
    markerlight,
    selectedIds = [],
    sourceRelationship = "self",
  ) =>
    selectedAndAutomaticCombatPresets(
      unit.combatPresets,
      selectedIds,
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
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      guided,
      spotted,
      markerlight,
      sourceRelationship,
    );

  const breachers = catalogue.units.find((unit) => unit.name === "Breacher Team");
  const blaster = breachers.weapons.find((weapon) => weapon.name === "Pulse blaster");
  assert.deepEqual(select(breachers, blaster, false, true, true), []);
  assert.deepEqual(
    select(breachers, blaster, true, true, false).map((preset) => preset.name),
    ["For the Greater Good — Guided Ballistic Skill"],
  );
  const guided = select(breachers, blaster, true, true, true);
  assert.deepEqual(
    guided.map((preset) => preset.name),
    [
      "For the Greater Good — Guided Ballistic Skill",
      "For the Greater Good — Markerlight Ignores Cover",
    ],
  );
  const guidedProfile = applyCombatPresets(
    {
      ...defaults,
      weaponName: blaster.name,
      hitOn: 4,
      hitModifier: -1,
      attackerGuidedAgainstTarget: true,
      targetSpotted: true,
      targetSpottedByMarkerlightObserver: true,
    },
    guided,
    [],
    "Ranged",
  );
  assert.equal(guidedProfile.hitOn, 3);
  assert.equal(guidedProfile.hitModifier, -1);
  assert.equal(guidedProfile.ignoresCover, true);

  const pathfinders = catalogue.units.find((unit) => unit.name === "Pathfinder Team");
  const carbine = pathfinders.weapons.find((weapon) => weapon.name === "Pulse carbine");
  assert.deepEqual(select(pathfinders, carbine, false, false, false), []);
  const uploaded = select(pathfinders, carbine, false, true, false);
  assert.deepEqual(
    uploaded.map((preset) => preset.name),
    ["Target Uploaded"],
  );
  const uploadedProfile = applyCombatPresets(
    { ...defaults, weaponName: carbine.name, hitOn: 4, targetSpotted: true },
    uploaded,
    [],
    "Ranged",
  );
  assert.equal(uploadedProfile.hitOn, 3);
  assert.equal(uploadedProfile.ignoresCover, true);

  const stealth = catalogue.units.find((unit) => unit.name === "Stealth Battlesuits");
  const forwardObservers = stealth.combatPresets.find(
    (preset) => preset.name === "Forward Observers",
  );
  assert.equal(
    select(stealth, blaster, true, true, false, [forwardObservers.id]).some(
      (preset) => preset.name === "Forward Observers",
    ),
    false,
    "A supporting-unit ability must not apply as the source unit's own preset",
  );
  const supported = select(
    stealth,
    blaster,
    true,
    true,
    false,
    [forwardObservers.id],
    "supporting_unit",
  );
  assert.deepEqual(
    supported.map((preset) => preset.name),
    ["Forward Observers"],
  );
  const supportedProfile = applyCombatPresets(
    { ...defaults, weaponName: blaster.name },
    supported,
    [],
    "Ranged",
    { attackerGuidedAgainstTarget: true, targetSpotted: true },
  );
  assert.equal(supportedProfile.rerollHitOnes, true);
  assert.equal(supportedProfile.rerollWoundOnes, true);

  const parsed = parseAgentProfile(
    "guided=true&spotted=true&markerlightSpotted=true",
    defaults,
    false,
  );
  assert.equal(parsed.attackerGuidedAgainstTarget, true);
  assert.equal(parsed.targetSpotted, true);
  assert.equal(parsed.targetSpottedByMarkerlightObserver, true);
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
  const assault = catalogue.units.find((unit) => unit.name === "Assault Squad");
  const derivedDefault = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000000061",
    catalogue,
  );
  assert.equal(derivedDefault.model.name, "Assault Sergeant");
  const legacyModel = resolveAgentCatalogueSelection(
    `attacker=000000545&weapon=1531&target=000000061&model=${assault.models[0].sourceModelId}`,
    catalogue,
  );
  assert.equal(legacyModel.model.name, "Assault Sergeant");
  assert.equal(legacyModel.model.sourceModelId, assault.models[0].sourceModelId);
  const specialist = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000002532&model=Soul%20Weaver",
    catalogue,
  );
  assert.equal(specialist.model.name, "Soul Weaver");
  const legacyVoidscarred = resolveAgentCatalogueSelection(
    `attacker=000000545&weapon=1531&target=000002532&model=${specialist.model.sourceModelId}`,
    catalogue,
  );
  assert.equal(legacyVoidscarred.model.name, "Voidscarred Felarch");
  const aquilaShieldBearer = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000004174&" +
      "model=Deathwatch%20Veteran%20with%20heavy%20thunder%20hammer",
    catalogue,
  );
  assert.equal(aquilaShieldBearer.model.name, "Deathwatch Veteran with heavy thunder hammer");
  const aquila = catalogue.units.find((unit) => unit.id === "000004174");
  const legacyAquila = resolveAgentCatalogueSelection(
    `attacker=000000545&weapon=1531&target=000004174&model=${aquila.models[0].sourceModelId}`,
    catalogue,
  );
  assert.equal(legacyAquila.model.name, "Kill Team Sergeant");
  const natorian = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000003821&model=Jensus%20Natorian",
    catalogue,
  );
  assert.equal(natorian.model.name, "Jensus Natorian");
  const silva = resolveAgentCatalogueSelection(
    "attacker=000000545&weapon=1531&target=000004188&model=Gaius%20Silva",
    catalogue,
  );
  assert.equal(silva.model.name, "Gaius Silva");
  const supported = resolveAgentCatalogueSelection(
    "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
      "support=Stealth%20Battlesuits&supportPreset=Forward%20Observers",
    catalogue,
  );
  assert.equal(supported.support.name, "Stealth Battlesuits");
  assert.deepEqual(
    supported.supportPresets.map((preset) => preset.name),
    ["Forward Observers"],
  );
  const selectedTargetSupport = resolveAgentCatalogueSelection(
    "attacker=Autarch&weapon=Death%20spinner&target=Brutalis%20Dreadnought&" +
      "support=Eldrad%20Ulthran&supportPreset=Doom%20%28Psychic%29&" +
      "sourceDistance=18&sourceVisible=true",
    catalogue,
  );
  assert.equal(selectedTargetSupport.support.name, "Eldrad Ulthran");
  assert.equal(
    selectedTargetSupport.supportPresets[0].sourceRelationship,
    "self_or_supporting_unit",
  );
  const selectedTargetSelf = resolveAgentCatalogueSelection(
    "attacker=Eldrad%20Ulthran&weapon=Shuriken%20pistol&target=Brutalis%20Dreadnought&" +
      "attackerPreset=Doom%20%28Psychic%29&sourceDistance=18&sourceVisible=true",
    catalogue,
  );
  assert.equal(selectedTargetSelf.attackerPresets[0].name, "Doom (Psychic)");
  const limitedSupport = resolveAgentCatalogueSelection(
    "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
      "support=000000439&supportPreset=Blacklight%20Marker%20Drones",
    catalogue,
  );
  assert.equal(limitedSupport.supportPresets[0].usesPerBattle, 2);
  const targetedSupport = resolveAgentCatalogueSelection(
    "attacker=000002721&weapon=5537&target=000000136&support=000000140&" +
      "supportPreset=Blessing%20of%20the%20Omnissiah&supportDistance=3",
    catalogue,
  );
  assert.equal(targetedSupport.support.name, "Techmarine");
  assert.equal(targetedSupport.supportPresets[0].maximumSupportDistance, 3);
  assert.deepEqual(targetedSupport.supportPresets[0].requiredSupportedKeywords, [
    "adeptus astartes",
    "vehicle",
  ]);
  const targetSupported = resolveAgentCatalogueSelection(
    "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Necron%20Warriors&" +
      "targetSupport=Illuminor%20Szeras&targetSupportPreset=Mechanical%20Augmentation%20%28Aura%29&" +
      "targetSupportDistance=3",
    catalogue,
  );
  assert.equal(targetSupported.targetSupport.name, "Illuminor Szeras");
  assert.deepEqual(
    targetSupported.targetSupportPresets.map((preset) => preset.name),
    ["Mechanical Augmentation (Aura)"],
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Necron%20Warriors&" +
          "targetSupport=Techmarine",
        catalogue,
      ),
    /target's faction/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Necron%20Warriors&" +
          "targetSupportPreset=Mechanical%20Augmentation%20%28Aura%29",
        catalogue,
      ),
    /targetSupport is required/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
          "attackerPreset=Forward%20Observers",
        catalogue,
      ),
    /not found|self ability/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
          "supportPreset=Forward%20Observers",
        catalogue,
      ),
    /support is required/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
          "support=Necron%20Warriors",
        catalogue,
      ),
    /attacker's faction/i,
  );
  assert.throws(
    () =>
      resolveAgentCatalogueSelection(
        "attacker=Breacher%20Team&weapon=Pulse%20blaster&target=Brutalis%20Dreadnought&" +
          "support=Breacher%20Team&supportPreset=For%20the%20Greater%20Good%20%E2%80%94%20Guided%20Ballistic%20Skill",
        catalogue,
      ),
    /supporting-unit ability/i,
  );
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

test("catalogue agent closest-target state gates exact automatic rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const aggressors = catalogue.units.find((unit) => unit.name === "Aggressor Squad");
  const preset = aggressors.combatPresets.find(
    (entry) => entry.name === "Close-quarters Firepower",
  );
  const parsed = parseAgentProfile("closestTarget=true", defaults, false);
  assert.equal(parsed.targetClosestEligible, true);
  assert.equal(preset.requiresTargetClosestEligible, true);
  assert.equal(applyCombatPresets(defaults, [preset], [], "Ranged").ap, 0);
  assert.equal(
    applyCombatPresets({ ...defaults, targetClosestEligible: true }, [preset], [], "Ranged").ap,
    1,
  );
});

test("selected visible-target rules require directional LOS and source range", async () => {
  const parsed = parseAgentProfile(
    "sourceDistance=18&targetSourceDistance=12&sourceVisible=true&targetSourceVisible=true",
    defaults,
    false,
  );
  assert.equal(parsed.attackerSourceTargetDistance, 18);
  assert.equal(parsed.targetSourceAttackerDistance, 12);
  assert.equal(parsed.attackerSourceCanSeeTarget, true);
  assert.equal(parsed.targetSourceCanSeeAttacker, true);
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const sorcerer = catalogue.units.find(
    (unit) =>
      unit.name.toLowerCase() === "sorcerer in terminator armour" &&
      unit.combatPresets.some((preset) => preset.name === "Marked by Fate (Psychic)"),
  );
  const marked = sorcerer.combatPresets.find(
    (preset) => preset.name === "Marked by Fate (Psychic)",
  );
  assert.equal(marked.requiresSourceTargetVisible, true);
  assert.equal(
    applyCombatPresets({ ...defaults, indirect: true }, [marked], [], "Ranged", {
      attackerSourceCanSeeTarget: false,
    }).hitModifier,
    0,
  );
  assert.equal(
    applyCombatPresets(defaults, [marked], [], "Ranged", {
      attackerSourceCanSeeTarget: true,
    }).hitModifier,
    1,
  );

  const eldrad = catalogue.units.find((unit) => unit.name === "Eldrad Ulthran");
  const doom = eldrad.combatPresets.find((preset) => preset.name === "Doom (Psychic)");
  assert.equal(doom.maximumSourceTargetDistance, 18);
  const woundModifier = (distance, visible) =>
    applyCombatPresets(defaults, [doom], [], "Ranged", {
      attackerSourceTargetDistance: distance,
      attackerSourceCanSeeTarget: visible,
      attackerKeywords: ["Aeldari"],
    }).woundModifier;
  assert.equal(woundModifier(0, true), 0);
  assert.equal(woundModifier(18, false), 0);
  assert.equal(woundModifier(18, true), 1);
  assert.equal(woundModifier(19, true), 0);
  assert.equal(
    applyCombatPresets(defaults, [doom], [], "Ranged", {
      attackerSourceTargetDistance: 18,
      attackerSourceCanSeeTarget: true,
      attackerKeywords: ["Necrons"],
    }).woundModifier,
    0,
  );

  const skyrunner = catalogue.units.find((unit) => unit.name === "Farseer Skyrunner");
  const misfortune = skyrunner.combatPresets.find(
    (preset) => preset.name === "Misfortune (Psychic)",
  );
  assert.equal(
    applyCombatPresets(defaults, [], [misfortune], "Ranged", {
      attackerSourceTargetDistance: 18,
      attackerSourceCanSeeTarget: true,
      targetSourceAttackerDistance: 18,
      targetSourceCanSeeAttacker: false,
    }).woundModifier,
    0,
  );
  assert.equal(
    applyCombatPresets(defaults, [], [misfortune], "Ranged", {
      attackerSourceTargetDistance: 0,
      attackerSourceCanSeeTarget: false,
      targetSourceAttackerDistance: 18,
      targetSourceCanSeeAttacker: true,
    }).woundModifier,
    -1,
  );
});

test("cross-unit selected targets enforce affected-unit and weapon qualifiers", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const preset = (unitName, presetName) =>
    catalogue.units
      .find((unit) => unit.name === unitName)
      .combatPresets.find((candidate) => candidate.name === presetName);
  const context = {
    attackerSourceTargetDistance: 18,
    attackerSourceCanSeeTarget: true,
  };

  const doom = preset("Eldrad Ulthran", "Doom (Psychic)");
  assert.equal(doom.sourceRelationship, "self_or_supporting_unit");
  assert.equal(combatPresetMatchesSourceRelationship(doom, "self"), true);
  assert.equal(combatPresetMatchesSourceRelationship(doom, "supporting_unit"), true);
  assert.equal(
    applyCombatPresets(defaults, [doom], [], "Ranged", {
      ...context,
      attackerKeywords: ["Aeldari"],
    }).woundModifier,
    1,
  );
  assert.equal(
    applyCombatPresets(defaults, [doom], [], "Ranged", {
      ...context,
      attackerKeywords: ["Necrons"],
    }).woundModifier,
    0,
  );

  const targetSighted = preset("Land Speeder", "Target Sighted");
  const targetSightedProfile = (attackerKeywords, attackKeywords) =>
    applyCombatPresets(defaults, [targetSighted], [], "Ranged", {
      attackerSourceCanSeeTarget: true,
      attackerKeywords,
      attackKeywords,
    });
  assert.equal(targetSightedProfile(["Adeptus Astartes"], ["Blast"]).hitModifier, 1);
  assert.equal(targetSightedProfile(["Adeptus Astartes"], []).hitModifier, 0);
  assert.equal(targetSightedProfile(["Astra Militarum"], ["Blast"]).hitModifier, 0);

  const spiritThief = preset("Lord Discordant On Helstalker", "Spirit Thief");
  assert.equal(
    applyCombatPresets(defaults, [spiritThief], [], "Ranged", {
      attackerSourceCanSeeTarget: true,
      attackerKeywords: ["Heretic Astartes"],
      targetKeywords: ["Vehicle"],
    }).rerollWoundOnes,
    true,
  );
  assert.equal(
    applyCombatPresets(defaults, [spiritThief], [], "Ranged", {
      attackerSourceCanSeeTarget: true,
      attackerKeywords: ["Heretic Astartes"],
      targetKeywords: ["Infantry"],
    }).rerollWoundOnes,
    false,
  );

  const blight = preset("Lord of Virulence", "Blight Bombardment");
  const blightProfile = (attackerKeywords, attackKeywords) =>
    applyCombatPresets(defaults, [blight], [], "Ranged", {
      attackerSourceTargetDistance: 30,
      attackerSourceCanSeeTarget: true,
      attackerKeywords,
      attackKeywords,
    });
  assert.deepEqual(
    [
      blightProfile(["Death Guard"], []).rerollHits,
      blightProfile(["Death Guard"], []).rerollHitOnes,
    ],
    [false, true],
  );
  assert.deepEqual(
    [
      blightProfile(["Death Guard"], ["Blast"]).rerollHits,
      blightProfile(["Death Guard"], ["Blast"]).rerollHitOnes,
    ],
    [true, false],
  );
  assert.deepEqual(
    [
      blightProfile(["Necrons"], ["Blast"]).rerollHits,
      blightProfile(["Necrons"], ["Blast"]).rerollHitOnes,
    ],
    [false, false],
  );
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
