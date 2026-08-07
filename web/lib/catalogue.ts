import type { CombatProfile } from "./combat";
import { antiWoundThreshold } from "./anti.mjs";
import { abilityDiceValue, parseDice } from "./dice.mjs";
import { applyCombatPresets as applySelectedCombatPresets } from "./combat-presets.mjs";

export type CatalogueFaction = { id: string; name: string };
export type CatalogueAbility = { name: string; value: string | null };
export type CatalogueWeapon = {
  id: number;
  name: string;
  type: "Ranged" | "Melee";
  attacks: string;
  skill: number | null;
  strength: string;
  ap: number | null;
  damage: string;
  rules: string;
  abilities: CatalogueAbility[];
  groupId: string;
  groupName: string;
  profileName: string | null;
  profileIndex: number;
  profileCount: number;
};
export type CatalogueModel = {
  id: number;
  name: string;
  t: number | null;
  save: number | null;
  invuln: number | null;
  feelNoPain: number;
  reduction: number;
  damageDivisor: number;
  wounds: number | null;
  keywords: string[];
};
export type CatalogueComposition = {
  text: string;
  min: number | null;
  max: number | null;
};
export type CatalogueCompositionModel = {
  name: string;
  min: number;
  max: number;
  source: string;
};
export type CatalogueWeaponLimitTerm = {
  fixed: number;
  perIncrement: number;
  modelsPerIncrement: number;
  quantity: number;
  source: string;
};
export type CatalogueWeaponLimit = {
  groupId: string;
  groupName: string;
  terms: CatalogueWeaponLimitTerm[];
};
export type CatalogueWargearChoice = {
  groupId: string;
  groupName: string;
  quantity: number;
};
export type CatalogueWargearAlternative = {
  id: string;
  label: string;
  weapons: CatalogueWargearChoice[];
};
export type CatalogueWargearChoicePool = {
  id: string;
  fixed: number;
  perIncrement: number;
  modelsPerIncrement: number;
  source: string;
  replaces: CatalogueWargearChoice[];
  alternatives: CatalogueWargearAlternative[];
};
export type CatalogueDefaultWeapon = {
  groupId: string;
  groupName: string;
  terms: Array<{
    fixed: number;
    perModel: number;
    perIncrement: number;
    modelsPerIncrement: number;
    quantity: number;
    source: string;
  }>;
};
export type CatalogueUnresolvedLoadoutSubject = {
  id: string;
  subject: string;
  equipment: string;
  weapons: CatalogueWargearChoice[];
};
export type CatalogueCombatPreset = {
  id: string;
  choiceGroup: string | null;
  activation: "inherent" | "automatic" | "situational";
  name: string;
  description: string;
  weaponScope: "Any" | "Ranged" | "Melee";
  hitModifier: number;
  hitModifierRole: CombatPresetRole | null;
  hitModifierSubject: CombatPresetSubject | null;
  woundModifier: number;
  woundModifierRole: CombatPresetRole | null;
  woundModifierSubject: CombatPresetSubject | null;
  rerollHits: boolean;
  rerollHitOnes: boolean;
  hitRerollRole: CombatPresetRole | null;
  hitRerollSubject: CombatPresetSubject | null;
  rerollWounds: boolean;
  rerollWoundOnes: boolean;
  woundRerollRole: CombatPresetRole | null;
  woundRerollSubject: CombatPresetSubject | null;
  effects: CatalogueCombatPresetEffect[];
};
export type CombatPresetRole = "attacker" | "target" | "either";
export type CombatPresetSubject =
  | "self"
  | "led_unit"
  | "friendly_unit"
  | "enemy_unit"
  | "affected_unit"
  | "unknown";
export type CatalogueCombatPresetEffect = {
  type:
    | "lethal_hits"
    | "devastating_wounds"
    | "twin_linked"
    | "ignores_cover"
    | "sustained_hits"
    | "rapid_fire"
    | "lance"
    | "heavy"
    | "ap_modifier"
    | "critical_hits"
    | "critical_wounds"
    | "attacks_replacement"
    | "strength_replacement"
    | "damage_replacement"
    | "attacks_modifier"
    | "strength_modifier"
    | "damage_modifier"
    | "save_target"
    | "invulnerable_save"
    | "feel_no_pain"
    | "damage_reduction"
    | "damage_divisor";
  value: number;
  diceCount: number;
  diceSides: number;
  role: CombatPresetRole;
  subject: CombatPresetSubject;
  weaponName?: string;
  requiredTargetKeyword?: string;
  requiredAttackKeyword?: string;
};
export type CatalogueUnit = {
  id: string;
  factionId: string;
  name: string;
  models: CatalogueModel[];
  weapons: CatalogueWeapon[];
  composition: CatalogueComposition[];
  compositionModels: CatalogueCompositionModel[];
  loadout: string;
  defaultWeapons: CatalogueDefaultWeapon[];
  unresolvedLoadoutSubjects: CatalogueUnresolvedLoadoutSubject[];
  wargearOptions: string[];
  weaponLimits: CatalogueWeaponLimit[];
  wargearChoicePools: CatalogueWargearChoicePool[];
  combatPresets: CatalogueCombatPreset[];
  suggestedModelCount: number | null;
  maximumModelCount: number | null;
};

