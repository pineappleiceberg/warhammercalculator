import { parseDice } from "./dice.mjs";
import {
  combatPresetMatchesSourceRelationship,
  combatPresetSupportsRole,
} from "./combat-presets.mjs";
import { resolveFiringDeckSelection } from "./firing-deck.mjs";
import { catalogueModelCandidates, catalogueModelsRequireSelection } from "./catalogue-models.mjs";

export const AGENT_SCHEMA_VERSION = 1;

export function catalogueWeaponRangeError(weapon, distance) {
  if (weapon?.type !== "Ranged" || !(distance > 0)) return "";
  if (!Number.isFinite(weapon.range) || weapon.range <= 0) {
    return "Published weapon range is unavailable for this catalogue profile";
  }
  return distance > weapon.range
    ? `Target distance exceeds this weapon's ${weapon.range}-inch range`
    : "";
}

const catalogueParameters = new Set([
  "attacker",
  "weapon",
  "passenger",
  "attached",
  "firingDeckModels",
  "passengerAlreadyShot",
  "target",
  "model",
  "attackerPreset",
  "targetPreset",
  "support",
  "supportPreset",
  "targetSupport",
  "targetSupportPreset",
  "format",
  "distance",
  "supportDistance",
  "targetSupportDistance",
]);

const integerParameters = [
  ["weaponCount", ["weaponCount"]],
  ["attacksReplacement", ["attacksReplacement"]],
  ["attacksMultiplier", ["attacksMultiplier"]],
  ["attacksModifier", ["attacksModifier"]],
  ["hitOn", ["hitOn", "hit"]],
  ["strength", ["strength"]],
  ["strengthReplacement", ["strengthReplacement"]],
  ["strengthMultiplier", ["strengthMultiplier"]],
  ["strengthModifier", ["strengthModifier"]],
  ["ap", ["ap"]],
  ["criticalHits", ["criticalHits"]],
  ["toughness", ["toughness"]],
  ["save", ["save"]],
  ["invulnerable", ["invulnerable", "invuln"]],
  ["feelNoPain", ["feelNoPain", "fnp"]],
  ["wounds", ["wounds"]],
  ["targetModels", ["targetModels", "models"]],
  ["reduction", ["reduction"]],
  ["damageDivisor", ["damageDivisor"]],
  ["criticalWounds", ["criticalWounds"]],
  ["hitModifier", ["hitModifier"]],
  ["woundModifier", ["woundModifier"]],
  ["damageReplacement", ["damageReplacement"]],
  ["firstFailedSaveDamageReplacement", ["firstFailedSaveDamageReplacement"]],
  ["allocatedAttackDamageReplacement", ["allocatedAttackDamageReplacement"]],
  ["allocatedAttackDamageReplacementUses", ["allocatedAttackDamageReplacementUses"]],
  ["allocatedAttackDamageReplacementSkip", ["allocatedAttackDamageReplacementSkip"]],
  ["damageMultiplier", ["damageMultiplier"]],
  ["damageModifier", ["damageModifier"]],
  ["melta", ["melta"]],
  ["targetDistance", ["targetDistance", "distance"]],
  ["attackerSourceTargetDistance", ["attackerSourceTargetDistance", "sourceDistance"]],
  ["targetSourceAttackerDistance", ["targetSourceAttackerDistance", "targetSourceDistance"]],
  ["supportDistance", ["supportDistance"]],
  ["targetSupportDistance", ["targetSupportDistance"]],
  ["attackerUnitModels", ["attackerUnitModels", "unitModels"]],
  ["nearbyEnemyModels", ["nearbyEnemyModels"]],
  ["nearbyEnemyUnits", ["nearbyEnemyUnits"]],
  ["enemyCharacterModelsDestroyed", ["enemyCharacterModelsDestroyed", "characterKills"]],
  ["destructiveFightPhases", ["destructiveFightPhases", "soulEaterStacks"]],
  ["embarkedModels", ["embarkedModels", "passengers"]],
  ["embarkedWracksModels", ["embarkedWracksModels", "wrackPassengers"]],
];

