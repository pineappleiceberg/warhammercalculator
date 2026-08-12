import type { CombatProfile, ObjectiveOwner } from "./combat";
import { antiWoundThreshold } from "./anti.mjs";
import { abilityDiceValue, parseDice } from "./dice.mjs";
import { applyCombatPresets as applySelectedCombatPresets } from "./combat-presets.mjs";

export type CatalogueFaction = { id: string; name: string };
export type CatalogueDetachment = { id: string; factionId: string; name: string };
export type CatalogueEnhancement = {
  id: string;
  detachmentId: string;
  name: string;
  cost: string;
  eligibleDatasheetIds: string[];
};
export type CatalogueAbility = { name: string; value: string | null };
export type CatalogueWeapon = {
  id: number;
  name: string;
  type: "Ranged" | "Melee";
  rangeText: string;
  range: number | null;
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
  sourceModelId?: number;
  compositionPosition?: number;
  compositionComponentPosition?: number;
  t: number | null;
  save: number | null;
  invuln: number | null;
  feelNoPain: number;
  reduction: number;
  damageDivisor: number;
  wounds: number | null;
  objectiveControl: number | null;
  keywords: string[];
};
export type CatalogueComposition = {
  text: string;
  min: number | null;
  max: number | null;
};
export type CatalogueCompositionModel = {
  modelId?: number;
  name: string;
  min: number;
  max: number;
  source: string;
  loadoutSubjectId?: string;
  controlsComposition?: boolean;
  countFormula?: {
    fixed: number;
    perModel: number;
    perIncrement: number;
    modelsPerIncrement: number;
  };
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
  replaces?: CatalogueWargearChoice[];
  selectionKey?: string;
  selectionName?: string;
  selectionQuantity?: number;
  selectionSlots: number;
  maximumSelections?: number;
  prerequisites?: Array<{
    alternativeId: string;
    minimum: number;
    maximum: number;
    source: string;
  }>;
};
export type CatalogueWargearChoicePool = {
  id: string;
  fixed: number;
  perIncrement: number;
  modelsPerIncrement: number;
  minimumModels: number;
  selectionsPerReplacement: number;
  source: string;
  replaces: CatalogueWargearChoice[];
  alternatives: CatalogueWargearAlternative[];
};
export type CatalogueWargearChoiceItemLimit = {
  itemKey: string;
  itemName: string;
  fixed: number;
  perIncrement: number;
  modelsPerIncrement: number;
  source: string;
};
export type CatalogueWargearChoicePairingRule = {
  poolId: string;
  weaponType: "Ranged" | "Melee";
  evaluationScope: "pool" | "unit";
  triggerCount: number;
  maximumTypedSelections: number;
  requirements: Array<{
    label: string;
    minimum: number;
    maximum: number;
    matches: Array<{ kind: "ability" | "weapon_group"; value: string }>;
  }>;
  requiredAbility?: string;
  requiredMinimum?: number;
  requiredMaximum?: number;
  source: string;
};
export type CatalogueWeaponTypeLimit = {
  weaponType: "Ranged" | "Melee";
  fixed: number;
  perIncrement: number;
  modelsPerIncrement: number;
  source: string;
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
  sourceEquipmentDefault?: boolean;
  sourceEquipmentChoiceExact?: boolean;
  sourceEquipmentScope?: "unit" | "bearer";
  sourceEquipmentAutoEnable?: boolean;
  sourceEquipmentDefaultTerms?: Array<{
    equipmentQuantity: number;
    fixed?: number;
    perModel?: number;
    perIncrement?: number;
    modelsPerIncrement?: number;
    loadoutSubjectId?: string;
    source: string;
  }>;
  sourceEquipmentChoiceLinks?: Array<{
    alternativeId: string;
    quantityDelta: number;
    source: string;
  }>;
  sourceRelationship: "self" | "supporting_unit" | "self_or_supporting_unit";
  usesPerBattle?: number;
  name: string;
  description: string;
  weaponScope: "Any" | "Ranged" | "Melee";
  maximumTargetDistance?: number;
  maximumSourceTargetDistance?: number;
  maximumSupportDistance?: number;
  requiredSupportedKeywords?: string[];
  requiredAttackerKeywords?: string[];
  requiredTargetKeywords?: string[];
  requiredAttackKeywordsAny?: string[];
  requiresAttackerCharge?: boolean;
  requiresAttackerStationary?: boolean;
  requiresAttachedUnit?: boolean;
  requiresWaaaghActive?: boolean;
  requiresOathTarget?: boolean;
  requiresOathWoundBonusEligible?: boolean;
  requiresSourceOnObjective?: boolean;
  requiresTargetOnObjective?: boolean;
  requiresSourceControlsObjective?: boolean;
  requiresTargetOnObjectiveNotControlledBySource?: boolean;
  requiresSourceOnSelectedObjective?: boolean;
  requiresTargetOnSourceSelectedObjective?: boolean;
  requiresTargetBattleShocked?: boolean;
  requiresAttackerNotBattleShocked?: boolean;
  requiresSourceNotBattleShocked?: boolean;
  requiresSourceGuidedAgainstTarget?: boolean;
  requiresTargetSpotted?: boolean;
  requiresTargetSpottedByMarkerlightObserver?: boolean;
  requiresTargetClosestEligible?: boolean;
  requiresSourceTargetVisible?: boolean;
  requiredTargetStrengthState?: "below_starting" | "below_half" | "not_below_half";
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
    | "ap_replacement"
    | "skill_modifier"
    | "critical_hits"
    | "critical_wounds"
    | "attacks_replacement"
    | "strength_replacement"
    | "damage_replacement"
    | "first_failed_save_damage_replacement"
    | "allocated_attack_damage_replacement"
    | "attacks_modifier"
    | "strength_modifier"
    | "damage_modifier"
    | "reroll_hits"
    | "reroll_hit_ones"
    | "save_target"
    | "invulnerable_save"
    | "feel_no_pain"
    | "damage_reduction"
    | "damage_divisor";
  value: number;
  diceCount: number;
  diceSides: number;
  modelsPerIncrement?: number;
  modelCountSource?:
    | "source_unit"
    | "nearby_enemy"
    | "nearby_enemy_units"
    | "enemy_character_models_destroyed"
    | "destructive_fight_phases"
    | "embarked_models"
    | "embarked_wracks_models";
  maximumModifier?: number;
  uses?: number;
  role: CombatPresetRole;
  subject: CombatPresetSubject;
  weaponName?: string;
  requiredTargetKeyword?: string;
  requiredAttackKeyword?: string;
};
export type CatalogueDefensiveEquipment = {
  id: string;
  name: string;
  description: string;
  scope: "bearer" | "unit";
  selectionKind: "default" | "optional" | "mixed" | "conditional" | "unknown";
  eligibilityExact: boolean;
  minimumKind: "none" | "default";
  maximumKind: "one" | "default" | "per_model" | "per_increment";
  maximumValue: number;
  maximumModelsPerIncrement: number;
  limitExact: boolean;
  limitSource: string;
  choiceCoverageExact: boolean;
  choiceLinks: Array<{
    alternativeId: string;
    quantityDelta: number;
    source: string;
  }>;
  eligibleModelIds: number[];
  selectionSource?: string;
  defaultTerms: Array<
    | {
        fixed: number;
        perModel: number;
        perIncrement: number;
        modelsPerIncrement: number;
        source: string;
      }
    | { loadoutSubjectId: string; source: string }
  >;
  guidance?: string;
  effects: Array<{
    type:
      | "save_target"
      | "invulnerable_save"
      | "feel_no_pain"
      | "damage_reduction"
      | "first_failed_save_damage_replacement";
    value: number;
    uses?: number;
    requiredAttackKeyword?: string;
  }>;
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
  wargearChoiceItemLimits: CatalogueWargearChoiceItemLimit[];
  wargearChoicePairingRules: CatalogueWargearChoicePairingRule[];
  weaponTypeLimits: CatalogueWeaponTypeLimit[];
  combatPresets: CatalogueCombatPreset[];
  defensiveEquipment: CatalogueDefensiveEquipment[];
  firingDeck: { capacity: number; abilityId: string | null } | null;
  firingDeckModelCost: number;
  hasHover: boolean;
  transport: {
    capacity: number;
    exactRules: boolean;
    source: string;
    allowedKeywords: string[][];
    additionalPools: Array<{
      position: number;
      capacity: number;
      allowedKeywords: string[][];
    }>;
    alternativePools: Array<{
      position: number;
      capacity: number;
      maximumWounds: number | null;
      allowedKeywords: string[][];
    }>;
    sharedAllowances: Array<{
      position: number;
      maximumModels: number;
      costEqualsWounds: boolean;
      fixedModelCost: number | null;
      consumesPrimaryCapacity: boolean;
      primaryCapacityWhileUsed: number | null;
      nestedPassengerPolicy: "included_in_fixed_cost" | "excluded_from_capacity" | null;
      allowedKeywords: string[][];
      excludedKeywords: string[][];
    }>;
    excluded: Array<{
      keywords: string[];
      minimumWounds: number | null;
      nonCharacter: boolean;
      attachmentException: {
        requiredPassengerKeyword: string;
        forbiddenAttachedKeyword: string;
      } | null;
      keywordExceptions: string[][];
    }>;
    modelCosts: Array<{ keywords: string[]; minimumWounds: number | null; cost: number }>;
    capacityModifiers: Array<{ equipment: string; capacity: number }>;
  } | null;
  transportKeywords: string[];
  leaderBodyguardIds: string[];
  leaderAttachmentConditions: Array<{
    bodyguardId: string;
    requiredEquipment: string;
    requiredWeaponGroupId: string | null;
    requiredChoiceAlternativeId: string | null;
    source: string;
  }>;
  leaderFooter: string;
  leaderAttachmentException: {
    maximumLeaders: number;
    mandatoryAttachment: boolean;
    anyExistingLeader: boolean;
    existingLeaderKeywords: string[];
    forbidSameDatasheet: boolean;
    forbiddenCompanionKeyword: string | null;
    source: string;
  } | null;
  bodyguardLeaderRule: {
    minimumLeaders: number;
    minimumLeaderKeywords: string[];
    maximumLeaders: number | null;
    maximumRequiredStartingStrength: number | null;
    maximumRequiredLeaderKeyword: string | null;
    leadersMustBeDistinct: boolean;
    source: string;
  } | null;
  bodyguardJoinOptions: Array<{
    bodyguardId: string;
    maximumSameJoiner: number;
    requiresUnattached: boolean;
    increasesStartingStrength: boolean;
    source: string;
  }>;
  startingSizeRanges: Array<{
    minimum: number;
    maximum: number;
    source: string;
  }>;
  suggestedModelCount: number | null;
  maximumModelCount: number | null;
};