export function applyCombatPreset(
  profile: CombatProfile,
  preset: CatalogueCombatPreset,
  context: { targetKeywords?: string[]; attackKeywords?: string[] } = {},
) {
  return applySelectedCombatPresets(
    profile,
    [preset],
    [],
    preset.weaponScope === "Melee" ? "Melee" : "Ranged",
    context,
  ) as CombatProfile;
}

export function applyCombatPresets(
  profile: CombatProfile,
  attackerPresets: CatalogueCombatPreset[],
  targetPresets: CatalogueCombatPreset[],
  weaponType: "Ranged" | "Melee",
  context: { targetKeywords?: string[]; attackKeywords?: string[] } = {},
) {
  return applySelectedCombatPresets(
    profile,
    attackerPresets,
    targetPresets,
    weaponType,
    context,
  ) as CombatProfile;
}
export type Catalogue = {
  sourceUpdatedAt: string;
  structuredWargear: {
    constraintCount: number;
    constrainedWeaponCount: number;
    choicePoolCount: number;
    defaultWeaponCount: number;
    defaultWeaponTermCount: number;
    loadoutSubjectCount: number;
    resolvedLoadoutSubjectCount: number;
    unresolvedLoadoutSubjectCount: number;
    loadoutSubjectWeaponCount: number;
    replacementWeaponCount: number;
    compoundAlternativeCount: number;
    optionCount: number;
    conservative: boolean;
  };
  factions: CatalogueFaction[];
  units: CatalogueUnit[];
};

export function applyWeaponProfile(
  profile: CombatProfile,
  weapon: CatalogueWeapon,
  targetKeywords: string[] = [],
) {
  const attacks = parseDice(weapon.attacks);
  const damage = parseDice(weapon.damage);
  const names = new Set(weapon.abilities.map((ability) => ability.name));
  const ability = (name: string) => weapon.abilities.find((entry) => entry.name === name);
  const sustainedHits = abilityDiceValue(ability("sustained hits"));
  const rapidFire = abilityDiceValue(ability("rapid fire"));
  return {
    ...profile,
    weaponName: weapon.name,
    ...(attacks
      ? { attackDice: attacks.count, attackSides: attacks.sides, attacks: attacks.modifier }
      : {}),
    ...(damage
      ? { damageDice: damage.count, damageSides: damage.sides, damage: damage.modifier }
      : {}),
    ...(weapon.skill ? { hitOn: weapon.skill } : {}),
    ...(/^\d+$/.test(weapon.strength) ? { strength: Number(weapon.strength) } : {}),
    attacksReplacement: 0,
    attacksModifier: 0,
    strengthReplacement: 0,
    strengthModifier: 0,
    damageReplacement: null,
    damageModifier: 0,
    ...(weapon.ap !== null ? { ap: Math.abs(weapon.ap) } : {}),
    criticalWounds: antiWoundThreshold(weapon.abilities, targetKeywords),
    sustainedHitsDice: sustainedHits.count,
    sustainedHitsSides: sustainedHits.sides,
    sustainedHits: sustainedHits.modifier,
    rapidFireDice: rapidFire.count,
    rapidFireSides: rapidFire.sides,
    rapidFire: rapidFire.modifier,
    melta: abilityDiceValue(ability("melta")).modifier,
    torrent: names.has("torrent"),
    blast: names.has("blast"),
    ignoresCover: names.has("ignores cover"),
    lethalHits: names.has("lethal hits"),
    devastatingWounds: names.has("devastating wounds"),
    twinLinked: names.has("twin-linked"),
    withinHalfRange: false,
    heavyActive: false,
    lanceActive: false,
    indirect: false,
  } satisfies CombatProfile;
}

export function applyTargetProfile(profile: CombatProfile, model: CatalogueModel) {
  return {
    ...profile,
    ...(model.t ? { toughness: model.t } : {}),
    ...(model.save ? { save: model.save } : {}),
    invulnerable: model.invuln ?? 0,
    feelNoPain: model.feelNoPain ?? 0,
    reduction: model.reduction ?? 0,
    damageDivisor: model.damageDivisor ?? 1,
    ...(model.wounds ? { wounds: model.wounds } : {}),
  } satisfies CombatProfile;
}

export async function loadCatalogue() {
  const publicRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
  const response = await fetch(new URL("profile-data.json", publicRoot));
  if (!response.ok) throw new Error("Profile catalogue unavailable");
  return response.json() as Promise<Catalogue>;
}