const booleanParameters = [
  ["characteristicModifierAttacks", ["characteristicModifierAttacks"]],
  ["characteristicModifierStrength", ["characteristicModifierStrength"]],
  ["characteristicModifierDamage", ["characteristicModifierDamage"]],
  ["attackerCharged", ["attackerCharged", "charged"]],
  ["attackerRemainedStationary", ["attackerRemainedStationary", "stationary"]],
  ["attackerAttached", ["attackerAttached"]],
  ["targetAttached", ["targetAttached"]],
  ["attackerWaaaghActive", ["attackerWaaaghActive", "waaaghActive"]],
  ["targetWaaaghActive", ["targetWaaaghActive"]],
  ["targetOathOfMoment", ["targetOathOfMoment", "oathTarget"]],
  ["attackerOathWoundBonusEligible", ["attackerOathWoundBonusEligible", "oathWoundBonus"]],
  ["attackerOnObjective", ["attackerOnObjective", "attackerObjective"]],
  ["targetOnObjective", ["targetOnObjective", "targetObjective"]],
  [
    "attackerOnAttackerSelectedObjective",
    ["attackerOnAttackerSelectedObjective", "attackerOnOwnSelectedObjective"],
  ],
  ["targetOnAttackerSelectedObjective", ["targetOnAttackerSelectedObjective"]],
  ["attackerOnTargetSelectedObjective", ["attackerOnTargetSelectedObjective"]],
  [
    "targetOnTargetSelectedObjective",
    ["targetOnTargetSelectedObjective", "targetOnOwnSelectedObjective"],
  ],
  ["attackerGuidedAgainstTarget", ["attackerGuidedAgainstTarget", "guided"]],
  ["targetSpotted", ["targetSpotted", "spotted"]],
  ["targetClosestEligible", ["targetClosestEligible", "closestTarget"]],
  ["attackerSourceCanSeeTarget", ["attackerSourceCanSeeTarget", "sourceVisible"]],
  ["targetSourceCanSeeAttacker", ["targetSourceCanSeeAttacker", "targetSourceVisible"]],
  [
    "targetSpottedByMarkerlightObserver",
    ["targetSpottedByMarkerlightObserver", "markerlightSpotted"],
  ],
  ["attackerBattleShocked", ["attackerBattleShocked"]],
  ["targetBattleShocked", ["targetBattleShocked", "battleShocked"]],
  ["withinHalfRange", ["withinHalfRange", "halfRange"]],
  ["torrent", ["torrent"]],
  ["blast", ["blast"]],
  ["heavyActive", ["heavyActive", "heavy"]],
  ["lanceActive", ["lanceActive", "lance"]],
  ["targetCover", ["targetCover", "cover"]],
  ["ignoresCover", ["ignoresCover"]],
  ["indirect", ["indirect"]],
  ["lethalHits", ["lethalHits"]],
  ["devastatingWounds", ["devastatingWounds"]],
  ["twinLinked", ["twinLinked"]],
  ["rerollHitOnes", ["rerollHitOnes"]],
  ["rerollWoundOnes", ["rerollWoundOnes"]],
];

const enumParameters = [["targetStrengthState", ["targetStrengthState", "targetStrength"]]];
const objectiveOwnerParameters = [
  ["attackerObjectiveOwner", ["attackerObjectiveOwner", "attackerObjectiveControl"]],
  ["targetObjectiveOwner", ["targetObjectiveOwner", "targetObjectiveControl"]],
];

const knownParameters = new Set([
  ...catalogueParameters,
  "attacks",
  "damage",
  "sustainedHits",
  "rapidFire",
  "characteristicModifier",
  "rerollHits",
  "rerollWounds",
  "rules",
  ...integerParameters.flatMap(([, aliases]) => aliases),
  ...booleanParameters.flatMap(([, aliases]) => aliases),
  ...enumParameters.flatMap(([, aliases]) => aliases),
  ...objectiveOwnerParameters.flatMap(([, aliases]) => aliases),
]);

const requiredDirectParameters = [
  ["attacks", ["attacks"]],
  ["hit", ["hitOn", "hit"]],
  ["strength", ["strength"]],
  ["ap", ["ap"]],
  ["damage", ["damage"]],
  ["toughness", ["toughness"]],
  ["save", ["save"]],
  ["wounds", ["wounds"]],
];