export function applyCombatPreset(
  profile: CombatProfile,
  preset: CatalogueCombatPreset,
  context: CombatPresetContext = {},
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
  context: CombatPresetContext = {},
) {
  return applySelectedCombatPresets(
    profile,
    attackerPresets,
    targetPresets,
    weaponType,
    context,
  ) as CombatProfile;
}

type CombatPresetContext = {
  targetKeywords?: string[];
  attackKeywords?: string[];
  attackerKeywords?: string[];
  targetDistance?: number;
  attackerSourceTargetDistance?: number;
  targetSourceAttackerDistance?: number;
  supportDistance?: number;
  supportedUnitKeywords?: string[];
  targetSupportDistance?: number;
  targetSupportedUnitKeywords?: string[];
  attackerCharged?: boolean;
  attackerRemainedStationary?: boolean;
  attackerAttached?: boolean;
  targetAttached?: boolean;
  attackerWaaaghActive?: boolean;
  targetWaaaghActive?: boolean;
  targetOathOfMoment?: boolean;
  attackerOathWoundBonusEligible?: boolean;
  attackerOnObjective?: boolean;
  targetOnObjective?: boolean;
  attackerObjectiveOwner?: ObjectiveOwner;
  targetObjectiveOwner?: ObjectiveOwner;
  attackerOnAttackerSelectedObjective?: boolean;
  targetOnAttackerSelectedObjective?: boolean;
  attackerOnTargetSelectedObjective?: boolean;
  targetOnTargetSelectedObjective?: boolean;
  attackerGuidedAgainstTarget?: boolean;
  targetSpotted?: boolean;
  targetSpottedByMarkerlightObserver?: boolean;
  targetClosestEligible?: boolean;
  attackerSourceCanSeeTarget?: boolean;
  targetSourceCanSeeAttacker?: boolean;
  attackerBattleShocked?: boolean;
  targetBattleShocked?: boolean;
  targetStrengthState?: CombatProfile["targetStrengthState"];
  attackerUnitModels?: number;
  nearbyEnemyModels?: number;
  nearbyEnemyUnits?: number;
  enemyCharacterModelsDestroyed?: number;
  destructiveFightPhases?: number;
  embarkedModels?: number;
  embarkedWracksModels?: number;
};
export type Catalogue = {
  sourceUpdatedAt: string;
  leaderFormationRules: {
    maximumLeaders: number;
    sourceUrl: string;
    sourceSha256: string;
    sourceVersion: string;
    sourcePage: number;
  };
  structuredWargear: {
    constraintCount: number;
    constrainedWeaponCount: number;
    choicePoolCount: number;
    choicePrerequisiteCount: number;
    defaultWeaponCount: number;
    defaultWeaponTermCount: number;
    loadoutSubjectCount: number;
    resolvedLoadoutSubjectCount: number;
    unresolvedLoadoutSubjectCount: number;
    loadoutSubjectWeaponCount: number;
    replacementWeaponCount: number;
    defensiveEquipmentChoiceLinkCount: number;
    combatPresetEquipmentChoiceLinkCount: number;
    combatPresetEquipmentDefaultTermCount: number;
    compoundAlternativeCount: number;
    optionCount: number;
    conservative: boolean;
  };
  structuredStartingSizes: {
    rangeCount: number;
    exactUnitCount: number;
    discreteAlternativeUnitCount: number;
  };
  factions: CatalogueFaction[];
  detachments: CatalogueDetachment[];
  enhancements: CatalogueEnhancement[];
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
    attacksMultiplier: 1,
    attacksModifier: 0,
    strengthReplacement: 0,
    strengthMultiplier: 1,
    strengthModifier: 0,
    damageReplacement: null,
    firstFailedSaveDamageReplacement: null,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 0,
    allocatedAttackDamageReplacementSkip: 0,
    damageMultiplier: 1,
    damageModifier: 0,
    characteristicModifierDice: 0,
    characteristicModifierSides: 0,
    characteristicModifierBonus: 0,
    characteristicModifierAttacks: false,
    characteristicModifierStrength: false,
    characteristicModifierDamage: false,
    characteristicModifierGroup: "",
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
