import type { CombatProfile } from "./combat";

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
};
export type CatalogueModel = {
  id: number;
  name: string;
  t: number | null;
  save: number | null;
  invuln: number | null;
  wounds: number | null;
};
export type CatalogueUnit = {
  id: string;
  factionId: string;
  name: string;
  models: CatalogueModel[];
  weapons: CatalogueWeapon[];
};
export type Catalogue = {
  sourceUpdatedAt: string;
  factions: CatalogueFaction[];
  units: CatalogueUnit[];
};

export function parseDice(value: string) {
  const normalized = value.replace(/\s/g, "");
  const fixed = /^\d+$/.exec(normalized);
  if (fixed) return { count: 0, sides: 0, modifier: Number(fixed[0]) };
  const dice = /^(\d*)D(\d+)([+-]\d+)?$/i.exec(normalized);
  if (!dice) return null;
  return {
    count: dice[1] ? Number(dice[1]) : 1,
    sides: Number(dice[2]),
    modifier: Math.max(0, Number(dice[3] ?? 0)),
  };
}

function fixedAbilityValue(ability: CatalogueAbility | undefined) {
  if (!ability?.value || !/^\d+$/.test(ability.value)) return 0;
  return Number(ability.value);
}

export function applyWeaponProfile(profile: CombatProfile, weapon: CatalogueWeapon) {
  const attacks = parseDice(weapon.attacks);
  const damage = parseDice(weapon.damage);
  const names = new Set(weapon.abilities.map((ability) => ability.name));
  const ability = (name: string) => weapon.abilities.find((entry) => entry.name === name);
  const anti = weapon.abilities.find((entry) => entry.name.startsWith("anti-"));
  const antiTarget = anti?.value ? Number(anti.value.replace("+", "")) : 0;
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
    criticalWounds: Number.isFinite(antiTarget) ? antiTarget : 0,
    sustainedHits: fixedAbilityValue(ability("sustained hits")),
    rapidFire: fixedAbilityValue(ability("rapid fire")),
    melta: fixedAbilityValue(ability("melta")),
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