const ruleParameters = new Map([
  ["torrent", "torrent"],
  ["blast", "blast"],
  ["heavy", "heavyActive"],
  ["lance", "lanceActive"],
  ["cover", "targetCover"],
  ["ignores-cover", "ignoresCover"],
  ["indirect", "indirect"],
  ["lethal-hits", "lethalHits"],
  ["devastating-wounds", "devastatingWounds"],
  ["twin-linked", "twinLinked"],
  ["half-range", "withinHalfRange"],
]);

function parameters(input) {
  return input instanceof URLSearchParams ? input : new URLSearchParams(input);
}

function singleValue(search, aliases) {
  const present = aliases.flatMap((alias) =>
    search.getAll(alias).map((value) => ({ alias, value })),
  );
  if (present.length > 1) {
    throw new Error(`${aliases[0]} must be supplied once`);
  }
  return present[0]?.value ?? null;
}

function integerValue(value, name) {
  if (!/^-?\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is outside the supported range`);
  return parsed;
}

function booleanValue(value, name) {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

function diceValue(value, name) {
  if (value.includes("-")) {
    throw new Error(`${name} cannot use a negative dice modifier`);
  }
  const parsed = parseDice(value);
  if (!parsed) throw new Error(`${name} must be a number or dice value such as D6+2`);
  return parsed;
}

function setDice(profile, prefix, value) {
  profile[`${prefix}Dice`] = value.count;
  profile[`${prefix}Sides`] = value.sides;
  profile[prefix === "attack" ? "attacks" : prefix] = value.modifier;
}

function setReroll(profile, search, name, allField, onesField) {
  const value = singleValue(search, [name]);
  if (value === null) return;
  const normalized = value.trim().toLowerCase();
  if (["all", "failed", "1", "true", "yes", "on"].includes(normalized)) {
    profile[allField] = true;
    profile[onesField] = false;
    return;
  }
  if (["ones", "one"].includes(normalized)) {
    profile[allField] = false;
    profile[onesField] = true;
    return;
  }
  if (["0", "false", "no", "off", "none"].includes(normalized)) {
    profile[allField] = false;
    profile[onesField] = false;
    return;
  }
  throw new Error(`${name} must be all, ones, or false`);
}

export function isCatalogueAgentQuery(input) {
  const search = parameters(input);
  return [
    "attacker",
    "weapon",
    "target",
    "model",
    "attackerPreset",
    "targetPreset",
    "support",
    "supportPreset",
  ].some((name) => search.has(name));
}

export function parseAgentProfile(input, baseProfile, requireDirectParameters = true) {
  const search = parameters(input);
  for (const name of search.keys()) {
    if (!knownParameters.has(name)) throw new Error(`Unknown parameter: ${name}`);
  }
  const format = singleValue(search, ["format"]);
  if (format !== null && format.trim().toLowerCase() !== "json") {
    throw new Error("format must be json");
  }
  if (requireDirectParameters) {
    const missing = requiredDirectParameters
      .filter(([, aliases]) => !aliases.some((alias) => search.has(alias)))
      .map(([name]) => name);
    if (missing.length) throw new Error(`Missing required parameters: ${missing.join(", ")}`);
  }

  const profile = { ...baseProfile };
  const attacks = singleValue(search, ["attacks"]);
  if (attacks !== null) setDice(profile, "attack", diceValue(attacks, "attacks"));
  const damage = singleValue(search, ["damage"]);
  if (damage !== null) setDice(profile, "damage", diceValue(damage, "damage"));
  const sustainedHits = singleValue(search, ["sustainedHits"]);
  if (sustainedHits !== null) {
    setDice(profile, "sustainedHits", diceValue(sustainedHits, "sustainedHits"));
  }
  const rapidFire = singleValue(search, ["rapidFire"]);
  if (rapidFire !== null) setDice(profile, "rapidFire", diceValue(rapidFire, "rapidFire"));
  const characteristicModifier = singleValue(search, ["characteristicModifier"]);
  if (characteristicModifier !== null) {
    const parsed = diceValue(characteristicModifier, "characteristicModifier");
    profile.characteristicModifierDice = parsed.count;
    profile.characteristicModifierSides = parsed.sides;
    profile.characteristicModifierBonus = parsed.modifier;
  }

  for (const [field, aliases] of integerParameters) {
    const value = singleValue(search, aliases);
    if (value !== null) profile[field] = integerValue(value, aliases[0]);
  }

  const rules = singleValue(search, ["rules"]);
  if (rules !== null) {
    for (const rule of rules.split(",").map((value) => value.trim().toLowerCase())) {
      const field = ruleParameters.get(rule);
      if (!field) throw new Error(`Unknown rule: ${rule}`);
      profile[field] = true;
    }
  }
  for (const [field, aliases] of booleanParameters) {
    const value = singleValue(search, aliases);
    if (value !== null) profile[field] = booleanValue(value, aliases[0]);
  }
  for (const [field, aliases] of enumParameters) {
    const value = singleValue(search, aliases);
    if (value === null) continue;
    const normalized = value.trim().toLowerCase().replaceAll("-", "_");
    if (!["full", "below_starting", "below_half"].includes(normalized)) {
      throw new Error(`${aliases[0]} must be full, below-starting, or below-half`);
    }
    profile[field] = normalized;
  }
  for (const [field, aliases] of objectiveOwnerParameters) {
    const value = singleValue(search, aliases);
    if (value === null) continue;
    const normalized = value.trim().toLowerCase();
    if (!["unknown", "attacker", "target", "uncontrolled"].includes(normalized)) {
      throw new Error(`${aliases[0]} must be unknown, attacker, target, or uncontrolled`);
    }
    profile[field] = normalized;
  }
  setReroll(profile, search, "rerollHits", "rerollHits", "rerollHitOnes");
  setReroll(profile, search, "rerollWounds", "rerollWounds", "rerollWoundOnes");
  if (profile.embarkedWracksModels > profile.embarkedModels) {
    throw new Error("embarkedWracksModels cannot exceed embarkedModels");
  }
  return profile;
}

function matchOne(items, value, label) {
  const normalized = value.trim().toLowerCase();
  const byId = items.filter((item) => String(item.id) === value);
  const matches = byId.length
    ? byId
    : items.filter((item) => item.name.trim().toLowerCase() === normalized);
  if (!matches.length) throw new Error(`${label} was not found: ${value}`);
  if (matches.length > 1) {
    throw new Error(
      `${label} is ambiguous; use one of these IDs: ${matches.map((item) => item.id)}`,
    );
  }
  return matches[0];
}

function presetValues(search, name) {
  return search
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveAgentCatalogueSelection(input, catalogue) {
  const search = parameters(input);
  const required = ["attacker", "weapon", "target"].filter((name) => !search.has(name));
  if (required.length) throw new Error(`Missing catalogue parameters: ${required.join(", ")}`);
  const attacker = matchOne(catalogue.units, search.get("attacker"), "attacker");
  const passengerValue = singleValue(search, ["passenger"]);
  const attachedValue = singleValue(search, ["attached"]);
  const firingDeckModelsValue = singleValue(search, ["firingDeckModels"]);
  const passengerAlreadyShotValue = singleValue(search, ["passengerAlreadyShot"]);
  if (
    !passengerValue &&
    (attachedValue !== null || firingDeckModelsValue !== null || passengerAlreadyShotValue !== null)
  ) {
    throw new Error("passenger is required with Firing Deck parameters");
  }
  const passenger = passengerValue ? matchOne(catalogue.units, passengerValue, "passenger") : null;
  const attached = attachedValue ? matchOne(catalogue.units, attachedValue, "attached") : null;
  const weaponSource = passenger ?? attacker;
  const weapon = matchOne(weaponSource.weapons, search.get("weapon"), "weapon");
  const firingDeck = passenger
    ? resolveFiringDeckSelection(catalogue, attacker, {
        passengerUnitId: passenger.id,
        attachedUnitId: attached?.id,
        weaponId: weapon.id,
        modelCount:
          firingDeckModelsValue === null
            ? 1
            : integerValue(firingDeckModelsValue, "firingDeckModels"),
        unitAlreadyShot:
          passengerAlreadyShotValue === null
            ? false
            : booleanValue(passengerAlreadyShotValue, "passengerAlreadyShot"),
      })
    : null;
  const requestedWeaponCount = singleValue(search, ["weaponCount"]);
  if (
    firingDeck &&
    requestedWeaponCount !== null &&
    integerValue(requestedWeaponCount, "weaponCount") !== firingDeck.modelCount
  ) {
    throw new Error("weaponCount must match firingDeckModels for a Firing Deck request");
  }
  const target = matchOne(catalogue.units, search.get("target"), "target");
  if (!target.models.length) throw new Error("The target has no model profile");
  const modelValue = search.get("model");
  if (!modelValue && catalogueModelsRequireSelection(target.models)) {
    throw new Error(
      `model is required; use one of these IDs: ${target.models.map((item) => item.id)}`,
    );
  }
  const modelMatches = modelValue ? catalogueModelCandidates(target.models, modelValue) : [];
  if (modelValue && !modelMatches.length) throw new Error(`model was not found: ${modelValue}`);
  if (
    modelMatches.length > 1 &&
    !modelMatches.every(
      (candidate) =>
        candidate.sourceModelId !== undefined &&
        candidate.sourceModelId === modelMatches[0].sourceModelId,
    )
  ) {
    throw new Error(
      `model is ambiguous; use one of these IDs: ${modelMatches.map((item) => item.id)}`,
    );
  }
  const model = modelMatches[0] ?? target.models[0];
  const resolvePresets = (unit, name, relationship = "self") =>
    presetValues(search, name).map((value) => {
      const preset = matchOne(unit.combatPresets, value, name);
      if (!combatPresetMatchesSourceRelationship(preset, relationship)) {
        throw new Error(
          `${name} must identify a ${relationship === "supporting_unit" ? "supporting-unit" : "self"} ability`,
        );
      }
      return preset;
    });
  const supportValue = singleValue(search, ["support"]);
  const requestedSupportPresets = presetValues(search, "supportPreset");
  if (!supportValue && requestedSupportPresets.length) {
    throw new Error("support is required when supportPreset is supplied");
  }
  const support = supportValue ? matchOne(catalogue.units, supportValue, "support") : null;
  if (support && support.factionId !== attacker.factionId) {
    throw new Error("support must belong to the attacker's faction");
  }
  const targetSupportValue = singleValue(search, ["targetSupport"]);
  const requestedTargetSupportPresets = presetValues(search, "targetSupportPreset");
  if (!targetSupportValue && requestedTargetSupportPresets.length) {
    throw new Error("targetSupport is required when targetSupportPreset is supplied");
  }
  const targetSupport = targetSupportValue
    ? matchOne(catalogue.units, targetSupportValue, "targetSupport")
    : null;
  if (targetSupport && targetSupport.factionId !== target.factionId) {
    throw new Error("targetSupport must belong to the target's faction");
  }
  return {
    attacker,
    weapon,
    passenger,
    attached,
    firingDeck,
    target,
    model,
    attackerPresets: resolvePresets(attacker, "attackerPreset"),
    targetPresets: resolvePresets(target, "targetPreset"),
    support,
    supportPresets: support
      ? requestedSupportPresets.map((value) => {
          const preset = matchOne(support.combatPresets, value, "supportPreset");
          if (!combatPresetMatchesSourceRelationship(preset, "supporting_unit")) {
            throw new Error("supportPreset must identify a supporting-unit ability");
          }
          if (!combatPresetSupportsRole(preset, "attacker")) {
            throw new Error("supportPreset must affect the attacker");
          }
          return preset;
        })
      : [],
    targetSupport,
    targetSupportPresets: targetSupport
      ? requestedTargetSupportPresets.map((value) => {
          const preset = matchOne(targetSupport.combatPresets, value, "targetSupportPreset");
          if (!combatPresetMatchesSourceRelationship(preset, "supporting_unit")) {
            throw new Error("targetSupportPreset must identify a supporting-unit ability");
          }
          if (!combatPresetSupportsRole(preset, "target")) {
            throw new Error("targetSupportPreset must affect the target");
          }
          return preset;
        })
      : [],
  };
}

function diceText(count, sides, modifier) {
  if (!count) return String(modifier);
  return `${count === 1 ? "" : count}D${sides}${modifier ? `+${modifier}` : ""}`;
}

export function canonicalAgentParameters(profile) {
  const search = new URLSearchParams();
  search.set("format", "json");
  search.set("attacks", diceText(profile.attackDice, profile.attackSides, profile.attacks));
  search.set("weaponCount", String(profile.weaponCount));
  search.set("attacksReplacement", String(profile.attacksReplacement ?? 0));
  search.set("attacksMultiplier", String(profile.attacksMultiplier ?? 1));
  search.set("attacksModifier", String(profile.attacksModifier ?? 0));
  search.set("hit", String(profile.hitOn));
  search.set("strength", String(profile.strength));
  search.set("strengthReplacement", String(profile.strengthReplacement ?? 0));
  search.set("strengthMultiplier", String(profile.strengthMultiplier ?? 1));
  search.set("strengthModifier", String(profile.strengthModifier ?? 0));
  search.set("ap", String(profile.ap));
  search.set("damage", diceText(profile.damageDice, profile.damageSides, profile.damage));
  if (profile.damageReplacement !== null && profile.damageReplacement !== undefined) {
    search.set("damageReplacement", String(profile.damageReplacement));
  }
  if (
    profile.firstFailedSaveDamageReplacement !== null &&
    profile.firstFailedSaveDamageReplacement !== undefined
  ) {
    search.set(
      "firstFailedSaveDamageReplacement",
      String(profile.firstFailedSaveDamageReplacement),
    );
  }
  search.set(
    "allocatedAttackDamageReplacement",
    String(profile.allocatedAttackDamageReplacement ?? 0),
  );
  search.set(
    "allocatedAttackDamageReplacementUses",
    String(profile.allocatedAttackDamageReplacementUses ?? 0),
  );
  search.set(
    "allocatedAttackDamageReplacementSkip",
    String(profile.allocatedAttackDamageReplacementSkip ?? 0),
  );
  search.set("damageMultiplier", String(profile.damageMultiplier ?? 1));
  search.set("damageModifier", String(profile.damageModifier ?? 0));
  search.set(
    "characteristicModifier",
    diceText(
      profile.characteristicModifierDice,
      profile.characteristicModifierSides,
      profile.characteristicModifierBonus,
    ),
  );
  search.set("toughness", String(profile.toughness));
  search.set("save", String(profile.save));
  search.set("invuln", String(profile.invulnerable));
  search.set("fnp", String(profile.feelNoPain));
  search.set("wounds", String(profile.wounds));
  search.set("models", String(profile.targetModels));
  search.set("reduction", String(profile.reduction));
  search.set("damageDivisor", String(profile.damageDivisor));
  search.set("criticalHits", String(profile.criticalHits));
  search.set("criticalWounds", String(profile.criticalWounds));
  search.set("hitModifier", String(profile.hitModifier));
  search.set("woundModifier", String(profile.woundModifier));
  search.set(
    "sustainedHits",
    diceText(profile.sustainedHitsDice, profile.sustainedHitsSides, profile.sustainedHits),
  );
  search.set(
    "rapidFire",
    diceText(profile.rapidFireDice, profile.rapidFireSides, profile.rapidFire),
  );
  search.set("melta", String(profile.melta));
  search.set("distance", String(profile.targetDistance ?? 0));
  search.set("sourceDistance", String(profile.attackerSourceTargetDistance ?? 0));
  search.set("targetSourceDistance", String(profile.targetSourceAttackerDistance ?? 0));
  search.set("supportDistance", String(profile.supportDistance ?? 0));
  search.set("targetSupportDistance", String(profile.targetSupportDistance ?? 0));
  search.set("attackerUnitModels", String(profile.attackerUnitModels ?? 0));
  search.set("nearbyEnemyModels", String(profile.nearbyEnemyModels ?? 0));
  search.set("nearbyEnemyUnits", String(profile.nearbyEnemyUnits ?? 0));
  search.set("enemyCharacterModelsDestroyed", String(profile.enemyCharacterModelsDestroyed ?? 0));
  search.set("destructiveFightPhases", String(profile.destructiveFightPhases ?? 0));
  search.set("embarkedModels", String(profile.embarkedModels ?? 0));
  search.set("embarkedWracksModels", String(profile.embarkedWracksModels ?? 0));
  for (const [field, aliases] of booleanParameters) {
    search.set(aliases[0], profile[field] ? "true" : "false");
  }
  search.set("targetStrength", String(profile.targetStrengthState ?? "full").replaceAll("_", "-"));
  for (const [field, aliases] of objectiveOwnerParameters) {
    search.set(aliases[0], String(profile[field] ?? "unknown"));
  }
  search.set("rerollHits", profile.rerollHits ? "all" : profile.rerollHitOnes ? "ones" : "false");
  search.set(
    "rerollWounds",
    profile.rerollWounds ? "all" : profile.rerollWoundOnes ? "ones" : "false",
  );
  return search;
}
