"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { CombatPresetSelector } from "../../components/combat-preset-selector";
import { SupportPresetSelector } from "../../components/support-preset-selector";
import {
  applyTargetCombatPresets,
  attackKeywordsForWeapon,
  reconcileCombatPresetSourceChoices,
  selectedAndAutomaticCombatPresets,
  sourceEquipmentCombatPresetIds,
  sourceEquipmentWeaponLineSegments,
  unavailableSourceEquipmentCombatPresetIds,
} from "../../lib/combat-presets.mjs";
import {
  calculateOrderedVolley,
  estimateOrderedVolleyComplexity,
  type ExactComplexity,
  type OrderedTargetSegment,
  type OrderedVolleySummary,
} from "../../lib/client-calculator";
import {
  DEFAULT_PROFILE,
  simulateOrderedVolley,
  simulateOrderedVolleyPhase,
  type PhaseSimulationResult,
  type OrderedVolleyRollResult,
  type ObjectiveOwner,
  type TargetStrengthState,
} from "../../lib/combat";
import {
  applyChoiceSelectionChange,
  applyLoadoutSubjectCountsChange,
  applyModelCountChange,
  choiceAlternativeMaximum,
  choicePoolMaximum,
  choicePoolUsed,
  choiceSelectionLimitWarnings,
  choiceSelectionWeaponCounts,
  compositionLoadoutSubjectCounts,
  defaultWeaponCounts,
  defaultLoadoutSubjectCounts,
  equippedWeaponLines,
  groupWeaponProfiles,
  normalizeEquippedCount,
  rebaseCompositionLoadoutSubjectCounts,
  unitLoadoutWarnings,
  weaponAllocationErrors,
  weaponLimitMaximum,
} from "../../lib/loadout.mjs";
import {
  applyCombatPresets,
  applyWeaponProfile,
  loadCatalogue,
  type Catalogue,
  type CatalogueModel,
  type CatalogueWeapon,
} from "../../lib/catalogue";
import {
  firingDeckWeaponLines,
  firingDeckWeapons,
  resolveFiringDeckSelections,
} from "../../lib/firing-deck.mjs";
import {
  transportPassengerAttachmentOptions,
  transportPassengerCanEmbark,
} from "../../lib/transport.mjs";
import { bodyguardJoinerOptions, catalogueModelSegments } from "../../lib/formations.mjs";
import {
  applyDefensiveEquipmentTargets,
  bearerEquipmentAvailableCount,
  bearerEquipmentCount,
  setBearerEquipmentCount,
} from "../../lib/defensive-equipment.mjs";

type TargetSegment = OrderedTargetSegment & {
  id: string;
  unitId: string;
  modelId: number;
  name: string;
  keywords: string[];
  defensiveEquipmentIds: string[];
};
type WeaponLine = {
  weapon: CatalogueWeapon;
  count: number;
  firingDeck?: {
    passengerUnitId: string;
    passengerUnitName: string;
    modelCost: number;
  };
  incrementalMean?: number;
  cumulativeMean?: number;
  sourceEquipmentPresetIds?: string[];
  sourceEquipmentLabel?: string;
};
type FiringDeckSelection = {
  id: string;
  passengerUnitId: string;
  attachedUnitId: string;
  weaponId: number | null;
  modelCount: number;
  unitAlreadyShot: boolean;
};

function targetSegment(model: CatalogueModel, modelCount: number, unitId = ""): TargetSegment {
  return {
    id: crypto.randomUUID(),
    unitId,
    modelId: model.id,
    name: model.name,
    keywords: model.keywords,
    defensiveEquipmentIds: [],
    toughness: model.t ?? 8,
    save: model.save ?? 7,
    invulnerable: model.invuln ?? 0,
    feelNoPain: model.feelNoPain ?? 0,
    wounds: model.wounds ?? 1,
    reduction: model.reduction ?? 0,
    damageDivisor: model.damageDivisor ?? 1,
    firstFailedSaveDamageReplacement: null,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 0,
    allocatedAttackDamageReplacementSkip: 0,
    modelCount,
  };
}

