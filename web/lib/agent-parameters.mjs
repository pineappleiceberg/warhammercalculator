import { parseDice } from "./dice.mjs";

export const AGENT_SCHEMA_VERSION = 1;

const catalogueParameters = new Set([
  "attacker",
  "weapon",
  "target",
  "model",
  "attackerPreset",
  "targetPreset",
  "format",
  "distance",
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
  ["attackerUnitModels", ["attackerUnitModels", "unitModels"]],
  ["nearbyEnemyModels", ["nearbyEnemyModels"]],
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
  return ["attacker", "weapon", "target", "model"].some((name) => search.has(name));
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
  setReroll(profile, search, "rerollHits", "rerollHits", "rerollHitOnes");
  setReroll(profile, search, "rerollWounds", "rerollWounds", "rerollWoundOnes");
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
  const weapon = matchOne(attacker.weapons, search.get("weapon"), "weapon");
  const target = matchOne(catalogue.units, search.get("target"), "target");
  if (!target.models.length) throw new Error("The target has no model profile");
  const modelValue = search.get("model");
  if (!modelValue && target.models.length > 1) {
    throw new Error(
      `model is required; use one of these IDs: ${target.models.map((item) => item.id)}`,
    );
  }
  const model = modelValue ? matchOne(target.models, modelValue, "model") : target.models[0];
  const resolvePresets = (unit, name) =>
    presetValues(search, name).map((value) => matchOne(unit.combatPresets, value, name));
  return {
    attacker,
    weapon,
    target,
    model,
    attackerPresets: resolvePresets(attacker, "attackerPreset"),
    targetPresets: resolvePresets(target, "targetPreset"),
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
  search.set("attackerUnitModels", String(profile.attackerUnitModels ?? 0));
  search.set("nearbyEnemyModels", String(profile.nearbyEnemyModels ?? 0));
  for (const [field, aliases] of booleanParameters) {
    search.set(aliases[0], profile[field] ? "true" : "false");
  }
  search.set("targetStrength", String(profile.targetStrengthState ?? "full").replaceAll("_", "-"));
  search.set("rerollHits", profile.rerollHits ? "all" : profile.rerollHitOnes ? "ones" : "false");
  search.set(
    "rerollWounds",
    profile.rerollWounds ? "all" : profile.rerollWoundOnes ? "ones" : "false",
  );
  return search;
}
