import type { CombatProfile } from "./combat";
import { antiWoundThreshold } from "./anti.mjs";
import { abilityDiceValue, parseDice } from "./dice.mjs";

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
  wounds: number | null;
  keywords: string[];
};
export type CatalogueComposition = {
  text: string;
  min: number | null;
  max: number | null;
};
export type CatalogueUnit = {
  id: string;
  factionId: string;
  name: string;
  models: CatalogueModel[];
  weapons: CatalogueWeapon[];
  composition: CatalogueComposition[];
  wargearOptions: string[];
  suggestedModelCount: number | null;
  maximumModelCount: number | null;
};
export type Catalogue = {
  sourceUpdatedAt: string;
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
    ...(attacks
      ? { attackDice: attacks.count, attackSides: attacks.sides, attacks: attacks.modifier }
      : {}),
    ...(damage
      ? { damageDice: damage.count, damageSides: damage.sides, damage: damage.modifier }
      : {}),
    ...(weapon.skill ? { hitOn: weapon.skill } : {}),
    ...(/^\d+$/.test(weapon.strength) ? { strength: Number(weapon.strength) } : {}),
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
    ...(model.wounds ? { wounds: model.wounds } : {}),
  } satisfies CombatProfile;
}

export async function loadCatalogue() {
  const response = await fetch(new URL("profile-data.json", document.baseURI));
  if (!response.ok) throw new Error("Profile catalogue unavailable");
  return response.json() as Promise<Catalogue>;
}