export default function UnitVsUnit() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [attackerFaction, setAttackerFaction] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetFaction, setTargetFaction] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [attackerModels, setAttackerModels] = useState(1);
  const [attackerJoinerId, setAttackerJoinerId] = useState("");
  const [attackerJoinerModels, setAttackerJoinerModels] = useState(1);
  const [targetJoinerId, setTargetJoinerId] = useState("");
  const [targetJoinerModels, setTargetJoinerModels] = useState(1);
  const [weaponCounts, setWeaponCounts] = useState<Record<string, number>>({});
  const [optionCounts, setOptionCounts] = useState<Record<string, number>>({});
  const [choiceSelections, setChoiceSelections] = useState<Record<string, number>>({});
  const [targetChoiceSelections, setTargetChoiceSelections] = useState<Record<string, number>>({});
  const [loadoutSubjectCounts, setLoadoutSubjectCounts] = useState<Record<string, number>>({});
  const [profileCounts, setProfileCounts] = useState<Record<number, number>>({});
  const [firingDeckSelections, setFiringDeckSelections] = useState<FiringDeckSelection[]>([]);
  const [activeAttackerPresetIds, setActiveAttackerPresetIds] = useState<string[]>([]);
  const [activeTargetPresetIds, setActiveTargetPresetIds] = useState<string[]>([]);
  const [supportUnitId, setSupportUnitId] = useState("");
  const [activeSupportPresetIds, setActiveSupportPresetIds] = useState<string[]>([]);
  const [supportDistance, setSupportDistance] = useState(0);
  const [targetSupportUnitId, setTargetSupportUnitId] = useState("");
  const [activeTargetSupportPresetIds, setActiveTargetSupportPresetIds] = useState<string[]>([]);
  const [targetSupportDistance, setTargetSupportDistance] = useState(0);
  const [weaponOrder, setWeaponOrder] = useState<number[]>([]);
  const [targetSegments, setTargetSegments] = useState<TargetSegment[]>([]);
  const [initialWoundsLost, setInitialWoundsLost] = useState(0);
  const [targetDistance, setTargetDistance] = useState(0);
  const [attackerSourceTargetDistance, setAttackerSourceTargetDistance] = useState(0);
  const [targetSourceAttackerDistance, setTargetSourceAttackerDistance] = useState(0);
  const [attackerSourceCanSeeTarget, setAttackerSourceCanSeeTarget] = useState(false);
  const [targetSourceCanSeeAttacker, setTargetSourceCanSeeAttacker] = useState(false);
  const [attackerUnitModels, setAttackerUnitModels] = useState(0);
  const [nearbyEnemyModels, setNearbyEnemyModels] = useState(0);
  const [nearbyEnemyUnits, setNearbyEnemyUnits] = useState(0);
  const [enemyCharacterModelsDestroyed, setEnemyCharacterModelsDestroyed] = useState(0);
  const [destructiveFightPhases, setDestructiveFightPhases] = useState(0);
  const [embarkedModels, setEmbarkedModels] = useState(0);
  const [embarkedWracksModels, setEmbarkedWracksModels] = useState(0);
  const [attackerCharged, setAttackerCharged] = useState(false);
  const [attackerRemainedStationary, setAttackerRemainedStationary] = useState(false);
  const [attackerAttached, setAttackerAttached] = useState(false);
  const [targetAttached, setTargetAttached] = useState(false);
  const [attackerWaaaghActive, setAttackerWaaaghActive] = useState(false);
  const [targetWaaaghActive, setTargetWaaaghActive] = useState(false);
  const [targetOathOfMoment, setTargetOathOfMoment] = useState(false);
  const [attackerOathWoundBonusEligible, setAttackerOathWoundBonusEligible] = useState(false);
  const [attackerOnObjective, setAttackerOnObjective] = useState(false);
  const [targetOnObjective, setTargetOnObjective] = useState(false);
  const [attackerObjectiveOwner, setAttackerObjectiveOwner] = useState<ObjectiveOwner>("unknown");
  const [targetObjectiveOwner, setTargetObjectiveOwner] = useState<ObjectiveOwner>("unknown");
  const [attackerOnAttackerSelectedObjective, setAttackerOnAttackerSelectedObjective] =
    useState(false);
  const [targetOnAttackerSelectedObjective, setTargetOnAttackerSelectedObjective] = useState(false);
  const [attackerOnTargetSelectedObjective, setAttackerOnTargetSelectedObjective] = useState(false);
  const [targetOnTargetSelectedObjective, setTargetOnTargetSelectedObjective] = useState(false);
  const [attackerGuidedAgainstTarget, setAttackerGuidedAgainstTarget] = useState(false);
  const [targetSpotted, setTargetSpotted] = useState(false);
  const [targetSpottedByMarkerlightObserver, setTargetSpottedByMarkerlightObserver] =
    useState(false);
  const [targetClosestEligible, setTargetClosestEligible] = useState(false);
  const [attackerBattleShocked, setAttackerBattleShocked] = useState(false);
  const [targetBattleShocked, setTargetBattleShocked] = useState(false);
  const [targetStrengthState, setTargetStrengthState] = useState<TargetStrengthState>("full");
  const [results, setResults] = useState<WeaponLine[]>([]);
  const [volleySummary, setVolleySummary] = useState<OrderedVolleySummary | null>(null);
  const [rollResult, setRollResult] = useState<OrderedVolleyRollResult | null>(null);
  const [phaseResult, setPhaseResult] = useState<PhaseSimulationResult | null>(null);
  const [simulationSeed, setSimulationSeed] = useState(1);
  const [simulationTrials, setSimulationTrials] = useState(10_000);
  const [phaseKey, setPhaseKey] = useState("");
  const [rollKey, setRollKey] = useState("");
  const [resultKey, setResultKey] = useState("");
  const [complexity, setComplexity] = useState<ExactComplexity | null>(null);
  const [complexityKey, setComplexityKey] = useState("");
  const [status, setStatus] = useState("Choose both units");

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch(() => setStatus("Profile catalogue unavailable"));
  }, []);

  const attackerUnits = useMemo(
    () =>
      catalogue?.units.filter(
        (unit) => unit.factionId === attackerFaction && unit.weapons.length,
      ) ?? [],
    [catalogue, attackerFaction],
  );
  const targetUnits = useMemo(
    () =>
      catalogue?.units.filter((unit) => unit.factionId === targetFaction && unit.models.length) ??
      [],
    [catalogue, targetFaction],
  );
  const attackerUnit = attackerUnits.find((unit) => unit.id === attackerUnitId);
  const supportUnits = catalogue?.units.filter((unit) => unit.factionId === attackerFaction) ?? [];
  const supportUnit = supportUnits.find((unit) => unit.id === supportUnitId);
  const targetUnit = targetUnits.find((unit) => unit.id === targetUnitId);
  const attackerJoinerOptions = bodyguardJoinerOptions(catalogue, attackerUnit);
  const attackerJoiner = attackerJoinerOptions.find((unit) => unit.id === attackerJoinerId);
  const targetJoinerOptions = bodyguardJoinerOptions(catalogue, targetUnit);
  const targetJoiner = targetJoinerOptions.find((unit) => unit.id === targetJoinerId);
  const attackerFormationUnits = [attackerUnit, attackerJoiner].filter(
    (unit): unit is NonNullable<typeof attackerUnit> => Boolean(unit),
  );
  const targetFormationUnits = [targetUnit, targetJoiner].filter(
    (unit): unit is NonNullable<typeof targetUnit> => Boolean(unit),
  );
  const attackerFormationUnit = attackerUnit
    ? {
        ...attackerUnit,
        combatPresets: attackerFormationUnits.flatMap((unit) => unit.combatPresets),
      }
    : undefined;
  const targetFormationUnit = targetUnit
    ? {
        ...targetUnit,
        combatPresets: targetFormationUnits.flatMap((unit) => unit.combatPresets),
      }
    : undefined;
  const attackerFormationKeywords = [
    ...new Set(
      attackerFormationUnits.flatMap((unit) => unit.models.flatMap((model) => model.keywords)),
    ),
  ];
  const targetSupportUnits =
    catalogue?.units.filter((unit) => unit.factionId === targetFaction) ?? [];
  const targetSupportUnit = targetSupportUnits.find((unit) => unit.id === targetSupportUnitId);
  const weaponGroups = groupWeaponProfiles(attackerFormationUnits.flatMap((unit) => unit.weapons));
  const weaponGroupSources = new Map(
    attackerFormationUnits.flatMap((unit) =>
      groupWeaponProfiles(unit.weapons).map((group) => [group.id, unit] as const),
    ),
  );
  const targetEquipmentOptions = targetFormationUnits.flatMap((unit) =>
    unit.defensiveEquipment.map((option) => ({
      ...option,
      sourceUnitId: unit.id,
      sourceUnitName: unit.name,
    })),
  );
  const targetModelOptions = targetFormationUnits.flatMap((unit) =>
    unit.models.map((model) => ({ unit, model })),
  );
  const bearerEquipmentIds = new Set(
    targetEquipmentOptions.filter((option) => option.scope === "bearer").map((option) => option.id),
  );
  const targetBearerEquipmentControls = [
    ...new Map(
      targetEquipmentOptions
        .filter((option) => option.scope === "bearer")
        .flatMap((option) =>
          targetSegments
            .filter(
              (segment) =>
                segment.unitId === option.sourceUnitId &&
                (!option.eligibleModelIds.length ||
                  option.eligibleModelIds.includes(segment.modelId)),
            )
            .map(
              (segment) =>
                [
                  `${option.id}:${segment.modelId}`,
                  {
                    option,
                    unitId: segment.unitId,
                    modelId: segment.modelId,
                    modelName: segment.name,
                  },
                ] as const,
            ),
        ),
    ).values(),
  ];
  const firingDeckPassengerUnits =
    catalogue?.units.filter(
      (unit) =>
        unit.id !== attackerUnit?.id &&
        firingDeckWeapons(unit).length > 0 &&
        transportPassengerCanEmbark(catalogue, attackerUnit, unit),
    ) ?? [];
  const structuredGroupIds = new Set(
    attackerFormationUnits.flatMap((unit) =>
      unit.wargearChoicePools.flatMap((pool) =>
        pool.replaces
          .map((weapon) => weapon.groupId)
          .concat(
            pool.alternatives.flatMap((alternative) =>
              alternative.weapons.map((weapon) => weapon.groupId),
            ),
          ),
      ),
    ),
  );
  const structuredOptionCounts = Object.assign(
    {},
    ...attackerFormationUnits.map((unit) => choiceSelectionWeaponCounts(unit, choiceSelections)),
  );
  const attackerComponentModelCount = (unitId: string) =>
    unitId === attackerJoiner?.id ? attackerJoinerModels : attackerModels;
  const loadoutWarnings = attackerFormationUnits.flatMap((unit) =>
    unitLoadoutWarnings(
      unit,
      attackerComponentModelCount(unit.id),
      { ...optionCounts, ...structuredOptionCounts },
      weaponCounts,
      choiceSelections,
      loadoutSubjectCounts,
    ),
  );
  const targetUnitModelCount = targetUnit
    ? Math.max(
        1,
        targetSegments
          .filter((segment) => segment.unitId === targetUnit.id)
          .reduce((total, segment) => total + segment.modelCount, 0),
      )
    : 0;
  const targetChoiceWarnings = choiceSelectionLimitWarnings(
    targetUnit,
    targetUnitModelCount,
    targetChoiceSelections,
  );
  const orderIndex = new Map(weaponOrder.map((weaponId, index) => [weaponId, index]));
  const completeFiringDeckSelections = firingDeckSelections.filter(
    (selection) => selection.passengerUnitId && selection.weaponId !== null,
  );
  let firingDeckError = "";
  let firingDeckLines: WeaponLine[] = [];
  let firingDeckSlots = 0;
  if (catalogue && attackerUnit?.firingDeck) {
    try {
      const resolved = resolveFiringDeckSelections(
        catalogue,
        attackerUnit,
        completeFiringDeckSelections,
      );
      firingDeckSlots = resolved.slots;
      firingDeckLines = firingDeckWeaponLines(
        catalogue,
        attackerUnit,
        completeFiringDeckSelections,
      );
    } catch (error) {
      firingDeckError = error instanceof Error ? error.message : "Invalid Firing Deck selection";
    }
  }
  const orderedLines = [
    ...equippedWeaponLines(weaponGroups, weaponCounts, profileCounts),
    ...firingDeckLines,
  ].sort(
    (left, right) =>
      (orderIndex.get(left.weapon.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(right.weapon.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const automaticUnitPresetIds = attackerFormationUnits.flatMap((unit) =>
    sourceEquipmentCombatPresetIds(unit, {
      choiceSelections,
      modelCount: attackerComponentModelCount(unit.id),
      loadoutSubjectCounts,
    }),
  );
  const unavailableAttackerSourcePresetIds = attackerFormationUnits.flatMap((unit) =>
    unavailableSourceEquipmentCombatPresetIds(unit, {
      choiceSelections,
      modelCount: attackerComponentModelCount(unit.id),
      loadoutSubjectCounts,
    }),
  );
  const calculationLines = orderedLines.flatMap((line) => {
    const sourceUnit = weaponGroupSources.get(line.weapon.groupId);
    if (!sourceUnit) return [{ ...line, sourceEquipmentPresetIds: [] }];
    return sourceEquipmentWeaponLineSegments(sourceUnit, line, {
      choiceSelections,
      modelCount: attackerComponentModelCount(sourceUnit.id),
      loadoutSubjectCounts,
    });
  });
  const inputKey = JSON.stringify({
    attackerJoinerId,
    attackerJoinerModels,
    targetJoinerId,
    targetJoinerModels,
    initialWoundsLost,
    targetDistance,
    attackerSourceTargetDistance,
    targetSourceAttackerDistance,
    attackerSourceCanSeeTarget,
    targetSourceCanSeeAttacker,
    attackerUnitModels,
    nearbyEnemyModels,
    nearbyEnemyUnits,
    enemyCharacterModelsDestroyed,
    destructiveFightPhases,
    embarkedModels,
    embarkedWracksModels,
    firingDeckSelections,
    attackerCharged,
    attackerRemainedStationary,
    attackerAttached,
    targetAttached,
    attackerWaaaghActive,
    targetWaaaghActive,
    targetOathOfMoment,
    attackerOathWoundBonusEligible,
    attackerOnObjective,
    targetOnObjective,
    attackerObjectiveOwner,
    targetObjectiveOwner,
    attackerOnAttackerSelectedObjective,
    targetOnAttackerSelectedObjective,
    attackerOnTargetSelectedObjective,
    targetOnTargetSelectedObjective,
    attackerGuidedAgainstTarget,
    targetSpotted,
    targetSpottedByMarkerlightObserver,
    targetClosestEligible,
    attackerBattleShocked,
    targetBattleShocked,
    targetStrengthState,
    orderedLines: orderedLines.map((line) => [line.weapon.id, line.count]),
    calculationLines: calculationLines.map((line) => [
      line.weapon.id,
      line.count,
      line.sourceEquipmentPresetIds,
    ]),
    choiceSelections,
    targetSegments,
    activeAttackerPresetIds,
    activeTargetPresetIds,
    supportUnitId,
    activeSupportPresetIds,
    supportDistance,
    targetSupportUnitId,
    activeTargetSupportPresetIds,
    targetSupportDistance,
  });
  const resultsAreCurrent = resultKey === inputKey;
  const rollIsCurrent = rollKey === inputKey;
  const currentPhaseKey = `${inputKey}:${simulationSeed}:${simulationTrials}`;
  const phaseIsCurrent = phaseKey === currentPhaseKey;

  const selectAttacker = (unitId: string) => {
    setAttackerUnitId(unitId);
    setAttackerJoinerId("");
    setAttackerJoinerModels(1);
    setAttackerCharged(false);
    setAttackerRemainedStationary(false);
    setAttackerAttached(false);
    setAttackerWaaaghActive(false);
    setTargetOathOfMoment(false);
    setAttackerOathWoundBonusEligible(false);
    setAttackerOnObjective(false);
    setAttackerObjectiveOwner("unknown");
    setAttackerOnAttackerSelectedObjective(false);
    setTargetOnAttackerSelectedObjective(false);
    setAttackerOnTargetSelectedObjective(false);
    setTargetOnTargetSelectedObjective(false);
    setAttackerGuidedAgainstTarget(false);
    setTargetSpotted(false);
    setTargetClosestEligible(false);
    setAttackerSourceTargetDistance(0);
    setTargetSourceAttackerDistance(0);
    setAttackerSourceCanSeeTarget(false);
    setTargetSourceCanSeeAttacker(false);
    setTargetSpottedByMarkerlightObserver(false);
    setNearbyEnemyModels(0);
    setNearbyEnemyUnits(0);
    setEnemyCharacterModelsDestroyed(0);
    setDestructiveFightPhases(0);
    setEmbarkedModels(0);
    setEmbarkedWracksModels(0);
    setFiringDeckSelections([]);
    setAttackerBattleShocked(false);
    const unit = attackerUnits.find((entry) => entry.id === unitId);
    const groups = groupWeaponProfiles(unit?.weapons ?? []);
    const models = unit?.suggestedModelCount ?? 1;
    const subjectCounts = defaultLoadoutSubjectCounts(unit);
    const defaults = defaultWeaponCounts(unit, models, subjectCounts);
    setAttackerModels(models);
    setAttackerUnitModels(unit ? models : 0);
    setWeaponCounts(Object.fromEntries(groups.map((group) => [group.id, defaults[group.id] ?? 0])));
    setOptionCounts(Object.fromEntries(groups.map((group) => [group.id, 0])));
    setChoiceSelections(
      Object.fromEntries(
        (unit?.wargearChoicePools ?? []).flatMap((pool) =>
          pool.alternatives.map((alternative) => [alternative.id, 0]),
        ),
      ),
    );
    setLoadoutSubjectCounts(subjectCounts);
    setProfileCounts(
      Object.fromEntries(
        groups.flatMap((group) => group.profiles.map((profile) => [profile.id, 0])),
      ),
    );
    setWeaponOrder(groups.flatMap((group) => group.profiles.map((profile) => profile.id)));
    setActiveAttackerPresetIds([]);
    setSupportUnitId("");
    setActiveSupportPresetIds([]);
    setSupportDistance(0);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
    setStatus(unit ? "Source loadout applied; edit it if needed" : "Choose both units");
  };

  const selectAttackerJoiner = (unitId: string) => {
    const previous = attackerJoiner;
    const unit = attackerJoinerOptions.find((entry) => entry.id === unitId);
    const previousGroups = groupWeaponProfiles(previous?.weapons ?? []);
    const previousGroupIds = new Set(previousGroups.map((group) => group.id));
    const previousProfileIds = new Set(
      previousGroups.flatMap((group) => group.profiles.map((profile) => profile.id)),
    );
    const previousChoiceIds = new Set(
      (previous?.wargearChoicePools ?? []).flatMap((pool) =>
        pool.alternatives.map((alternative) => alternative.id),
      ),
    );
    const previousSubjectIds = new Set(
      (previous?.unresolvedLoadoutSubjects ?? []).map((subject) => subject.id),
    );
    const groups = groupWeaponProfiles(unit?.weapons ?? []);
    const models = unit?.suggestedModelCount ?? 1;
    const subjectCounts = defaultLoadoutSubjectCounts(unit);
    const defaults = defaultWeaponCounts(unit, models, subjectCounts);
    const without = <T extends number>(current: Record<string, T>, ids: Set<string>) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id))) as Record<
        string,
        T
      >;
    setAttackerJoinerId(unitId);
    setAttackerJoinerModels(models);
    setAttackerUnitModels(attackerModels + (unit ? models : 0));
    setWeaponCounts((current) => ({
      ...without(current, previousGroupIds),
      ...Object.fromEntries(groups.map((group) => [group.id, defaults[group.id] ?? 0])),
    }));
    setOptionCounts((current) => ({
      ...without(current, previousGroupIds),
      ...Object.fromEntries(groups.map((group) => [group.id, 0])),
    }));
    setChoiceSelections((current) => ({
      ...without(current, previousChoiceIds),
      ...Object.fromEntries(
        (unit?.wargearChoicePools ?? []).flatMap((pool) =>
          pool.alternatives.map((alternative) => [alternative.id, 0]),
        ),
      ),
    }));
    setLoadoutSubjectCounts((current) => ({
      ...without(current, previousSubjectIds),
      ...subjectCounts,
    }));
    setProfileCounts((current) => ({
      ...without(
        Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value])),
        new Set([...previousProfileIds].map(String)),
      ),
      ...Object.fromEntries(
        groups.flatMap((group) => group.profiles.map((profile) => [profile.id, 0])),
      ),
    }));
    setWeaponOrder((current) => [
      ...current.filter((id) => !previousProfileIds.has(id)),
      ...groups.flatMap((group) => group.profiles.map((profile) => profile.id)),
    ]);
    setActiveAttackerPresetIds((current) =>
      current.filter((id) => !(previous?.combatPresets ?? []).some((preset) => preset.id === id)),
    );
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
    setStatus(
      unit ? `${unit.name} joined with an independent editable loadout` : "Joined unit removed",
    );
  };

  const selectTarget = (unitId: string) => {
    setTargetUnitId(unitId);
    setTargetJoinerId("");
    setTargetJoinerModels(1);
    setTargetAttached(false);
    setTargetWaaaghActive(false);
    setTargetOathOfMoment(false);
    setTargetOnObjective(false);
    setTargetObjectiveOwner("unknown");
    setAttackerOnAttackerSelectedObjective(false);
    setTargetOnAttackerSelectedObjective(false);
    setAttackerOnTargetSelectedObjective(false);
    setTargetOnTargetSelectedObjective(false);
    setAttackerGuidedAgainstTarget(false);
    setTargetSpotted(false);
    setTargetClosestEligible(false);
    setAttackerSourceTargetDistance(0);
    setTargetSourceAttackerDistance(0);
    setAttackerSourceCanSeeTarget(false);
    setTargetSourceCanSeeAttacker(false);
    setTargetSpottedByMarkerlightObserver(false);
    setTargetBattleShocked(false);
    setTargetStrengthState("full");
    const unit = targetUnits.find((entry) => entry.id === unitId);
    const sourceChoices = Object.fromEntries(
      (unit?.wargearChoicePools ?? []).flatMap((pool) =>
        pool.alternatives.map((alternative) => [alternative.id, 0]),
      ),
    );
    const models = unit?.suggestedModelCount ?? 1;
    const composition = catalogueModelSegments(unit, models);
    setTargetSegments(
      composition.segments.map((segment) =>
        targetSegment(segment.model, segment.modelCount, unit?.id),
      ),
    );
    setInitialWoundsLost(0);
    setTargetChoiceSelections(sourceChoices);
    setActiveTargetPresetIds(sourceEquipmentCombatPresetIds(unit, sourceChoices));
    setTargetSupportUnitId("");
    setActiveTargetSupportPresetIds([]);
    setTargetSupportDistance(0);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const selectTargetJoiner = (unitId: string) => {
    const unit = targetJoinerOptions.find((entry) => entry.id === unitId);
    const models = unit?.suggestedModelCount ?? 1;
    const rootComposition = catalogueModelSegments(
      targetUnit,
      targetUnit?.suggestedModelCount ?? 1,
    );
    const joinedComposition = catalogueModelSegments(unit, models);
    setTargetJoinerId(unitId);
    setTargetJoinerModels(models);
    setTargetSegments([
      ...rootComposition.segments.map((segment) =>
        targetSegment(segment.model, segment.modelCount, targetUnit?.id),
      ),
      ...joinedComposition.segments.map((segment) =>
        targetSegment(segment.model, segment.modelCount, unit?.id),
      ),
    ]);
    setInitialWoundsLost(0);
    setActiveTargetPresetIds((current) =>
      current.filter(
        (id) => !(targetJoiner?.combatPresets ?? []).some((preset) => preset.id === id),
      ),
    );
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
    setStatus(unit ? `${unit.name} joined the target formation` : "Target joined unit removed");
  };

  const moveWeapon = (weaponId: number, direction: -1 | 1) => {
    setWeaponOrder((current) => {
      const index = current.indexOf(weaponId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const moveTarget = (id: string, direction: -1 | 1) => {
    setTargetSegments((current) => {
      const index = current.findIndex((segment) => segment.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setInitialWoundsLost(0);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const changeUnitEquipment = (optionId: string, equipped: boolean) => {
    setTargetSegments((current) =>
      current.map((segment) => ({
        ...segment,
        defensiveEquipmentIds: equipped
          ? [...new Set([...segment.defensiveEquipmentIds, optionId])]
          : segment.defensiveEquipmentIds.filter((id) => id !== optionId),
      })),
    );
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const changeBearerEquipment = (
    unitId: string,
    modelId: number,
    optionId: string,
    count: number,
  ) => {
    try {
      const next = setBearerEquipmentCount(
        targetSegments,
        unitId,
        modelId,
        optionId,
        bearerEquipmentIds,
        count,
      );
      setTargetSegments(next);
      setInitialWoundsLost(0);
      setResults([]);
      setVolleySummary(null);
      setRollResult(null);
      setStatus("Defensive equipment allocation updated");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Equipment allocation could not be changed",
      );
    }
  };

  const currentProfiles = () => {
    const targetModels = targetSegments.reduce((sum, segment) => sum + segment.modelCount, 0);
    return calculationLines.map((line) =>
      applyCombatPresets(
        applyWeaponProfile(
          {
            ...DEFAULT_PROFILE,
            targetModels,
            weaponCount: line.count,
            targetDistance,
            attackerSourceTargetDistance,
            targetSourceAttackerDistance,
            attackerSourceCanSeeTarget,
            targetSourceCanSeeAttacker,
            attackerUnitModels,
            nearbyEnemyModels,
            nearbyEnemyUnits,
            enemyCharacterModelsDestroyed,
            destructiveFightPhases,
            embarkedModels,
            embarkedWracksModels,
            attackerCharged,
            attackerRemainedStationary,
            attackerAttached,
            targetAttached,
            attackerWaaaghActive,
            targetWaaaghActive,
            targetOathOfMoment,
            attackerOathWoundBonusEligible,
            attackerOnObjective,
            targetOnObjective,
            attackerObjectiveOwner,
            targetObjectiveOwner,
            attackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective,
            attackerOnTargetSelectedObjective,
            targetOnTargetSelectedObjective,
            attackerGuidedAgainstTarget,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            targetClosestEligible,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            supportDistance,
            targetSupportDistance,
          },
          line.weapon,
          targetSegments[0]?.keywords ?? [],
        ),
        [
          ...selectedAndAutomaticCombatPresets(
            attackerFormationUnit?.combatPresets ?? [],
            [
              ...activeAttackerPresetIds,
              ...automaticUnitPresetIds,
              ...(line.sourceEquipmentPresetIds ?? []),
            ],
            line.weapon.type,
            line.weapon.name,
            targetSegments[0]?.keywords ?? [],
            attackKeywordsForWeapon(line.weapon),
            targetDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
            attackerAttached,
            attackerWaaaghActive,
            targetOathOfMoment,
            attackerOathWoundBonusEligible,
            attackerOnObjective,
            targetOnObjective,
            attackerOnObjective && attackerObjectiveOwner === "attacker",
            targetOnObjective && ["target", "uncontrolled"].includes(targetObjectiveOwner),
            attackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective,
            attackerBattleShocked,
            attackerGuidedAgainstTarget,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            "self",
            [],
            0,
            targetClosestEligible,
            attackerSourceTargetDistance,
            attackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
          ...selectedAndAutomaticCombatPresets(
            supportUnit?.combatPresets ?? [],
            activeSupportPresetIds,
            line.weapon.type,
            line.weapon.name,
            targetSegments[0]?.keywords ?? [],
            attackKeywordsForWeapon(line.weapon),
            targetDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
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
            attackerGuidedAgainstTarget,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            "supporting_unit",
            attackerFormationKeywords,
            supportDistance,
            targetClosestEligible,
            attackerSourceTargetDistance,
            attackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
        ],
        [
          ...selectedAndAutomaticCombatPresets(
            targetFormationUnit?.combatPresets ?? [],
            activeTargetPresetIds,
            line.weapon.type,
            line.weapon.name,
            targetSegments[0]?.keywords ?? [],
            attackKeywordsForWeapon(line.weapon),
            targetDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
            targetAttached,
            targetWaaaghActive,
            false,
            false,
            targetOnObjective,
            attackerOnObjective,
            targetOnObjective && targetObjectiveOwner === "target",
            attackerOnObjective && ["attacker", "uncontrolled"].includes(attackerObjectiveOwner),
            targetOnTargetSelectedObjective,
            attackerOnTargetSelectedObjective,
            targetBattleShocked,
            false,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            "self",
            [],
            0,
            targetClosestEligible,
            targetSourceAttackerDistance,
            targetSourceCanSeeAttacker,
            attackerFormationKeywords,
          ),
          ...selectedAndAutomaticCombatPresets(
            targetSupportUnit?.combatPresets ?? [],
            activeTargetSupportPresetIds,
            line.weapon.type,
            line.weapon.name,
            targetSegments[0]?.keywords ?? [],
            attackKeywordsForWeapon(line.weapon),
            targetDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
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
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            "supporting_unit",
            targetSegments[0]?.keywords ?? [],
            targetSupportDistance,
            targetClosestEligible,
            targetSourceAttackerDistance,
            targetSourceCanSeeAttacker,
            attackerFormationKeywords,
          ),
        ],
        line.weapon.type,
        {
          attackerKeywords: attackerFormationKeywords,
          targetKeywords: targetSegments[0]?.keywords ?? [],
          attackKeywords: attackKeywordsForWeapon(line.weapon),
          targetDistance,
          attackerUnitModels,
          nearbyEnemyModels,
          nearbyEnemyUnits,
          enemyCharacterModelsDestroyed,
          destructiveFightPhases,
          embarkedModels,
          embarkedWracksModels,
          attackerCharged,
          attackerBattleShocked,
          targetBattleShocked,
          targetStrengthState,
          attackerRemainedStationary,
          attackerAttached,
          targetAttached,
          attackerWaaaghActive,
          targetWaaaghActive,
          targetOathOfMoment,
          attackerOathWoundBonusEligible,
          attackerOnObjective,
          targetOnObjective,
          attackerObjectiveOwner,
          targetObjectiveOwner,
          attackerOnAttackerSelectedObjective,
          targetOnAttackerSelectedObjective,
          attackerOnTargetSelectedObjective,
          targetOnTargetSelectedObjective,
          attackerGuidedAgainstTarget,
          targetSpotted,
          targetSpottedByMarkerlightObserver,
          targetClosestEligible,
          attackerSourceTargetDistance,
          targetSourceAttackerDistance,
          attackerSourceCanSeeTarget,
          targetSourceCanSeeAttacker,
          supportDistance,
          supportedUnitKeywords: attackerFormationKeywords,
          targetSupportDistance,
          targetSupportedUnitKeywords: targetSegments[0]?.keywords ?? [],
        },
      ),
    );
  };

  const currentTargets = () => {
    const targetPresets = [
      ...new Map(
        calculationLines
          .flatMap((line) => [
            ...selectedAndAutomaticCombatPresets(
              targetFormationUnit?.combatPresets ?? [],
              activeTargetPresetIds,
              line.weapon.type,
              line.weapon.name,
              targetSegments[0]?.keywords ?? [],
              attackKeywordsForWeapon(line.weapon),
              targetDistance,
              attackerCharged,
              attackerBattleShocked,
              targetBattleShocked,
              targetStrengthState,
              attackerRemainedStationary,
              targetAttached,
              targetWaaaghActive,
              false,
              false,
              targetOnObjective,
              attackerOnObjective,
              targetOnObjective && targetObjectiveOwner === "target",
              attackerOnObjective && ["attacker", "uncontrolled"].includes(attackerObjectiveOwner),
              targetOnTargetSelectedObjective,
              attackerOnTargetSelectedObjective,
              targetBattleShocked,
              false,
              targetSpotted,
              targetSpottedByMarkerlightObserver,
              "self",
              [],
              0,
              targetClosestEligible,
              targetSourceAttackerDistance,
              targetSourceCanSeeAttacker,
              attackerFormationKeywords,
            ),
            ...selectedAndAutomaticCombatPresets(
              targetSupportUnit?.combatPresets ?? [],
              activeTargetSupportPresetIds,
              line.weapon.type,
              line.weapon.name,
              targetSegments[0]?.keywords ?? [],
              attackKeywordsForWeapon(line.weapon),
              targetDistance,
              attackerCharged,
              attackerBattleShocked,
              targetBattleShocked,
              targetStrengthState,
              attackerRemainedStationary,
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
              targetSpotted,
              targetSpottedByMarkerlightObserver,
              "supporting_unit",
              targetSegments[0]?.keywords ?? [],
              targetSupportDistance,
              targetClosestEligible,
              targetSourceAttackerDistance,
              targetSourceCanSeeAttacker,
              attackerFormationKeywords,
            ),
          ])
          .map((preset) => [preset.id, preset]),
      ).values(),
    ];
    const equipmentCandidates = calculationLines.map((line) =>
      applyDefensiveEquipmentTargets(
        targetSegments,
        targetEquipmentOptions,
        attackKeywordsForWeapon(line.weapon),
      ),
    );
    const equipmentSignatures = equipmentCandidates.map((candidate) =>
      JSON.stringify(
        candidate.map((segment) => [
          segment.save,
          segment.invulnerable,
          segment.feelNoPain,
          segment.reduction,
          segment.firstFailedSaveDamageReplacement,
        ]),
      ),
    );
    if (new Set(equipmentSignatures).size > 1)
      throw new Error("Resolve weapons with different defensive equipment eligibility separately");
    return applyTargetCombatPresets(
      equipmentCandidates[0] ?? targetSegments,
      targetPresets,
      calculationLines.map((line) => ({
        weaponType: line.weapon.type,
        weaponName: line.weapon.name,
        attackKeywords: attackKeywordsForWeapon(line.weapon),
        attackerKeywords: attackerFormationKeywords,
        targetDistance,
        attackerUnitModels,
        nearbyEnemyModels,
        nearbyEnemyUnits,
        enemyCharacterModelsDestroyed,
        destructiveFightPhases,
        embarkedModels,
        embarkedWracksModels,
        attackerCharged,
        attackerBattleShocked,
        targetBattleShocked,
        targetStrengthState,
        attackerRemainedStationary,
        targetAttached,
        targetWaaaghActive,
        attackerOnObjective,
        targetOnObjective,
        attackerObjectiveOwner,
        targetObjectiveOwner,
        attackerOnAttackerSelectedObjective,
        targetOnAttackerSelectedObjective,
        attackerOnTargetSelectedObjective,
        targetOnTargetSelectedObjective,
        attackerGuidedAgainstTarget,
        targetSpotted,
        targetSpottedByMarkerlightObserver,
        targetClosestEligible,
        targetSourceAttackerDistance,
        targetSourceCanSeeAttacker,
        targetSupportDistance,
        targetSupportedUnitKeywords: targetSegments[0]?.keywords ?? [],
      })),
    );
  };

  const calculateUnit = async (forceExact = false) => {
    if (!attackerUnit || !targetUnit) return;
    setStatus("Calculating unit volley…");
    if (
      firingDeckSelections.some(
        (selection) => !selection.passengerUnitId || selection.weaponId === null,
      )
    ) {
      setStatus("Complete or remove every Firing Deck selection");
      return;
    }
    if (firingDeckError) {
      setStatus(firingDeckError);
      return;
    }
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    const lines = calculationLines;
    if (!lines.length) {
      setStatus("Enter at least one equipped weapon quantity");
      return;
    }
    if (!targetSegments.length) {
      setStatus("Add at least one target profile segment");
      return;
    }
    try {
      const profiles = currentProfiles();
      const targets = currentTargets();
      const estimate = await estimateOrderedVolleyComplexity(profiles, targets, initialWoundsLost);
      setComplexity(estimate);
      setComplexityKey(inputKey);
      if (estimate.usesDeferredStates && !estimate.exactGuaranteedByBound && !forceExact) {
        setStatus("This volley may exceed the exact state budget; choose exact or simulation");
        return;
      }
      const summary = await calculateOrderedVolley(profiles, targets, initialWoundsLost);
      const resolved = lines.map((line, index) => ({
        ...line,
        incrementalMean: summary.incrementalMeans[index],
        cumulativeMean: summary.cumulativeMeans[index],
      }));
      setResults(resolved);
      setVolleySummary(summary);
      setResultKey(inputKey);
      setStatus(
        loadoutWarnings.length ? "Volley calculated with loadout warnings" : "Volley calculated",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calculation failed");
    }
  };

  const rollUnit = () => {
    if (!attackerUnit || !targetUnit) return;
    if (
      firingDeckSelections.some(
        (selection) => !selection.passengerUnitId || selection.weaponId === null,
      )
    ) {
      setStatus("Complete or remove every Firing Deck selection");
      return;
    }
    if (firingDeckError) {
      setStatus(firingDeckError);
      return;
    }
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    if (!orderedLines.length || !targetSegments.length) {
      setStatus("Enter a weapon quantity and target profile first");
      return;
    }
    try {
      const profiles = currentProfiles();
      setRollResult(simulateOrderedVolley(profiles, currentTargets(), initialWoundsLost));
      setRollKey(inputKey);
      setStatus("Full volley rolled with secure random dice");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Roll failed");
    }
  };

  const runPhaseSimulation = async () => {
    if (!attackerUnit || !targetUnit) return;
    if (
      firingDeckSelections.some(
        (selection) => !selection.passengerUnitId || selection.weaponId === null,
      )
    ) {
      setStatus("Complete or remove every Firing Deck selection");
      return;
    }
    if (firingDeckError) {
      setStatus(firingDeckError);
      return;
    }
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    if (!orderedLines.length || !targetSegments.length) {
      setStatus("Enter a weapon quantity and target profile first");
      return;
    }
    setStatus(`Simulating ${simulationTrials.toLocaleString()} seeded volleys…`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const profiles = currentProfiles();
      setPhaseResult(
        simulateOrderedVolleyPhase(
          profiles,
          currentTargets(),
          simulationSeed,
          simulationTrials,
          initialWoundsLost,
        ),
      );
      setPhaseKey(currentPhaseKey);
      setStatus("Reproducible phase simulation complete");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Simulation failed");
    }
  };

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">COGITATOR // 10E</span>
          <h1>Unit vs Unit</h1>
        </div>
        <div className="engine-status ready">
          <span />
          {status}
        </div>
      </header>
      <WorkflowNav current="/unit-vs-unit" />
      <div className="workspace-grid">
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>Attacking formation</p>
              <h2>Unit and loadout</h2>
            </div>
          </div>
          <div className="panel-body compact-form">
            <label>
              <span>Faction</span>
              <select
                value={attackerFaction}
                onChange={(event) => {
                  setAttackerFaction(event.target.value);
                  setAttackerUnitId("");
                  setAttackerJoinerId("");
                  setAttackerJoinerModels(1);
                  setAttackerCharged(false);
                  setAttackerRemainedStationary(false);
                  setAttackerAttached(false);
                  setAttackerWaaaghActive(false);
                  setTargetOathOfMoment(false);
                  setAttackerOathWoundBonusEligible(false);
                  setAttackerOnObjective(false);
                  setAttackerObjectiveOwner("unknown");
                  setAttackerUnitModels(0);
                  setNearbyEnemyModels(0);
                  setNearbyEnemyUnits(0);
                  setEnemyCharacterModelsDestroyed(0);
                  setDestructiveFightPhases(0);
                  setEmbarkedModels(0);
                  setEmbarkedWracksModels(0);
                  setFiringDeckSelections([]);
                  setAttackerBattleShocked(false);
                  setSupportUnitId("");
                  setActiveSupportPresetIds([]);
                  setSupportDistance(0);
                }}
              >
                <option value="">Choose faction</option>
                {catalogue?.factions.map((faction) => (
                  <option key={faction.id} value={faction.id}>
                    {faction.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Unit</span>
              <select
                value={attackerUnitId}
                onChange={(event) => selectAttacker(event.target.value)}
              >
                <option value="">Choose unit</option>
                {attackerUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Models firing</span>
              <input
                type="number"
                min={1}
                max={attackerUnit?.maximumModelCount ?? 100}
                value={attackerModels}
                onChange={(event) => {
                  const next = Math.max(1, +event.target.value);
                  setWeaponCounts((current) =>
                    applyModelCountChange(
                      current,
                      attackerUnit,
                      attackerModels,
                      next,
                      loadoutSubjectCounts,
                    ),
                  );
                  setLoadoutSubjectCounts((current) =>
                    rebaseCompositionLoadoutSubjectCounts(
                      attackerUnit,
                      attackerModels,
                      next,
                      current,
                    ),
                  );
                  setAttackerModels(next);
                  setAttackerUnitModels(next + (attackerJoiner ? attackerJoinerModels : 0));
                }}
              />
            </label>
            {attackerJoinerOptions.length > 0 && (
              <label>
                <span>Joined formation unit</span>
                <select
                  aria-label="Attacker joined Bodyguard unit"
                  value={attackerJoinerId}
                  onChange={(event) => selectAttackerJoiner(event.target.value)}
                >
                  <option value="">None</option>
                  {attackerJoinerOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
                <small>Uses the published pre-battle Bodyguard join rule</small>
              </label>
            )}
            {attackerJoiner && (
              <label>
                <span>{attackerJoiner.name} models firing</span>
                <input
                  aria-label="Attacker joined unit models firing"
                  type="number"
                  min={1}
                  max={attackerJoiner.maximumModelCount ?? 100}
                  value={attackerJoinerModels}
                  onChange={(event) => {
                    const next = Math.max(1, +event.target.value);
                    setWeaponCounts((current) =>
                      applyModelCountChange(
                        current,
                        attackerJoiner,
                        attackerJoinerModels,
                        next,
                        loadoutSubjectCounts,
                      ),
                    );
                    setLoadoutSubjectCounts((current) =>
                      rebaseCompositionLoadoutSubjectCounts(
                        attackerJoiner,
                        attackerJoinerModels,
                        next,
                        current,
                      ),
                    );
                    setAttackerJoinerModels(next);
                    setAttackerUnitModels(attackerModels + next);
                  }}
                />
              </label>
            )}
            {attackerUnit && (
              <div className="loadout-list">
                <CombatPresetSelector
                  presets={(attackerFormationUnit?.combatPresets ?? []).filter(
                    (preset) =>
                      !preset.sourceEquipmentChoiceExact ||
                      preset.sourceEquipmentAutoEnable === false,
                  )}
                  role="attacker"
                  selectedIds={activeAttackerPresetIds}
                  onChange={setActiveAttackerPresetIds}
                  title="Active attacking abilities"
                  targetDistance={targetDistance}
                  attackerCharged={attackerCharged}
                  attackerRemainedStationary={attackerRemainedStationary}
                  sourceUnitAttached={attackerAttached}
                  sourceUnitWaaaghActive={attackerWaaaghActive}
                  attackerBattleShocked={attackerBattleShocked}
                  targetBattleShocked={targetBattleShocked}
                  targetStrengthState={targetStrengthState}
                  sourceTargetDistance={attackerSourceTargetDistance}
                  sourceTargetVisible={attackerSourceCanSeeTarget}
                  disabledIds={unavailableAttackerSourcePresetIds}
                />
                <SupportPresetSelector
                  units={supportUnits}
                  role="attacker"
                  selectedUnitId={supportUnitId}
                  selectedIds={activeSupportPresetIds}
                  onUnitChange={(unitId) => {
                    setSupportUnitId(unitId);
                    setActiveSupportPresetIds([]);
                    setSupportDistance(0);
                  }}
                  onPresetChange={setActiveSupportPresetIds}
                  supportDistance={supportDistance}
                  onSupportDistanceChange={setSupportDistance}
                  supportedUnitKeywords={attackerFormationKeywords}
                  attackerCharged={attackerCharged}
                  attackerRemainedStationary={attackerRemainedStationary}
                  attackerBattleShocked={attackerBattleShocked}
                  targetBattleShocked={targetBattleShocked}
                  targetStrengthState={targetStrengthState}
                  sourceTargetDistance={attackerSourceTargetDistance}
                  sourceTargetVisible={attackerSourceCanSeeTarget}
                />
                {attackerFormationUnits.some(
                  (unit) => unit.unresolvedLoadoutSubjects.length > 0,
                ) && (
                  <details className="source-choice-pools model-composition-editor" open>
                    <summary>Model composition</summary>
                    <small>
                      Enter how many models match each published loadout clause. Weapon totals
                      remain editable.
                    </small>
                    {attackerFormationUnits.flatMap((unit) =>
                      unit.unresolvedLoadoutSubjects.map((subject) => (
                        <label key={subject.id}>
                          <span>
                            {subject.subject}
                            <small>
                              {unit.name} · {subject.equipment}
                            </small>
                          </span>
                          <input
                            aria-label={`${unit.name} ${subject.subject} model count`}
                            type="number"
                            min={0}
                            max={1000}
                            value={loadoutSubjectCounts[subject.id] ?? 0}
                            onChange={(event) => {
                              const next = normalizeEquippedCount(+event.target.value, 1000);
                              const previousCounts = compositionLoadoutSubjectCounts(
                                unit,
                                attackerComponentModelCount(unit.id),
                                loadoutSubjectCounts,
                              );
                              const nextCounts = compositionLoadoutSubjectCounts(
                                unit,
                                attackerComponentModelCount(unit.id),
                                { ...previousCounts, [subject.id]: next },
                              );
                              setWeaponCounts((current) =>
                                applyLoadoutSubjectCountsChange(
                                  current,
                                  unit,
                                  previousCounts,
                                  nextCounts,
                                ),
                              );
                              setLoadoutSubjectCounts(nextCounts);
                            }}
                          />
                        </label>
                      )),
                    )}
                  </details>
                )}
                <h3>Total weapons equipped</h3>
                {weaponGroups.map((group) => {
                  const sourceUnit = weaponGroupSources.get(group.id) ?? attackerUnit;
                  const sourceModelCount = attackerComponentModelCount(sourceUnit.id);
                  const sourceLimit = sourceUnit.weaponLimits.find(
                    (limit) => limit.groupId === group.id,
                  );
                  return (
                    <div className="weapon-group" key={group.id}>
                      <label>
                        <span>
                          {group.name}
                          <small>
                            {group.profiles.length > 1
                              ? `${group.profiles.length} mutually exclusive profiles`
                              : `${group.profiles[0].attacks} · S${group.profiles[0].strength} · AP ${group.profiles[0].ap ?? "—"} · D ${group.profiles[0].damage}`}
                            {" · copies across unit"}
                            {attackerJoiner ? ` · ${sourceUnit.name}` : ""}
                            {sourceLimit
                              ? ` · options allow up to ${weaponLimitMaximum(sourceLimit, sourceModelCount)}`
                              : ""}
                          </small>
                        </span>
                        <input
                          aria-label={`${group.name} count`}
                          type="number"
                          min={0}
                          max={100}
                          value={weaponCounts[group.id] ?? 0}
                          onChange={(event) =>
                            setWeaponCounts((current) => ({
                              ...current,
                              [group.id]: normalizeEquippedCount(+event.target.value),
                            }))
                          }
                        />
                      </label>
                      {sourceLimit && !structuredGroupIds.has(group.id) && (
                        <label className="option-count">
                          <span>
                            Selected through wargear options
                            <small>Copies taken or replaced using the source options</small>
                          </span>
                          <input
                            aria-label={`${group.name} option-selected copies`}
                            type="number"
                            min={0}
                            max={weaponCounts[group.id] ?? 0}
                            value={optionCounts[group.id] ?? 0}
                            onChange={(event) =>
                              setOptionCounts((current) => ({
                                ...current,
                                [group.id]: normalizeEquippedCount(+event.target.value),
                              }))
                            }
                          />
                        </label>
                      )}
                      {group.profiles.length > 1 && (
                        <div className="profile-allocations">
                          <span>Copies using each profile this volley</span>
                          {group.profiles.map((profile) => (
                            <label key={profile.id}>
                              <span>
                                {profile.profileName ?? profile.name}
                                <small>
                                  {profile.attacks} · S{profile.strength} · AP {profile.ap ?? "—"} ·
                                  D {profile.damage}
                                </small>
                              </span>
                              <input
                                aria-label={`${profile.name} firing count`}
                                type="number"
                                min={0}
                                max={weaponCounts[group.id] ?? 0}
                                value={profileCounts[profile.id] ?? 0}
                                onChange={(event) =>
                                  setProfileCounts((current) => ({
                                    ...current,
                                    [profile.id]: normalizeEquippedCount(
                                      +event.target.value,
                                      weaponCounts[group.id] ?? 0,
                                    ),
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {attackerUnit.firingDeck && (
                  <details className="source-choice-pools" open>
                    <summary>
                      Firing Deck {attackerUnit.firingDeck.capacity} ({firingDeckSlots}/
                      {attackerUnit.firingDeck.capacity} model slots)
                    </summary>
                    <small>
                      Select one ranged, non-One Shot weapon from each embarked model. These weapons
                      are resolved as equipped by {attackerUnit.name}; passenger abilities do not
                      transfer.
                    </small>
                    {firingDeckSelections.map((selection) => {
                      const passenger = firingDeckPassengerUnits.find(
                        (unit) => unit.id === selection.passengerUnitId,
                      );
                      const attachmentOptions = transportPassengerAttachmentOptions(
                        catalogue,
                        attackerUnit,
                        passenger,
                      );
                      return (
                        <fieldset key={selection.id}>
                          <legend>Embarked models</legend>
                          <label>
                            <span>Passenger unit</span>
                            <select
                              aria-label="Firing Deck passenger unit"
                              value={selection.passengerUnitId}
                              onChange={(event) =>
                                setFiringDeckSelections((current) =>
                                  current.map((entry) =>
                                    entry.id === selection.id
                                      ? {
                                          ...entry,
                                          passengerUnitId: event.target.value,
                                          attachedUnitId: "",
                                          weaponId: null,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              <option value="">Choose embarked unit</option>
                              {firingDeckPassengerUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {passenger && attachmentOptions.length > 0 && (
                            <label>
                              <span>Passenger attached to</span>
                              <select
                                aria-label="Firing Deck attached unit"
                                value={selection.attachedUnitId}
                                onChange={(event) =>
                                  setFiringDeckSelections((current) =>
                                    current.map((entry) =>
                                      entry.id === selection.id
                                        ? {
                                            ...entry,
                                            attachedUnitId: event.target.value,
                                            weaponId: null,
                                          }
                                        : entry,
                                    ),
                                  )
                                }
                              >
                                <option value="">Choose attached unit</option>
                                {attachmentOptions.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {unit.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label>
                            <span>One weapon per selected model</span>
                            <select
                              aria-label="Firing Deck passenger weapon"
                              value={selection.weaponId ?? ""}
                              disabled={
                                !passenger ||
                                (attachmentOptions.length > 0 && !selection.attachedUnitId)
                              }
                              onChange={(event) =>
                                setFiringDeckSelections((current) =>
                                  current.map((entry) =>
                                    entry.id === selection.id
                                      ? { ...entry, weaponId: Number(event.target.value) || null }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              <option value="">Choose ranged weapon</option>
                              {passenger &&
                                firingDeckWeapons(passenger).map((weapon) => (
                                  <option key={weapon.id} value={weapon.id}>
                                    {weapon.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            <span>
                              Models using this weapon
                              {passenger && passenger.firingDeckModelCost > 1 && (
                                <small>{passenger.firingDeckModelCost} slots per model</small>
                              )}
                            </span>
                            <input
                              aria-label="Firing Deck selected passenger models"
                              type="number"
                              min={1}
                              max={attackerUnit.firingDeck?.capacity ?? 1}
                              value={selection.modelCount}
                              onChange={(event) =>
                                setFiringDeckSelections((current) =>
                                  current.map((entry) =>
                                    entry.id === selection.id
                                      ? {
                                          ...entry,
                                          modelCount:
                                            normalizeEquippedCount(
                                              +event.target.value,
                                              attackerUnit.firingDeck!.capacity,
                                            ) || 1,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className="inline-checkbox">
                            <input
                              type="checkbox"
                              checked={selection.unitAlreadyShot}
                              onChange={(event) =>
                                setFiringDeckSelections((current) =>
                                  current.map((entry) =>
                                    entry.id === selection.id
                                      ? { ...entry, unitAlreadyShot: event.target.checked }
                                      : entry,
                                  ),
                                )
                              }
                            />
                            Passenger unit has already shot this phase
                          </label>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              setFiringDeckSelections((current) =>
                                current.filter((entry) => entry.id !== selection.id),
                              )
                            }
                          >
                            Remove passenger weapon
                          </button>
                        </fieldset>
                      );
                    })}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setFiringDeckSelections((current) => [
                          ...current,
                          {
                            id: crypto.randomUUID(),
                            passengerUnitId: "",
                            attachedUnitId: "",
                            weaponId: null,
                            modelCount: 1,
                            unitAlreadyShot: false,
                          },
                        ])
                      }
                    >
                      Add embarked weapon
                    </button>
                    {firingDeckError && <div className="field-error">{firingDeckError}</div>}
                  </details>
                )}
                {attackerFormationUnits.some((unit) => unit.wargearChoicePools.length > 0) && (
                  <details className="source-choice-pools">
                    <summary>
                      Source option choices (
                      {attackerFormationUnits.reduce(
                        (sum, unit) => sum + unit.wargearChoicePools.length,
                        0,
                      )}
                      )
                    </summary>
                    <p>
                      Enter how many times each alternative is selected. Alternatives in the same
                      block share one allowance, including bundled weapons.
                    </p>
                    {attackerFormationUnits.flatMap((unit) =>
                      unit.wargearChoicePools.map((pool) => {
                        const maximum = choicePoolMaximum(
                          pool,
                          attackerComponentModelCount(unit.id),
                        );
                        const used = choicePoolUsed(pool, choiceSelections);
                        return (
                          <fieldset key={pool.id}>
                            <legend>
                              {unit.name}: {used}/{maximum} choice slots
                            </legend>
                            <small>{pool.source}</small>
                            {pool.alternatives.map((alternative) => (
                              <label key={alternative.id}>
                                <span>{alternative.label}</span>
                                <input
                                  aria-label={`${alternative.label} source selections`}
                                  type="number"
                                  min={0}
                                  max={choiceAlternativeMaximum(
                                    pool,
                                    alternative,
                                    attackerComponentModelCount(unit.id),
                                  )}
                                  value={choiceSelections[alternative.id] ?? 0}
                                  onChange={(event) => {
                                    const previous = choiceSelections[alternative.id] ?? 0;
                                    const next = normalizeEquippedCount(
                                      +event.target.value,
                                      choiceAlternativeMaximum(
                                        pool,
                                        alternative,
                                        attackerComponentModelCount(unit.id),
                                      ),
                                    );
                                    setWeaponCounts((current) =>
                                      applyChoiceSelectionChange(
                                        current,
                                        pool,
                                        alternative,
                                        previous,
                                        next,
                                        choiceSelections,
                                      ),
                                    );
                                    setChoiceSelections((current) => ({
                                      ...current,
                                      [alternative.id]: next,
                                    }));
                                  }}
                                />
                              </label>
                            ))}
                          </fieldset>
                        );
                      }),
                    )}
                  </details>
                )}
                {loadoutWarnings.length > 0 && (
                  <div className="loadout-warnings" role="status">
                    <strong>Check this edited loadout</strong>
                    <ul>
                      {loadoutWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                    <small>
                      You can still calculate to represent casualties or narrative rules.
                    </small>
                  </div>
                )}
                {attackerFormationUnits.map((unit) => (
                  <div key={unit.id}>
                    <details className="source-guidance" open>
                      <summary>{unit.name} composition</summary>
                      <ul>
                        {unit.composition.map((line, index) => (
                          <li key={`${line.text}-${index}`}>{line.text}</li>
                        ))}
                      </ul>
                    </details>
                    {unit.loadout && (
                      <details className="source-guidance" open>
                        <summary>{unit.name} starting equipment</summary>
                        <p>{unit.loadout}</p>
                      </details>
                    )}
                    {unit.wargearOptions.length > 0 && (
                      <details className="source-guidance">
                        <summary>
                          {unit.name} wargear options ({unit.wargearOptions.length})
                        </summary>
                        <ul>
                          {unit.wargearOptions.map((option, index) => (
                            <li key={`${option}-${index}`}>{option}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <span>02</span>
            <div>
              <p>Defending formation</p>
              <h2>Target unit</h2>
            </div>
          </div>
          <div className="panel-body compact-form">
            <label>
              <span>Faction</span>
              <select
                value={targetFaction}
                onChange={(event) => {
                  setTargetFaction(event.target.value);
                  setTargetUnitId("");
                  setTargetJoinerId("");
                  setTargetJoinerModels(1);
                  setTargetChoiceSelections({});
                  setActiveTargetPresetIds([]);
                  setTargetBattleShocked(false);
                  setTargetStrengthState("full");
                  setTargetAttached(false);
                  setTargetWaaaghActive(false);
                  setTargetOathOfMoment(false);
                  setTargetOnObjective(false);
                  setTargetObjectiveOwner("unknown");
                  setTargetSupportUnitId("");
                  setActiveTargetSupportPresetIds([]);
                  setTargetSupportDistance(0);
                }}
              >
                <option value="">Choose faction</option>
                {catalogue?.factions.map((faction) => (
                  <option key={faction.id} value={faction.id}>
                    {faction.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Unit</span>
              <select value={targetUnitId} onChange={(event) => selectTarget(event.target.value)}>
                <option value="">Choose unit</option>
                {targetUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            {targetJoinerOptions.length > 0 && (
              <label>
                <span>Joined formation unit</span>
                <select
                  aria-label="Target joined Bodyguard unit"
                  value={targetJoinerId}
                  onChange={(event) => selectTargetJoiner(event.target.value)}
                >
                  <option value="">None</option>
                  {targetJoinerOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
                <small>Uses the published pre-battle Bodyguard join rule</small>
              </label>
            )}
            {targetJoiner && (
              <label>
                <span>{targetJoiner.name} models</span>
                <input
                  aria-label="Target joined unit model count"
                  type="number"
                  min={1}
                  max={targetJoiner.maximumModelCount ?? 100}
                  value={targetJoinerModels}
                  onChange={(event) => {
                    const next = Math.max(1, +event.target.value);
                    const composition = catalogueModelSegments(targetJoiner, next);
                    setTargetJoinerModels(next);
                    setTargetSegments((current) => [
                      ...current.filter((segment) => segment.unitId !== targetJoiner.id),
                      ...composition.segments.map((segment) =>
                        targetSegment(segment.model, segment.modelCount, targetJoiner.id),
                      ),
                    ]);
                    setInitialWoundsLost(0);
                  }}
                />
              </label>
            )}
            {targetUnit && targetUnit.wargearChoicePools.length > 0 && (
              <details className="source-choice-pools" open>
                <summary>Target source option choices</summary>
                <p>
                  Select the target’s published equipment. Linked defensive abilities activate
                  automatically and remain editable below.
                </p>
                {targetUnit.wargearChoicePools.map((pool) => {
                  const maximum = choicePoolMaximum(pool, targetUnitModelCount);
                  const used = choicePoolUsed(pool, targetChoiceSelections);
                  return (
                    <fieldset key={pool.id}>
                      <legend>
                        {used}/{maximum} choice slots
                      </legend>
                      <small>{pool.source}</small>
                      {pool.alternatives.map((alternative) => (
                        <label key={alternative.id}>
                          <span>{alternative.label}</span>
                          <input
                            aria-label={`${alternative.label} target source selections`}
                            type="number"
                            min={0}
                            max={choiceAlternativeMaximum(pool, alternative, targetUnitModelCount)}
                            value={targetChoiceSelections[alternative.id] ?? 0}
                            onChange={(event) => {
                              const nextValue = normalizeEquippedCount(
                                +event.target.value,
                                choiceAlternativeMaximum(pool, alternative, targetUnitModelCount),
                              );
                              const nextChoices = {
                                ...targetChoiceSelections,
                                [alternative.id]: nextValue,
                              };
                              setActiveTargetPresetIds((current) =>
                                reconcileCombatPresetSourceChoices(
                                  targetUnit.combatPresets,
                                  current,
                                  targetChoiceSelections,
                                  nextChoices,
                                ),
                              );
                              setTargetChoiceSelections(nextChoices);
                              setResults([]);
                              setVolleySummary(null);
                              setRollResult(null);
                            }}
                          />
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </details>
            )}
            {targetChoiceWarnings.length > 0 && (
              <div className="loadout-warnings" role="status">
                <strong>Check these target choices</strong>
                <ul>
                  {targetChoiceWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <small>You can keep the override for casualties or narrative rules.</small>
              </div>
            )}
            <label>
              <span>Charge state</span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={attackerCharged}
                  onChange={(event) => setAttackerCharged(event.target.checked)}
                />
                Attacker charged this turn
              </span>
            </label>
            <label>
              <span>Movement state</span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={attackerRemainedStationary}
                  onChange={(event) => setAttackerRemainedStationary(event.target.checked)}
                />
                Attacker remained stationary
              </span>
            </label>
            <label>
              <span>Battle-shock state</span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={attackerBattleShocked}
                  onChange={(event) => setAttackerBattleShocked(event.target.checked)}
                />
                Attacker is Battle-shocked
              </span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={targetBattleShocked}
                  onChange={(event) => setTargetBattleShocked(event.target.checked)}
                />
                Target is Battle-shocked
              </span>
            </label>
            <label>
              <span>Attached-unit state</span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={attackerAttached}
                  onChange={(event) => setAttackerAttached(event.target.checked)}
                />
                Attacker is Attached
              </span>
              <span className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={targetAttached}
                  onChange={(event) => setTargetAttached(event.target.checked)}
                />
                Target is Attached
              </span>
            </label>
            <label>
              <span>Waaagh! benefits</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker is gaining Waaagh! benefits"
                  type="checkbox"
                  checked={attackerWaaaghActive}
                  onChange={(event) => setAttackerWaaaghActive(event.target.checked)}
                />
                Attacker
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is gaining Waaagh! benefits"
                  type="checkbox"
                  checked={targetWaaaghActive}
                  onChange={(event) => setTargetWaaaghActive(event.target.checked)}
                />
                Target
              </span>
            </label>
            <label>
              <span>Oath of Moment</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is the Oath of Moment target"
                  type="checkbox"
                  checked={targetOathOfMoment}
                  onChange={(event) => setTargetOathOfMoment(event.target.checked)}
                />
                Target selected
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker qualifies for the Codex Oath wound bonus"
                  type="checkbox"
                  checked={attackerOathWoundBonusEligible}
                  onChange={(event) => setAttackerOathWoundBonusEligible(event.target.checked)}
                />
                Codex +1 Wound eligible
              </span>
            </label>
            <label>
              <span>Objective marker range</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker is within range of an objective marker"
                  type="checkbox"
                  checked={attackerOnObjective}
                  onChange={(event) => {
                    setAttackerOnObjective(event.target.checked);
                    if (!event.target.checked) setAttackerObjectiveOwner("unknown");
                  }}
                />
                Attacker
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is within range of an objective marker"
                  type="checkbox"
                  checked={targetOnObjective}
                  onChange={(event) => {
                    setTargetOnObjective(event.target.checked);
                    if (!event.target.checked) setTargetObjectiveOwner("unknown");
                  }}
                />
                Target
              </span>
            </label>
            <label>
              <span>Attacker objective controlled by</span>
              <select
                aria-label="Attacker objective owner"
                disabled={!attackerOnObjective}
                value={attackerObjectiveOwner}
                onChange={(event) =>
                  setAttackerObjectiveOwner(event.target.value as ObjectiveOwner)
                }
              >
                <option value="unknown">Unknown</option>
                <option value="attacker">Attacker</option>
                <option value="target">Target</option>
                <option value="uncontrolled">Neither player</option>
              </select>
            </label>
            <label>
              <span>Target objective controlled by</span>
              <select
                aria-label="Target objective owner"
                disabled={!targetOnObjective}
                value={targetObjectiveOwner}
                onChange={(event) => setTargetObjectiveOwner(event.target.value as ObjectiveOwner)}
              >
                <option value="unknown">Unknown</option>
                <option value="attacker">Attacker</option>
                <option value="target">Target</option>
                <option value="uncontrolled">Neither player</option>
              </select>
            </label>
            <label>
              <span>Attacker-selected objective</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker is within range of its selected objective"
                  type="checkbox"
                  checked={attackerOnAttackerSelectedObjective}
                  onChange={(event) => setAttackerOnAttackerSelectedObjective(event.target.checked)}
                />
                Attacker
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is within range of the attacker-selected objective"
                  type="checkbox"
                  checked={targetOnAttackerSelectedObjective}
                  onChange={(event) => setTargetOnAttackerSelectedObjective(event.target.checked)}
                />
                Target
              </span>
            </label>
            <label>
              <span>Target-selected objective</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker is within range of the target-selected objective"
                  type="checkbox"
                  checked={attackerOnTargetSelectedObjective}
                  onChange={(event) => setAttackerOnTargetSelectedObjective(event.target.checked)}
                />
                Attacker
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is within range of its selected objective"
                  type="checkbox"
                  checked={targetOnTargetSelectedObjective}
                  onChange={(event) => setTargetOnTargetSelectedObjective(event.target.checked)}
                />
                Target
              </span>
            </label>
            <label>
              <span>T’au targeting state</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker is Guided against this Spotted target"
                  type="checkbox"
                  checked={attackerGuidedAgainstTarget}
                  onChange={(event) => {
                    setAttackerGuidedAgainstTarget(event.target.checked);
                    if (event.target.checked) setTargetSpotted(true);
                    else setTargetSpottedByMarkerlightObserver(false);
                  }}
                />
                Guided
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is a Spotted unit"
                  type="checkbox"
                  checked={targetSpotted}
                  onChange={(event) => {
                    setTargetSpotted(event.target.checked);
                    if (!event.target.checked) {
                      setAttackerGuidedAgainstTarget(false);
                      setTargetSpottedByMarkerlightObserver(false);
                    }
                  }}
                />
                Spotted
              </span>
              <span className="inline-checkbox">
                <input
                  aria-label="Spotted by an Observer with Markerlight"
                  type="checkbox"
                  checked={targetSpottedByMarkerlightObserver}
                  onChange={(event) => {
                    setTargetSpottedByMarkerlightObserver(event.target.checked);
                    if (event.target.checked) setTargetSpotted(true);
                  }}
                />
                Markerlight
              </span>
            </label>
            <label>
              <span>Target distance</span>
              <input
                aria-label="Target distance in inches"
                type="number"
                min={0}
                max={1000}
                value={targetDistance}
                onChange={(event) =>
                  setTargetDistance(Math.min(1000, Math.max(0, +event.target.value || 0)))
                }
              />
              <small>Inches; 0 means unknown</small>
            </label>
            <label>
              <span>Target relationship</span>
              <span className="inline-checkbox">
                <input
                  aria-label="Target is the closest eligible target"
                  type="checkbox"
                  checked={targetClosestEligible}
                  onChange={(event) => setTargetClosestEligible(event.target.checked)}
                />
                Closest eligible target
              </span>
            </label>
            <label>
              <span>Attacker-side source to target</span>
              <input
                aria-label="Attacker-side source to target distance in inches"
                type="number"
                min={0}
                max={1000}
                value={attackerSourceTargetDistance}
                onChange={(event) =>
                  setAttackerSourceTargetDistance(
                    Math.min(1000, Math.max(0, +event.target.value || 0)),
                  )
                }
              />
              <span className="inline-checkbox">
                <input
                  aria-label="Target visible to attacker-side source"
                  type="checkbox"
                  checked={attackerSourceCanSeeTarget}
                  onChange={(event) => setAttackerSourceCanSeeTarget(event.target.checked)}
                />
                Visible
              </span>
            </label>
            <label>
              <span>Target-side source to attacker</span>
              <input
                aria-label="Target-side source to attacker distance in inches"
                type="number"
                min={0}
                max={1000}
                value={targetSourceAttackerDistance}
                onChange={(event) =>
                  setTargetSourceAttackerDistance(
                    Math.min(1000, Math.max(0, +event.target.value || 0)),
                  )
                }
              />
              <span className="inline-checkbox">
                <input
                  aria-label="Attacker visible to target-side source"
                  type="checkbox"
                  checked={targetSourceCanSeeAttacker}
                  onChange={(event) => setTargetSourceCanSeeAttacker(event.target.checked)}
                />
                Visible
              </span>
            </label>
            <label>
              <span>Models in attacker unit</span>
              <input
                aria-label="Models in the attacker unit"
                type="number"
                min={0}
                max={1000}
                value={attackerUnitModels}
                onChange={(event) =>
                  setAttackerUnitModels(Math.min(1000, Math.max(0, +event.target.value || 0)))
                }
              />
              <small>0 means unknown</small>
            </label>
            <label>
              <span>Nearby enemy models</span>
              <input
                aria-label="Enemy models within the ability range"
                type="number"
                min={0}
                max={1000}
                value={nearbyEnemyModels}
                onChange={(event) =>
                  setNearbyEnemyModels(Math.min(1000, Math.max(0, +event.target.value || 0)))
                }
              />
              <small>Count models within the rule’s stated range</small>
            </label>
            <label>
              <span>Nearby enemy units</span>
              <input
                aria-label="Enemy units within the ability range"
                type="number"
                min={0}
                max={1000}
                value={nearbyEnemyUnits}
                onChange={(event) =>
                  setNearbyEnemyUnits(Math.min(1000, Math.max(0, +event.target.value || 0)))
                }
              />
              <small>Count units within the rule’s stated range</small>
            </label>
            <label>
              <span>Enemy Character models destroyed</span>
              <input
                aria-label="Enemy Character models destroyed by the attacker"
                type="number"
                min={0}
                max={1000}
                value={enemyCharacterModelsDestroyed}
                onChange={(event) =>
                  setEnemyCharacterModelsDestroyed(
                    Math.min(1000, Math.max(0, +event.target.value || 0)),
                  )
                }
              />
            </label>
            <label>
              <span>Fight phases triggering cumulative attack bonus</span>
              <input
                aria-label="Fight phases in which this attacker destroyed enemy units"
                type="number"
                min={0}
                max={1000}
                value={destructiveFightPhases}
                onChange={(event) =>
                  setDestructiveFightPhases(Math.min(1000, Math.max(0, +event.target.value || 0)))
                }
              />
            </label>
            <label>
              <span>Models embarked in attacker transport</span>
              <input
                aria-label="Models embarked in the attacker transport"
                type="number"
                min={0}
                max={1000}
                value={embarkedModels}
                onChange={(event) => {
                  const value = Math.min(1000, Math.max(0, +event.target.value || 0));
                  setEmbarkedModels(value);
                  setEmbarkedWracksModels((current) => Math.min(current, value));
                }}
              />
            </label>
            <label>
              <span>Embarked Wracks models</span>
              <input
                aria-label="Wracks models embarked in the attacker transport"
                type="number"
                min={0}
                max={embarkedModels}
                value={embarkedWracksModels}
                onChange={(event) =>
                  setEmbarkedWracksModels(
                    Math.min(embarkedModels, Math.max(0, +event.target.value || 0)),
                  )
                }
              />
              <small>Must be part of the embarked model count</small>
            </label>
            <label>
              <span>Target unit strength</span>
              <select
                value={targetStrengthState}
                onChange={(event) =>
                  setTargetStrengthState(event.target.value as TargetStrengthState)
                }
              >
                <option value="full">Full strength</option>
                <option value="below_starting">Below Starting Strength</option>
                <option value="below_half">Below Half-strength</option>
              </select>
            </label>
            {targetUnit && (
              <div className="target-sequence">
                <CombatPresetSelector
                  presets={targetFormationUnit?.combatPresets ?? []}
                  role="target"
                  selectedIds={activeTargetPresetIds}
                  onChange={setActiveTargetPresetIds}
                  title="Active defensive abilities"
                  targetDistance={targetDistance}
                  attackerCharged={attackerCharged}
                  attackerRemainedStationary={attackerRemainedStationary}
                  sourceUnitAttached={targetAttached}
                  sourceUnitWaaaghActive={targetWaaaghActive}
                  attackerBattleShocked={attackerBattleShocked}
                  targetBattleShocked={targetBattleShocked}
                  targetStrengthState={targetStrengthState}
                  sourceTargetDistance={targetSourceAttackerDistance}
                  sourceTargetVisible={targetSourceCanSeeAttacker}
                />
                <SupportPresetSelector
                  units={targetSupportUnits}
                  role="target"
                  selectedUnitId={targetSupportUnitId}
                  selectedIds={activeTargetSupportPresetIds}
                  onUnitChange={(unitId) => {
                    setTargetSupportUnitId(unitId);
                    setActiveTargetSupportPresetIds([]);
                    setTargetSupportDistance(0);
                  }}
                  onPresetChange={setActiveTargetSupportPresetIds}
                  supportDistance={targetSupportDistance}
                  onSupportDistanceChange={setTargetSupportDistance}
                  supportedUnitKeywords={targetSegments[0]?.keywords ?? []}
                  attackerCharged={attackerCharged}
                  attackerRemainedStationary={attackerRemainedStationary}
                  attackerBattleShocked={attackerBattleShocked}
                  targetBattleShocked={targetBattleShocked}
                  targetStrengthState={targetStrengthState}
                  sourceTargetDistance={targetSourceAttackerDistance}
                  sourceTargetVisible={targetSourceCanSeeAttacker}
                />
                {targetEquipmentOptions.length > 0 && (
                  <fieldset className="preset-options">
                    <legend>Defensive equipment allocation</legend>
                    <small>
                      Whole-unit effects protect every profile. Bearer counts create separate,
                      reorderable equipped and unequipped target segments.
                    </small>
                    {targetEquipmentOptions
                      .filter((option) => option.scope === "unit")
                      .map((option) => (
                        <label key={option.id} title={option.guidance ?? option.description}>
                          <input
                            type="checkbox"
                            checked={targetSegments.some((segment) =>
                              segment.defensiveEquipmentIds.includes(option.id),
                            )}
                            onChange={(event) =>
                              changeUnitEquipment(option.id, event.target.checked)
                            }
                          />
                          <span>
                            {option.sourceUnitName} · {option.name} (whole unit)
                            <small>{option.description}</small>
                          </span>
                        </label>
                      ))}
                    {targetBearerEquipmentControls.map(({ option, unitId, modelId, modelName }) => {
                      const count = bearerEquipmentCount(
                        targetSegments,
                        unitId,
                        modelId,
                        option.id,
                      );
                      const maximum = bearerEquipmentAvailableCount(
                        targetSegments,
                        unitId,
                        modelId,
                        option.id,
                        bearerEquipmentIds,
                      );
                      return (
                        <label
                          key={`${option.id}:${modelId}`}
                          title={option.guidance ?? option.description}
                        >
                          <span>
                            {option.sourceUnitName} · {modelName} · {option.name}
                            <small>{option.description}</small>
                          </span>
                          <input
                            aria-label={`${option.sourceUnitName} ${modelName} ${option.name} bearers`}
                            type="number"
                            min={0}
                            max={maximum}
                            value={count}
                            onChange={(event) =>
                              changeBearerEquipment(
                                unitId,
                                modelId,
                                option.id,
                                Math.min(maximum, Math.max(0, +event.target.value || 0)),
                              )
                            }
                          />
                        </label>
                      );
                    })}
                  </fieldset>
                )}
                <div className="sequence-heading">
                  <div>
                    <h3>Damage allocation order</h3>
                    <small>First surviving profile receives the next attack</small>
                  </div>
                  <button
                    type="button"
                    disabled={targetSegments.length >= 16}
                    onClick={() => {
                      const option = targetModelOptions[0];
                      if (option)
                        setTargetSegments((current) => [
                          ...current,
                          targetSegment(option.model, 1, option.unit.id),
                        ]);
                    }}
                  >
                    Add profile
                  </button>
                </div>
                {targetSegments.map((segment, index) => (
                  <article className="target-segment" key={segment.id}>
                    <div className="sequence-heading">
                      <strong>{index + 1}</strong>
                      <select
                        aria-label={`Target profile ${index + 1}`}
                        value={segment.modelId}
                        onChange={(event) => {
                          const option = targetModelOptions.find(
                            (entry) => entry.model.id === +event.target.value,
                          );
                          if (!option) return;
                          setTargetSegments((current) =>
                            current.map((entry) =>
                              entry.id === segment.id
                                ? {
                                    ...targetSegment(
                                      option.model,
                                      entry.modelCount,
                                      option.unit.id,
                                    ),
                                    id: entry.id,
                                  }
                                : entry,
                            ),
                          );
                          if (index === 0) setInitialWoundsLost(0);
                        }}
                      >
                        {targetFormationUnits.map((unit) => (
                          <optgroup key={unit.id} label={unit.name}>
                            {unit.models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="order-actions">
                        <button
                          type="button"
                          aria-label={`Move ${segment.name} earlier`}
                          disabled={index === 0}
                          onClick={() => moveTarget(segment.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${segment.name} later`}
                          disabled={index === targetSegments.length - 1}
                          onClick={() => moveTarget(segment.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={targetSegments.length === 1}
                          onClick={() =>
                            setTargetSegments((current) =>
                              current.filter((entry) => entry.id !== segment.id),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {segment.defensiveEquipmentIds.length > 0 && (
                      <small>
                        Equipped:{" "}
                        {segment.defensiveEquipmentIds
                          .map(
                            (id) =>
                              targetEquipmentOptions.find((option) => option.id === id)?.name ?? id,
                          )
                          .join(", ")}
                      </small>
                    )}
                    <div className="stat-row target-stats">
                      {(
                        [
                          ["modelCount", "Models"],
                          ["toughness", "T"],
                          ["save", "Save"],
                          ["invulnerable", "Invuln"],
                          ["wounds", "W/model"],
                          ["feelNoPain", "FNP"],
                          ["reduction", "-Damage"],
                          ["damageDivisor", "÷Damage"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <span>{label}</span>
                          <input
                            type="number"
                            min={["invulnerable", "feelNoPain", "reduction"].includes(key) ? 0 : 1}
                            max={key === "modelCount" ? 1000 : undefined}
                            value={segment[key]}
                            onChange={(event) => {
                              const value = Math.max(
                                ["invulnerable", "feelNoPain", "reduction"].includes(key) ? 0 : 1,
                                +event.target.value,
                              );
                              setTargetSegments((current) =>
                                current.map((entry) =>
                                  entry.id === segment.id ? { ...entry, [key]: value } : entry,
                                ),
                              );
                              if (index === 0 && key === "wounds") {
                                setInitialWoundsLost((current) => Math.min(current, value - 1));
                              }
                            }}
                          />
                        </label>
                      ))}
                      {index === 0 && (
                        <>
                          <label>
                            <span>First failed save replacement</span>
                            <input
                              type="checkbox"
                              checked={segment.firstFailedSaveDamageReplacement !== null}
                              onChange={(event) =>
                                setTargetSegments((current) =>
                                  current.map((entry) => ({
                                    ...entry,
                                    firstFailedSaveDamageReplacement: event.target.checked
                                      ? 0
                                      : null,
                                  })),
                                )
                              }
                            />
                          </label>
                          {segment.firstFailedSaveDamageReplacement !== null && (
                            <label>
                              <span>First failed save Damage</span>
                              <input
                                type="number"
                                min={0}
                                max={1024}
                                value={segment.firstFailedSaveDamageReplacement}
                                onChange={(event) =>
                                  setTargetSegments((current) =>
                                    current.map((entry) => ({
                                      ...entry,
                                      firstFailedSaveDamageReplacement: Math.max(
                                        0,
                                        +event.target.value,
                                      ),
                                    })),
                                  )
                                }
                              />
                            </label>
                          )}
                          <label>
                            <span>Allocated-attack replacement</span>
                            <input
                              type="checkbox"
                              checked={segment.allocatedAttackDamageReplacementUses > 0}
                              onChange={(event) =>
                                setTargetSegments((current) =>
                                  current.map((entry) => ({
                                    ...entry,
                                    allocatedAttackDamageReplacementUses: event.target.checked
                                      ? 1
                                      : 0,
                                  })),
                                )
                              }
                            />
                          </label>
                          {segment.allocatedAttackDamageReplacementUses > 0 && (
                            <>
                              <label>
                                <span>Allocated attack Damage</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={1024}
                                  value={segment.allocatedAttackDamageReplacement}
                                  onChange={(event) =>
                                    setTargetSegments((current) =>
                                      current.map((entry) => ({
                                        ...entry,
                                        allocatedAttackDamageReplacement: Math.max(
                                          0,
                                          +event.target.value,
                                        ),
                                      })),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                <span>Uses this sequence</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={1024}
                                  value={segment.allocatedAttackDamageReplacementUses}
                                  onChange={(event) =>
                                    setTargetSegments((current) =>
                                      current.map((entry) => ({
                                        ...entry,
                                        allocatedAttackDamageReplacementUses: Math.max(
                                          1,
                                          +event.target.value,
                                        ),
                                      })),
                                    )
                                  }
                                />
                              </label>
                              <label>
                                <span>Allocated attacks to skip</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={1024}
                                  value={segment.allocatedAttackDamageReplacementSkip}
                                  onChange={(event) =>
                                    setTargetSegments((current) =>
                                      current.map((entry) => ({
                                        ...entry,
                                        allocatedAttackDamageReplacementSkip: Math.max(
                                          0,
                                          +event.target.value,
                                        ),
                                      })),
                                    )
                                  }
                                />
                              </label>
                              <p>Skips those attacks, then spends one use per allocated attack.</p>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {targetSegments[0] && (
                  <label>
                    <span>
                      Wounds already lost on first model
                      <small>
                        Carried into the first attack; damage cannot spill between models
                      </small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={targetSegments[0].wounds - 1}
                      value={initialWoundsLost}
                      onChange={(event) =>
                        setInitialWoundsLost(
                          Math.max(0, Math.min(targetSegments[0].wounds - 1, +event.target.value)),
                        )
                      }
                    />
                  </label>
                )}
              </div>
            )}
            {targetUnit && targetUnit.composition.length > 0 && (
              <details className="source-guidance" open>
                <summary>Unit composition</summary>
                <ul>
                  {targetUnit.composition.map((line, index) => (
                    <li key={`${line.text}-${index}`}>{line.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      </div>
      <section className="volley-results">
        {orderedLines.length > 0 && (
          <div className="volley-order">
            <div className="sequence-heading">
              <div>
                <span>Attack sequence</span>
                <strong>Weapon order changes who receives later attacks</strong>
              </div>
            </div>
            {orderedLines.map((line, index) => (
              <div key={line.weapon.id}>
                <span>
                  {index + 1}. {line.count} × {line.weapon.name}
                  {line.firingDeck
                    ? ` · Firing Deck from ${line.firingDeck.passengerUnitName}`
                    : ""}
                </span>
                <div className="order-actions">
                  <button
                    type="button"
                    aria-label={`Move ${line.weapon.name} earlier`}
                    disabled={index === 0}
                    onClick={() => moveWeapon(line.weapon.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${line.weapon.name} later`}
                    disabled={index === orderedLines.length - 1}
                    onClick={() => moveWeapon(line.weapon.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          className="primary-action"
          type="button"
          disabled={!attackerUnit || !targetUnit}
          onClick={() => calculateUnit(false)}
        >
          Calculate full volley
        </button>
        {complexityKey === inputKey && complexity && (
          <div
            className={`complexity-report ${
              complexity.usesDeferredStates && !complexity.exactGuaranteedByBound
                ? "complexity-warning"
                : ""
            }`}
          >
            <div>
              <span>Exact calculation complexity</span>
              <strong>
                {complexity.usesDeferredStates
                  ? complexity.exactGuaranteedByBound
                    ? "Within sparse-state bound"
                    : "May exceed sparse-state bound"
                  : "Standard exact distribution"}
              </strong>
              <small>
                {complexity.usesDeferredStates
                  ? `Prefix-aware upper bound ${complexity.estimatedStateUpperBound.toLocaleString()} · engine budget ${complexity.stateLimit.toLocaleString()}${resultsAreCurrent && volleySummary ? ` · observed peak ${volleySummary.peakSparseStates.toLocaleString()}` : ""}`
                  : `${complexity.targetCapacity + 1} possible applied-damage totals`}
              </small>
            </div>
            {complexity.usesDeferredStates && !complexity.exactGuaranteedByBound && (
              <div className="complexity-actions">
                <button type="button" onClick={() => calculateUnit(true)}>
                  Try exact anyway
                </button>
                <button type="button" className="secondary-action" onClick={runPhaseSimulation}>
                  Use seeded simulation
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className="secondary-action"
          type="button"
          disabled={!attackerUnit || !targetUnit}
          onClick={rollUnit}
        >
          Roll full volley
        </button>
        <div className="phase-controls">
          <label>
            <span>Simulation seed</span>
            <input
              type="number"
              min={0}
              max={0xffff_ffff}
              value={simulationSeed}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setSimulationSeed(
                  Number.isFinite(value)
                    ? Math.max(0, Math.min(0xffff_ffff, Math.trunc(value)))
                    : 0,
                );
              }}
            />
          </label>
          <label>
            <span>Repeated volleys</span>
            <input
              type="number"
              min={100}
              max={100_000}
              step={100}
              value={simulationTrials}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setSimulationTrials(
                  Number.isFinite(value)
                    ? Math.max(100, Math.min(100_000, Math.trunc(value)))
                    : 100,
                );
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const value = new Uint32Array(1);
              crypto.getRandomValues(value);
              setSimulationSeed(value[0]);
            }}
          >
            New seed
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!attackerUnit || !targetUnit}
            onClick={runPhaseSimulation}
          >
            Simulate phase
          </button>
        </div>
        <div className="volley-total">
          <span>Expected applied damage after ordered allocation</span>
          <strong>{resultsAreCurrent ? volleySummary?.mean.toFixed(2) : "—"}</strong>
        </div>
        {resultsAreCurrent && volleySummary && (
          <div className="volley-distribution">
            <span>Median {volleySummary.median}</span>
            <span>
              Middle half {volleySummary.firstQuartile}–{volleySummary.thirdQuartile}
            </span>
            <span>
              Range {volleySummary.minimum}–{volleySummary.maximum}
            </span>
          </div>
        )}
        {resultsAreCurrent && results.length > 0 && volleySummary && (
          <div className="result-lines">
            {results.map((line, index) => (
              <div key={`${line.weapon.id}-${line.sourceEquipmentLabel ?? "base"}`}>
                <span>
                  {index + 1}. {line.count} × {line.weapon.name}
                  {line.sourceEquipmentLabel ? ` · ${line.sourceEquipmentLabel}` : ""}
                  {line.firingDeck
                    ? ` · Firing Deck from ${line.firingDeck.passengerUnitName}`
                    : ""}
                </span>
                <b>{line.incrementalMean?.toFixed(2)} expected damage added</b>
                <small>{line.cumulativeMean?.toFixed(2)} cumulative after this profile</small>
              </div>
            ))}
          </div>
        )}
        {rollIsCurrent && rollResult && (
          <section className="volley-roll" aria-live="polite">
            <div className="sequence-heading">
              <div>
                <span>Rolled result</span>
                <strong>{rollResult.appliedDamage} damage applied</strong>
              </div>
              <small>{rollResult.modelsDestroyed} models destroyed</small>
            </div>
            <div className="roll-summary-grid">
              <span>
                <b>{rollResult.attacksResolved}</b> attacks
              </span>
              <span>
                <b>{rollResult.hits}</b> hits
              </span>
              <span>
                <b>{rollResult.criticalHits}</b> critical hits
              </span>
              <span>
                <b>{rollResult.woundingAttacks}</b> wounds
              </span>
              <span>
                <b>{rollResult.savedAttacks}</b> saved
              </span>
              <span>
                <b>{rollResult.fnpPrevented}</b> FNP prevented
              </span>
              <span>
                <b>{rollResult.successfulAttacks}</b> damaging attacks
              </span>
              <span>
                <b>{rollResult.wastedDamage}</b> damage lost
              </span>
            </div>
            <div className="result-lines">
              {rollResult.lines.map((line, index) => (
                <div
                  key={`${calculationLines[index]?.weapon.id ?? index}-${calculationLines[index]?.sourceEquipmentLabel ?? "base"}-roll`}
                >
                  <span>
                    {index + 1}. {calculationLines[index]?.weapon.name ?? "Weapon"}
                    {calculationLines[index]?.sourceEquipmentLabel
                      ? ` · ${calculationLines[index].sourceEquipmentLabel}`
                      : ""}
                  </span>
                  <b>{line.appliedDamage} damage applied</b>
                  <small>
                    {line.hits} hits · {line.woundingAttacks} wounds · {line.savedAttacks} saved ·{" "}
                    {line.fnpPrevented} FNP
                  </small>
                </div>
              ))}
            </div>
          </section>
        )}
        {phaseIsCurrent && phaseResult && (
          <section className="phase-results" aria-live="polite">
            <div className="sequence-heading">
              <div>
                <span>Seeded phase result</span>
                <strong>{phaseResult.mean.toFixed(2)} mean applied damage</strong>
              </div>
              <small>
                Seed {phaseResult.seed} · {phaseResult.trials.toLocaleString()} volleys
              </small>
            </div>
            <div className="roll-summary-grid">
              <span>
                <b>{(phaseResult.unitDestroyedChance * 100).toFixed(1)}%</b> unit destroyed
              </span>
              <span>
                <b>{(phaseResult.zeroDamageChance * 100).toFixed(1)}%</b> zero damage
              </span>
              <span>
                <b>{phaseResult.standardDeviation.toFixed(2)}</b> standard deviation
              </span>
              <span>
                <b>{phaseResult.meanModelsDestroyed.toFixed(2)}</b> models destroyed
              </span>
              <span>
                <b>{phaseResult.means.hits.toFixed(2)}</b> mean hits
              </span>
              <span>
                <b>{phaseResult.means.woundingAttacks.toFixed(2)}</b> mean wounds
              </span>
              <span>
                <b>{phaseResult.means.savedAttacks.toFixed(2)}</b> mean saves
              </span>
              <span>
                <b>{phaseResult.means.fnpPrevented.toFixed(2)}</b> mean FNP prevented
              </span>
            </div>
            <div className="volley-distribution">
              <span>Median {phaseResult.median}</span>
              <span>
                Middle half {phaseResult.firstQuartile}–{phaseResult.thirdQuartile}
              </span>
              <span>
                Range {phaseResult.minimum}–{phaseResult.maximum}
              </span>
            </div>
            <div className="phase-histogram" aria-label="Applied damage frequency distribution">
              {phaseResult.histogram.map((bucket) => (
                <div key={bucket.damage}>
                  <span>{bucket.damage}</span>
                  <i style={{ width: `${bucket.probability * 100}%` }} />
                  <b>{(bucket.probability * 100).toFixed(1)}%</b>
                </div>
              ))}
            </div>
            <small className="simulation-replay">
              Reuse this seed, trial count, weapon order, and target order to reproduce the same
              result. Live rolls remain cryptographically random.
            </small>
          </section>
        )}
      </section>
    </main>
  );
}
