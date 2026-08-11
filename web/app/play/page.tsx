"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { CombatPresetSelector } from "../../components/combat-preset-selector";
import { SupportPresetSelector } from "../../components/support-preset-selector";
import { fetchArmyLists, type ArmyListRecord } from "../../lib/army-list";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  simulateOrderedVolley,
  type CombatProfile,
  type OrderedVolleyRollResult,
  type RollResult,
} from "../../lib/combat";
import { applyFireOverwatchAttackRules } from "../../lib/fire-overwatch.mjs";
import {
  activeBattleAttacks,
  advanceBattleClock,
  appendResolvedAttack,
  arriveFromReserves,
  battleCanResolveAttack,
  battleFormation,
  battleFormationIsOnBattlefield,
  battleUnusedWeaponCount,
  battleFormationHealth,
  battleFormationWasTargeted,
  changeBattleResource,
  completeFormationMovement,
  completeFormationActivation,
  configureBattleWeaponBearers,
  configureBattleMission,
  configureUnengagedBattleFormation,
  createBattleState,
  declareFormationCharge,
  declareFormationDeployment,
  deployFormation,
  disembarkFormation,
  embarkFormation,
  normalizeBattleState,
  passFightPriority,
  passFireOverwatch,
  passHeroicIntervention,
  recordFormationCharge,
  recordFightMove,
  recordRangedTargetEligibility,
  replayBattleState,
  rollChargeDice,
  resolveDestroyedTransport,
  resolveBattleChoice,
  resolveHeroicIntervention,
  revertLatestAttack,
  scoreBattlePoints,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
  startFireOverwatch,
  startFormationMovement,
  startFormationActivation,
} from "../../lib/battle-state.mjs";
import { battleClockLabel } from "../../lib/battle-clock.mjs";
import { battleRosterRevisionsMatch, initializeBattleForLists } from "../../lib/battle-setup.mjs";
import {
  applyCombatPresets,
  applyTargetProfile,
  applyWeaponProfile,
  loadCatalogue,
  type Catalogue,
} from "../../lib/catalogue";
import { groupWeaponProfiles } from "../../lib/loadout.mjs";
import {
  applyTargetCombatPresets,
  attackKeywordsForWeapon,
  selectedAndAutomaticCombatPresets,
  sourceEquipmentWeaponLineSegments,
  unavailableSourceEquipmentCombatPresetIds,
} from "../../lib/combat-presets.mjs";
import {
  createPlayRecovery,
  parsePlayRecovery,
  PLAY_RECOVERY_KEY,
} from "../../lib/play-recovery.mjs";
import { firingDeckWeapons, resolveFiringDeckSelection } from "../../lib/firing-deck.mjs";
import { transportAssignmentReport } from "../../lib/transport.mjs";
import {
  savedFormationForUnit,
  savedFormationDefensiveEquipmentDefaults,
  savedFormationCombatPresetIds,
  savedFormationCombatPresetSourceUnitIds,
  savedFormationGroups,
  savedFormationModelSegments,
  savedFormationTargetSequence,
  savedFormationBattleRegistration,
  applyBattleHealthToTargetSequence,
  battleTargetSequence,
  savedUnitDefensiveEquipmentWarnings,
  savedUnitCombatPresetIds,
} from "../../lib/formations.mjs";
import {
  applyDefensiveEquipmentTargets,
  defensiveEquipmentSelectionKey,
} from "../../lib/defensive-equipment.mjs";
import {
  reconcileActiveLimitedAbilityUses,
  withoutLimitedAbilityPresetIds,
} from "../../lib/ability-uses.mjs";

type LogEntry = {
  id: string;
  attacker: string;
  weapon: string;
  target: string;
  damage: number;
  successful: number;
};

type AttackCountContext = Pick<
  CombatProfile,
  | "nearbyEnemyUnits"
  | "enemyCharacterModelsDestroyed"
  | "destructiveFightPhases"
  | "embarkedModels"
  | "embarkedWracksModels"
>;

function firingDeckWeaponValue(passengerUnitId: string, weaponId: number) {
  return `fd:${passengerUnitId}:${weaponId}`;
}

function parseFiringDeckWeaponValue(value: string) {
  const match = /^fd:([^:]+):(\d+)$/.exec(value);
  return match ? { passengerUnitId: match[1], weaponId: Number(match[2]) } : null;
}

function formationWeaponValue(savedUnitId: string, weaponId: number) {
  return `fm:${savedUnitId}:${weaponId}`;
}

function parseFormationWeaponValue(value: string) {
  const match = /^fm:([^:]+):(\d+)$/.exec(value);
  return match ? { savedUnitId: match[1], weaponId: Number(match[2]) } : null;
}

export default function PlayMode() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [lists, setLists] = useState<ArmyListRecord[]>([]);
  const [attackerListId, setAttackerListId] = useState("");
  const [targetListId, setTargetListId] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [weaponId, setWeaponId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [firingDeckModels, setFiringDeckModels] = useState(1);
  const [firingDeckPassengerAlreadyShot, setFiringDeckPassengerAlreadyShot] = useState(false);
  const [targetModelId, setTargetModelId] = useState("");
  const [targetDefensiveEquipmentCounts, setTargetDefensiveEquipmentCounts] = useState<
    Record<string, number>
  >({});
  const [activeAttackerPresetIds, setActiveAttackerPresetIds] = useState<string[]>([]);
  const [activeTargetPresetIds, setActiveTargetPresetIds] = useState<string[]>([]);
  const [supportUnitId, setSupportUnitId] = useState("");
  const [activeSupportPresetIds, setActiveSupportPresetIds] = useState<string[]>([]);
  const [targetSupportUnitId, setTargetSupportUnitId] = useState("");
  const [activeTargetSupportPresetIds, setActiveTargetSupportPresetIds] = useState<string[]>([]);
  const [abilityUsesSpent, setAbilityUsesSpent] = useState<Record<string, Record<string, number>>>(
    {},
  );
  const [profile, setProfile] = useState<CombatProfile>(DEFAULT_PROFILE);
  const [result, setResult] = useState<RollResult | OrderedVolleyRollResult | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [battleState, setBattleState] = useState<ReturnType<typeof createBattleState> | null>(null);
  const [battleSetupError, setBattleSetupError] = useState("");
  const [pendingChoiceSelections, setPendingChoiceSelections] = useState<Record<string, string[]>>(
    {},
  );
  const [status, setStatus] = useState("Select two saved lists");
  const [targetEligibilityConfirmationKey, setTargetEligibilityConfirmationKey] = useState("");
  const [actionEligibilityOverride, setActionEligibilityOverride] = useState(false);
  const [actionOverrideReason, setActionOverrideReason] = useState("");
  const [fightsFirstOverride, setFightsFirstOverride] = useState(false);
  const [chargeDice, setChargeDice] = useState<[number, number]>([3, 4]);
  const [chargeRollModifier, setChargeRollModifier] = useState(0);
  const [chargeDistance, setChargeDistance] = useState(7);
  const [chargeTargetDistance, setChargeTargetDistance] = useState(7);
  const [chargeMaximumModelMove, setChargeMaximumModelMove] = useState(7);
  const [chargeRollOverrideReason, setChargeRollOverrideReason] = useState("");
  const [chargeFailureReason, setChargeFailureReason] = useState("");
  const [chargeMovementReviewReason, setChargeMovementReviewReason] = useState("");
  const [chargeFacts, setChargeFacts] = useState({
    phaseStartEligible: false,
    startedOutsideEngagementRange: false,
    targetEndsWithinEngagementRange: false,
    unitCoherency: false,
    nonTargetsAvoided: false,
    allModelsCloser: false,
    baseContactMaximized: false,
    reviewedByPlayer: false,
  });
  const [fireOverwatchFormationId, setFireOverwatchFormationId] = useState("");
  const [fireOverwatchDistance, setFireOverwatchDistance] = useState(24);
  const [fireOverwatchCommandPointCost, setFireOverwatchCommandPointCost] = useState(1);
  const [fireOverwatchCostOverrideReason, setFireOverwatchCostOverrideReason] = useState("");
  const [fireOverwatchUsageOverrideReason, setFireOverwatchUsageOverrideReason] = useState("");
  const [fireOverwatchEligibilityOverrideReason, setFireOverwatchEligibilityOverrideReason] =
    useState("");
  const [fireOverwatchTargetVisible, setFireOverwatchTargetVisible] = useState(false);
  const [fireOverwatchEligibilityConfirmed, setFireOverwatchEligibilityConfirmed] = useState(false);
  const [fireOverwatchEligibilityReason, setFireOverwatchEligibilityReason] = useState("");
  const [fireOverwatchOutOfPhaseConfirmed, setFireOverwatchOutOfPhaseConfirmed] = useState(false);
  const [fireOverwatchOutOfPhaseReason, setFireOverwatchOutOfPhaseReason] = useState("");
  const [fireOverwatchPassReason, setFireOverwatchPassReason] = useState("");
  const [heroicFormationId, setHeroicFormationId] = useState("");
  const [heroicDice, setHeroicDice] = useState<[number, number]>([3, 4]);
  const [heroicRollModifier, setHeroicRollModifier] = useState(0);
  const [heroicDistance, setHeroicDistance] = useState(7);
  const [heroicStartDistance, setHeroicStartDistance] = useState(6);
  const [heroicMaximumModelMove, setHeroicMaximumModelMove] = useState(5);
  const [heroicCommandPointCost, setHeroicCommandPointCost] = useState(1);
  const [heroicCostOverrideReason, setHeroicCostOverrideReason] = useState("");
  const [heroicUsageOverrideReason, setHeroicUsageOverrideReason] = useState("");
  const [heroicEligibilityOverrideReason, setHeroicEligibilityOverrideReason] = useState("");
  const [heroicRollOverrideReason, setHeroicRollOverrideReason] = useState("");
  const [heroicFailureReason, setHeroicFailureReason] = useState("");
  const [heroicMovementReviewReason, setHeroicMovementReviewReason] = useState("");
  const [heroicPassReason, setHeroicPassReason] = useState("");
  const [heroicFacts, setHeroicFacts] = useState({
    targetEligibilityConfirmed: false,
    startedOutsideEngagementRange: false,
    endsWithinEngagementRange: false,
    unitCoherencyConfirmed: false,
    nonTargetEngagementRangeAvoided: false,
    allModelsCloserToTarget: false,
    baseContactMaximized: false,
    movementReviewedByPlayer: false,
  });
  const [fightMoveDestination, setFightMoveDestination] = useState("enemy");
  const [fightMaximumModelMove, setFightMaximumModelMove] = useState(3);
  const [fightMovementReviewReason, setFightMovementReviewReason] = useState("");
  const [fightOutcomeReason, setFightOutcomeReason] = useState("");
  const [fightObjectiveId, setFightObjectiveId] = useState("");
  const [fightMeleeAttacksComplete, setFightMeleeAttacksComplete] = useState(false);
  const [fightMeleeAttacksCompletionReason, setFightMeleeAttacksCompletionReason] = useState("");
  const [fightMoveFacts, setFightMoveFacts] = useState({
    reviewedByPlayer: false,
    baseContactModelsStationary: false,
    unitCoherency: false,
    endsWithinEngagementRange: false,
    allMovedModelsCloserToEnemy: false,
    baseContactMaximized: false,
    endsWithinObjectiveRange: false,
    allMovedModelsCloserToObjective: false,
  });
  const [deploymentPlacementConfirmed, setDeploymentPlacementConfirmed] = useState(false);
  const [deploymentPlacementReason, setDeploymentPlacementReason] = useState("");
  const [reservePlacementConfirmed, setReservePlacementConfirmed] = useState(false);
  const [reservePlacementReason, setReservePlacementReason] = useState("");
  const [transportPlacementConfirmed, setTransportPlacementConfirmed] = useState(false);
  const [transportPlacementReason, setTransportPlacementReason] = useState("");
  const [deadlyDemiseResolvedConfirmed, setDeadlyDemiseResolvedConfirmed] = useState(false);
  const [destroyedTransportOptions, setDestroyedTransportOptions] = useState<
    Record<string, { emergency: boolean; unplacedModels: number; firstSegmentId: string }>
  >({});
  const [recoveryReady, setRecoveryReady] = useState(false);
  const recovered = useRef(false);
  const migrateLegacyLimitedUses = useRef(false);
  const suppressRecoverySave = useRef(false);
  const latestResult = useRef<HTMLElement>(null);
  const importBattleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([loadCatalogue(), fetchArmyLists()])
      .then(([profiles, saved]) => {
        setCatalogue(profiles);
        setLists(saved);
        setStatus(recovered.current ? "Recovered battle · autosave on" : "Battle console ready");
      })
      .catch(() => setStatus("Saved lists are unavailable in this deployment"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(PLAY_RECOVERY_KEY);
        if (raw) {
          const rawRecovery = JSON.parse(raw);
          migrateLegacyLimitedUses.current = rawRecovery.version === 1;
          const saved = parsePlayRecovery(rawRecovery) as unknown as {
            attackerListId: string;
            targetListId: string;
            attackerUnitId: string;
            targetUnitId: string;
            weaponId: string;
            profileId: string;
            targetModelId: string;
            firingDeckModels: number;
            firingDeckPassengerAlreadyShot: boolean;
            profile: unknown;
            history: LogEntry[];
            activeAttackerPresetIds: string[];
            activeTargetPresetIds: string[];
            supportUnitId: string;
            activeSupportPresetIds: string[];
            targetSupportUnitId: string;
            activeTargetSupportPresetIds: string[];
            abilityUsesSpent: Record<string, Record<string, number>>;
            targetDefensiveEquipmentCounts: Record<string, number>;
            battleState: ReturnType<typeof createBattleState> | null;
          };
          setAttackerListId(saved.attackerListId);
          setTargetListId(saved.targetListId);
          setAttackerUnitId(saved.attackerUnitId);
          setTargetUnitId(saved.targetUnitId);
          setWeaponId(saved.weaponId);
          setProfileId(saved.profileId);
          setTargetModelId(saved.targetModelId);
          setFiringDeckModels(saved.firingDeckModels);
          setFiringDeckPassengerAlreadyShot(saved.firingDeckPassengerAlreadyShot);
          setActiveAttackerPresetIds(saved.activeAttackerPresetIds);
          setActiveTargetPresetIds(saved.activeTargetPresetIds);
          setSupportUnitId(saved.supportUnitId);
          setActiveSupportPresetIds(saved.activeSupportPresetIds);
          setTargetSupportUnitId(saved.targetSupportUnitId);
          setActiveTargetSupportPresetIds(saved.activeTargetSupportPresetIds);
          setAbilityUsesSpent(saved.abilityUsesSpent);
          setTargetDefensiveEquipmentCounts(saved.targetDefensiveEquipmentCounts);
          setBattleState(saved.battleState);
          setProfile(normalizeProfile(saved.profile));
          setHistory(saved.history);
          recovered.current = true;
        }
      } catch {
        window.localStorage.removeItem(PLAY_RECOVERY_KEY);
        setStatus("Ignored invalid recovered battle data");
      } finally {
        setRecoveryReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!recoveryReady) return;
    if (suppressRecoverySave.current) {
      suppressRecoverySave.current = false;
      return;
    }
    const saved = createPlayRecovery({
      attackerListId,
      targetListId,
      attackerUnitId,
      targetUnitId,
      weaponId,
      profileId,
      targetModelId,
      firingDeckModels,
      firingDeckPassengerAlreadyShot,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      supportUnitId,
      activeSupportPresetIds,
      targetSupportUnitId,
      activeTargetSupportPresetIds,
      abilityUsesSpent,
      targetDefensiveEquipmentCounts,
      profile,
      history,
      battleState,
    });
    window.localStorage.setItem(PLAY_RECOVERY_KEY, JSON.stringify(saved));
  }, [
    attackerListId,
    activeAttackerPresetIds,
    activeTargetPresetIds,
    activeSupportPresetIds,
    activeTargetSupportPresetIds,
    attackerUnitId,
    history,
    battleState,
    profile,
    profileId,
    recoveryReady,
    targetListId,
    targetModelId,
    firingDeckModels,
    firingDeckPassengerAlreadyShot,
    targetUnitId,
    supportUnitId,
    targetSupportUnitId,
    abilityUsesSpent,
    targetDefensiveEquipmentCounts,
    weaponId,
  ]);

  const retainBattleForLists = (nextAttackerListId: string, nextTargetListId: string) => {
    const listIds = battleState?.players?.map((player) => player.listId) ?? [];
    return (
      listIds.length === 2 &&
      listIds.includes(nextAttackerListId) &&
      listIds.includes(nextTargetListId) &&
      (nextAttackerListId !== nextTargetListId ||
        listIds.every((listId) => listId === nextAttackerListId))
    );
  };

  const resetBattleForChangedLists = (nextAttackerListId: string, nextTargetListId: string) => {
    if (retainBattleForLists(nextAttackerListId, nextTargetListId)) return;
    setBattleState(null);
    setPendingChoiceSelections({});
    setActionEligibilityOverride(false);
    setActionOverrideReason("");
    setFightsFirstOverride(false);
    setChargeDice([3, 4]);
    setChargeRollModifier(0);
    setChargeDistance(7);
    setHistory([]);
  };

  const attackerList = lists.find((list) => list.id === attackerListId);
  const targetList = lists.find((list) => list.id === targetListId);
  const currentRulesSnapshot = catalogue
    ? `${catalogue.sourceUpdatedAt}:${catalogue.leaderFormationRules.sourceSha256}`
    : "";
  const battleRulesMatch = !battleState || battleState.rulesSnapshot === currentRulesSnapshot;
  const battleRostersMatch =
    !battleState ||
    !attackerList ||
    !targetList ||
    battleRosterRevisionsMatch(battleState, attackerList, targetList);
  const attackerFormations =
    catalogue && attackerList ? savedFormationGroups(catalogue, attackerList) : [];
  const targetFormations =
    catalogue && targetList ? savedFormationGroups(catalogue, targetList) : [];
  const attackerFormation =
    attackerFormations.find((formation) => formation.id === attackerUnitId) ??
    (catalogue && attackerList
      ? savedFormationForUnit(catalogue, attackerList, attackerUnitId)
      : undefined);
  const targetFormation =
    targetFormations.find((formation) => formation.id === targetUnitId) ??
    (catalogue && targetList
      ? savedFormationForUnit(catalogue, targetList, targetUnitId)
      : undefined);
  const attackerUnit = attackerFormation?.root;
  const targetUnit = targetFormation?.root;
  const attackerSelectionId = attackerFormation?.id ?? attackerUnitId;
  const targetSelectionId = targetFormation?.id ?? targetUnitId;
  const firingDeckChoice = parseFiringDeckWeaponValue(weaponId);
  const formationWeaponChoice = parseFormationWeaponValue(weaponId);
  const firingDeckPassengerUnit = attackerList?.units.find(
    (unit) => unit.id === firingDeckChoice?.passengerUnitId,
  );
  const formationWeaponUnit = attackerList?.units.find(
    (unit) => unit.id === formationWeaponChoice?.savedUnitId,
  );
  const selectedWeapon = (
    firingDeckPassengerUnit ??
    formationWeaponUnit ??
    attackerUnit
  )?.weapons.find(
    (weapon) =>
      String(weapon.weaponId) ===
      String(firingDeckChoice?.weaponId ?? formationWeaponChoice?.weaponId ?? weaponId),
  );
  const weaponSourceArmyUnit = firingDeckPassengerUnit ?? formationWeaponUnit ?? attackerUnit;
  const attackerCatalogueUnit = catalogue?.units.find((unit) => unit.id === attackerUnit?.unitId);
  const firingDeckPassengerCatalogueUnit = catalogue?.units.find(
    (unit) => unit.id === firingDeckPassengerUnit?.unitId,
  );
  const formationWeaponCatalogueUnit = catalogue?.units.find(
    (unit) => unit.id === formationWeaponUnit?.unitId,
  );
  const weaponSourceCatalogueUnit = firingDeckChoice
    ? firingDeckPassengerCatalogueUnit
    : formationWeaponChoice
      ? formationWeaponCatalogueUnit
      : attackerCatalogueUnit;
  const targetCatalogueUnit = catalogue?.units.find((unit) => unit.id === targetUnit?.unitId);
  const attackerFormationCatalogueUnit = attackerCatalogueUnit
    ? {
        ...attackerCatalogueUnit,
        combatPresets:
          attackerFormation?.components.flatMap(
            (component) => component.catalogueUnit?.combatPresets ?? [],
          ) ?? attackerCatalogueUnit.combatPresets,
      }
    : undefined;
  const targetFormationCatalogueUnit = targetCatalogueUnit
    ? {
        ...targetCatalogueUnit,
        combatPresets:
          targetFormation?.components.flatMap(
            (component) => component.catalogueUnit?.combatPresets ?? [],
          ) ?? targetCatalogueUnit.combatPresets,
      }
    : undefined;
  const attackerAbilitySourceUnitIds = savedFormationCombatPresetSourceUnitIds(attackerFormation);
  const targetAbilitySourceUnitIds = savedFormationCombatPresetSourceUnitIds(targetFormation);
  const attackerFormationKeywords = [
    ...new Set(
      attackerFormation?.components.flatMap(
        (component) => component.catalogueUnit?.models.flatMap((model) => model.keywords) ?? [],
      ) ??
        attackerCatalogueUnit?.models[0]?.keywords ??
        [],
    ),
  ];
  const attackerTransportReport =
    catalogue && attackerList
      ? transportAssignmentReport(catalogue, attackerList)
      : { assignments: [], errors: [], attachedUnitIds: new Set<string>() };
  const targetTransportReport =
    catalogue && targetList
      ? transportAssignmentReport(catalogue, targetList)
      : { assignments: [], errors: [], attachedUnitIds: new Set<string>() };
  const assignedFiringDeckPassengerIds = new Set(
    attackerTransportReport.assignments
      .filter((assignment) => assignment.transportUnit.id === attackerSelectionId)
      .map((assignment) => assignment.passengerUnit.id),
  );
  const playSupportUnits =
    attackerList?.units
      .filter(
        (unit) => !attackerFormation?.components.some((component) => component.unit.id === unit.id),
      )
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        combatPresets:
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId)
            ?.combatPresets ?? [],
        disabledPresetIds: unavailableSourceEquipmentCombatPresetIds(
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId),
          {
            choiceSelections: unit.choiceSelections,
            modelCount: unit.modelCount,
            loadoutSubjectCounts: unit.loadoutSubjectCounts,
          },
        ),
      })) ?? [];
  const supportArmyUnit = attackerList?.units.find((unit) => unit.id === supportUnitId);
  const supportCatalogueUnit = catalogue?.units.find((unit) => unit.id === supportArmyUnit?.unitId);
  const playTargetSupportUnits =
    targetList?.units
      .filter(
        (unit) => !targetFormation?.components.some((component) => component.unit.id === unit.id),
      )
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        combatPresets:
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId)
            ?.combatPresets ?? [],
        disabledPresetIds: unavailableSourceEquipmentCombatPresetIds(
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId),
          {
            choiceSelections: unit.choiceSelections,
            modelCount: unit.modelCount,
            loadoutSubjectCounts: unit.loadoutSubjectCounts,
          },
        ),
      })) ?? [];
  const targetSupportArmyUnit = targetList?.units.find((unit) => unit.id === targetSupportUnitId);
  const targetSupportCatalogueUnit = catalogue?.units.find(
    (unit) => unit.id === targetSupportArmyUnit?.unitId,
  );
  useEffect(() => {
    if (!recoveryReady || !catalogue || !migrateLegacyLimitedUses.current) return;
    migrateLegacyLimitedUses.current = false;
    const recoveredAttackerList = lists.find((list) => list.id === attackerListId);
    const recoveredTargetList = lists.find((list) => list.id === targetListId);
    const recoveredAttackerFormation = recoveredAttackerList
      ? savedFormationForUnit(catalogue, recoveredAttackerList, attackerUnitId)
      : undefined;
    const recoveredTargetFormation = recoveredTargetList
      ? savedFormationForUnit(catalogue, recoveredTargetList, targetUnitId)
      : undefined;
    const recoveredSupportUnit = recoveredAttackerList?.units.find(
      (unit) => unit.id === supportUnitId,
    );
    const recoveredTargetSupportUnit = recoveredTargetList?.units.find(
      (unit) => unit.id === targetSupportUnitId,
    );
    const recoveredSupportCatalogueUnit = catalogue.units.find(
      (unit) => unit.id === recoveredSupportUnit?.unitId,
    );
    const recoveredTargetSupportCatalogueUnit = catalogue.units.find(
      (unit) => unit.id === recoveredTargetSupportUnit?.unitId,
    );
    setAbilityUsesSpent((current) =>
      reconcileActiveLimitedAbilityUses(
        [
          {
            presets:
              recoveredAttackerFormation?.components.flatMap(
                (component) => component.catalogueUnit?.combatPresets ?? [],
              ) ?? [],
            selectedIds: activeAttackerPresetIds,
            sourceUnitIds: savedFormationCombatPresetSourceUnitIds(recoveredAttackerFormation),
          },
          {
            presets:
              recoveredTargetFormation?.components.flatMap(
                (component) => component.catalogueUnit?.combatPresets ?? [],
              ) ?? [],
            selectedIds: activeTargetPresetIds,
            sourceUnitIds: savedFormationCombatPresetSourceUnitIds(recoveredTargetFormation),
          },
          {
            presets: recoveredSupportCatalogueUnit?.combatPresets ?? [],
            selectedIds: activeSupportPresetIds,
            sourceUnitIds: Object.fromEntries(
              (recoveredSupportCatalogueUnit?.combatPresets ?? []).map((preset) => [
                preset.id,
                supportUnitId,
              ]),
            ),
          },
          {
            presets: recoveredTargetSupportCatalogueUnit?.combatPresets ?? [],
            selectedIds: activeTargetSupportPresetIds,
            sourceUnitIds: Object.fromEntries(
              (recoveredTargetSupportCatalogueUnit?.combatPresets ?? []).map((preset) => [
                preset.id,
                targetSupportUnitId,
              ]),
            ),
          },
        ],
        current,
      ),
    );
  }, [
    activeAttackerPresetIds,
    activeSupportPresetIds,
    activeTargetPresetIds,
    activeTargetSupportPresetIds,
    attackerListId,
    attackerUnitId,
    catalogue,
    lists,
    recoveryReady,
    supportUnitId,
    targetListId,
    targetSupportUnitId,
    targetUnitId,
  ]);
  const weaponGroups = groupWeaponProfiles(
    (firingDeckChoice
      ? firingDeckPassengerCatalogueUnit
      : formationWeaponChoice
        ? formationWeaponCatalogueUnit
        : attackerCatalogueUnit
    )?.weapons ?? [],
  );
  const selectedWeaponGroup = weaponGroups.find(
    (group) =>
      group.id === selectedWeapon?.groupId ||
      group.profiles.some((weapon) => weapon.id === selectedWeapon?.weaponId),
  );
  const weaponProfile =
    selectedWeaponGroup?.profiles.find((weapon) => String(weapon.id) === profileId) ??
    selectedWeaponGroup?.profiles[0];
  const targetEligibilityDraftKey = `${attackerUnitId}:${targetUnitId}:${weaponProfile?.id ?? ""}`;
  const defaultTargetEligibilityDraft = {
    key: targetEligibilityDraftKey,
    targetVisible: false,
    targetFullyVisible: false,
    targetMeasurementMethod: "manual",
    targetMeasurementReason: "",
    effectiveWeaponRange: weaponProfile?.range ?? 0,
    rangeOverrideReason: "",
  };
  const [storedTargetEligibilityDraft, setStoredTargetEligibilityDraft] = useState(
    defaultTargetEligibilityDraft,
  );
  const targetEligibilityDraft =
    storedTargetEligibilityDraft.key === targetEligibilityDraftKey
      ? storedTargetEligibilityDraft
      : defaultTargetEligibilityDraft;
  const {
    targetVisible,
    targetFullyVisible,
    targetMeasurementMethod,
    targetMeasurementReason,
    effectiveWeaponRange,
    rangeOverrideReason,
  } = targetEligibilityDraft;
  const updateTargetEligibilityDraft = (
    patch: Partial<Omit<typeof defaultTargetEligibilityDraft, "key">>,
  ) =>
    setStoredTargetEligibilityDraft((current) => ({
      ...(current.key === targetEligibilityDraftKey ? current : defaultTargetEligibilityDraft),
      ...patch,
      key: targetEligibilityDraftKey,
    }));
  const selectedSourceEquipmentSegments = weaponProfile
    ? sourceEquipmentWeaponLineSegments(
        weaponSourceCatalogueUnit,
        { weapon: weaponProfile, count: profile.weaponCount },
        {
          choiceSelections: weaponSourceArmyUnit?.choiceSelections,
          modelCount: weaponSourceArmyUnit?.modelCount,
          loadoutSubjectCounts: weaponSourceArmyUnit?.loadoutSubjectCounts,
        },
      )
    : [];
  const selectedFullSourceEquipmentPresetIds =
    selectedSourceEquipmentSegments.length === 1
      ? (selectedSourceEquipmentSegments[0].sourceEquipmentPresetIds ?? [])
      : [];
  const unavailableAttackerSourcePresetIds =
    attackerFormation?.components.flatMap((component) =>
      unavailableSourceEquipmentCombatPresetIds(component.catalogueUnit, {
        choiceSelections: component.unit.choiceSelections,
        modelCount: component.unit.modelCount,
        loadoutSubjectCounts: component.unit.loadoutSubjectCounts,
      }),
    ) ?? [];
  const targetBaseModels = savedFormationModelSegments(targetFormation);
  let targetFormationBaseModels = savedFormationTargetSequence(
    targetFormation,
    targetModelId,
    targetDefensiveEquipmentCounts,
  );
  const attackerPlayerId =
    battleState?.players.find((player, index) => {
      if (player.listId !== attackerListId) return false;
      return attackerListId !== targetListId || index === 0;
    })?.id ?? "player-1";
  const targetPlayerId =
    battleState?.players.find((player, index) => {
      if (player.listId !== targetListId) return false;
      return attackerListId !== targetListId || index === 1;
    })?.id ?? "player-2";
  const targetBattleFormationId = targetFormation ? `${targetPlayerId}:${targetFormation.id}` : "";
  const attackerBattleFormationId = attackerFormation
    ? `${attackerPlayerId}:${attackerFormation.id}`
    : "";
  const weaponSourceFormation =
    catalogue && attackerList && weaponSourceArmyUnit
      ? savedFormationForUnit(catalogue, attackerList, weaponSourceArmyUnit.id)
      : undefined;
  const weaponSourceBattleFormationId = weaponSourceFormation
    ? `${attackerPlayerId}:${weaponSourceFormation.id}`
    : "";
  const unusedSelectedWeaponCount =
    battleState &&
    weaponSourceBattleFormationId &&
    weaponSourceArmyUnit &&
    selectedWeaponGroup &&
    weaponProfile?.type === "Ranged"
      ? battleUnusedWeaponCount(
          battleState,
          weaponSourceBattleFormationId,
          weaponSourceArmyUnit.id,
          selectedWeaponGroup.id,
        )
      : null;
  const selectedDeclaredWeaponCount = selectedSourceEquipmentSegments.length
    ? selectedSourceEquipmentSegments.reduce((total, segment) => total + segment.count, 0)
    : profile.weaponCount;
  const replayedBattle = battleState ? replayBattleState(battleState) : null;
  targetFormationBaseModels = battleTargetSequence(
    targetFormationBaseModels,
    targetBattleFormationId ? replayedBattle?.formations.get(targetBattleFormationId) : null,
    targetModelId,
  );
  const battleClock = replayedBattle?.clock ?? null;
  const setupWeaponBearerGroups = replayedBattle
    ? [...replayedBattle.formations.values()].flatMap((formation) =>
        formation.weaponBearerTracking === "exact"
          ? formation.weaponInventory
              .filter((group) =>
                ["setup_required", "player_reviewed"].includes(group.bearerAssignmentSource),
              )
              .map((group) => ({ formation, group }))
          : [],
      )
    : [];
  const validFiringDeckPassengerIds = new Set(
    [...assignedFiringDeckPassengerIds].filter((savedUnitId) => {
      if (!replayedBattle || replayedBattle.deploymentByFormation.size === 0) return true;
      const passenger =
        catalogue && attackerList
          ? savedFormationForUnit(catalogue, attackerList, savedUnitId)
          : undefined;
      return (
        passenger &&
        replayedBattle.embarkedByFormation.get(`${attackerPlayerId}:${passenger.id}`) ===
          attackerBattleFormationId
      );
    }),
  );
  const selectedEmbarkedTransportId = attackerBattleFormationId
    ? (replayedBattle?.embarkedByFormation.get(attackerBattleFormationId) ?? "")
    : "";
  const selectedBattleFormation = attackerBattleFormationId
    ? replayedBattle?.formations.get(attackerBattleFormationId)
    : undefined;
  const assignedTransportFormationId = selectedBattleFormation?.assignedTransportFormationId ?? "";
  const assignedTransportOnBattlefield = Boolean(
    assignedTransportFormationId &&
      battleState &&
      battleFormationIsOnBattlefield(battleState, assignedTransportFormationId),
  );
  const pendingDestroyedTransport = replayedBattle
    ? [...replayedBattle.pendingTransportDestructions.values()][0]
    : undefined;
  const selectedDisembarkedCurrentPhase = Boolean(
    attackerBattleFormationId &&
      battleClock?.status === "active" &&
      (() => {
        const disembarkation =
          replayedBattle?.disembarkedByFormation.get(attackerBattleFormationId);
        return (
          disembarkation &&
          disembarkation.clock.battleRound === battleClock.battleRound &&
          disembarkation.clock.turn === battleClock.turn &&
          disembarkation.clock.phase === battleClock.phase &&
          disembarkation.clock.activePlayerId === battleClock.activePlayerId
        );
      })(),
  );
  const weaponHasIndirect = Boolean(
    weaponProfile?.abilities.some((ability) => ability.name.toLowerCase() === "indirect fire"),
  );
  const targetEligibilityKey = `${attackerBattleFormationId}:${targetBattleFormationId}:${weaponProfile?.id ?? ""}:${battleClock?.battleRound ?? 0}:${battleClock?.turn ?? 0}:${battleClock?.phase ?? "setup"}:${battleClock?.step ?? "setup"}:${profile.targetDistance}:${effectiveWeaponRange}:${profile.weaponCount}:${targetVisible}:${targetFullyVisible}:${profile.indirect}:${targetMeasurementMethod}:${targetMeasurementReason}:${rangeOverrideReason}`;
  const targetEligibilityReviewed = targetEligibilityConfirmationKey === targetEligibilityKey;
  const rangedTargetEligibilityReady = Boolean(
    weaponProfile?.type === "Ranged" &&
      weaponProfile.range !== null &&
      effectiveWeaponRange > 0 &&
      profile.targetDistance > 0 &&
      profile.targetDistance <= effectiveWeaponRange &&
      profile.weaponCount > 0 &&
      (targetVisible ? !profile.indirect : profile.indirect && weaponHasIndirect) &&
      targetMeasurementReason.trim() &&
      (effectiveWeaponRange === weaponProfile.range || rangeOverrideReason.trim()) &&
      targetEligibilityReviewed,
  );
  const activeFormationActivation = replayedBattle?.activeActivation ?? null;
  const resolvingFireOverwatch = activeFormationActivation?.source === "fire_overwatch";
  const targetEligibilityConfirmed =
    battleClock?.phase === "shooting" || resolvingFireOverwatch
      ? rangedTargetEligibilityReady
      : targetEligibilityReviewed;
  const weaponHasAssault = Boolean(
    weaponProfile?.abilities.some((ability) => ability.name.toLowerCase() === "assault"),
  );
  const battleActionOptions = {
    targetFormationId: targetBattleFormationId,
    weaponHasAssault,
    weaponType: weaponProfile?.type ?? "",
    eligibilityOverride: actionEligibilityOverride,
    targetEligibilityConfirmed,
    targetEligibilityReason:
      targetMeasurementReason.trim() ||
      actionOverrideReason.trim() ||
      "Player confirmed Engagement Range and target eligibility",
    overrideReason:
      actionOverrideReason.trim() || "Player confirmed a rule or physical-table eligibility fact",
    fightsFirst: fightsFirstOverride,
  };
  const selectedMovement = attackerBattleFormationId
    ? replayedBattle?.movementByFormation.get(attackerBattleFormationId)
    : null;
  const selectedMovementStart = attackerBattleFormationId
    ? replayedBattle?.movementStartsByFormation.get(attackerBattleFormationId)
    : null;
  const selectedCharge = attackerBattleFormationId
    ? replayedBattle?.chargeByFormation.get(attackerBattleFormationId)
    : null;
  const selectedChargeDeclaration = attackerBattleFormationId
    ? replayedBattle?.chargeDeclarationsByFormation.get(attackerBattleFormationId)
    : null;
  const selectedMovementCurrent = Boolean(
    selectedMovement &&
      battleClock?.status === "active" &&
      selectedMovement.clock.battleRound === battleClock.battleRound &&
      selectedMovement.clock.turn === battleClock.turn &&
      selectedMovement.clock.activePlayerId === battleClock.activePlayerId,
  );
  const selectedChargeCurrent = Boolean(
    selectedCharge &&
      battleClock?.status === "active" &&
      selectedCharge.clock.battleRound === battleClock.battleRound &&
      selectedCharge.clock.turn === battleClock.turn &&
      selectedCharge.clock.activePlayerId === battleClock.activePlayerId,
  );
  const pendingBattleChoices = replayedBattle ? [...replayedBattle.pendingChoices.values()] : [];
  const pendingFireOverwatch = replayedBattle?.pendingFireOverwatch ?? null;
  const fireOverwatchFormationOptions = pendingFireOverwatch
    ? [...replayedBattle.formations.values()].filter((candidate) => {
        const keywords = candidate.keywords.map((keyword: string) => keyword.toLowerCase());
        return (
          candidate.playerId === pendingFireOverwatch.responderPlayerId &&
          battleFormationIsOnBattlefield(battleState, candidate.id) &&
          candidate.segments.some(
            (segment: { id: string }) => candidate.health[segment.id].modelsRemaining > 0,
          ) &&
          candidate.weaponInventory.some((group) =>
            group.profiles.some((weapon: { type: string }) => weapon.type === "Ranged"),
          ) &&
          !keywords.includes("titanic")
        );
      })
    : [];
  const selectedFireOverwatchFormationId = fireOverwatchFormationOptions.some(
    (candidate) => candidate.id === fireOverwatchFormationId,
  )
    ? fireOverwatchFormationId
    : (fireOverwatchFormationOptions[0]?.id ?? "");
  const fireOverwatchResponderCommandPoints = pendingFireOverwatch
    ? (replayedBattle?.resources.get(pendingFireOverwatch.responderPlayerId)?.get("command_points")
        ?.value ?? 0)
    : 0;
  const pendingHeroicIntervention = replayedBattle?.pendingHeroicIntervention ?? null;
  const heroicFormationOptions = pendingHeroicIntervention
    ? [...replayedBattle.formations.values()].filter((candidate) => {
        const keywords = candidate.keywords.map((keyword: string) => keyword.toLowerCase());
        return (
          candidate.playerId === pendingHeroicIntervention.responderPlayerId &&
          battleFormationIsOnBattlefield(battleState, candidate.id) &&
          candidate.segments.some(
            (segment: { id: string }) => candidate.health[segment.id].modelsRemaining > 0,
          ) &&
          (!keywords.includes("vehicle") || keywords.includes("walker"))
        );
      })
    : [];
  const selectedHeroicFormationId = heroicFormationOptions.some(
    (candidate) => candidate.id === heroicFormationId,
  )
    ? heroicFormationId
    : (heroicFormationOptions[0]?.id ?? "");
  const heroicResponderCommandPoints = pendingHeroicIntervention
    ? (replayedBattle?.resources
        .get(pendingHeroicIntervention.responderPlayerId)
        ?.get("command_points")?.value ?? 0)
    : 0;
  const activeBattleEffects = replayedBattle ? [...replayedBattle.effects.values()] : [];
  const battleObjectives = replayedBattle ? [...replayedBattle.objectives.values()] : [];
  const activeFightMovement =
    activeFormationActivation?.activationType === "fight"
      ? replayedBattle?.fightMovementsByActivation.get(activeFormationActivation.id)
      : null;
  const pendingFightMoveStage =
    activeFormationActivation?.activationType !== "fight"
      ? ""
      : !activeFormationActivation.pileIn
        ? "pile_in"
        : !activeFormationActivation.consolidation
          ? "consolidation"
          : "";
  const battleScoringEvents = replayedBattle?.scoringEvents ?? [];
  const attackerFormationBattleShocked = Boolean(
    attackerBattleFormationId &&
      replayedBattle?.battleShockedFormations.has(attackerBattleFormationId),
  );
  const targetFormationBattleShocked = Boolean(
    targetBattleFormationId && replayedBattle?.battleShockedFormations.has(targetBattleFormationId),
  );
  const targetBattleHealth =
    battleState && targetBattleFormationId
      ? battleFormationHealth(battleState, targetBattleFormationId)
      : null;
  const targetBattleWasAttacked =
    battleState && targetBattleFormationId
      ? battleFormationWasTargeted(battleState, targetBattleFormationId)
      : false;
  const targetEquipmentLocked =
    targetBattleWasAttacked ||
    battleClock?.status === "active" ||
    battleClock?.status === "complete";
  useEffect(() => {
    if (!recoveryReady || !catalogue || !attackerList || !targetList) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const next = initializeBattleForLists({
          catalogue,
          firstList: attackerList,
          secondList: targetList,
          rulesSnapshot: currentRulesSnapshot,
          state: battleState,
          id: crypto.randomUUID(),
          legacyFormationEquipmentCounts: targetBattleFormationId
            ? { [targetBattleFormationId]: targetDefensiveEquipmentCounts }
            : {},
        });
        if (next !== battleState) setBattleState(next);
        setBattleSetupError("");
      } catch (error) {
        setBattleSetupError(error instanceof Error ? error.message : "Battle setup is invalid");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    attackerList,
    battleState,
    catalogue,
    currentRulesSnapshot,
    recoveryReady,
    targetBattleFormationId,
    targetDefensiveEquipmentCounts,
    targetList,
  ]);
  let targetBattleStateError = "";
  let targetFormationModels = targetFormationBaseModels;
  try {
    targetFormationModels = applyBattleHealthToTargetSequence(
      targetFormationBaseModels,
      targetBattleHealth,
    );
  } catch (error) {
    targetBattleStateError =
      error instanceof Error ? error.message : "Target battle state is invalid";
  }
  const targetProfiles = targetFormationModels.segments;
  const targetAllocationOptions = targetFormationModels.allocationOptions;
  const selectedTargetSegment = targetFormationModels.first;
  const targetModelsRemaining = targetFormationModels.orderedSegments.reduce(
    (total, segment) => total + segment.modelCount,
    0,
  );
  const targetModelSelectValue = targetAllocationOptions.some(
    (segment) => segment.id === targetModelId,
  )
    ? targetModelId
    : (targetFormationModels.first?.id ?? "");
  const targetDefensiveEquipmentOptions =
    targetFormation?.components.flatMap((component) =>
      (component.catalogueUnit?.defensiveEquipment ?? []).map((option) => ({
        ...option,
        savedUnitId: component.unit.id,
        unitName: component.unit.name,
      })),
    ) ?? [];
  const targetDefensiveEquipmentWarnings =
    targetFormation?.components.flatMap((component) =>
      component.catalogueUnit
        ? savedUnitDefensiveEquipmentWarnings(
            {
              ...component.unit,
              defensiveEquipmentCounts: targetDefensiveEquipmentCounts,
            },
            component.catalogueUnit,
          ).map((warning) => ({ ...warning, unitName: component.unit.name }))
        : [],
    ) ?? [];
  const firingDeckPlayOptions =
    attackerCatalogueUnit?.firingDeck && catalogue
      ? (attackerList?.units ?? [])
          .filter((unit) => validFiringDeckPassengerIds.has(unit.id))
          .map((unit) => {
            const source = catalogue.units.find((entry) => entry.id === unit.unitId);
            const eligibleIds = new Set(
              firingDeckWeapons(source ?? { weapons: [] }).map((entry) => entry.id),
            );
            return {
              unit,
              source,
              weapons: unit.weapons.filter(
                (weapon) => weapon.count > 0 && eligibleIds.has(weapon.weaponId),
              ),
            };
          })
          .filter((entry) => entry.weapons.length > 0)
      : [];

  const selectedCombatPresets = (
    ids: string[],
    unit: typeof attackerCatalogueUnit,
    weapon = weaponProfile,
    targetKeywords = selectedTargetSegment?.model.keywords ?? [],
    targetDistance = profile.targetDistance,
    attackerCharged = profile.attackerCharged,
    attackerBattleShocked = profile.attackerBattleShocked,
    targetBattleShocked = profile.targetBattleShocked,
    targetStrengthState = profile.targetStrengthState,
    attackerRemainedStationary = profile.attackerRemainedStationary,
    sourceUnitAttached = false,
    sourceUnitWaaaghActive = false,
    targetOathOfMoment = false,
    sourceUnitOathWoundBonusEligible = false,
    sourceUnitOnObjective = false,
    targetUnitOnObjective = false,
    sourceUnitControlsObjective = false,
    targetUnitOnObjectiveNotControlledBySource = false,
    sourceUnitOnSelectedObjective = false,
    targetUnitOnSourceSelectedObjective = false,
    sourceUnitBattleShocked = false,
    sourceUnitGuidedAgainstTarget = false,
    targetUnitSpotted = false,
    targetUnitSpottedByMarkerlightObserver = false,
    sourceRelationship: "self" | "supporting_unit" = "self",
    supportedUnitKeywords: string[] = [],
    supportDistance = 0,
    targetClosestEligible = profile.targetClosestEligible,
    sourceTargetDistance = profile.attackerSourceTargetDistance,
    sourceTargetVisible = profile.attackerSourceCanSeeTarget,
    attackerKeywords: string[] = unit?.models[0]?.keywords ?? [],
  ) =>
    selectedAndAutomaticCombatPresets(
      unit?.combatPresets ?? [],
      ids,
      weapon?.type ?? "Ranged",
      weapon?.name ?? "",
      targetKeywords,
      attackKeywordsForWeapon(weapon),
      targetDistance,
      attackerCharged,
      attackerBattleShocked,
      targetBattleShocked,
      targetStrengthState,
      attackerRemainedStationary,
      sourceUnitAttached,
      sourceUnitWaaaghActive,
      targetOathOfMoment,
      sourceUnitOathWoundBonusEligible,
      sourceUnitOnObjective,
      targetUnitOnObjective,
      sourceUnitControlsObjective,
      targetUnitOnObjectiveNotControlledBySource,
      sourceUnitOnSelectedObjective,
      targetUnitOnSourceSelectedObjective,
      sourceUnitBattleShocked,
      sourceUnitGuidedAgainstTarget,
      targetUnitSpotted,
      targetUnitSpottedByMarkerlightObserver,
      sourceRelationship,
      supportedUnitKeywords,
      supportDistance,
      targetClosestEligible,
      sourceTargetDistance,
      sourceTargetVisible,
      attackerKeywords,
    );

  const refreshProfile = (
    nextWeaponOrCounts: string | Partial<AttackCountContext> = weaponId,
    nextTargetModelId = targetModelId,
    nextProfileId = profileId,
    nextAttackerPresetIds = activeAttackerPresetIds,
    nextTargetPresetIds = activeTargetPresetIds,
    nextTargetDistance = profile.targetDistance,
    nextAttackerCharged = profile.attackerCharged,
    nextAttackerBattleShocked = profile.attackerBattleShocked,
    nextTargetBattleShocked = profile.targetBattleShocked,
    nextTargetStrengthState = profile.targetStrengthState,
    nextAttackerRemainedStationary = profile.attackerRemainedStationary,
    nextAttackerAttached = profile.attackerAttached,
    nextTargetAttached = profile.targetAttached,
    nextAttackerWaaaghActive = profile.attackerWaaaghActive,
    nextTargetWaaaghActive = profile.targetWaaaghActive,
    nextTargetOathOfMoment = profile.targetOathOfMoment,
    nextAttackerOathWoundBonusEligible = profile.attackerOathWoundBonusEligible,
    nextAttackerUnitModels = profile.attackerUnitModels,
    nextNearbyEnemyModels = profile.nearbyEnemyModels,
    nextAttackerOnObjective = profile.attackerOnObjective,
    nextTargetOnObjective = profile.targetOnObjective,
    nextAttackerObjectiveOwner = profile.attackerObjectiveOwner,
    nextTargetObjectiveOwner = profile.targetObjectiveOwner,
    nextAttackerOnAttackerSelectedObjective = profile.attackerOnAttackerSelectedObjective,
    nextTargetOnAttackerSelectedObjective = profile.targetOnAttackerSelectedObjective,
    nextAttackerOnTargetSelectedObjective = profile.attackerOnTargetSelectedObjective,
    nextTargetOnTargetSelectedObjective = profile.targetOnTargetSelectedObjective,
    nextAttackerGuidedAgainstTarget = profile.attackerGuidedAgainstTarget,
    nextTargetSpotted = profile.targetSpotted,
    nextTargetSpottedByMarkerlightObserver = profile.targetSpottedByMarkerlightObserver,
    nextSupportPresetIds = activeSupportPresetIds,
    nextSupportCatalogueUnit = supportCatalogueUnit,
    nextSupportDistance = profile.supportDistance,
    nextTargetSupportPresetIds = activeTargetSupportPresetIds,
    nextTargetSupportCatalogueUnit = targetSupportCatalogueUnit,
    nextTargetSupportDistance = profile.targetSupportDistance,
    nextTargetClosestEligible = profile.targetClosestEligible,
    nextAttackerSourceTargetDistance = profile.attackerSourceTargetDistance,
    nextTargetSourceAttackerDistance = profile.targetSourceAttackerDistance,
    nextAttackerSourceCanSeeTarget = profile.attackerSourceCanSeeTarget,
    nextTargetSourceCanSeeAttacker = profile.targetSourceCanSeeAttacker,
  ) => {
    const nextWeaponId = typeof nextWeaponOrCounts === "string" ? nextWeaponOrCounts : weaponId;
    const countOverrides = typeof nextWeaponOrCounts === "string" ? {} : nextWeaponOrCounts;
    const nextNearbyEnemyUnits = countOverrides.nearbyEnemyUnits ?? profile.nearbyEnemyUnits;
    const nextEnemyCharacterModelsDestroyed =
      countOverrides.enemyCharacterModelsDestroyed ?? profile.enemyCharacterModelsDestroyed;
    const nextDestructiveFightPhases =
      countOverrides.destructiveFightPhases ?? profile.destructiveFightPhases;
    const nextEmbarkedModels = countOverrides.embarkedModels ?? profile.embarkedModels;
    const nextEmbarkedWracksModels = Math.min(
      countOverrides.embarkedWracksModels ?? profile.embarkedWracksModels,
      nextEmbarkedModels,
    );
    const nextFiringDeckChoice = parseFiringDeckWeaponValue(nextWeaponId);
    const nextFormationWeaponChoice = parseFormationWeaponValue(nextWeaponId);
    const nextPassengerArmyUnit = attackerList?.units.find(
      (entry) => entry.id === nextFiringDeckChoice?.passengerUnitId,
    );
    const nextPassengerCatalogueUnit = catalogue?.units.find(
      (entry) => entry.id === nextPassengerArmyUnit?.unitId,
    );
    const nextFormationWeaponUnit = attackerList?.units.find(
      (entry) => entry.id === nextFormationWeaponChoice?.savedUnitId,
    );
    const nextFormationWeaponCatalogueUnit = catalogue?.units.find(
      (entry) => entry.id === nextFormationWeaponUnit?.unitId,
    );
    const nextAttachedArmyUnit = attackerList?.units.find(
      (entry) => entry.id === nextPassengerArmyUnit?.attachedToId,
    );
    const nextAttachedCatalogueUnit = catalogue?.units.find(
      (entry) => entry.id === nextAttachedArmyUnit?.unitId,
    );
    const weaponSourceArmyUnit = nextPassengerArmyUnit ?? nextFormationWeaponUnit ?? attackerUnit;
    const weaponSourceCatalogueUnit = nextFiringDeckChoice
      ? nextPassengerCatalogueUnit
      : nextFormationWeaponChoice
        ? nextFormationWeaponCatalogueUnit
        : attackerCatalogueUnit;
    const listWeapon = weaponSourceArmyUnit?.weapons.find(
      (entry) =>
        String(entry.weaponId) ===
        String(
          nextFiringDeckChoice?.weaponId ?? nextFormationWeaponChoice?.weaponId ?? nextWeaponId,
        ),
    );
    const groups = groupWeaponProfiles(weaponSourceCatalogueUnit?.weapons ?? []);
    const group = groups.find(
      (entry) =>
        entry.id === listWeapon?.groupId ||
        entry.profiles.some((profile) => profile.id === listWeapon?.weaponId),
    );
    const weapon =
      group?.profiles.find((entry) => String(entry.id) === nextProfileId) ?? group?.profiles[0];
    const targetSegment =
      targetAllocationOptions.find((entry) => entry.id === nextTargetModelId) ??
      targetAllocationOptions[0];
    const model = targetSegment?.model;
    if (!weapon || !model) return;
    let weaponCount = listWeapon?.count ?? 1;
    if (nextFiringDeckChoice && catalogue && attackerCatalogueUnit) {
      if (!validFiringDeckPassengerIds.has(nextPassengerArmyUnit?.id ?? "")) {
        setStatus("Assign this passenger to the attacking Transport in Army Lists first");
        return;
      }
      const maximumModels = Math.max(
        1,
        Math.min(
          nextPassengerArmyUnit?.modelCount ?? 1,
          listWeapon?.count ?? 1,
          Math.floor(
            (attackerCatalogueUnit.firingDeck?.capacity ?? 0) /
              (nextPassengerCatalogueUnit?.firingDeckModelCost ?? 1),
          ),
        ),
      );
      const selectedModels = nextWeaponId === weaponId ? firingDeckModels : maximumModels;
      resolveFiringDeckSelection(catalogue, attackerCatalogueUnit, {
        passengerUnitId: nextPassengerCatalogueUnit?.id,
        attachedUnitId: nextAttachedCatalogueUnit?.id,
        weaponId: weapon.id,
        modelCount: selectedModels,
        unitAlreadyShot: false,
      });
      weaponCount = selectedModels;
    }
    const sourceEquipmentSegments = sourceEquipmentWeaponLineSegments(
      weaponSourceCatalogueUnit,
      { weapon, count: weaponCount },
      {
        choiceSelections: weaponSourceArmyUnit?.choiceSelections,
        modelCount: weaponSourceArmyUnit?.modelCount,
        loadoutSubjectCounts: weaponSourceArmyUnit?.loadoutSubjectCounts,
      },
    );
    const fullSourceEquipmentPresetIds =
      sourceEquipmentSegments.length === 1
        ? (sourceEquipmentSegments[0].sourceEquipmentPresetIds ?? [])
        : [];
    setProfile(
      applyCombatPresets(
        applyWeaponProfile(
          {
            ...applyTargetProfile(DEFAULT_PROFILE, model),
            weaponCount,
            targetModels: targetFormation?.modelCount ?? targetUnit?.modelCount ?? 1,
            targetDistance: nextTargetDistance,
            attackerUnitModels: nextAttackerUnitModels,
            nearbyEnemyModels: nextNearbyEnemyModels,
            nearbyEnemyUnits: nextNearbyEnemyUnits,
            enemyCharacterModelsDestroyed: nextEnemyCharacterModelsDestroyed,
            destructiveFightPhases: nextDestructiveFightPhases,
            embarkedModels: nextEmbarkedModels,
            embarkedWracksModels: nextEmbarkedWracksModels,
            attackerCharged: nextAttackerCharged,
            attackerRemainedStationary: nextAttackerRemainedStationary,
            attackerAttached: nextAttackerAttached,
            targetAttached: nextTargetAttached,
            attackerWaaaghActive: nextAttackerWaaaghActive,
            targetWaaaghActive: nextTargetWaaaghActive,
            targetOathOfMoment: nextTargetOathOfMoment,
            attackerOathWoundBonusEligible: nextAttackerOathWoundBonusEligible,
            attackerOnObjective: nextAttackerOnObjective,
            targetOnObjective: nextTargetOnObjective,
            attackerObjectiveOwner: nextAttackerObjectiveOwner,
            targetObjectiveOwner: nextTargetObjectiveOwner,
            attackerOnAttackerSelectedObjective: nextAttackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective: nextTargetOnAttackerSelectedObjective,
            attackerOnTargetSelectedObjective: nextAttackerOnTargetSelectedObjective,
            targetOnTargetSelectedObjective: nextTargetOnTargetSelectedObjective,
            attackerGuidedAgainstTarget: nextAttackerGuidedAgainstTarget,
            targetSpotted: nextTargetSpotted,
            targetSpottedByMarkerlightObserver: nextTargetSpottedByMarkerlightObserver,
            targetClosestEligible: nextTargetClosestEligible,
            attackerSourceTargetDistance: nextAttackerSourceTargetDistance,
            targetSourceAttackerDistance: nextTargetSourceAttackerDistance,
            attackerSourceCanSeeTarget: nextAttackerSourceCanSeeTarget,
            targetSourceCanSeeAttacker: nextTargetSourceCanSeeAttacker,
            attackerBattleShocked: nextAttackerBattleShocked,
            targetBattleShocked: nextTargetBattleShocked,
            targetStrengthState: nextTargetStrengthState,
            supportDistance: nextSupportDistance,
            targetSupportDistance: nextTargetSupportDistance,
          },
          weapon,
          model.keywords,
        ),
        [
          ...selectedCombatPresets(
            [...nextAttackerPresetIds, ...fullSourceEquipmentPresetIds],
            attackerFormationCatalogueUnit,
            weapon,
            model.keywords,
            nextTargetDistance,
            nextAttackerCharged,
            nextAttackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            nextAttackerRemainedStationary,
            nextAttackerAttached,
            nextAttackerWaaaghActive,
            nextTargetOathOfMoment,
            nextAttackerOathWoundBonusEligible,
            nextAttackerOnObjective,
            nextTargetOnObjective,
            nextAttackerOnObjective && nextAttackerObjectiveOwner === "attacker",
            nextTargetOnObjective && ["target", "uncontrolled"].includes(nextTargetObjectiveOwner),
            nextAttackerOnAttackerSelectedObjective,
            nextTargetOnAttackerSelectedObjective,
            nextAttackerBattleShocked,
            nextAttackerGuidedAgainstTarget,
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "self",
            [],
            0,
            nextTargetClosestEligible,
            nextAttackerSourceTargetDistance,
            nextAttackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
          ...selectedCombatPresets(
            nextSupportPresetIds,
            nextSupportCatalogueUnit,
            weapon,
            model.keywords,
            nextTargetDistance,
            nextAttackerCharged,
            nextAttackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            nextAttackerRemainedStationary,
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
            nextAttackerGuidedAgainstTarget,
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "supporting_unit",
            attackerFormationKeywords,
            nextSupportDistance,
            nextTargetClosestEligible,
            nextAttackerSourceTargetDistance,
            nextAttackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
        ],
        [
          ...selectedCombatPresets(
            nextTargetPresetIds,
            targetFormationCatalogueUnit,
            weapon,
            model.keywords,
            nextTargetDistance,
            nextAttackerCharged,
            nextAttackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            nextAttackerRemainedStationary,
            nextTargetAttached,
            nextTargetWaaaghActive,
            false,
            false,
            nextTargetOnObjective,
            nextAttackerOnObjective,
            nextTargetOnObjective && nextTargetObjectiveOwner === "target",
            nextAttackerOnObjective &&
              ["attacker", "uncontrolled"].includes(nextAttackerObjectiveOwner),
            nextTargetOnTargetSelectedObjective,
            nextAttackerOnTargetSelectedObjective,
            nextTargetBattleShocked,
            false,
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "self",
            [],
            0,
            nextTargetClosestEligible,
            nextTargetSourceAttackerDistance,
            nextTargetSourceCanSeeAttacker,
            attackerFormationKeywords,
          ),
          ...selectedCombatPresets(
            nextTargetSupportPresetIds,
            nextTargetSupportCatalogueUnit,
            weapon,
            model.keywords,
            nextTargetDistance,
            nextAttackerCharged,
            nextAttackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            nextAttackerRemainedStationary,
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
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "supporting_unit",
            model.keywords,
            nextTargetSupportDistance,
            nextTargetClosestEligible,
            nextTargetSourceAttackerDistance,
            nextTargetSourceCanSeeAttacker,
            attackerFormationKeywords,
          ),
        ],
        weapon.type,
        {
          targetKeywords: model.keywords,
          attackerKeywords: attackerFormationKeywords,
          attackKeywords: attackKeywordsForWeapon(weapon),
          targetDistance: nextTargetDistance,
          attackerUnitModels: nextAttackerUnitModels,
          nearbyEnemyModels: nextNearbyEnemyModels,
          nearbyEnemyUnits: nextNearbyEnemyUnits,
          enemyCharacterModelsDestroyed: nextEnemyCharacterModelsDestroyed,
          destructiveFightPhases: nextDestructiveFightPhases,
          embarkedModels: nextEmbarkedModels,
          embarkedWracksModels: nextEmbarkedWracksModels,
          attackerCharged: nextAttackerCharged,
          attackerRemainedStationary: nextAttackerRemainedStationary,
          attackerAttached: nextAttackerAttached,
          targetAttached: nextTargetAttached,
          attackerWaaaghActive: nextAttackerWaaaghActive,
          targetWaaaghActive: nextTargetWaaaghActive,
          targetOathOfMoment: nextTargetOathOfMoment,
          attackerOathWoundBonusEligible: nextAttackerOathWoundBonusEligible,
          attackerOnObjective: nextAttackerOnObjective,
          targetOnObjective: nextTargetOnObjective,
          attackerObjectiveOwner: nextAttackerObjectiveOwner,
          targetObjectiveOwner: nextTargetObjectiveOwner,
          attackerOnAttackerSelectedObjective: nextAttackerOnAttackerSelectedObjective,
          targetOnAttackerSelectedObjective: nextTargetOnAttackerSelectedObjective,
          attackerOnTargetSelectedObjective: nextAttackerOnTargetSelectedObjective,
          targetOnTargetSelectedObjective: nextTargetOnTargetSelectedObjective,
          attackerGuidedAgainstTarget: nextAttackerGuidedAgainstTarget,
          targetSpotted: nextTargetSpotted,
          targetSpottedByMarkerlightObserver: nextTargetSpottedByMarkerlightObserver,
          targetClosestEligible: nextTargetClosestEligible,
          attackerSourceTargetDistance: nextAttackerSourceTargetDistance,
          targetSourceAttackerDistance: nextTargetSourceAttackerDistance,
          attackerSourceCanSeeTarget: nextAttackerSourceCanSeeTarget,
          targetSourceCanSeeAttacker: nextTargetSourceCanSeeAttacker,
          attackerBattleShocked: nextAttackerBattleShocked,
          targetBattleShocked: nextTargetBattleShocked,
          targetStrengthState: nextTargetStrengthState,
          supportDistance: nextSupportDistance,
          supportedUnitKeywords: attackerFormationKeywords,
          targetSupportDistance: nextTargetSupportDistance,
          targetSupportedUnitKeywords: model.keywords,
        },
      ),
    );
    setResult(null);
  };

  const chooseWeapon = (id: string) => {
    const nextFiringDeckChoice = parseFiringDeckWeaponValue(id);
    const nextFormationWeaponChoice = parseFormationWeaponValue(id);
    const passengerArmyUnit = attackerList?.units.find(
      (entry) => entry.id === nextFiringDeckChoice?.passengerUnitId,
    );
    const passengerCatalogueUnit = catalogue?.units.find(
      (entry) => entry.id === passengerArmyUnit?.unitId,
    );
    const formationArmyUnit = attackerList?.units.find(
      (entry) => entry.id === nextFormationWeaponChoice?.savedUnitId,
    );
    const formationCatalogueUnit = catalogue?.units.find(
      (entry) => entry.id === formationArmyUnit?.unitId,
    );
    const listWeapon = (passengerArmyUnit ?? formationArmyUnit ?? attackerUnit)?.weapons.find(
      (entry) =>
        String(entry.weaponId) ===
        String(nextFiringDeckChoice?.weaponId ?? nextFormationWeaponChoice?.weaponId ?? id),
    );
    const groups = groupWeaponProfiles(
      (nextFiringDeckChoice
        ? passengerCatalogueUnit
        : nextFormationWeaponChoice
          ? formationCatalogueUnit
          : attackerCatalogueUnit
      )?.weapons ?? [],
    );
    const group = groups.find(
      (entry) =>
        entry.id === listWeapon?.groupId ||
        entry.profiles.some((profile) => profile.id === listWeapon?.weaponId),
    );
    const initialProfile = listWeapon?.groupId
      ? group?.profiles[0]
      : group?.profiles.find((profile) => profile.id === listWeapon?.weaponId);
    const firstProfileId = initialProfile ? String(initialProfile.id) : "";
    if (nextFiringDeckChoice) {
      setFiringDeckModels(
        Math.max(
          1,
          Math.min(
            passengerArmyUnit?.modelCount ?? 1,
            listWeapon?.count ?? 1,
            Math.floor(
              (attackerCatalogueUnit?.firingDeck?.capacity ?? 0) /
                (passengerCatalogueUnit?.firingDeckModelCost ?? 1),
            ),
          ),
        ),
      );
      setFiringDeckPassengerAlreadyShot(false);
    }
    setWeaponId(id);
    setProfileId(firstProfileId);
    refreshProfile(id, targetModelId, firstProfileId);
  };

  const refreshObjectiveState = (
    attackerOnObjective: boolean,
    targetOnObjective: boolean,
    attackerObjectiveOwner = profile.attackerObjectiveOwner,
    targetObjectiveOwner = profile.targetObjectiveOwner,
  ) =>
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      attackerOnObjective,
      targetOnObjective,
      attackerObjectiveOwner,
      targetObjectiveOwner,
    );

  const chooseProfile = (id: string) => {
    setProfileId(id);
    refreshProfile(weaponId, targetModelId, id);
  };

  const refreshSelectedObjectiveState = (
    attackerOnAttackerSelectedObjective: boolean,
    targetOnAttackerSelectedObjective: boolean,
    attackerOnTargetSelectedObjective: boolean,
    targetOnTargetSelectedObjective: boolean,
  ) =>
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      attackerOnAttackerSelectedObjective,
      targetOnAttackerSelectedObjective,
      attackerOnTargetSelectedObjective,
      targetOnTargetSelectedObjective,
    );

  const refreshGuidanceState = (
    attackerGuidedAgainstTarget: boolean,
    targetSpotted: boolean,
    targetSpottedByMarkerlightObserver: boolean,
  ) =>
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      profile.attackerOnAttackerSelectedObjective,
      profile.targetOnAttackerSelectedObjective,
      profile.attackerOnTargetSelectedObjective,
      profile.targetOnTargetSelectedObjective,
      attackerGuidedAgainstTarget,
      targetSpotted,
      targetSpottedByMarkerlightObserver,
    );

  const refreshClosestTargetState = (targetClosestEligible: boolean) =>
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      profile.attackerOnAttackerSelectedObjective,
      profile.targetOnAttackerSelectedObjective,
      profile.attackerOnTargetSelectedObjective,
      profile.targetOnTargetSelectedObjective,
      profile.attackerGuidedAgainstTarget,
      profile.targetSpotted,
      profile.targetSpottedByMarkerlightObserver,
      activeSupportPresetIds,
      supportCatalogueUnit,
      profile.supportDistance,
      activeTargetSupportPresetIds,
      targetSupportCatalogueUnit,
      profile.targetSupportDistance,
      targetClosestEligible,
    );

  const refreshSourceTargetState = (
    attackerSourceTargetDistance: number,
    targetSourceAttackerDistance: number,
    attackerSourceCanSeeTarget: boolean,
    targetSourceCanSeeAttacker: boolean,
  ) =>
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      profile.attackerOnAttackerSelectedObjective,
      profile.targetOnAttackerSelectedObjective,
      profile.attackerOnTargetSelectedObjective,
      profile.targetOnTargetSelectedObjective,
      profile.attackerGuidedAgainstTarget,
      profile.targetSpotted,
      profile.targetSpottedByMarkerlightObserver,
      activeSupportPresetIds,
      supportCatalogueUnit,
      profile.supportDistance,
      activeTargetSupportPresetIds,
      targetSupportCatalogueUnit,
      profile.targetSupportDistance,
      profile.targetClosestEligible,
      attackerSourceTargetDistance,
      targetSourceAttackerDistance,
      attackerSourceCanSeeTarget,
      targetSourceCanSeeAttacker,
    );

  const refreshSupportState = (
    ids: string[],
    unitId = supportUnitId,
    distance = profile.supportDistance,
  ) => {
    const armyUnit = attackerList?.units.find((unit) => unit.id === unitId);
    const catalogueUnit = catalogue?.units.find((unit) => unit.id === armyUnit?.unitId);
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      profile.attackerOnAttackerSelectedObjective,
      profile.targetOnAttackerSelectedObjective,
      profile.attackerOnTargetSelectedObjective,
      profile.targetOnTargetSelectedObjective,
      profile.attackerGuidedAgainstTarget,
      profile.targetSpotted,
      profile.targetSpottedByMarkerlightObserver,
      ids,
      catalogueUnit,
      distance,
    );
  };

  const refreshTargetSupportState = (
    ids: string[],
    unitId = targetSupportUnitId,
    distance = profile.targetSupportDistance,
  ) => {
    const armyUnit = targetList?.units.find((unit) => unit.id === unitId);
    const catalogueUnit = catalogue?.units.find((unit) => unit.id === armyUnit?.unitId);
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      profile.attackerBattleShocked,
      profile.targetBattleShocked,
      profile.targetStrengthState,
      profile.attackerRemainedStationary,
      profile.attackerAttached,
      profile.targetAttached,
      profile.attackerWaaaghActive,
      profile.targetWaaaghActive,
      profile.targetOathOfMoment,
      profile.attackerOathWoundBonusEligible,
      profile.attackerUnitModels,
      profile.nearbyEnemyModels,
      profile.attackerOnObjective,
      profile.targetOnObjective,
      profile.attackerObjectiveOwner,
      profile.targetObjectiveOwner,
      profile.attackerOnAttackerSelectedObjective,
      profile.targetOnAttackerSelectedObjective,
      profile.attackerOnTargetSelectedObjective,
      profile.targetOnTargetSelectedObjective,
      profile.attackerGuidedAgainstTarget,
      profile.targetSpotted,
      profile.targetSpottedByMarkerlightObserver,
      activeSupportPresetIds,
      supportCatalogueUnit,
      profile.supportDistance,
      ids,
      catalogueUnit,
      distance,
    );
  };

  const chooseTargetProfile = (id: string) => {
    setTargetModelId(id);
    refreshProfile(weaponId, id, profileId);
  };

  const changeTargetDefensiveEquipment = (key: string, count: number) => {
    if (targetEquipmentLocked) {
      setStatus("Target equipment is locked after the battle starts");
      return;
    }
    const next = { ...targetDefensiveEquipmentCounts };
    if (count > 0) next[key] = count;
    else delete next[key];
    const nextSequence = savedFormationTargetSequence(targetFormation, targetModelId, next);
    let nextTargetModelId = nextSequence.first?.id ?? "";
    if (battleState && targetFormation && targetBattleFormationId) {
      try {
        const updated = configureUnengagedBattleFormation(
          battleState,
          savedFormationBattleRegistration(
            targetFormation,
            targetPlayerId,
            targetBattleFormationId,
            nextSequence,
            next,
            battleFormation(battleState, targetBattleFormationId)?.assignedTransportFormationId ??
              "",
          ),
          crypto.randomUUID(),
          battleState.events.length + 1,
        );
        const configured = battleFormation(updated, targetBattleFormationId);
        nextTargetModelId =
          battleTargetSequence(nextSequence, configured, targetModelId).first?.id ?? "";
        setBattleState(updated);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Target equipment could not be changed");
        return;
      }
    }
    setTargetDefensiveEquipmentCounts(next);
    setTargetModelId(nextTargetModelId);
    if (nextTargetModelId) refreshProfile(weaponId, nextTargetModelId, profileId);
    setResult(null);
  };

  const chooseTargetUnit = (id: string) => {
    const nextFormation =
      catalogue && targetList ? savedFormationForUnit(catalogue, targetList, id) : undefined;
    const nextTarget = nextFormation?.root ?? targetList?.units.find((unit) => unit.id === id);
    const nextTargetCatalogueUnit = catalogue?.units.find((unit) => unit.id === nextTarget?.unitId);
    const nextTargetPresetUnit = nextTargetCatalogueUnit
      ? {
          ...nextTargetCatalogueUnit,
          combatPresets:
            nextFormation?.components.flatMap(
              (component) => component.catalogueUnit?.combatPresets ?? [],
            ) ?? nextTargetCatalogueUnit.combatPresets,
        }
      : undefined;
    const nextTargetPlayerId =
      battleState?.players.find((player, index) => {
        if (player.listId !== targetListId) return false;
        return attackerListId !== targetListId || index === 1;
      })?.id ?? "player-2";
    const nextRegistration =
      battleState && nextFormation
        ? battleFormation(battleState, `${nextTargetPlayerId}:${nextFormation.id}`)
        : null;
    const nextTargetDefensiveEquipmentCounts = nextRegistration
      ? nextRegistration.defensiveEquipmentCounts
      : savedFormationDefensiveEquipmentDefaults(nextFormation);
    const nextTargetSequence = battleTargetSequence(
      savedFormationTargetSequence(nextFormation, "", nextTargetDefensiveEquipmentCounts),
      nextRegistration,
      "",
    );
    const firstSegment = nextTargetSequence.first;
    const model = firstSegment?.model ?? nextTargetCatalogueUnit?.models[0];
    const nextTargetPresetIds = nextFormation
      ? savedFormationCombatPresetIds(nextFormation)
      : savedUnitCombatPresetIds(nextTarget, nextTargetCatalogueUnit);
    setTargetUnitId(id);
    setTargetDefensiveEquipmentCounts(nextTargetDefensiveEquipmentCounts);
    const nextTargetBattleShocked = Boolean(
      nextFormation &&
        replayedBattle?.battleShockedFormations.has(`${nextTargetPlayerId}:${nextFormation.id}`),
    );
    const nextTargetAttached =
      nextFormation?.attached ?? targetTransportReport.attachedUnitIds.has(id);
    const nextTargetWaaaghActive = false;
    const nextTargetOathOfMoment = false;
    const nextTargetOnObjective = false;
    const nextTargetObjectiveOwner = "unknown" as const;
    const nextTargetOnAttackerSelectedObjective = false;
    const nextAttackerOnTargetSelectedObjective = false;
    const nextTargetOnTargetSelectedObjective = false;
    const nextAttackerGuidedAgainstTarget = false;
    const nextTargetSpotted = false;
    const nextTargetSpottedByMarkerlightObserver = false;
    const nextTargetClosestEligible = false;
    const nextAttackerSourceTargetDistance = 0;
    const nextTargetSourceAttackerDistance = 0;
    const nextAttackerSourceCanSeeTarget = false;
    const nextTargetSourceCanSeeAttacker = false;
    const nextTargetStrengthState = "full" as const;
    setTargetModelId(firstSegment?.id ?? (model ? `${nextTarget?.id}:${model.id}` : ""));
    setActiveTargetPresetIds(
      withoutLimitedAbilityPresetIds(
        nextTargetPresetUnit?.combatPresets ?? [],
        nextTargetPresetIds,
      ),
    );
    setActiveSupportPresetIds([]);
    setTargetSupportUnitId("");
    setActiveTargetSupportPresetIds([]);
    if (!weaponProfile || !model || !nextTarget) {
      setProfile((current) => ({
        ...current,
        targetAttached: nextTargetAttached,
        targetWaaaghActive: nextTargetWaaaghActive,
        targetOathOfMoment: nextTargetOathOfMoment,
        targetOnObjective: nextTargetOnObjective,
        targetObjectiveOwner: nextTargetObjectiveOwner,
        targetOnAttackerSelectedObjective: nextTargetOnAttackerSelectedObjective,
        attackerOnTargetSelectedObjective: nextAttackerOnTargetSelectedObjective,
        targetOnTargetSelectedObjective: nextTargetOnTargetSelectedObjective,
        attackerGuidedAgainstTarget: nextAttackerGuidedAgainstTarget,
        targetSpotted: nextTargetSpotted,
        targetSpottedByMarkerlightObserver: nextTargetSpottedByMarkerlightObserver,
        targetClosestEligible: nextTargetClosestEligible,
        attackerSourceTargetDistance: nextAttackerSourceTargetDistance,
        targetSourceAttackerDistance: nextTargetSourceAttackerDistance,
        attackerSourceCanSeeTarget: nextAttackerSourceCanSeeTarget,
        targetSourceCanSeeAttacker: nextTargetSourceCanSeeAttacker,
        targetBattleShocked: nextTargetBattleShocked,
        targetStrengthState: nextTargetStrengthState,
        targetSupportDistance: 0,
      }));
      setResult(null);
      return;
    }
    setProfile(
      applyCombatPresets(
        applyWeaponProfile(
          {
            ...applyTargetProfile(DEFAULT_PROFILE, model),
            weaponCount: selectedWeapon?.count ?? 1,
            targetModels: nextFormation?.modelCount ?? nextTarget.modelCount,
            targetDistance: profile.targetDistance,
            attackerUnitModels: profile.attackerUnitModels,
            nearbyEnemyModels: profile.nearbyEnemyModels,
            nearbyEnemyUnits: profile.nearbyEnemyUnits,
            enemyCharacterModelsDestroyed: profile.enemyCharacterModelsDestroyed,
            destructiveFightPhases: profile.destructiveFightPhases,
            embarkedModels: profile.embarkedModels,
            embarkedWracksModels: profile.embarkedWracksModels,
            attackerCharged: profile.attackerCharged,
            attackerRemainedStationary: profile.attackerRemainedStationary,
            attackerBattleShocked: profile.attackerBattleShocked,
            targetBattleShocked: nextTargetBattleShocked,
            targetAttached: nextTargetAttached,
            attackerWaaaghActive: profile.attackerWaaaghActive,
            targetWaaaghActive: nextTargetWaaaghActive,
            targetOathOfMoment: nextTargetOathOfMoment,
            attackerOathWoundBonusEligible: profile.attackerOathWoundBonusEligible,
            attackerOnObjective: profile.attackerOnObjective,
            targetOnObjective: nextTargetOnObjective,
            attackerObjectiveOwner: profile.attackerObjectiveOwner,
            targetObjectiveOwner: nextTargetObjectiveOwner,
            attackerOnAttackerSelectedObjective: profile.attackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective: nextTargetOnAttackerSelectedObjective,
            attackerOnTargetSelectedObjective: nextAttackerOnTargetSelectedObjective,
            targetOnTargetSelectedObjective: nextTargetOnTargetSelectedObjective,
            attackerGuidedAgainstTarget: nextAttackerGuidedAgainstTarget,
            targetSpotted: nextTargetSpotted,
            targetSpottedByMarkerlightObserver: nextTargetSpottedByMarkerlightObserver,
            targetClosestEligible: nextTargetClosestEligible,
            attackerSourceTargetDistance: nextAttackerSourceTargetDistance,
            targetSourceAttackerDistance: nextTargetSourceAttackerDistance,
            attackerSourceCanSeeTarget: nextAttackerSourceCanSeeTarget,
            targetSourceCanSeeAttacker: nextTargetSourceCanSeeAttacker,
            targetStrengthState: nextTargetStrengthState,
            supportDistance: profile.supportDistance,
            targetSupportDistance: 0,
          },
          weaponProfile,
          model.keywords,
        ),
        [
          ...selectedCombatPresets(
            [...activeAttackerPresetIds, ...selectedFullSourceEquipmentPresetIds],
            attackerFormationCatalogueUnit,
            weaponProfile,
            model.keywords,
            profile.targetDistance,
            profile.attackerCharged,
            profile.attackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            profile.attackerRemainedStationary,
            profile.attackerAttached,
            profile.attackerWaaaghActive,
            nextTargetOathOfMoment,
            profile.attackerOathWoundBonusEligible,
            profile.attackerOnObjective,
            nextTargetOnObjective,
            profile.attackerOnObjective && profile.attackerObjectiveOwner === "attacker",
            false,
            profile.attackerOnAttackerSelectedObjective,
            nextTargetOnAttackerSelectedObjective,
            profile.attackerBattleShocked,
            nextAttackerGuidedAgainstTarget,
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "self",
            [],
            0,
            nextTargetClosestEligible,
            nextAttackerSourceTargetDistance,
            nextAttackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
          ...selectedCombatPresets(
            activeSupportPresetIds,
            supportCatalogueUnit,
            weaponProfile,
            model.keywords,
            profile.targetDistance,
            profile.attackerCharged,
            profile.attackerBattleShocked,
            nextTargetBattleShocked,
            nextTargetStrengthState,
            profile.attackerRemainedStationary,
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
            nextAttackerGuidedAgainstTarget,
            nextTargetSpotted,
            nextTargetSpottedByMarkerlightObserver,
            "supporting_unit",
            attackerFormationKeywords,
            profile.supportDistance,
            nextTargetClosestEligible,
            nextAttackerSourceTargetDistance,
            nextAttackerSourceCanSeeTarget,
            attackerFormationKeywords,
          ),
        ],
        selectedCombatPresets(
          nextTargetPresetIds,
          nextTargetPresetUnit,
          weaponProfile,
          model.keywords,
          profile.targetDistance,
          profile.attackerCharged,
          profile.attackerBattleShocked,
          nextTargetBattleShocked,
          nextTargetStrengthState,
          profile.attackerRemainedStationary,
          nextTargetAttached,
          nextTargetWaaaghActive,
          false,
          false,
          nextTargetOnObjective,
          profile.attackerOnObjective,
          false,
          profile.attackerOnObjective &&
            ["attacker", "uncontrolled"].includes(profile.attackerObjectiveOwner),
          nextTargetOnTargetSelectedObjective,
          nextAttackerOnTargetSelectedObjective,
          nextTargetBattleShocked,
          false,
          nextTargetSpotted,
          nextTargetSpottedByMarkerlightObserver,
          "self",
          [],
          0,
          nextTargetClosestEligible,
          nextTargetSourceAttackerDistance,
          nextTargetSourceCanSeeAttacker,
          attackerFormationKeywords,
        ),
        weaponProfile.type,
        {
          targetKeywords: model.keywords,
          attackerKeywords: attackerFormationKeywords,
          attackKeywords: attackKeywordsForWeapon(weaponProfile),
          targetDistance: profile.targetDistance,
          attackerUnitModels: profile.attackerUnitModels,
          nearbyEnemyModels: profile.nearbyEnemyModels,
          nearbyEnemyUnits: profile.nearbyEnemyUnits,
          enemyCharacterModelsDestroyed: profile.enemyCharacterModelsDestroyed,
          destructiveFightPhases: profile.destructiveFightPhases,
          embarkedModels: profile.embarkedModels,
          embarkedWracksModels: profile.embarkedWracksModels,
          attackerCharged: profile.attackerCharged,
          attackerRemainedStationary: profile.attackerRemainedStationary,
          attackerAttached: profile.attackerAttached,
          targetAttached: nextTargetAttached,
          attackerWaaaghActive: profile.attackerWaaaghActive,
          targetWaaaghActive: nextTargetWaaaghActive,
          targetOathOfMoment: nextTargetOathOfMoment,
          attackerOathWoundBonusEligible: profile.attackerOathWoundBonusEligible,
          attackerOnObjective: profile.attackerOnObjective,
          targetOnObjective: nextTargetOnObjective,
          attackerObjectiveOwner: profile.attackerObjectiveOwner,
          targetObjectiveOwner: nextTargetObjectiveOwner,
          attackerOnAttackerSelectedObjective: profile.attackerOnAttackerSelectedObjective,
          targetOnAttackerSelectedObjective: nextTargetOnAttackerSelectedObjective,
          attackerOnTargetSelectedObjective: nextAttackerOnTargetSelectedObjective,
          targetOnTargetSelectedObjective: nextTargetOnTargetSelectedObjective,
          attackerGuidedAgainstTarget: nextAttackerGuidedAgainstTarget,
          targetSpotted: nextTargetSpotted,
          targetSpottedByMarkerlightObserver: nextTargetSpottedByMarkerlightObserver,
          targetClosestEligible: nextTargetClosestEligible,
          attackerSourceTargetDistance: nextAttackerSourceTargetDistance,
          targetSourceAttackerDistance: nextTargetSourceAttackerDistance,
          attackerSourceCanSeeTarget: nextAttackerSourceCanSeeTarget,
          targetSourceCanSeeAttacker: nextTargetSourceCanSeeAttacker,
          attackerBattleShocked: profile.attackerBattleShocked,
          targetBattleShocked: nextTargetBattleShocked,
          targetStrengthState: nextTargetStrengthState,
          supportDistance: profile.supportDistance,
          supportedUnitKeywords: attackerFormationKeywords,
          targetSupportDistance: 0,
          targetSupportedUnitKeywords: model.keywords,
        },
      ),
    );
    setResult(null);
  };

  const applyActivePresetSelection = (attackerIds: string[], targetIds: string[]) => {
    if (!weaponProfile) return;
    refreshProfile(weaponId, targetModelId, profileId, attackerIds, targetIds);
  };

  const roll = () => {
    if (!attackerUnit || !targetUnit || !selectedWeapon || !weaponProfile) return;
    if (firingDeckChoice && !validFiringDeckPassengerIds.has(firingDeckChoice.passengerUnitId)) {
      setStatus("Assign this passenger to the attacking Transport in Army Lists first");
      return;
    }
    if (firingDeckChoice && firingDeckPassengerAlreadyShot) {
      setStatus("Firing Deck cannot use models from a unit that has already shot this phase");
      return;
    }
    const resolvedAttackerBattleShocked =
      battleClock?.status === "active"
        ? attackerFormationBattleShocked
        : profile.attackerBattleShocked;
    const resolvedTargetBattleShocked =
      battleClock?.status === "active" ? targetFormationBattleShocked : profile.targetBattleShocked;
    let rolled: RollResult | OrderedVolleyRollResult;
    let declaredWeaponCount = 0;
    try {
      if (
        resolvingFireOverwatch &&
        weaponProfile.abilities.some((ability) => ability.name.toLowerCase() === "hazardous")
      ) {
        throw new Error(
          "Hazardous Fire Overwatch is fail-closed until its self-damage and Charge-phase deferral are replayed",
        );
      }
      if (targetFormationModels.ambiguousComponents.length > 0) {
        throw new Error(
          `Set an exact model composition for ${targetFormationModels.ambiguousComponents.join(
            ", ",
          )} before resolving this formation`,
        );
      }
      const targetPresets = selectedCombatPresets(
        activeTargetPresetIds,
        targetFormationCatalogueUnit,
        weaponProfile,
        selectedTargetSegment?.model.keywords ?? [],
        profile.targetDistance,
        profile.attackerCharged,
        resolvedAttackerBattleShocked,
        resolvedTargetBattleShocked,
        profile.targetStrengthState,
        profile.attackerRemainedStationary,
        profile.targetAttached,
        profile.targetWaaaghActive,
      );
      const attackKeywords = attackKeywordsForWeapon(weaponProfile);
      const orderedTargets = applyDefensiveEquipmentTargets(
        applyTargetCombatPresets(targetFormationModels.targets, targetPresets, [
          {
            weaponType: weaponProfile.type,
            weaponName: weaponProfile.name,
            attackKeywords,
            attackerKeywords: attackerFormationKeywords,
            targetDistance: profile.targetDistance,
            attackerCharged: profile.attackerCharged,
            attackerBattleShocked: resolvedAttackerBattleShocked,
            targetBattleShocked: resolvedTargetBattleShocked,
            targetStrengthState: profile.targetStrengthState,
            attackerRemainedStationary: profile.attackerRemainedStationary,
            targetAttached: profile.targetAttached,
            targetWaaaghActive: profile.targetWaaaghActive,
            attackerUnitModels: profile.attackerUnitModels,
            nearbyEnemyModels: profile.nearbyEnemyModels,
            nearbyEnemyUnits: profile.nearbyEnemyUnits,
            enemyCharacterModelsDestroyed: profile.enemyCharacterModelsDestroyed,
            destructiveFightPhases: profile.destructiveFightPhases,
            embarkedModels: profile.embarkedModels,
            embarkedWracksModels: profile.embarkedWracksModels,
            attackerOnObjective: profile.attackerOnObjective,
            targetOnObjective: profile.targetOnObjective,
            attackerObjectiveOwner: profile.attackerObjectiveOwner,
            targetObjectiveOwner: profile.targetObjectiveOwner,
            attackerOnTargetSelectedObjective: profile.attackerOnTargetSelectedObjective,
            targetOnTargetSelectedObjective: profile.targetOnTargetSelectedObjective,
            targetClosestEligible: profile.targetClosestEligible,
            targetSourceAttackerDistance: profile.targetSourceAttackerDistance,
            targetSourceCanSeeAttacker: profile.targetSourceCanSeeAttacker,
          },
        ]),
        targetDefensiveEquipmentOptions,
        attackKeywords,
      );
      const attackProfiles = (
        selectedSourceEquipmentSegments.length
          ? selectedSourceEquipmentSegments
          : [{ count: profile.weaponCount, sourceEquipmentPresetIds: [] }]
      ).map((segment) => {
        const base = {
          ...profile,
          weaponCount: segment.count,
          attackerBattleShocked: resolvedAttackerBattleShocked,
          targetBattleShocked: resolvedTargetBattleShocked,
        };
        if (
          selectedSourceEquipmentSegments.length <= 1 ||
          !(segment.sourceEquipmentPresetIds ?? []).length
        ) {
          return resolvingFireOverwatch ? applyFireOverwatchAttackRules(base) : base;
        }
        const applied = applyCombatPresets(
          base,
          selectedCombatPresets(
            segment.sourceEquipmentPresetIds ?? [],
            weaponSourceCatalogueUnit,
            weaponProfile,
            selectedTargetSegment?.model.keywords ?? [],
            profile.targetDistance,
            profile.attackerCharged,
            resolvedAttackerBattleShocked,
            resolvedTargetBattleShocked,
            profile.targetStrengthState,
            profile.attackerRemainedStationary,
          ),
          [],
          weaponProfile.type,
          {
            attackerCharged: profile.attackerCharged,
            attackerBattleShocked: resolvedAttackerBattleShocked,
            targetBattleShocked: resolvedTargetBattleShocked,
            targetStrengthState: profile.targetStrengthState,
            targetKeywords: selectedTargetSegment?.model.keywords ?? [],
            attackKeywords,
          },
        );
        return resolvingFireOverwatch ? applyFireOverwatchAttackRules(applied) : applied;
      });
      declaredWeaponCount = attackProfiles.reduce(
        (total, attackProfile) => total + attackProfile.weaponCount,
        0,
      );
      rolled = simulateOrderedVolley(
        attackProfiles,
        orderedTargets,
        targetFormationModels.initialWoundsLost,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack could not be resolved");
      return;
    }
    const attackId = crypto.randomUUID();
    let nextBattleState = battleState;
    try {
      if (!targetFormation || !attackerFormation || !catalogue) {
        throw new Error("Battle state is not ready");
      }
      if (!nextBattleState) throw new Error("Battle setup is not ready");
      const replayedBeforeAttack = replayBattleState(nextBattleState);
      if (replayedBeforeAttack.clock.phase === "fight" && !replayedBeforeAttack.activeActivation) {
        throw new Error("Begin the Fight activation and record Pile In before attacking");
      }
      if (!replayedBeforeAttack.activeActivation) {
        nextBattleState = startFormationActivation(
          nextBattleState,
          attackerBattleFormationId,
          battleActionOptions,
          crypto.randomUUID(),
          nextBattleState.events.length + 1,
        );
      }
      let targetEligibilityEventId = "";
      if (weaponProfile.type === "Ranged") {
        targetEligibilityEventId = crypto.randomUUID();
        nextBattleState = recordRangedTargetEligibility(
          nextBattleState,
          {
            attackerFormationId: `${attackerPlayerId}:${attackerFormation.id}`,
            targetFormationId: targetBattleFormationId,
            weaponId: String(weaponProfile.id),
            weaponName: weaponProfile.name,
            weaponSourceFormationId,
            sourceSavedUnitId: weaponSourceArmyUnit?.id ?? "",
            weaponGroupId: selectedWeaponGroup?.id ?? "",
            publishedRangeThousandths: Math.round((weaponProfile.range ?? 0) * 1000),
            effectiveRangeThousandths: Math.round(effectiveWeaponRange * 1000),
            measuredDistanceThousandths: Math.round(profile.targetDistance * 1000),
            visible: targetVisible,
            fullyVisible: targetFullyVisible,
            indirectFire: !targetVisible && profile.indirect,
            weaponHasIndirect,
            eligibleWeaponCount: declaredWeaponCount,
            method: targetMeasurementMethod,
            reviewedByPlayer: targetEligibilityReviewed,
            reviewReason: targetMeasurementReason.trim(),
            rangeOverrideReason: rangeOverrideReason.trim(),
          },
          targetEligibilityEventId,
          nextBattleState.events.length + 1,
        );
      }
      nextBattleState = appendResolvedAttack(nextBattleState, {
        id: attackId,
        at: nextBattleState.events.length + 1,
        attackerFormationId: `${attackerPlayerId}:${attackerFormation.id}`,
        targetFormationId: targetBattleFormationId,
        segmentIds: targetFormationModels.orderedSegments.map((segment) => segment.id),
        targets: orderedTargets,
        initialWoundsLost: targetFormationModels.initialWoundsLost,
        result: rolled,
        weaponHasAssault,
        weaponType: weaponProfile.type,
        targetEligibilityConfirmed: battleActionOptions.targetEligibilityConfirmed,
        targetEligibilityReason: battleActionOptions.targetEligibilityReason,
        targetEligibilityEventId,
        weaponId: String(weaponProfile.id),
        declaredWeaponCount,
        indirectFire: weaponProfile.type === "Ranged" && !targetVisible && profile.indirect,
        weaponSourceFormationId,
        sourceSavedUnitId: weaponSourceArmyUnit?.id ?? "",
        weaponGroupId: selectedWeaponGroup?.id ?? "",
        summary: {
          attacker: attackerFormation.name,
          weapon: weaponProfile.name,
          target: targetFormation.name,
          damage: rolled.appliedDamage,
          successful: rolled.successfulAttacks,
        },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack could not be recorded");
      return;
    }
    setBattleState(nextBattleState);
    setResult(rolled);
    setHistory((current) =>
      [
        {
          id: attackId,
          attacker: attackerFormation?.name ?? attackerUnit.name,
          weapon: weaponProfile.name,
          target: targetFormation?.name ?? targetUnit.name,
          damage: rolled.appliedDamage,
          successful: rolled.successfulAttacks,
        },
        ...current,
      ].slice(0, 30),
    );
    setStatus(`${rolled.appliedDamage} damage applied`);
    requestAnimationFrame(() => latestResult.current?.focus());
  };

  const setNumber = (key: keyof CombatProfile, value: number) =>
    setProfile((current) => ({ ...current, [key]: value }));

  const startGuidedBattle = () => {
    if (!battleState) return;
    try {
      setBattleState(
        startBattle(
          battleState,
          attackerPlayerId,
          crypto.randomUUID(),
          battleState.events.length + 1,
        ),
      );
      setStatus(`${attackerList?.name ?? "Attacker"} has the first turn`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Battle could not start");
    }
  };

  const confirmWeaponBearers = (
    formationId: string,
    sourceSavedUnitId: string,
    groupId: string,
    bearerModelIds: string[],
  ) => {
    if (!battleState) return;
    try {
      const next = configureBattleWeaponBearers(
        battleState,
        formationId,
        sourceSavedUnitId,
        groupId,
        bearerModelIds,
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus("Weapon bearer assignments confirmed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Weapon bearers could not be configured");
    }
  };

  const declareDeployments = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!battleState || !replayedBattle) return;
    try {
      const data = new FormData(event.currentTarget);
      let next = battleState;
      for (const formation of replayedBattle.formations.values()) {
        const location = String(data.get(`location-${formation.id}`) || "battlefield");
        const transportFormationId =
          location === "embarked" ? formation.assignedTransportFormationId : "";
        const transportLocation = transportFormationId
          ? String(data.get(`location-${transportFormationId}`) || "battlefield")
          : "";
        const inReserves =
          ["reserves", "strategic_reserves"].includes(location) ||
          (location === "embarked" &&
            ["reserves", "strategic_reserves"].includes(transportLocation));
        const countsTowardStrategicReserves =
          location === "strategic_reserves" ||
          (location === "embarked" && transportLocation === "strategic_reserves");
        next = declareFormationDeployment(
          next,
          formation.id,
          location,
          {
            points: countsTowardStrategicReserves
              ? Math.max(0, Number(data.get(`points-${formation.id}`)) || 0)
              : 0,
            earliestBattleRound:
              location === "strategic_reserves"
                ? Math.max(2, Number(data.get(`round-${formation.id}`)) || 2)
                : Math.max(1, Number(data.get(`round-${formation.id}`)) || 1),
            eligibilityConfirmed: !inReserves || data.get(`eligible-${formation.id}`) === "on",
            eligibilityReason: inReserves
              ? String(data.get(`reason-${formation.id}`) || "").trim()
              : location === "embarked"
                ? "Core rules Transport declaration"
                : "Battlefield deployment",
            transportFormationId,
          },
          crypto.randomUUID(),
          next.events.length + 1,
        );
      }
      setBattleState(next);
      setStatus("Deployment declarations recorded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deployment could not be declared");
    }
  };

  const recordFormationDeployment = (formationId: string) => {
    if (!battleState) return;
    try {
      const next = deployFormation(
        battleState,
        formationId,
        {
          placementConfirmed: deploymentPlacementConfirmed,
          placementReason: deploymentPlacementReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setDeploymentPlacementConfirmed(false);
      setDeploymentPlacementReason("");
      setStatus(`${battleFormation(next, formationId)?.name ?? "Formation"} deployed`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Formation could not be deployed");
    }
  };

  const recordReserveArrival = () => {
    if (!battleState || !attackerBattleFormationId) return;
    try {
      const next = arriveFromReserves(
        battleState,
        attackerBattleFormationId,
        {
          placementConfirmed: reservePlacementConfirmed,
          placementReason: reservePlacementReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setReservePlacementConfirmed(false);
      setReservePlacementReason("");
      setStatus(`${attackerFormation?.name ?? "Formation"} arrived from Reserves`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Reserve could not arrive");
    }
  };

  const configureMission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!battleState) return;
    try {
      const data = new FormData(event.currentTarget);
      const objectiveCount = Math.min(12, Math.max(0, Number(data.get("objectives")) || 0));
      const startingCommandPoints = Object.fromEntries(
        battleState.players.map((player) => [
          player.id,
          Math.min(100, Math.max(0, Number(data.get(`starting-${player.id}`)) || 0)),
        ]),
      );
      const next = configureBattleMission(
        battleState,
        {
          name: String(data.get("mission") || "Custom mission").trim() || "Custom mission",
          pointsLimit: Math.min(100000, Math.max(0, Number(data.get("points-limit")) || 0)),
          deploymentFirstPlayerId: String(
            data.get("deployment-first") || battleState.players[0].id,
          ),
          commandPointsPerCommandPhase: Math.min(
            10,
            Math.max(0, Number(data.get("command-points")) || 0),
          ),
          startingCommandPoints,
          objectives: Array.from({ length: objectiveCount }, (_, index) => ({
            id: `objective-${index + 1}`,
            name: `Objective ${index + 1}`,
          })),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus("Mission setup recorded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mission setup could not be recorded");
    }
  };

  const updateTrackedResource = (
    playerId: string,
    resourceId: string,
    name: string,
    delta: number,
    maximum: number | null,
    reason: string,
  ) => {
    if (!battleState) return;
    try {
      const next = changeBattleResource(
        battleState,
        { playerId, resourceId, name, delta, maximum, reason },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus(`${name} ${delta >= 0 ? "+" : ""}${delta}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Resource could not be changed");
    }
  };

  const addTrackedResource = (playerId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("resource-name") || "").trim();
    if (!name) {
      setStatus("Enter a resource name");
      return;
    }
    const resourceId = `custom:${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const maximumText = String(data.get("resource-maximum") || "").trim();
    const maximum = maximumText ? Math.min(100000, Math.max(0, Number(maximumText) || 0)) : null;
    updateTrackedResource(playerId, resourceId, name, 0, maximum, "Resource added");
    event.currentTarget.reset();
  };

  const recordScore = (playerId: string, points: number, category: string, reason: string) => {
    if (!battleState) return;
    try {
      const next = scoreBattlePoints(
        battleState,
        playerId,
        points,
        category,
        reason,
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus(`${points >= 0 ? "+" : ""}${points} Victory Points`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Score could not be recorded");
    }
  };

  const recordCustomScore = (playerId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const points = Math.min(1000, Math.max(-1000, Number(data.get("score-points")) || 0));
    const category = String(data.get("score-category") || "other");
    const reason = String(data.get("score-reason") || "Manual score").trim() || "Manual score";
    if (!Number.isInteger(points) || points === 0) {
      setStatus("Score must be a non-zero whole number");
      return;
    }
    recordScore(playerId, points, category, reason);
    event.currentTarget.reset();
  };

  const updateObjectiveControl = (
    objectiveId: string,
    controllerPlayerId: string,
    contested: boolean,
  ) => {
    if (!battleState) return;
    try {
      setBattleState(
        setBattleObjectiveControl(
          battleState,
          objectiveId,
          controllerPlayerId,
          contested,
          crypto.randomUUID(),
          battleState.events.length + 1,
        ),
      );
      setStatus("Objective control recorded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Objective control could not be recorded");
    }
  };

  const updateFormationBattleShock = (
    formationId: string,
    battleShocked: boolean,
    role: "attacker" | "target",
  ) => {
    let nextAttacker = role === "attacker" ? battleShocked : profile.attackerBattleShocked;
    let nextTarget = role === "target" ? battleShocked : profile.targetBattleShocked;
    if (battleState && battleClock?.status === "active" && formationId) {
      try {
        const next = setFormationBattleShocked(
          battleState,
          formationId,
          battleShocked,
          battleShocked ? "Failed Battle-shock test" : "Battle-shock cleared",
          crypto.randomUUID(),
          battleState.events.length + 1,
        );
        setBattleState(next);
        const replayed = replayBattleState(next);
        nextAttacker = Boolean(
          attackerBattleFormationId &&
            replayed.battleShockedFormations.has(attackerBattleFormationId),
        );
        nextTarget = Boolean(
          targetBattleFormationId && replayed.battleShockedFormations.has(targetBattleFormationId),
        );
        setStatus(battleShocked ? "Battle-shock recorded" : "Battle-shock cleared");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Battle-shock could not be recorded");
        return;
      }
    }
    refreshProfile(
      weaponId,
      targetModelId,
      profileId,
      activeAttackerPresetIds,
      activeTargetPresetIds,
      profile.targetDistance,
      profile.attackerCharged,
      nextAttacker,
      nextTarget,
    );
  };

  const advanceGuidedBattle = () => {
    if (!battleState) return;
    try {
      const next = advanceBattleClock(
        battleState,
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      const replayed = replayBattleState(next);
      refreshProfile(
        weaponId,
        targetModelId,
        profileId,
        activeAttackerPresetIds,
        activeTargetPresetIds,
        profile.targetDistance,
        profile.attackerCharged,
        Boolean(
          attackerBattleFormationId &&
            replayed.battleShockedFormations.has(attackerBattleFormationId),
        ),
        Boolean(
          targetBattleFormationId && replayed.battleShockedFormations.has(targetBattleFormationId),
        ),
      );
      setStatus(battleClockLabel(replayBattleState(next).clock, next.players));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Battle could not advance");
    }
  };

  const recordSelectedMovement = (movement: "stationary" | "normal" | "advance" | "fall_back") => {
    if (!battleState || !attackerBattleFormationId) return;
    try {
      const movementStarted =
        replayBattleState(battleState).movementStartsByFormation.get(attackerBattleFormationId);
      const next =
        movement === "stationary" || movementStarted
          ? completeFormationMovement(
              battleState,
              attackerBattleFormationId,
              movement,
              crypto.randomUUID(),
              battleState.events.length + 1,
            )
          : startFormationMovement(
              battleState,
              attackerBattleFormationId,
              movement,
              crypto.randomUUID(),
              battleState.events.length + 1,
            );
      setBattleState(next);
      refreshProfile(
        weaponId,
        targetModelId,
        profileId,
        activeAttackerPresetIds,
        activeTargetPresetIds,
        profile.targetDistance,
        profile.attackerCharged,
        profile.attackerBattleShocked,
        profile.targetBattleShocked,
        profile.targetStrengthState,
        movement === "stationary",
      );
      setStatus(
        movement === "stationary"
          ? `${attackerFormation?.name ?? "Formation"} · remained stationary`
          : movementStarted
            ? `${attackerFormation?.name ?? "Formation"} · ${movement.replace("_", " ")} complete · Fire Overwatch response`
            : `${attackerFormation?.name ?? "Formation"} · ${movement.replace("_", " ")} started · Fire Overwatch response`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Movement could not be recorded");
    }
  };

  const recordSelectedEmbarkation = () => {
    if (!battleState || !attackerBattleFormationId || !assignedTransportFormationId) return;
    try {
      const next = embarkFormation(
        battleState,
        attackerBattleFormationId,
        assignedTransportFormationId,
        {
          rangeConfirmed: transportPlacementConfirmed,
          rangeReason: transportPlacementReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setTransportPlacementConfirmed(false);
      setTransportPlacementReason("");
      setStatus(`${attackerFormation?.name ?? "Formation"} embarked`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Formation could not embark");
    }
  };

  const recordSelectedDisembarkation = () => {
    if (!battleState || !attackerBattleFormationId || !selectedEmbarkedTransportId) return;
    try {
      const next = disembarkFormation(
        battleState,
        attackerBattleFormationId,
        selectedEmbarkedTransportId,
        {
          placementConfirmed: transportPlacementConfirmed,
          placementReason: transportPlacementReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setTransportPlacementConfirmed(false);
      setTransportPlacementReason("");
      setStatus(`${attackerFormation?.name ?? "Formation"} disembarked`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Formation could not disembark");
    }
  };

  const resolvePendingDestroyedTransport = () => {
    if (!battleState || !pendingDestroyedTransport) return;
    try {
      const next = resolveDestroyedTransport(
        battleState,
        pendingDestroyedTransport.transportFormationId,
        pendingDestroyedTransport.passengerFormationIds.map((formationId: string) => ({
          formationId,
          firstSegmentId:
            destroyedTransportOptions[formationId]?.firstSegmentId ??
            replayedBattle.formations
              .get(formationId)
              ?.segments.find(
                (segment: { id: string }) =>
                  replayedBattle.formations.get(formationId)?.health[segment.id].modelsRemaining >
                  0,
              )?.id ??
            "",
          emergency: destroyedTransportOptions[formationId]?.emergency ?? false,
          unplacedModels: destroyedTransportOptions[formationId]?.unplacedModels ?? 0,
          placementConfirmed: transportPlacementConfirmed,
          placementReason: transportPlacementReason.trim(),
        })),
        crypto.randomUUID(),
        battleState.events.length + 1,
        undefined,
        {
          deadlyDemiseResolvedConfirmed,
          deadlyDemiseResolutionReason:
            "Deadly Demise resolved before disembarkation, or the Transport has no such ability",
        },
      );
      const resolved = next.events.at(-1);
      setBattleState(next);
      setTransportPlacementConfirmed(false);
      setTransportPlacementReason("");
      setDeadlyDemiseResolvedConfirmed(false);
      setDestroyedTransportOptions({});
      const mortalWounds =
        resolved?.type === "transport_destroyed_resolved"
          ? resolved.passengers.reduce(
              (total: number, passenger: { summary: { damage: number } }) =>
                total + passenger.summary.damage,
              0,
            )
          : 0;
      setStatus(`Destroyed Transport resolved · ${mortalWounds} passenger damage`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Destroyed Transport could not be resolved",
      );
    }
  };

  const rollSelectedCharge = () => {
    const dice = rollChargeDice() as [number, number];
    const distance = Math.max(0, dice[0] + dice[1] + chargeRollModifier);
    setChargeDice(dice);
    setChargeDistance(distance);
    setChargeMaximumModelMove(distance);
    setChargeRollOverrideReason("");
    setStatus(`Charge roll · ${dice.join(" + ")} · ${distance}″`);
  };

  const updateChargeDie = (index: 0 | 1, value: number) => {
    const dice: [number, number] = [...chargeDice];
    dice[index] = Math.min(6, Math.max(1, value || 1));
    const distance = Math.max(0, dice[0] + dice[1] + chargeRollModifier);
    setChargeDice(dice);
    setChargeDistance(distance);
    setChargeMaximumModelMove(distance);
    setChargeRollOverrideReason("");
  };

  const updateChargeRollModifier = (value: number) => {
    const modifier = Math.min(12, Math.max(-12, value || 0));
    const distance = Math.max(0, chargeDice[0] + chargeDice[1] + modifier);
    setChargeRollModifier(modifier);
    setChargeDistance(distance);
    setChargeMaximumModelMove(distance);
    setChargeRollOverrideReason("");
  };

  const recordSelectedCharge = (successful: boolean) => {
    if (!battleState || !attackerBattleFormationId || !targetBattleFormationId) return;
    try {
      const chargeDeclaration =
        replayBattleState(battleState).chargeDeclarationsByFormation.get(attackerBattleFormationId);
      if (!chargeDeclaration) {
        const declared = declareFormationCharge(
          battleState,
          attackerBattleFormationId,
          [targetBattleFormationId],
          {
            targetFacts: [
              {
                formationId: targetBattleFormationId,
                startDistanceThousandths: Math.round(chargeTargetDistance * 1000),
              },
            ],
            phaseStartEligibilityConfirmed: chargeFacts.phaseStartEligible,
            phaseStartEligibilityReason: battleActionOptions.targetEligibilityReason,
            startedOutsideEngagementRange: chargeFacts.startedOutsideEngagementRange,
            eligibilityOverride: battleActionOptions.eligibilityOverride,
            overrideReason: battleActionOptions.overrideReason,
          },
          crypto.randomUUID(),
          battleState.events.length + 1,
        );
        setBattleState(declared);
        setStatus("Charge declared · resolve or pass Fire Overwatch before rolling the charge");
        return;
      }
      const next = recordFormationCharge(
        battleState,
        attackerBattleFormationId,
        [targetBattleFormationId],
        {
          successful,
          rolls: chargeDice,
          rollModifier: chargeRollModifier,
          chargeDistanceThousandths: Math.round(chargeDistance * 1000),
          rollOverrideReason: chargeRollOverrideReason,
          targetFacts: [
            {
              formationId: targetBattleFormationId,
              startDistanceThousandths: Math.round(chargeTargetDistance * 1000),
              endsWithinEngagementRange: successful && chargeFacts.targetEndsWithinEngagementRange,
            },
          ],
          phaseStartEligibilityConfirmed: chargeFacts.phaseStartEligible,
          phaseStartEligibilityReason: battleActionOptions.targetEligibilityReason,
          startedOutsideEngagementRange: chargeFacts.startedOutsideEngagementRange,
          maximumModelMoveThousandths: successful ? Math.round(chargeMaximumModelMove * 1000) : 0,
          unitCoherencyConfirmed: successful && chargeFacts.unitCoherency,
          nonTargetEngagementRangeAvoided: successful && chargeFacts.nonTargetsAvoided,
          allModelsCloserToTarget: successful && chargeFacts.allModelsCloser,
          baseContactMaximized: successful && chargeFacts.baseContactMaximized,
          movementReviewedByPlayer: chargeFacts.reviewedByPlayer,
          movementReviewReason: chargeMovementReviewReason,
          failureReason: successful ? "" : chargeFailureReason,
          eligibilityOverride: battleActionOptions.eligibilityOverride,
          overrideReason: battleActionOptions.overrideReason,
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      refreshProfile(
        weaponId,
        targetModelId,
        profileId,
        activeAttackerPresetIds,
        activeTargetPresetIds,
        profile.targetDistance,
        successful,
      );
      setStatus(
        successful
          ? `Successful charge · ${chargeDice.join(" + ")} · Heroic Intervention response required`
          : `Failed charge · ${chargeDice.join(" + ")} · ${chargeDistance.toFixed(3)}″`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Charge could not be recorded");
    }
  };

  const beginFireOverwatch = () => {
    if (!battleState || !pendingFireOverwatch || !selectedFireOverwatchFormationId) return;
    try {
      const before = replayBattleState(battleState);
      const shooter = before.formations.get(selectedFireOverwatchFormationId);
      const target = before.formations.get(pendingFireOverwatch.targetFormationId);
      if (!shooter || !target) throw new Error("Fire Overwatch formations are unavailable");
      const next = startFireOverwatch(
        battleState,
        selectedFireOverwatchFormationId,
        {
          commandPointCost: fireOverwatchCommandPointCost,
          costOverrideReason: fireOverwatchCostOverrideReason.trim(),
          usageOverrideReason: fireOverwatchUsageOverrideReason.trim(),
          stratagemEligibilityOverrideReason: fireOverwatchEligibilityOverrideReason.trim(),
          distanceThousandths: Math.round(fireOverwatchDistance * 1000),
          targetVisible: fireOverwatchTargetVisible,
          shootingEligibilityConfirmed: fireOverwatchEligibilityConfirmed,
          shootingEligibilityReason: fireOverwatchEligibilityReason.trim(),
          outOfPhaseRestrictionsConfirmed: fireOverwatchOutOfPhaseConfirmed,
          outOfPhaseRestrictionsReason: fireOverwatchOutOfPhaseReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      const shooterPlayer = next.players.find((player) => player.id === shooter.playerId);
      const targetPlayer = next.players.find((player) => player.id === target.playerId);
      if (!shooterPlayer || !targetPlayer)
        throw new Error("Fire Overwatch players are unavailable");
      setBattleState(next);
      setAttackerListId(shooterPlayer.listId);
      setTargetListId(targetPlayer.listId);
      setAttackerUnitId(shooter.segments[0]?.savedUnitId ?? "");
      setTargetUnitId(target.segments[0]?.savedUnitId ?? "");
      setWeaponId("");
      setProfileId("");
      setTargetModelId("");
      setActiveAttackerPresetIds([]);
      setActiveTargetPresetIds([]);
      setResult(null);
      setStatus(
        `Fire Overwatch started · ${shooter.name} must shoot only ${target.name} · unmodified 6s hit`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fire Overwatch could not start");
    }
  };

  const declineFireOverwatch = () => {
    if (!battleState || !pendingFireOverwatch) return;
    try {
      const next = passFireOverwatch(
        battleState,
        fireOverwatchPassReason.trim() || "Responding player declined Fire Overwatch",
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setFireOverwatchPassReason("");
      setStatus("Fire Overwatch declined · continue the triggering action");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fire Overwatch could not be declined");
    }
  };

  const rollHeroicIntervention = () => {
    const dice = rollChargeDice() as [number, number];
    const distance = Math.max(0, dice[0] + dice[1] + heroicRollModifier);
    setHeroicDice(dice);
    setHeroicDistance(distance);
    setHeroicMaximumModelMove(Math.min(6, distance));
    setHeroicRollOverrideReason("");
    setStatus(`Heroic Intervention roll · ${dice.join(" + ")} · ${distance}″`);
  };

  const updateHeroicDie = (index: 0 | 1, value: number) => {
    const dice: [number, number] = [...heroicDice];
    dice[index] = Math.min(6, Math.max(1, value || 1));
    const distance = Math.max(0, dice[0] + dice[1] + heroicRollModifier);
    setHeroicDice(dice);
    setHeroicDistance(distance);
    setHeroicMaximumModelMove(Math.min(6, distance));
    setHeroicRollOverrideReason("");
  };

  const recordHeroicIntervention = (successful: boolean) => {
    if (!battleState || !selectedHeroicFormationId || !pendingHeroicIntervention) return;
    try {
      const next = resolveHeroicIntervention(
        battleState,
        selectedHeroicFormationId,
        {
          commandPointCost: heroicCommandPointCost,
          costOverrideReason: heroicCostOverrideReason.trim(),
          usageOverrideReason: heroicUsageOverrideReason.trim(),
          stratagemEligibilityOverrideReason: heroicEligibilityOverrideReason.trim(),
          successful,
          rolls: heroicDice,
          rollModifier: heroicRollModifier,
          chargeDistanceThousandths: Math.round(heroicDistance * 1000),
          rollOverrideReason: heroicRollOverrideReason.trim(),
          startDistanceThousandths: Math.round(heroicStartDistance * 1000),
          targetEligibilityConfirmed: heroicFacts.targetEligibilityConfirmed,
          targetEligibilityReason:
            "Within 6 inches and eligible to charge only the unit that triggered this reaction",
          startedOutsideEngagementRange: heroicFacts.startedOutsideEngagementRange,
          maximumModelMoveThousandths: successful ? Math.round(heroicMaximumModelMove * 1000) : 0,
          endsWithinEngagementRange: successful && heroicFacts.endsWithinEngagementRange,
          unitCoherencyConfirmed: successful && heroicFacts.unitCoherencyConfirmed,
          nonTargetEngagementRangeAvoided:
            successful && heroicFacts.nonTargetEngagementRangeAvoided,
          allModelsCloserToTarget: successful && heroicFacts.allModelsCloserToTarget,
          baseContactMaximized: successful && heroicFacts.baseContactMaximized,
          movementReviewedByPlayer: heroicFacts.movementReviewedByPlayer,
          movementReviewReason: heroicMovementReviewReason.trim(),
          failureReason: successful ? "" : heroicFailureReason.trim(),
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus(
        successful
          ? "Heroic Intervention resolved · no Charge Bonus granted"
          : "Heroic Intervention spent and failed",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Heroic Intervention could not resolve");
    }
  };

  const passPendingHeroicIntervention = () => {
    if (!battleState || !pendingHeroicIntervention) return;
    try {
      const next = passHeroicIntervention(
        battleState,
        heroicPassReason.trim() || "Responding player declined Heroic Intervention",
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setHeroicPassReason("");
      setStatus("Heroic Intervention declined");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Reaction could not be passed");
    }
  };

  const beginSelectedFightActivation = () => {
    if (!battleState || !attackerBattleFormationId) return;
    try {
      const next = startFormationActivation(
        battleState,
        attackerBattleFormationId,
        battleActionOptions,
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setFightMoveDestination("enemy");
      setStatus("Fight activation started · record Pile In");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fight activation could not start");
    }
  };

  const recordSelectedFightMove = () => {
    if (!battleState || !pendingFightMoveStage) return;
    try {
      const destination =
        pendingFightMoveStage === "pile_in" && fightMoveDestination === "objective"
          ? "none"
          : fightMoveDestination;
      const enemyDestination = destination === "enemy";
      const objectiveDestination = destination === "objective";
      const noDestination = destination === "none";
      const next = recordFightMove(
        battleState,
        pendingFightMoveStage,
        {
          destination,
          maximumModelMoveThousandths: noDestination ? 0 : Math.round(fightMaximumModelMove * 1000),
          movementReviewedByPlayer: fightMoveFacts.reviewedByPlayer,
          movementReviewReason: fightMovementReviewReason,
          baseContactModelsStationary: fightMoveFacts.baseContactModelsStationary,
          unitCoherencyConfirmed:
            (enemyDestination || objectiveDestination) && fightMoveFacts.unitCoherency,
          endsWithinEngagementRange: enemyDestination && fightMoveFacts.endsWithinEngagementRange,
          allMovedModelsCloserToEnemy:
            enemyDestination && fightMoveFacts.allMovedModelsCloserToEnemy,
          baseContactMaximized: enemyDestination && fightMoveFacts.baseContactMaximized,
          enemyDestinationImpossible: !enemyDestination,
          objectiveId: objectiveDestination
            ? fightObjectiveId || battleObjectives[0]?.id || ""
            : "",
          endsWithinObjectiveRange: objectiveDestination && fightMoveFacts.endsWithinObjectiveRange,
          allMovedModelsCloserToObjective:
            objectiveDestination && fightMoveFacts.allMovedModelsCloserToObjective,
          objectiveDestinationImpossible:
            pendingFightMoveStage === "consolidation" && noDestination,
          outcomeReason: enemyDestination ? "" : fightOutcomeReason,
          meleeAttacksCompleteConfirmed:
            pendingFightMoveStage === "consolidation" && fightMeleeAttacksComplete,
          meleeAttacksCompletionReason:
            pendingFightMoveStage === "consolidation" ? fightMeleeAttacksCompletionReason : "",
        },
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setFightMoveDestination("enemy");
      setFightMaximumModelMove(3);
      setFightMovementReviewReason("");
      setFightOutcomeReason("");
      setFightMeleeAttacksComplete(false);
      setFightMeleeAttacksCompletionReason("");
      setFightMoveFacts({
        reviewedByPlayer: false,
        baseContactModelsStationary: false,
        unitCoherency: false,
        endsWithinEngagementRange: false,
        allMovedModelsCloserToEnemy: false,
        baseContactMaximized: false,
        endsWithinObjectiveRange: false,
        allMovedModelsCloserToObjective: false,
      });
      setStatus(
        pendingFightMoveStage === "pile_in"
          ? "Pile In recorded · resolve melee attacks, then Consolidate"
          : "Consolidation recorded · finish this activation",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fight movement could not be recorded");
    }
  };

  const finishFormationActivation = () => {
    if (!battleState) return;
    try {
      const finishingFireOverwatch =
        replayBattleState(battleState).activeActivation?.source === "fire_overwatch";
      const next = completeFormationActivation(
        battleState,
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus(
        finishingFireOverwatch
          ? "Fire Overwatch complete · continue the interrupted action"
          : "Formation activation completed",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Activation could not be completed");
    }
  };

  const yieldFightPriority = () => {
    if (!battleState) return;
    try {
      const next = passFightPriority(
        battleState,
        "No eligible formation selected at this priority",
        crypto.randomUUID(),
        battleState.events.length + 1,
      );
      setBattleState(next);
      setStatus("Fight priority passed to the other player");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Fight priority could not pass");
    }
  };

  const togglePendingChoice = (choiceId: string, optionId: string, maximum: number) => {
    setPendingChoiceSelections((current) => {
      const selected = current[choiceId] ?? [];
      const next = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : maximum === 1
          ? [optionId]
          : [...selected, optionId].slice(0, maximum);
      return { ...current, [choiceId]: next };
    });
  };

  const finishPendingChoice = (choiceId: string) => {
    if (!battleState) return;
    try {
      setBattleState(
        resolveBattleChoice(
          battleState,
          choiceId,
          pendingChoiceSelections[choiceId] ?? [],
          crypto.randomUUID(),
          battleState.events.length + 1,
        ),
      );
      setPendingChoiceSelections((current) => {
        const next = { ...current };
        delete next[choiceId];
        return next;
      });
      setStatus("Choice recorded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Choice could not be recorded");
    }
  };

  const battleAttackReady =
    Boolean(battleState && attackerBattleFormationId) &&
    battleCanResolveAttack(battleState, attackerBattleFormationId, battleActionOptions);

  const ready = Boolean(
    attackerUnit &&
      targetUnit &&
      selectedWeapon &&
      weaponProfile &&
      targetModelId &&
      !targetFormationModels.destroyed &&
      !targetBattleStateError &&
      battleRulesMatch &&
      battleRostersMatch &&
      !battleSetupError &&
      Boolean(battleState) &&
      battleAttackReady &&
      (unusedSelectedWeaponCount === null ||
        (unusedSelectedWeaponCount > 0 &&
          selectedDeclaredWeaponCount <= unusedSelectedWeaponCount)) &&
      targetFormationModels.ambiguousComponents.length === 0 &&
      !(firingDeckChoice && !validFiringDeckPassengerIds.has(firingDeckChoice.passengerUnitId)) &&
      !(firingDeckChoice && firingDeckPassengerAlreadyShot),
  );
  const readyLabel = (() => {
    if (!attackerList) return "Choose an attacking list";
    if (!attackerUnit) return "Choose an attacking unit";
    if (firingDeckChoice && !validFiringDeckPassengerIds.has(firingDeckChoice.passengerUnitId)) {
      return "Passenger is not currently embarked in this Transport";
    }
    if (firingDeckChoice && firingDeckPassengerAlreadyShot) {
      return "Passenger unit has already shot";
    }
    if (!selectedWeapon) return "Choose a weapon";
    if (unusedSelectedWeaponCount === 0) {
      return "Every locked copy of this weapon group has already fired this phase";
    }
    if (
      unusedSelectedWeaponCount !== null &&
      selectedDeclaredWeaponCount > unusedSelectedWeaponCount
    ) {
      return `Only ${unusedSelectedWeaponCount} locked weapon ${unusedSelectedWeaponCount === 1 ? "copy remains" : "copies remain"} unused this phase`;
    }
    if (!targetList) return "Choose a target list";
    if (!targetUnit) return "Choose a target unit";
    if (!targetModelId) return "Choose a target profile";
    if (targetBattleStateError) return targetBattleStateError;
    if (!battleRulesMatch) return "Battle rules snapshot does not match the loaded catalogue";
    if (!battleRostersMatch) return "A saved roster changed after this battle was set up";
    if (battleSetupError) return battleSetupError;
    if (!battleState || !battleClock) return "Preparing battle setup";
    if (battleClock.status === "setup") {
      return replayedBattle?.deploymentComplete || battleState.migration
        ? "Start the battle before resolving attacks"
        : "Finish deployment before starting the battle";
    }
    if (battleClock.status === "complete") return "The battle is complete";
    if (pendingDestroyedTransport) {
      return "Resolve the destroyed Transport and its passengers before continuing";
    }
    if (
      attackerBattleFormationId &&
      !battleFormationIsOnBattlefield(battleState, attackerBattleFormationId)
    ) {
      return "The attacking formation is not on the battlefield";
    }
    if (
      targetBattleFormationId &&
      !battleFormationIsOnBattlefield(battleState, targetBattleFormationId)
    ) {
      return "The target formation is not on the battlefield";
    }
    if (pendingBattleChoices.length > 0) {
      return "Resolve the pending choice before attacking";
    }
    if (battleClock.activePlayerId !== attackerPlayerId && !resolvingFireOverwatch) {
      if (battleClock.phase !== "fight") {
        return `${battleClockLabel(battleClock, battleState.players)} · swap sides to attack`;
      }
    }
    if (
      (battleClock.phase === "shooting" || resolvingFireOverwatch) &&
      !targetEligibilityConfirmed
    ) {
      if (weaponProfile?.range === null) return "Published weapon range is unavailable";
      if (effectiveWeaponRange <= 0) return "Enter the effective weapon range";
      if (profile.targetDistance <= 0) return "Enter the measured target distance";
      if (profile.targetDistance > effectiveWeaponRange) return "Target is outside weapon range";
      if (!targetVisible && !(profile.indirect && weaponHasIndirect)) {
        return "Confirm visibility or use an eligible Indirect Fire weapon";
      }
      if (!targetMeasurementReason.trim()) return "Describe how the tabletop facts were checked";
      if (effectiveWeaponRange !== weaponProfile?.range && !rangeOverrideReason.trim()) {
        return "Name the rule changing the published weapon range";
      }
      return "Review and accept the recorded target facts";
    }
    if (battleClock.phase === "fight" && !resolvingFireOverwatch && !targetEligibilityConfirmed) {
      return "Confirm Engagement Range and target eligibility";
    }
    if (!battleAttackReady) {
      if (
        activeFormationActivation &&
        activeFormationActivation.formationId !== attackerBattleFormationId
      ) {
        return "Finish the current formation activation before selecting another unit";
      }
      if (battleClock.phase === "shooting" && selectedMovement?.movement === "advance") {
        return weaponHasAssault
          ? "This formation already completed its Shooting activation"
          : "Only Assault weapons can fire after Advancing";
      }
      if (battleClock.phase === "fight") {
        if (activeFormationActivation?.activationType === "fight") {
          if (!activeFormationActivation.pileIn) return "Record Pile In before melee attacks";
          if (activeFormationActivation.pileIn.destination === "none") {
            return "No legal Pile-in endpoint · record Consolidation without attacking";
          }
          if (activeFormationActivation.consolidation) {
            return "Consolidation is recorded · finish this Fight activation";
          }
        }
        return "Select the formation with Fight priority, or confirm its eligibility";
      }
      return `${battleClockLabel(battleClock, battleState.players)} · record movement and advance to an attack step`;
    }
    if (targetFormationModels.destroyed) {
      return `${targetFormation?.name ?? targetUnit.name} is destroyed`;
    }
    if (targetFormationModels.ambiguousComponents.length > 0) {
      return `Exact composition unavailable for ${targetFormationModels.ambiguousComponents.join(
        ", ",
      )}`;
    }
    return `${attackerFormation?.name ?? attackerUnit.name} into ${
      targetFormation?.name ?? targetUnit.name
    }`;
  })();

  const resetBattle = () => {
    suppressRecoverySave.current = true;
    setAttackerListId("");
    setTargetListId("");
    setAttackerUnitId("");
    setTargetUnitId("");
    setWeaponId("");
    setFiringDeckModels(1);
    setFiringDeckPassengerAlreadyShot(false);
    setProfileId("");
    setTargetModelId("");
    setActiveAttackerPresetIds([]);
    setActiveTargetPresetIds([]);
    setSupportUnitId("");
    setActiveSupportPresetIds([]);
    setTargetSupportUnitId("");
    setActiveTargetSupportPresetIds([]);
    setAbilityUsesSpent({});
    setProfile(DEFAULT_PROFILE);
    setResult(null);
    setHistory([]);
    setBattleState(null);
    setPendingChoiceSelections({});
    setDeploymentPlacementConfirmed(false);
    setDeploymentPlacementReason("");
    setReservePlacementConfirmed(false);
    setReservePlacementReason("");
    window.localStorage.removeItem(PLAY_RECOVERY_KEY);
    setStatus("Battle reset");
  };

  const undoLastAttack = () => {
    if (!battleState) return;
    try {
      const attack = activeBattleAttacks(battleState).at(-1);
      if (!attack) throw new Error("There is no resolved attack to undo");
      setBattleState(
        revertLatestAttack(battleState, crypto.randomUUID(), battleState.events.length + 1),
      );
      setHistory((current) => current.filter((entry) => entry.id !== attack.id));
      setResult(null);
      setStatus(`Undid ${attack.summary.damage} damage from ${attack.summary.weapon}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack could not be undone");
    }
  };

  const swapSides = () => {
    if (!attackerListId || !targetListId) return;
    setAttackerListId(targetListId);
    setTargetListId(attackerListId);
    setAttackerUnitId("");
    setTargetUnitId("");
    setWeaponId("");
    setProfileId("");
    setTargetModelId("");
    setTargetDefensiveEquipmentCounts({});
    setActiveAttackerPresetIds([]);
    setActiveTargetPresetIds([]);
    setSupportUnitId("");
    setActiveSupportPresetIds([]);
    setTargetSupportUnitId("");
    setActiveTargetSupportPresetIds([]);
    setResult(null);
    setStatus("Sides swapped · choose the next attacking unit");
  };

  const exportBattle = () => {
    if (!battleState) return;
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(battleState, null, 2)}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `warhammer-battle-${battleState.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Battle event log exported");
  };

  const importBattle = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Battle import must be 5 MB or smaller");
      const imported = normalizeBattleState(JSON.parse(await file.text()));
      if (!catalogue || imported.rulesSnapshot !== currentRulesSnapshot) {
        throw new Error("Battle import uses a different rules snapshot");
      }
      if (imported.players.some((player) => !lists.some((list) => list.id === player.listId))) {
        throw new Error("Import both referenced saved lists before importing this battle");
      }
      const importedAttacks = activeBattleAttacks(imported);
      setBattleState(imported);
      setAttackerListId(imported.players[0].listId);
      setTargetListId(imported.players[1].listId);
      setAttackerUnitId("");
      setTargetUnitId("");
      setWeaponId("");
      setProfileId("");
      setTargetModelId("");
      setTargetDefensiveEquipmentCounts({});
      setHistory(
        importedAttacks
          .slice(-30)
          .reverse()
          .map((attack) => ({
            id: attack.id,
            attacker: attack.summary.attacker,
            weapon: attack.summary.weapon,
            target: attack.summary.target,
            damage: attack.summary.damage,
            successful: attack.summary.successful,
          })),
      );
      setResult(null);
      setStatus(`Imported ${importedAttacks.length} resolved attacks`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Battle import is invalid");
    }
  };

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">BATTLE CONSOLE // 10E</span>
          <h1>Play Mode</h1>
        </div>
        <div className="engine-status ready" role="status" aria-live="polite" aria-atomic="true">
          <span />
          {status}
        </div>
      </header>
      <WorkflowNav current="/play" />
      <div className="play-layout">
        <section className="panel play-console">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>Rapid resolution</p>
              <h2>Choose attack</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="play-selectors">
              <fieldset className="play-selector-group">
                <legend>Attacker</legend>
                <label>
                  <span>List</span>
                  <select
                    value={attackerListId}
                    onChange={(event) => {
                      resetBattleForChangedLists(event.target.value, targetListId);
                      setAttackerListId(event.target.value);
                      setAttackerUnitId("");
                      setWeaponId("");
                      setFiringDeckModels(1);
                      setFiringDeckPassengerAlreadyShot(false);
                      setProfileId("");
                      setActiveAttackerPresetIds([]);
                      setSupportUnitId("");
                      setActiveSupportPresetIds([]);
                      setProfile((current) => ({
                        ...current,
                        attackerCharged: false,
                        attackerRemainedStationary: false,
                        attackerAttached: false,
                        attackerWaaaghActive: false,
                        targetOathOfMoment: false,
                        attackerOathWoundBonusEligible: false,
                        attackerOnObjective: false,
                        attackerObjectiveOwner: "unknown",
                        attackerOnAttackerSelectedObjective: false,
                        targetOnAttackerSelectedObjective: false,
                        attackerOnTargetSelectedObjective: false,
                        targetOnTargetSelectedObjective: false,
                        attackerGuidedAgainstTarget: false,
                        targetSpotted: false,
                        targetSpottedByMarkerlightObserver: false,
                        attackerUnitModels: 0,
                        nearbyEnemyModels: 0,
                        nearbyEnemyUnits: 0,
                        enemyCharacterModelsDestroyed: 0,
                        destructiveFightPhases: 0,
                        embarkedModels: 0,
                        embarkedWracksModels: 0,
                        attackerBattleShocked: false,
                        supportDistance: 0,
                      }));
                      setResult(null);
                    }}
                  >
                    <option value="">Choose list</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unit</span>
                  <select
                    value={attackerSelectionId}
                    disabled={!attackerList}
                    onChange={(event) => {
                      const nextFormation = attackerFormations.find(
                        (formation) => formation.id === event.target.value,
                      );
                      const nextUnit = nextFormation?.root;
                      const nextAttackerAttached = nextFormation?.attached ?? false;
                      const nextEmbarkedAssignments = attackerTransportReport.assignments.filter(
                        (assignment) => assignment.transportUnit.id === event.target.value,
                      );
                      const nextEmbarkedModels = nextEmbarkedAssignments.reduce(
                        (total, assignment) => total + assignment.passengerUnit.modelCount,
                        0,
                      );
                      const nextEmbarkedWracksModels = nextEmbarkedAssignments
                        .filter((assignment) =>
                          assignment.passenger.transportKeywords.includes("wracks"),
                        )
                        .reduce(
                          (total, assignment) => total + assignment.passengerUnit.modelCount,
                          0,
                        );
                      setAttackerUnitId(event.target.value);
                      const nextCatalogueUnit = catalogue?.units.find(
                        (unit) => unit.id === nextUnit?.unitId,
                      );
                      const nextPresets =
                        nextFormation?.components.flatMap(
                          (component) => component.catalogueUnit?.combatPresets ?? [],
                        ) ??
                        nextCatalogueUnit?.combatPresets ??
                        [];
                      const nextPresetIds = nextFormation
                        ? savedFormationCombatPresetIds(nextFormation)
                        : savedUnitCombatPresetIds(nextUnit, nextCatalogueUnit);
                      setActiveAttackerPresetIds(
                        withoutLimitedAbilityPresetIds(nextPresets, nextPresetIds),
                      );
                      setSupportUnitId("");
                      setActiveSupportPresetIds([]);
                      setWeaponId("");
                      setFiringDeckModels(1);
                      setFiringDeckPassengerAlreadyShot(false);
                      setProfileId("");
                      setProfile((current) => ({
                        ...current,
                        attackerCharged: false,
                        attackerRemainedStationary: false,
                        attackerAttached: nextAttackerAttached,
                        attackerWaaaghActive: false,
                        targetOathOfMoment: false,
                        attackerOathWoundBonusEligible: false,
                        attackerOnObjective: false,
                        attackerObjectiveOwner: "unknown",
                        attackerOnAttackerSelectedObjective: false,
                        targetOnAttackerSelectedObjective: false,
                        attackerOnTargetSelectedObjective: false,
                        targetOnTargetSelectedObjective: false,
                        attackerGuidedAgainstTarget: false,
                        targetSpotted: false,
                        targetSpottedByMarkerlightObserver: false,
                        attackerUnitModels: nextFormation?.modelCount ?? 0,
                        nearbyEnemyModels: 0,
                        nearbyEnemyUnits: 0,
                        enemyCharacterModelsDestroyed: 0,
                        destructiveFightPhases: 0,
                        embarkedModels: nextEmbarkedModels,
                        embarkedWracksModels: nextEmbarkedWracksModels,
                        attackerBattleShocked: Boolean(
                          nextFormation &&
                            replayedBattle?.battleShockedFormations.has(
                              `${attackerPlayerId}:${nextFormation.id}`,
                            ),
                        ),
                        supportDistance: 0,
                      }));
                      setResult(null);
                    }}
                  >
                    <option value="">Choose unit</option>
                    {attackerFormations.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.name} ({formation.modelCount})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Weapon</span>
                  <select
                    value={weaponId}
                    disabled={!attackerUnit}
                    onChange={(event) => chooseWeapon(event.target.value)}
                  >
                    <option value="">Choose weapon</option>
                    {attackerUnit?.weapons
                      .filter((weapon) => weapon.count > 0)
                      .map((weapon) => (
                        <option key={weapon.weaponId} value={weapon.weaponId}>
                          {weapon.name} × {weapon.count}
                        </option>
                      ))}
                    {attackerFormation?.components
                      .filter((component) => component.unit.id !== attackerUnit.id)
                      .map((component) => (
                        <optgroup key={component.unit.id} label={component.unit.name}>
                          {component.unit.weapons
                            .filter((weapon) => weapon.count > 0)
                            .map((weapon) => (
                              <option
                                key={`${component.unit.id}:${weapon.weaponId}`}
                                value={formationWeaponValue(component.unit.id, weapon.weaponId)}
                              >
                                {weapon.name} × {weapon.count}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    {firingDeckPlayOptions.map(({ unit, weapons }) => (
                      <optgroup key={unit.id} label={`Firing Deck · ${unit.name}`}>
                        {weapons.map((weapon) => (
                          <option
                            key={`${unit.id}:${weapon.weaponId}`}
                            value={firingDeckWeaponValue(unit.id, weapon.weaponId)}
                          >
                            {weapon.name} · up to {weapon.count} models
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {firingDeckChoice && attackerCatalogueUnit?.firingDeck && (
                  <>
                    <label>
                      <span>Firing Deck models</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.floor(
                          Math.min(
                            attackerCatalogueUnit.firingDeck.capacity /
                              (firingDeckPassengerCatalogueUnit?.firingDeckModelCost ?? 1),
                            firingDeckPassengerUnit?.modelCount ?? 1,
                            selectedWeapon?.count ?? 1,
                          ),
                        )}
                        value={firingDeckModels}
                        onChange={(event) => {
                          const maximum = Math.floor(
                            Math.min(
                              attackerCatalogueUnit.firingDeck!.capacity /
                                (firingDeckPassengerCatalogueUnit?.firingDeckModelCost ?? 1),
                              firingDeckPassengerUnit?.modelCount ?? 1,
                              selectedWeapon?.count ?? 1,
                            ),
                          );
                          const value = Math.min(maximum, Math.max(1, +event.target.value || 1));
                          setFiringDeckModels(value);
                          setProfile((current) => ({ ...current, weaponCount: value }));
                          setResult(null);
                        }}
                      />
                      <small>
                        {firingDeckModels *
                          (firingDeckPassengerCatalogueUnit?.firingDeckModelCost ?? 1)}
                        /{attackerCatalogueUnit.firingDeck.capacity} model slots · transport is the
                        weapon bearer
                      </small>
                    </label>
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        checked={firingDeckPassengerAlreadyShot}
                        onChange={(event) => {
                          setFiringDeckPassengerAlreadyShot(event.target.checked);
                          setResult(null);
                        }}
                      />
                      Passenger unit has already shot this phase
                    </label>
                  </>
                )}
                {selectedWeaponGroup && selectedWeaponGroup.profiles.length > 1 && (
                  <label>
                    <span>Weapon profile</span>
                    <select
                      value={profileId}
                      onChange={(event) => chooseProfile(event.target.value)}
                    >
                      {selectedWeaponGroup.profiles.map((weapon) => (
                        <option key={weapon.id} value={weapon.id}>
                          {weapon.profileName ?? weapon.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedSourceEquipmentSegments.length > 1 && (
                  <div className="loadout-warnings" role="status">
                    <strong>Bearer-only equipment split</strong>
                    <ul>
                      {selectedSourceEquipmentSegments.map((segment) => (
                        <li key={`${segment.count}:${segment.sourceEquipmentLabel ?? "base"}`}>
                          {segment.count} weapon{segment.count === 1 ? "" : "s"}
                          {segment.sourceEquipmentLabel ? ` · ${segment.sourceEquipmentLabel}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </fieldset>
              <fieldset className="play-selector-group">
                <legend>Target</legend>
                <label>
                  <span>List</span>
                  <select
                    value={targetListId}
                    onChange={(event) => {
                      resetBattleForChangedLists(attackerListId, event.target.value);
                      setTargetListId(event.target.value);
                      setTargetUnitId("");
                      setTargetModelId("");
                      setTargetDefensiveEquipmentCounts({});
                      setActiveTargetPresetIds([]);
                      setActiveSupportPresetIds([]);
                      setTargetSupportUnitId("");
                      setActiveTargetSupportPresetIds([]);
                      setProfile((current) => ({
                        ...current,
                        targetAttached: false,
                        targetWaaaghActive: false,
                        targetOathOfMoment: false,
                        targetOnObjective: false,
                        targetObjectiveOwner: "unknown",
                        attackerOnAttackerSelectedObjective: false,
                        targetOnAttackerSelectedObjective: false,
                        attackerOnTargetSelectedObjective: false,
                        targetOnTargetSelectedObjective: false,
                        attackerGuidedAgainstTarget: false,
                        targetSpotted: false,
                        targetSpottedByMarkerlightObserver: false,
                        targetBattleShocked: false,
                        targetStrengthState: "full",
                        targetSupportDistance: 0,
                      }));
                      setResult(null);
                    }}
                  >
                    <option value="">Choose list</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unit</span>
                  <select
                    value={targetSelectionId}
                    disabled={!targetList}
                    onChange={(event) => chooseTargetUnit(event.target.value)}
                  >
                    <option value="">Choose unit</option>
                    {targetFormations.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.name} ({formation.modelCount})
                      </option>
                    ))}
                  </select>
                </label>
                {targetDefensiveEquipmentOptions.length > 0 && (
                  <details className="source-choice-pools" open>
                    <summary>Defensive equipment</summary>
                    <small>
                      Whole-unit effects apply to every model. Bearer effects create separate
                      allocation profiles for only the equipped models.
                    </small>
                    {targetDefensiveEquipmentOptions.map((option) => {
                      if (option.scope === "unit") {
                        const key = defensiveEquipmentSelectionKey(
                          option.savedUnitId,
                          null,
                          option.id,
                        );
                        return (
                          <label key={key} title={option.guidance ?? option.description}>
                            <span>
                              {option.unitName} · {option.name}
                              <small>{option.description}</small>
                              {!option.limitExact && (
                                <small>Source bearer limit is conservative.</small>
                              )}
                            </span>
                            <input
                              aria-label={`${option.unitName} ${option.name} equipped`}
                              type="checkbox"
                              checked={(targetDefensiveEquipmentCounts[key] ?? 0) > 0}
                              disabled={targetEquipmentLocked}
                              onChange={(event) =>
                                changeTargetDefensiveEquipment(key, event.target.checked ? 1 : 0)
                              }
                            />
                          </label>
                        );
                      }
                      return targetBaseModels.segments
                        .filter(
                          (segment) =>
                            segment.savedUnitId === option.savedUnitId &&
                            (!option.eligibleModelIds.length ||
                              option.eligibleModelIds.includes(segment.model.id)),
                        )
                        .map((segment) => {
                          const key = defensiveEquipmentSelectionKey(
                            option.savedUnitId,
                            segment.model.id,
                            option.id,
                          );
                          return (
                            <label key={key} title={option.guidance ?? option.description}>
                              <span>
                                {option.unitName} · {segment.model.name} · {option.name}
                                <small>{option.description}</small>
                                {!option.limitExact && (
                                  <small>Source bearer limit is conservative.</small>
                                )}
                              </span>
                              <input
                                aria-label={`${option.unitName} ${segment.model.name} ${option.name} bearers`}
                                type="number"
                                min={0}
                                max={segment.modelCount}
                                value={targetDefensiveEquipmentCounts[key] ?? 0}
                                disabled={targetEquipmentLocked}
                                onChange={(event) =>
                                  changeTargetDefensiveEquipment(
                                    key,
                                    Math.min(
                                      segment.modelCount,
                                      Math.max(0, +event.target.value || 0),
                                    ),
                                  )
                                }
                              />
                            </label>
                          );
                        });
                    })}
                    {targetEquipmentLocked && (
                      <small>Equipment is locked after the battle starts.</small>
                    )}
                  </details>
                )}
                {targetDefensiveEquipmentWarnings.length > 0 && (
                  <div className="loadout-warnings" role="status">
                    <strong>Defensive equipment source check</strong>
                    <ul>
                      {targetDefensiveEquipmentWarnings.map((warning) => (
                        <li key={`${warning.unitName}:${warning.key}`}>
                          {warning.unitName} · {warning.message}
                          {warning.reason && (
                            <small>
                              Saved override:{" "}
                              {warning.reason === "casualties"
                                ? "battlefield casualties"
                                : "narrative or house rule"}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                    <small>Play Mode edits are battle-local and remain editable.</small>
                  </div>
                )}
                <label>
                  <span>Allocate first</span>
                  <select
                    value={targetModelSelectValue}
                    disabled={!targetUnit}
                    onChange={(event) => chooseTargetProfile(event.target.value)}
                  >
                    <option value="">Choose profile</option>
                    {targetAllocationOptions.map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.unitName} · {segment.model.name} × {segment.modelCount}
                        {segment.weaponCopies?.length
                          ? ` · ${segment.weaponCopies
                              .map(
                                (copy: { name: string; count: number }) =>
                                  `${copy.name}${copy.count > 1 ? ` ×${copy.count}` : ""}`,
                              )
                              .join(", ")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {targetProfiles.length > 1 && (
                    <small>
                      The chosen profile resolves first; remaining profiles follow roster order.
                    </small>
                  )}
                  {targetBattleHealth && (
                    <small>
                      Battle state: {targetModelsRemaining} model
                      {targetModelsRemaining === 1 ? "" : "s"} remaining
                      {targetFormationModels.initialWoundsLost > 0
                        ? ` · current model has lost ${targetFormationModels.initialWoundsLost} wounds`
                        : ""}
                    </small>
                  )}
                </label>
                <label>
                  <span>Charge</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker charged this turn"
                      type="checkbox"
                      checked={profile.attackerCharged}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          event.target.checked,
                        )
                      }
                    />
                    Charged
                  </span>
                </label>
                <label>
                  <span>Distance</span>
                  <input
                    aria-label="Target distance in inches"
                    type="number"
                    min={0}
                    max={1000}
                    step="0.001"
                    value={profile.targetDistance}
                    onChange={(event) =>
                      refreshProfile(
                        weaponId,
                        targetModelId,
                        profileId,
                        activeAttackerPresetIds,
                        activeTargetPresetIds,
                        Math.min(1000, Math.max(0, +event.target.value || 0)),
                      )
                    }
                  />
                  <small>Inches; 0 means unknown</small>
                </label>
                <label>
                  <span>Attacker-side source to target</span>
                  <input
                    aria-label="Attacker-side source to target distance in inches"
                    type="number"
                    min={0}
                    max={1000}
                    value={profile.attackerSourceTargetDistance}
                    onChange={(event) =>
                      refreshSourceTargetState(
                        Math.min(1000, Math.max(0, +event.target.value || 0)),
                        profile.targetSourceAttackerDistance,
                        profile.attackerSourceCanSeeTarget,
                        profile.targetSourceCanSeeAttacker,
                      )
                    }
                  />
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target visible to attacker-side source"
                      type="checkbox"
                      checked={profile.attackerSourceCanSeeTarget}
                      onChange={(event) =>
                        refreshSourceTargetState(
                          profile.attackerSourceTargetDistance,
                          profile.targetSourceAttackerDistance,
                          event.target.checked,
                          profile.targetSourceCanSeeAttacker,
                        )
                      }
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
                    value={profile.targetSourceAttackerDistance}
                    onChange={(event) =>
                      refreshSourceTargetState(
                        profile.attackerSourceTargetDistance,
                        Math.min(1000, Math.max(0, +event.target.value || 0)),
                        profile.attackerSourceCanSeeTarget,
                        profile.targetSourceCanSeeAttacker,
                      )
                    }
                  />
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker visible to target-side source"
                      type="checkbox"
                      checked={profile.targetSourceCanSeeAttacker}
                      onChange={(event) =>
                        refreshSourceTargetState(
                          profile.attackerSourceTargetDistance,
                          profile.targetSourceAttackerDistance,
                          profile.attackerSourceCanSeeTarget,
                          event.target.checked,
                        )
                      }
                    />
                    Visible
                  </span>
                </label>
                <label>
                  <span>Attacker unit models</span>
                  <input
                    aria-label="Models in the attacker unit"
                    type="number"
                    min={0}
                    max={1000}
                    value={profile.attackerUnitModels}
                    onChange={(event) =>
                      refreshProfile(
                        weaponId,
                        targetModelId,
                        profileId,
                        activeAttackerPresetIds,
                        activeTargetPresetIds,
                        profile.targetDistance,
                        profile.attackerCharged,
                        profile.attackerBattleShocked,
                        profile.targetBattleShocked,
                        profile.targetStrengthState,
                        profile.attackerRemainedStationary,
                        profile.attackerAttached,
                        profile.targetAttached,
                        profile.attackerWaaaghActive,
                        profile.targetWaaaghActive,
                        profile.targetOathOfMoment,
                        profile.attackerOathWoundBonusEligible,
                        Math.min(1000, Math.max(0, +event.target.value || 0)),
                        profile.nearbyEnemyModels,
                      )
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
                    value={profile.nearbyEnemyModels}
                    onChange={(event) =>
                      refreshProfile(
                        weaponId,
                        targetModelId,
                        profileId,
                        activeAttackerPresetIds,
                        activeTargetPresetIds,
                        profile.targetDistance,
                        profile.attackerCharged,
                        profile.attackerBattleShocked,
                        profile.targetBattleShocked,
                        profile.targetStrengthState,
                        profile.attackerRemainedStationary,
                        profile.attackerAttached,
                        profile.targetAttached,
                        profile.attackerWaaaghActive,
                        profile.targetWaaaghActive,
                        profile.targetOathOfMoment,
                        profile.attackerOathWoundBonusEligible,
                        profile.attackerUnitModels,
                        Math.min(1000, Math.max(0, +event.target.value || 0)),
                      )
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
                    value={profile.nearbyEnemyUnits}
                    onChange={(event) =>
                      refreshProfile({
                        nearbyEnemyUnits: Math.min(1000, Math.max(0, +event.target.value || 0)),
                      })
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
                    value={profile.enemyCharacterModelsDestroyed}
                    onChange={(event) =>
                      refreshProfile({
                        enemyCharacterModelsDestroyed: Math.min(
                          1000,
                          Math.max(0, +event.target.value || 0),
                        ),
                      })
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
                    value={profile.destructiveFightPhases}
                    onChange={(event) =>
                      refreshProfile({
                        destructiveFightPhases: Math.min(
                          1000,
                          Math.max(0, +event.target.value || 0),
                        ),
                      })
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
                    value={profile.embarkedModels}
                    onChange={(event) =>
                      refreshProfile({
                        embarkedModels: Math.min(1000, Math.max(0, +event.target.value || 0)),
                      })
                    }
                  />
                </label>
                <label>
                  <span>Embarked Wracks models</span>
                  <input
                    aria-label="Wracks models embarked in the attacker transport"
                    type="number"
                    min={0}
                    max={profile.embarkedModels}
                    value={profile.embarkedWracksModels}
                    onChange={(event) =>
                      refreshProfile({
                        embarkedWracksModels: Math.min(
                          profile.embarkedModels,
                          Math.max(0, +event.target.value || 0),
                        ),
                      })
                    }
                  />
                  <small>Must be part of the embarked model count</small>
                </label>
                <label>
                  <span>Oath of Moment</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is the Oath of Moment target"
                      type="checkbox"
                      checked={profile.targetOathOfMoment}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          profile.attackerAttached,
                          profile.targetAttached,
                          profile.attackerWaaaghActive,
                          profile.targetWaaaghActive,
                          event.target.checked,
                          profile.attackerOathWoundBonusEligible,
                        )
                      }
                    />
                    Target selected
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker qualifies for the Codex Oath wound bonus"
                      type="checkbox"
                      checked={profile.attackerOathWoundBonusEligible}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          profile.attackerAttached,
                          profile.targetAttached,
                          profile.attackerWaaaghActive,
                          profile.targetWaaaghActive,
                          profile.targetOathOfMoment,
                          event.target.checked,
                        )
                      }
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
                      checked={profile.attackerOnObjective}
                      onChange={(event) =>
                        refreshObjectiveState(
                          event.target.checked,
                          profile.targetOnObjective,
                          event.target.checked ? profile.attackerObjectiveOwner : "unknown",
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is within range of an objective marker"
                      type="checkbox"
                      checked={profile.targetOnObjective}
                      onChange={(event) =>
                        refreshObjectiveState(
                          profile.attackerOnObjective,
                          event.target.checked,
                          profile.attackerObjectiveOwner,
                          event.target.checked ? profile.targetObjectiveOwner : "unknown",
                        )
                      }
                    />
                    Target
                  </span>
                </label>
                <label>
                  <span>Attacker objective controlled by</span>
                  <select
                    aria-label="Attacker objective owner"
                    disabled={!profile.attackerOnObjective}
                    value={profile.attackerObjectiveOwner}
                    onChange={(event) =>
                      refreshObjectiveState(
                        profile.attackerOnObjective,
                        profile.targetOnObjective,
                        event.target.value as Profile["attackerObjectiveOwner"],
                      )
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
                    disabled={!profile.targetOnObjective}
                    value={profile.targetObjectiveOwner}
                    onChange={(event) =>
                      refreshObjectiveState(
                        profile.attackerOnObjective,
                        profile.targetOnObjective,
                        profile.attackerObjectiveOwner,
                        event.target.value as Profile["targetObjectiveOwner"],
                      )
                    }
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
                      checked={profile.attackerOnAttackerSelectedObjective}
                      onChange={(event) =>
                        refreshSelectedObjectiveState(
                          event.target.checked,
                          profile.targetOnAttackerSelectedObjective,
                          profile.attackerOnTargetSelectedObjective,
                          profile.targetOnTargetSelectedObjective,
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is within range of the attacker-selected objective"
                      type="checkbox"
                      checked={profile.targetOnAttackerSelectedObjective}
                      onChange={(event) =>
                        refreshSelectedObjectiveState(
                          profile.attackerOnAttackerSelectedObjective,
                          event.target.checked,
                          profile.attackerOnTargetSelectedObjective,
                          profile.targetOnTargetSelectedObjective,
                        )
                      }
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
                      checked={profile.attackerOnTargetSelectedObjective}
                      onChange={(event) =>
                        refreshSelectedObjectiveState(
                          profile.attackerOnAttackerSelectedObjective,
                          profile.targetOnAttackerSelectedObjective,
                          event.target.checked,
                          profile.targetOnTargetSelectedObjective,
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is within range of its selected objective"
                      type="checkbox"
                      checked={profile.targetOnTargetSelectedObjective}
                      onChange={(event) =>
                        refreshSelectedObjectiveState(
                          profile.attackerOnAttackerSelectedObjective,
                          profile.targetOnAttackerSelectedObjective,
                          profile.attackerOnTargetSelectedObjective,
                          event.target.checked,
                        )
                      }
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
                      checked={profile.attackerGuidedAgainstTarget}
                      onChange={(event) =>
                        refreshGuidanceState(
                          event.target.checked,
                          event.target.checked || profile.targetSpotted,
                          event.target.checked ? profile.targetSpottedByMarkerlightObserver : false,
                        )
                      }
                    />
                    Guided
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is a Spotted unit"
                      type="checkbox"
                      checked={profile.targetSpotted}
                      onChange={(event) =>
                        refreshGuidanceState(
                          event.target.checked && profile.attackerGuidedAgainstTarget,
                          event.target.checked,
                          event.target.checked && profile.targetSpottedByMarkerlightObserver,
                        )
                      }
                    />
                    Spotted
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Spotted by an Observer with Markerlight"
                      type="checkbox"
                      checked={profile.targetSpottedByMarkerlightObserver}
                      onChange={(event) =>
                        refreshGuidanceState(
                          profile.attackerGuidedAgainstTarget,
                          event.target.checked || profile.targetSpotted,
                          event.target.checked,
                        )
                      }
                    />
                    Markerlight
                  </span>
                </label>
                <label>
                  <span>Movement</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker remained stationary"
                      type="checkbox"
                      checked={profile.attackerRemainedStationary}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          event.target.checked,
                        )
                      }
                    />
                    Remained stationary
                  </span>
                </label>
                <label>
                  <span>Target relationship</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is the closest eligible target"
                      type="checkbox"
                      checked={profile.targetClosestEligible}
                      onChange={(event) => refreshClosestTargetState(event.target.checked)}
                    />
                    Closest eligible target
                  </span>
                </label>
                <label>
                  <span>Battle-shock</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker is Battle-shocked"
                      type="checkbox"
                      checked={
                        battleClock?.status === "active"
                          ? attackerFormationBattleShocked
                          : profile.attackerBattleShocked
                      }
                      onChange={(event) =>
                        updateFormationBattleShock(
                          attackerBattleFormationId,
                          event.target.checked,
                          "attacker",
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is Battle-shocked"
                      type="checkbox"
                      checked={
                        battleClock?.status === "active"
                          ? targetFormationBattleShocked
                          : profile.targetBattleShocked
                      }
                      onChange={(event) =>
                        updateFormationBattleShock(
                          targetBattleFormationId,
                          event.target.checked,
                          "target",
                        )
                      }
                    />
                    Target
                  </span>
                </label>
                <label>
                  <span>Attached unit</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker is an Attached unit"
                      type="checkbox"
                      checked={profile.attackerAttached}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          event.target.checked,
                          profile.targetAttached,
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is an Attached unit"
                      type="checkbox"
                      checked={profile.targetAttached}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          profile.attackerAttached,
                          event.target.checked,
                        )
                      }
                    />
                    Target
                  </span>
                </label>
                <label>
                  <span>Waaagh! benefits</span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Attacker is gaining Waaagh! benefits"
                      type="checkbox"
                      checked={profile.attackerWaaaghActive}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          profile.attackerAttached,
                          profile.targetAttached,
                          event.target.checked,
                          profile.targetWaaaghActive,
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is gaining Waaagh! benefits"
                      type="checkbox"
                      checked={profile.targetWaaaghActive}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          profile.attackerBattleShocked,
                          profile.targetBattleShocked,
                          profile.targetStrengthState,
                          profile.attackerRemainedStationary,
                          profile.attackerAttached,
                          profile.targetAttached,
                          profile.attackerWaaaghActive,
                          event.target.checked,
                        )
                      }
                    />
                    Target
                  </span>
                </label>
                <label>
                  <span>Target unit strength</span>
                  <select
                    value={profile.targetStrengthState}
                    onChange={(event) =>
                      refreshProfile(
                        weaponId,
                        targetModelId,
                        profileId,
                        activeAttackerPresetIds,
                        activeTargetPresetIds,
                        profile.targetDistance,
                        profile.attackerCharged,
                        profile.attackerBattleShocked,
                        profile.targetBattleShocked,
                        event.target.value as CombatProfile["targetStrengthState"],
                      )
                    }
                  >
                    <option value="full">Full strength</option>
                    <option value="below_starting">Below Starting Strength</option>
                    <option value="below_half">Below Half-strength</option>
                  </select>
                </label>
              </fieldset>
            </div>
            <div className="play-ability-selectors">
              {attackerFormationCatalogueUnit && (
                <CombatPresetSelector
                  presets={attackerFormationCatalogueUnit.combatPresets.filter(
                    (preset) =>
                      !preset.sourceEquipmentChoiceExact ||
                      preset.sourceEquipmentAutoEnable === false,
                  )}
                  role="attacker"
                  selectedIds={activeAttackerPresetIds}
                  onChange={(ids) => {
                    setActiveAttackerPresetIds(ids);
                    applyActivePresetSelection(ids, activeTargetPresetIds);
                  }}
                  title="Active attacking abilities"
                  targetDistance={profile.targetDistance}
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  sourceUnitAttached={profile.attackerAttached}
                  sourceUnitWaaaghActive={profile.attackerWaaaghActive}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
                  sourceTargetDistance={profile.attackerSourceTargetDistance}
                  sourceTargetVisible={profile.attackerSourceCanSeeTarget}
                  disabledIds={unavailableAttackerSourcePresetIds}
                  abilityUsesSpent={abilityUsesSpent}
                  abilitySourceUnitIds={attackerAbilitySourceUnitIds}
                  onAbilityUsesChange={setAbilityUsesSpent}
                />
              )}
              {attackerCatalogueUnit ? (
                <SupportPresetSelector
                  units={playSupportUnits}
                  role="attacker"
                  selectedUnitId={supportUnitId}
                  selectedIds={activeSupportPresetIds}
                  abilityUsesSpent={abilityUsesSpent}
                  onAbilityUsesChange={setAbilityUsesSpent}
                  onUnitChange={(unitId) => {
                    setSupportUnitId(unitId);
                    setActiveSupportPresetIds([]);
                    refreshSupportState([], unitId, 0);
                  }}
                  onPresetChange={(ids) => {
                    setActiveSupportPresetIds(ids);
                    refreshSupportState(ids);
                  }}
                  supportDistance={profile.supportDistance}
                  onSupportDistanceChange={(distance) =>
                    refreshSupportState(activeSupportPresetIds, supportUnitId, distance)
                  }
                  supportedUnitKeywords={attackerFormationKeywords}
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
                  sourceTargetDistance={profile.attackerSourceTargetDistance}
                  sourceTargetVisible={profile.attackerSourceCanSeeTarget}
                />
              ) : null}
              {targetFormationCatalogueUnit && (
                <CombatPresetSelector
                  presets={targetFormationCatalogueUnit.combatPresets}
                  role="target"
                  selectedIds={activeTargetPresetIds}
                  onChange={(ids) => {
                    setActiveTargetPresetIds(ids);
                    applyActivePresetSelection(activeAttackerPresetIds, ids);
                  }}
                  title="Active defensive abilities"
                  targetDistance={profile.targetDistance}
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  sourceUnitAttached={profile.targetAttached}
                  sourceUnitWaaaghActive={profile.targetWaaaghActive}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
                  sourceTargetDistance={profile.targetSourceAttackerDistance}
                  sourceTargetVisible={profile.targetSourceCanSeeAttacker}
                  abilityUsesSpent={abilityUsesSpent}
                  abilitySourceUnitIds={targetAbilitySourceUnitIds}
                  onAbilityUsesChange={setAbilityUsesSpent}
                />
              )}
              {targetCatalogueUnit ? (
                <SupportPresetSelector
                  units={playTargetSupportUnits}
                  role="target"
                  selectedUnitId={targetSupportUnitId}
                  selectedIds={activeTargetSupportPresetIds}
                  abilityUsesSpent={abilityUsesSpent}
                  onAbilityUsesChange={setAbilityUsesSpent}
                  onUnitChange={(unitId) => {
                    setTargetSupportUnitId(unitId);
                    setActiveTargetSupportPresetIds([]);
                    refreshTargetSupportState([], unitId, 0);
                  }}
                  onPresetChange={(ids) => {
                    setActiveTargetSupportPresetIds(ids);
                    refreshTargetSupportState(ids);
                  }}
                  supportDistance={profile.targetSupportDistance}
                  onSupportDistanceChange={(distance) =>
                    refreshTargetSupportState(
                      activeTargetSupportPresetIds,
                      targetSupportUnitId,
                      distance,
                    )
                  }
                  supportedUnitKeywords={selectedTargetSegment?.model.keywords ?? []}
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
                  sourceTargetDistance={profile.targetSourceAttackerDistance}
                  sourceTargetVisible={profile.targetSourceCanSeeAttacker}
                />
              ) : null}
            </div>
            <details className="override-strip">
              <summary>
                Quick overrides <span>Optional editable values</span>
              </summary>
              <div>
                {(
                  [
                    ["weaponCount", "Weapons"],
                    ["attacks", "Attacks"],
                    ["attacksMultiplier", "×Attacks"],
                    ["hitOn", "Hit"],
                    ["strength", "S"],
                    ["strengthMultiplier", "×S"],
                    ["ap", "AP"],
                    ["damage", "Damage"],
                    ["damageMultiplier", "×Damage"],
                    ["characteristicModifierDice", "Shared dice"],
                    ["characteristicModifierSides", "Shared sides"],
                    ["characteristicModifierBonus", "Shared bonus"],
                    ["toughness", "T"],
                    ["save", "Save"],
                    ["invulnerable", "Invuln"],
                    ["feelNoPain", "FNP"],
                    ["targetModels", "Targets"],
                    ["reduction", "-Damage"],
                    ["damageDivisor", "÷Damage"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={
                        key === "invulnerable" || key === "feelNoPain" || key === "reduction"
                          ? 0
                          : 1
                      }
                      value={profile[key] as number}
                      onChange={(event) => setNumber(key, Math.max(0, +event.target.value))}
                    />
                  </label>
                ))}
                <label>
                  <span>First failed save replacement</span>
                  <input
                    type="checkbox"
                    checked={profile.firstFailedSaveDamageReplacement !== null}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        firstFailedSaveDamageReplacement: event.target.checked ? 0 : null,
                      }))
                    }
                  />
                </label>
                {profile.firstFailedSaveDamageReplacement !== null && (
                  <label>
                    <span>First failed save Damage</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1024}
                      value={profile.firstFailedSaveDamageReplacement}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          firstFailedSaveDamageReplacement: Math.max(0, +event.target.value),
                        }))
                      }
                    />
                  </label>
                )}
                <label>
                  <span>Allocated-attack replacement</span>
                  <input
                    type="checkbox"
                    checked={profile.allocatedAttackDamageReplacementUses > 0}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        allocatedAttackDamageReplacementUses: event.target.checked ? 1 : 0,
                      }))
                    }
                  />
                </label>
                {profile.allocatedAttackDamageReplacementUses > 0 && (
                  <>
                    <label>
                      <span>Allocated attack Damage</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1024}
                        value={profile.allocatedAttackDamageReplacement}
                        onChange={(event) =>
                          setProfile((current) => ({
                            ...current,
                            allocatedAttackDamageReplacement: Math.max(0, +event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Uses this sequence</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={1024}
                        value={profile.allocatedAttackDamageReplacementUses}
                        onChange={(event) =>
                          setProfile((current) => ({
                            ...current,
                            allocatedAttackDamageReplacementUses: Math.max(1, +event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Allocated attacks to skip</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1024}
                        value={profile.allocatedAttackDamageReplacementSkip}
                        onChange={(event) =>
                          setProfile((current) => ({
                            ...current,
                            allocatedAttackDamageReplacementSkip: Math.max(0, +event.target.value),
                          }))
                        }
                      />
                    </label>
                    <p>Skips those attacks, then spends one use per allocated attack.</p>
                  </>
                )}
                {(
                  [
                    ["characteristicModifierAttacks", "Shared roll → Attacks"],
                    ["characteristicModifierStrength", "Shared roll → Strength"],
                    ["characteristicModifierDamage", "Shared roll → Damage"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={profile[key]}
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            {battleClock?.status === "active" && (
              <div className="action-eligibility">
                {battleClock.phase === "shooting" ? (
                  <fieldset>
                    <legend>Ranged target measurement</legend>
                    <label>
                      <span>Effective weapon range</span>
                      <input
                        aria-label="Effective weapon range in inches"
                        type="number"
                        min={0}
                        max={1000}
                        step="0.001"
                        value={effectiveWeaponRange}
                        onChange={(event) =>
                          updateTargetEligibilityDraft({
                            effectiveWeaponRange: Math.min(
                              1000,
                              Math.max(0, Number(event.target.value) || 0),
                            ),
                          })
                        }
                      />
                      <small>
                        Published: {weaponProfile?.rangeText ?? "unavailable"}; measured distance:{" "}
                        {profile.targetDistance || "unknown"} inches
                      </small>
                    </label>
                    {weaponProfile?.range !== null &&
                      effectiveWeaponRange !== weaponProfile?.range && (
                        <input
                          aria-label="Effective range override reason"
                          value={rangeOverrideReason}
                          maxLength={300}
                          placeholder="Rule or effect changing the published Range"
                          onChange={(event) =>
                            updateTargetEligibilityDraft({
                              rangeOverrideReason: event.target.value,
                            })
                          }
                        />
                      )}
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        checked={targetVisible}
                        onChange={(event) => {
                          updateTargetEligibilityDraft({
                            targetVisible: event.target.checked,
                            ...(!event.target.checked ? { targetFullyVisible: false } : {}),
                          });
                          if (event.target.checked) {
                            setProfile((current) => ({ ...current, indirect: false }));
                          }
                        }}
                      />
                      <span>At least one target model is visible to each selected bearer</span>
                    </label>
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        disabled={!targetVisible}
                        checked={targetFullyVisible}
                        onChange={(event) =>
                          updateTargetEligibilityDraft({ targetFullyVisible: event.target.checked })
                        }
                      />
                      <span>Target unit is fully visible</span>
                    </label>
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        disabled={targetVisible || !weaponHasIndirect}
                        checked={!targetVisible && profile.indirect}
                        onChange={(event) =>
                          setProfile((current) => ({ ...current, indirect: event.target.checked }))
                        }
                      />
                      <span>Use Indirect Fire against a non-visible target</span>
                    </label>
                    <label>
                      <span>Measurement source</span>
                      <select
                        value={targetMeasurementMethod}
                        onChange={(event) =>
                          updateTargetEligibilityDraft({
                            targetMeasurementMethod: event.target.value,
                          })
                        }
                      >
                        <option value="manual">Manual tabletop measurement</option>
                        <option value="uwb">UWB measurement</option>
                        <option value="camera">Camera measurement</option>
                        <option value="imported">Imported measurement</option>
                      </select>
                    </label>
                    <input
                      aria-label="Target measurement review reason"
                      value={targetMeasurementReason}
                      maxLength={300}
                      placeholder="Closest base or hull points and line of sight checked"
                      onChange={(event) =>
                        updateTargetEligibilityDraft({
                          targetMeasurementReason: event.target.value,
                        })
                      }
                    />
                    <label className="inline-checkbox">
                      <input
                        type="checkbox"
                        checked={targetEligibilityReviewed}
                        onChange={(event) =>
                          setTargetEligibilityConfirmationKey(
                            event.target.checked ? targetEligibilityKey : "",
                          )
                        }
                      />
                      <span>
                        Review and accept this distance, visibility, and selected weapon count
                      </span>
                    </label>
                  </fieldset>
                ) : (
                  <label className="inline-checkbox">
                    <input
                      type="checkbox"
                      checked={targetEligibilityReviewed}
                      onChange={(event) =>
                        setTargetEligibilityConfirmationKey(
                          event.target.checked ? targetEligibilityKey : "",
                        )
                      }
                    />
                    <span>Confirm Engagement Range and target eligibility</span>
                  </label>
                )}
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={actionEligibilityOverride}
                    onChange={(event) => setActionEligibilityOverride(event.target.checked)}
                  />
                  <span>Apply a rules exception to this action</span>
                </label>
                {actionEligibilityOverride && (
                  <input
                    aria-label="Eligibility override reason"
                    value={actionOverrideReason}
                    maxLength={300}
                    placeholder="Rule, Stratagem, Engagement Range, or table fact"
                    onChange={(event) => setActionOverrideReason(event.target.value)}
                  />
                )}
                {battleClock.phase === "fight" && actionEligibilityOverride && (
                  <label className="inline-checkbox">
                    <input
                      type="checkbox"
                      checked={fightsFirstOverride}
                      onChange={(event) => setFightsFirstOverride(event.target.checked)}
                    />
                    <span>This formation has Fights First</span>
                  </label>
                )}
              </div>
            )}
            <div className="play-action-bar">
              <span id="play-action-hint">{readyLabel}</span>
              <button
                className="resolve-button"
                type="button"
                disabled={!ready}
                aria-describedby="play-action-hint"
                onClick={roll}
              >
                {result ? "Roll again" : "Resolve attack"}
              </button>
            </div>
          </div>
        </section>
        <aside
          className="resolution-panel"
          ref={latestResult}
          tabIndex={-1}
          role="region"
          aria-labelledby="latest-result-heading"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="section-kicker" id="latest-result-heading">
            Latest result
          </span>
          {!result && <p>Choose an attack to begin.</p>}
          {result && (
            <>
              <strong className="damage-callout">{result.appliedDamage}</strong>
              <span className="damage-label">damage applied</span>
              <div className="combat-flow">
                <div>
                  <b>{result.attacks}</b>
                  <span>Attacks</span>
                </div>
                <div>
                  <b>{result.hits}</b>
                  <span>Hits</span>
                </div>
                <div>
                  <b>{result.woundingAttacks}</b>
                  <span>Wounds</span>
                </div>
                <div>
                  <b>{result.savedAttacks}</b>
                  <span>Saved</span>
                </div>
                <div>
                  <b>{result.fnpPrevented}</b>
                  <span>FNP</span>
                </div>
                <div>
                  <b>{result.successfulAttacks}</b>
                  <span>Through</span>
                </div>
              </div>
              <p>
                {result.modelsDestroyed} models destroyed · {result.wastedDamage} excess damage lost
                · {result.totalDamage} damage rolled.
              </p>
            </>
          )}
        </aside>
      </div>
      <section className="battle-log">
        {battleState && battleClock && (
          <div className="battle-timeline" aria-labelledby="battle-timeline-heading">
            <div>
              <span className="section-kicker">Guided timeline</span>
              <h2 id="battle-timeline-heading">
                {battleClockLabel(battleClock, battleState.players)}
              </h2>
              {battleState.migration && battleClock.status === "setup" && (
                <small>
                  Imported attacks remain explicitly untimed. Start the guided timeline from the
                  current health state.
                </small>
              )}
            </div>
            <div className="battle-log-actions">
              {battleClock.status === "setup" && (
                <button
                  type="button"
                  disabled={
                    (!replayedBattle.deploymentComplete && !battleState.migration) ||
                    setupWeaponBearerGroups.some(({ group }) => !group.bearerAssignmentsReviewed)
                  }
                  onClick={startGuidedBattle}
                >
                  {replayedBattle.deploymentComplete || battleState.migration
                    ? `Start battle · ${attackerList?.name ?? "current attacker"} first`
                    : "Complete deployment to start"}
                </button>
              )}
              {battleClock.status === "active" && (
                <button
                  type="button"
                  disabled={
                    pendingBattleChoices.length > 0 ||
                    Boolean(activeFormationActivation) ||
                    Boolean(pendingDestroyedTransport) ||
                    Boolean(pendingFireOverwatch) ||
                    replayedBattle.movementStartsByFormation.size > 0 ||
                    replayedBattle.chargeDeclarationsByFormation.size > 0 ||
                    Boolean(pendingHeroicIntervention)
                  }
                  onClick={advanceGuidedBattle}
                >
                  Next step
                </button>
              )}
            </div>
            {battleClock.status === "setup" && setupWeaponBearerGroups.length > 0 && (
              <div className="action-tracker" aria-labelledby="weapon-bearer-heading">
                <strong id="weapon-bearer-heading">Confirm optional weapon bearers</strong>
                <span>
                  Each copy is tied to a model. Casualties allocated to that loadout remove its
                  weapons from later attacks.
                </span>
                {setupWeaponBearerGroups.map(({ formation, group }) => {
                  const candidates = formation.modelInstances.filter(
                    (model: { savedUnitId: string }) =>
                      model.savedUnitId === group.sourceSavedUnitId,
                  );
                  return (
                    <fieldset key={`${formation.id}:${group.sourceSavedUnitId}:${group.groupId}`}>
                      <legend>
                        {formation.name} · {group.name}
                      </legend>
                      {group.bearerModelIds.map((modelId: string, copyIndex: number) => (
                        <label key={`${group.groupId}:${copyIndex}`}>
                          <span>Copy {copyIndex + 1} bearer</span>
                          <select
                            value={modelId}
                            onChange={(event) => {
                              const next = [...group.bearerModelIds];
                              next[copyIndex] = event.target.value;
                              confirmWeaponBearers(
                                formation.id,
                                group.sourceSavedUnitId,
                                group.groupId,
                                next,
                              );
                            }}
                          >
                            {candidates.map(
                              (model: {
                                id: string;
                                unitName: string;
                                modelName: string;
                                ordinal: number;
                              }) => (
                                <option key={model.id} value={model.id}>
                                  {model.unitName} · {model.modelName} #{model.ordinal}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ))}
                      {!group.bearerAssignmentsReviewed ? (
                        <button
                          type="button"
                          onClick={() =>
                            confirmWeaponBearers(
                              formation.id,
                              group.sourceSavedUnitId,
                              group.groupId,
                              group.bearerModelIds,
                            )
                          }
                        >
                          Confirm these bearers
                        </button>
                      ) : (
                        <small>Bearer assignments reviewed.</small>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            )}
            {replayedBattle && pendingDestroyedTransport && (
              <div className="action-tracker" role="alert">
                <strong>
                  Resolve destroyed{" "}
                  {replayedBattle.formations.get(pendingDestroyedTransport.transportFormationId)
                    ?.name ?? "Transport"}
                </strong>
                <span>
                  Every embarked unit must disembark immediately. The calculator will use secure
                  random D6 rolls for each model and applicable Feel No Pain rolls.
                </span>
                {pendingDestroyedTransport.passengerFormationIds.map((formationId: string) => {
                  const passenger = replayedBattle.formations.get(formationId);
                  const liveModels = passenger
                    ? Object.values(passenger.health).reduce(
                        (total: number, health: { modelsRemaining: number }) =>
                          total + health.modelsRemaining,
                        0,
                      )
                    : 0;
                  const options = destroyedTransportOptions[formationId] ?? {
                    emergency: false,
                    unplacedModels: 0,
                    firstSegmentId:
                      passenger?.segments.find(
                        (segment: { id: string }) =>
                          passenger.health[segment.id].modelsRemaining > 0,
                      )?.id ?? "",
                  };
                  return (
                    <fieldset key={formationId}>
                      <legend>{passenger?.name ?? "Passenger unit"}</legend>
                      {passenger && passenger.segments.length > 1 && (
                        <label>
                          <span>Allocate casualties to this model profile first</span>
                          <select
                            value={options.firstSegmentId}
                            onChange={(event) =>
                              setDestroyedTransportOptions((current) => ({
                                ...current,
                                [formationId]: {
                                  ...options,
                                  firstSegmentId: event.target.value,
                                },
                              }))
                            }
                          >
                            {passenger.segments
                              .filter(
                                (segment: { id: string }) =>
                                  passenger.health[segment.id].modelsRemaining > 0,
                              )
                              .map((segment: { id: string; name: string }) => (
                                <option key={segment.id} value={segment.id}>
                                  {segment.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <label className="confirmation-row">
                        <input
                          type="checkbox"
                          checked={options.emergency}
                          onChange={(event) =>
                            setDestroyedTransportOptions((current) => ({
                              ...current,
                              [formationId]: {
                                ...options,
                                emergency: event.target.checked,
                              },
                            }))
                          }
                        />
                        Emergency Disembarkation within 6 inches
                      </label>
                      {options.emergency && (
                        <label>
                          <span>Models that still cannot be set up</span>
                          <input
                            type="number"
                            min="0"
                            max={liveModels}
                            value={options.unplacedModels}
                            onChange={(event) =>
                              setDestroyedTransportOptions((current) => ({
                                ...current,
                                [formationId]: {
                                  ...options,
                                  unplacedModels: Math.min(
                                    liveModels,
                                    Math.max(0, Number(event.target.value) || 0),
                                  ),
                                },
                              }))
                            }
                          />
                        </label>
                      )}
                    </fieldset>
                  );
                })}
                <label className="confirmation-row">
                  <input
                    type="checkbox"
                    checked={deadlyDemiseResolvedConfirmed}
                    onChange={(event) => setDeadlyDemiseResolvedConfirmed(event.target.checked)}
                  />
                  Any Deadly Demise roll and effects were resolved first, or this Transport has no
                  Deadly Demise ability
                </label>
                <label className="confirmation-row">
                  <input
                    type="checkbox"
                    checked={transportPlacementConfirmed}
                    onChange={(event) => setTransportPlacementConfirmed(event.target.checked)}
                  />
                  All normal or Emergency Disembarkation placements checked on the table
                </label>
                <input
                  value={transportPlacementReason}
                  maxLength={300}
                  placeholder="3-inch/6-inch placement and Engagement Range checked"
                  onChange={(event) => setTransportPlacementReason(event.target.value)}
                />
                <button type="button" onClick={resolvePendingDestroyedTransport}>
                  Roll and resolve passengers
                </button>
              </div>
            )}
            {battleClock.status === "active" && activeFormationActivation && (
              <div className="action-tracker" role="status">
                <strong>
                  {battleFormation(battleState, activeFormationActivation.formationId)?.name ??
                    "Formation"}{" "}
                  ·{" "}
                  {activeFormationActivation.source === "fire_overwatch"
                    ? "Fire Overwatch"
                    : `${activeFormationActivation.activationType} activation`}
                </strong>
                <span>
                  {activeFormationActivation.activationType === "fight"
                    ? `${activeFightMovement?.attackCount ?? 0} melee attack events · ${
                        activeFormationActivation.pileIn ? "Pile In recorded" : "Pile In pending"
                      } · ${
                        activeFormationActivation.consolidation
                          ? "Consolidation recorded"
                          : "Consolidation pending"
                      }`
                    : activeFormationActivation.source === "fire_overwatch"
                      ? "Only the visible triggering unit can be targeted · unmodified 6s hit · critical hits only on 6s"
                      : activeFormationActivation.weaponRestriction === "assault_only"
                        ? "Assault weapons only"
                        : "Resolve every selected weapon before finishing"}
                </span>
                <button
                  type="button"
                  disabled={
                    Boolean(pendingDestroyedTransport) ||
                    (activeFormationActivation.activationType === "fight" &&
                      !activeFormationActivation.consolidation)
                  }
                  onClick={finishFormationActivation}
                >
                  Finish activation
                </button>
              </div>
            )}
            {battleClock.status === "active" &&
              activeFormationActivation?.activationType === "fight" &&
              pendingFightMoveStage && (
                <div className="action-tracker">
                  <strong>
                    {pendingFightMoveStage === "pile_in"
                      ? "1. Record Pile In"
                      : "3. Record Consolidation"}
                  </strong>
                  <span>
                    {pendingFightMoveStage === "pile_in"
                      ? "Complete this reviewed movement before resolving melee attacks."
                      : "Record this only after every eligible melee attack has resolved, or none were eligible."}
                  </span>
                  <label>
                    <span>Movement result</span>
                    <select
                      value={fightMoveDestination}
                      onChange={(event) => setFightMoveDestination(event.target.value)}
                    >
                      <option value="enemy">End within Engagement Range</option>
                      {pendingFightMoveStage === "consolidation" && (
                        <option value="objective">Move toward closest objective</option>
                      )}
                      <option value="none">No legal movement</option>
                    </select>
                  </label>
                  {fightMoveDestination !== "none" && (
                    <label>
                      <span>Longest model move (inches)</span>
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={0.001}
                        value={fightMaximumModelMove}
                        onChange={(event) =>
                          setFightMaximumModelMove(
                            Math.min(3, Math.max(0, +event.target.value || 0)),
                          )
                        }
                      />
                    </label>
                  )}
                  {fightMoveDestination === "objective" && (
                    <label>
                      <span>Closest objective marker</span>
                      <select
                        value={fightObjectiveId || battleObjectives[0]?.id || ""}
                        onChange={(event) => setFightObjectiveId(event.target.value)}
                      >
                        <option value="">Select an objective</option>
                        {battleObjectives.map((objective) => (
                          <option key={objective.id} value={objective.id}>
                            {objective.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={fightMoveFacts.baseContactModelsStationary}
                      onChange={(event) =>
                        setFightMoveFacts((current) => ({
                          ...current,
                          baseContactModelsStationary: event.target.checked,
                        }))
                      }
                    />
                    <span>Models already in base contact did not move</span>
                  </label>
                  {fightMoveDestination === "enemy" &&
                    [
                      ["unitCoherency", "Unit ends in coherency"],
                      ["endsWithinEngagementRange", "Unit ends within Engagement Range"],
                      [
                        "allMovedModelsCloserToEnemy",
                        "Every moved model ends closer to its closest enemy model",
                      ],
                      ["baseContactMaximized", "Base contact maximized wherever possible"],
                    ].map(([key, label]) => (
                      <label className="check-line" key={key}>
                        <input
                          type="checkbox"
                          checked={fightMoveFacts[key as keyof typeof fightMoveFacts]}
                          onChange={(event) =>
                            setFightMoveFacts((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  {fightMoveDestination === "objective" &&
                    [
                      ["unitCoherency", "Unit ends in coherency"],
                      ["endsWithinObjectiveRange", "Unit ends within range of the objective"],
                      [
                        "allMovedModelsCloserToObjective",
                        "Every moved model moves toward the closest objective",
                      ],
                    ].map(([key, label]) => (
                      <label className="check-line" key={key}>
                        <input
                          type="checkbox"
                          checked={fightMoveFacts[key as keyof typeof fightMoveFacts]}
                          onChange={(event) =>
                            setFightMoveFacts((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  {fightMoveDestination !== "enemy" && (
                    <label>
                      <span>Outcome reason</span>
                      <input
                        value={fightOutcomeReason}
                        maxLength={300}
                        onChange={(event) => setFightOutcomeReason(event.target.value)}
                        placeholder={
                          fightMoveDestination === "objective"
                            ? "Why no Engagement Range endpoint was possible; objective measurement"
                            : pendingFightMoveStage === "pile_in"
                              ? "Why no coherent Engagement Range endpoint was possible"
                              : "Why neither an enemy nor objective endpoint was possible"
                        }
                      />
                    </label>
                  )}
                  {pendingFightMoveStage === "consolidation" && (
                    <>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={fightMeleeAttacksComplete}
                          onChange={(event) => setFightMeleeAttacksComplete(event.target.checked)}
                        />
                        <span>All eligible melee attacks are complete, or none were eligible</span>
                      </label>
                      <label>
                        <span>Melee attack completion</span>
                        <input
                          value={fightMeleeAttacksCompletionReason}
                          maxLength={300}
                          onChange={(event) =>
                            setFightMeleeAttacksCompletionReason(event.target.value)
                          }
                          placeholder="Resolved all declared weapons, or explain why no target was eligible"
                        />
                      </label>
                    </>
                  )}
                  <label>
                    <span>Movement review</span>
                    <input
                      value={fightMovementReviewReason}
                      maxLength={300}
                      onChange={(event) => setFightMovementReviewReason(event.target.value)}
                      placeholder="Tabletop endpoints, distances, coherency, and base contact checked"
                    />
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={fightMoveFacts.reviewedByPlayer}
                      onChange={(event) =>
                        setFightMoveFacts((current) => ({
                          ...current,
                          reviewedByPlayer: event.target.checked,
                        }))
                      }
                    />
                    <span>Player reviewed the complete movement result</span>
                  </label>
                  <button type="button" onClick={recordSelectedFightMove}>
                    Record {pendingFightMoveStage === "pile_in" ? "Pile In" : "Consolidation"}
                  </button>
                </div>
              )}
            {battleClock.status === "active" &&
              battleClock.phase === "movement" &&
              battleClock.step === "move_units" &&
              !pendingFireOverwatch &&
              attackerBattleFormationId &&
              attackerPlayerId === battleClock.activePlayerId && (
                <div className="action-tracker">
                  <strong>
                    {attackerFormation?.name ?? "Selected formation"}
                    {selectedEmbarkedTransportId ? " · disembark" : " movement"}
                  </strong>
                  {selectedEmbarkedTransportId ? (
                    <>
                      <span>
                        Embarked in{" "}
                        {replayedBattle.formations.get(selectedEmbarkedTransportId)?.name}. It can
                        disembark only if it started this Movement phase embarked.
                      </span>
                      <label className="confirmation-row">
                        <input
                          type="checkbox"
                          checked={transportPlacementConfirmed}
                          onChange={(event) => setTransportPlacementConfirmed(event.target.checked)}
                        />
                        Wholly within 3 inches and outside enemy Engagement Range
                      </label>
                      <input
                        value={transportPlacementReason}
                        maxLength={300}
                        placeholder="Physical placement checked"
                        onChange={(event) => setTransportPlacementReason(event.target.value)}
                      />
                      <button type="button" onClick={recordSelectedDisembarkation}>
                        Disembark
                      </button>
                    </>
                  ) : (
                    <>
                      {selectedMovementCurrent ? (
                        <span>Recorded: {selectedMovement?.movement.replace("_", " ")}</span>
                      ) : (
                        <div
                          className="action-buttons"
                          aria-label="Record selected formation movement"
                        >
                          {(
                            [
                              ["stationary", "Remained stationary"],
                              ["normal", "Normal move"],
                              ["advance", "Advanced"],
                              ["fall_back", "Fell Back"],
                            ] as const
                          )
                            .filter(
                              ([movement]) =>
                                (!selectedMovementStart ||
                                  movement === selectedMovementStart.movement) &&
                                (movement !== "stationary" || !selectedDisembarkedCurrentPhase),
                            )
                            .map(([movement, label]) => (
                              <button
                                type="button"
                                key={movement}
                                onClick={() => recordSelectedMovement(movement)}
                              >
                                {selectedMovementStart ? `Complete ${label.toLowerCase()}` : label}
                              </button>
                            ))}
                        </div>
                      )}
                      {selectedMovementCurrent &&
                        ["normal", "advance", "fall_back"].includes(
                          selectedMovement?.movement ?? "",
                        ) &&
                        assignedTransportOnBattlefield &&
                        !selectedDisembarkedCurrentPhase && (
                          <>
                            <label className="confirmation-row">
                              <input
                                type="checkbox"
                                checked={transportPlacementConfirmed}
                                onChange={(event) =>
                                  setTransportPlacementConfirmed(event.target.checked)
                                }
                              />
                              Every model ended the move within 3 inches of the assigned Transport
                            </label>
                            <input
                              value={transportPlacementReason}
                              maxLength={300}
                              placeholder="Whole-unit distance checked"
                              onChange={(event) => setTransportPlacementReason(event.target.value)}
                            />
                            <button type="button" onClick={recordSelectedEmbarkation}>
                              Embark in{" "}
                              {replayedBattle.formations.get(assignedTransportFormationId)?.name ??
                                "Transport"}
                            </button>
                          </>
                        )}
                    </>
                  )}
                </div>
              )}
            {battleClock.status === "active" &&
              battleClock.phase === "movement" &&
              battleClock.step === "reinforcements" &&
              !pendingFireOverwatch &&
              attackerBattleFormationId &&
              attackerPlayerId === battleClock.activePlayerId &&
              replayedBattle.offBattlefieldFormationIds.has(attackerBattleFormationId) &&
              ["reserves", "strategic_reserves"].includes(
                replayedBattle.deploymentByFormation.get(attackerBattleFormationId)?.location ?? "",
              ) && (
                <div className="action-tracker">
                  <strong>{attackerFormation?.name ?? "Selected formation"} · Reserves</strong>
                  <span>
                    Confirm its source-rule, round, board-edge or setup-zone, and enemy-distance
                    requirements on the physical table.
                  </span>
                  <label className="confirmation-row">
                    <input
                      type="checkbox"
                      checked={reservePlacementConfirmed}
                      onChange={(event) => setReservePlacementConfirmed(event.target.checked)}
                    />
                    Legal Reserve placement confirmed
                  </label>
                  <input
                    value={reservePlacementReason}
                    maxLength={300}
                    placeholder="Rule and placement checked (for example, Strategic Reserves outside 9 inches)"
                    onChange={(event) => setReservePlacementReason(event.target.value)}
                  />
                  <button type="button" onClick={recordReserveArrival}>
                    Arrive from Reserves
                  </button>
                </div>
              )}
            {battleClock.status === "active" && pendingFireOverwatch && (
              <div className="action-tracker" aria-labelledby="fire-overwatch-heading">
                <strong id="fire-overwatch-heading">Fire Overwatch response</strong>
                <span>
                  {pendingFireOverwatch.trigger.replaceAll("_", " ")} · the responding player may
                  spend 1CP and select one eligible non-Titanic unit within 24″. The triggering unit
                  must be visible; attacks hit only on unmodified 6s and critical hits occur only on
                  6s.
                </span>
                <div className="action-buttons">
                  <label>
                    <span>Overwatch formation</span>
                    <select
                      value={selectedFireOverwatchFormationId}
                      onChange={(event) => setFireOverwatchFormationId(event.target.value)}
                    >
                      {fireOverwatchFormationOptions.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>Available CP: {fireOverwatchResponderCommandPoints}</span>
                  <label>
                    <span>CP cost</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={fireOverwatchCommandPointCost}
                      onChange={(event) =>
                        setFireOverwatchCommandPointCost(
                          Math.min(5, Math.max(0, +event.target.value || 0)),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Closest distance to triggering unit (inches)</span>
                    <input
                      type="number"
                      min={0.001}
                      max={24}
                      step={0.001}
                      value={fireOverwatchDistance}
                      onChange={(event) =>
                        setFireOverwatchDistance(
                          Math.min(24, Math.max(0.001, +event.target.value || 0.001)),
                        )
                      }
                    />
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={fireOverwatchTargetVisible}
                      onChange={(event) => setFireOverwatchTargetVisible(event.target.checked)}
                    />
                    <span>Triggering enemy unit is visible to the selected unit</span>
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={fireOverwatchEligibilityConfirmed}
                      onChange={(event) =>
                        setFireOverwatchEligibilityConfirmed(event.target.checked)
                      }
                    />
                    <span>Unit would be eligible to shoot if it were its Shooting phase</span>
                  </label>
                  <input
                    value={fireOverwatchEligibilityReason}
                    maxLength={300}
                    placeholder="Visibility, Engagement Range, eligible weapon and target checked"
                    onChange={(event) => setFireOverwatchEligibilityReason(event.target.value)}
                  />
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={fireOverwatchOutOfPhaseConfirmed}
                      onChange={(event) =>
                        setFireOverwatchOutOfPhaseConfirmed(event.target.checked)
                      }
                    />
                    <span>No Shooting-phase-only rule or Firing Deck effect will be applied</span>
                  </label>
                  <input
                    value={fireOverwatchOutOfPhaseReason}
                    maxLength={300}
                    placeholder="Out-of-phase effects reviewed"
                    onChange={(event) => setFireOverwatchOutOfPhaseReason(event.target.value)}
                  />
                  {fireOverwatchCommandPointCost !== 1 && (
                    <input
                      value={fireOverwatchCostOverrideReason}
                      maxLength={300}
                      placeholder="Source rule changing the 1CP cost"
                      onChange={(event) => setFireOverwatchCostOverrideReason(event.target.value)}
                    />
                  )}
                  <input
                    value={fireOverwatchUsageOverrideReason}
                    maxLength={300}
                    placeholder="Source rule allowing another use this turn, if applicable"
                    onChange={(event) => setFireOverwatchUsageOverrideReason(event.target.value)}
                  />
                  <input
                    value={fireOverwatchEligibilityOverrideReason}
                    maxLength={300}
                    placeholder="Source rule overriding Stratagem eligibility, if applicable"
                    onChange={(event) =>
                      setFireOverwatchEligibilityOverrideReason(event.target.value)
                    }
                  />
                  <button
                    type="button"
                    disabled={
                      !selectedFireOverwatchFormationId ||
                      fireOverwatchCommandPointCost > fireOverwatchResponderCommandPoints ||
                      !fireOverwatchTargetVisible ||
                      !fireOverwatchEligibilityConfirmed ||
                      !fireOverwatchEligibilityReason.trim() ||
                      !fireOverwatchOutOfPhaseConfirmed ||
                      !fireOverwatchOutOfPhaseReason.trim() ||
                      (fireOverwatchCommandPointCost !== 1 &&
                        !fireOverwatchCostOverrideReason.trim())
                    }
                    onClick={beginFireOverwatch}
                  >
                    Spend CP and begin Fire Overwatch
                  </button>
                  <input
                    value={fireOverwatchPassReason}
                    maxLength={300}
                    placeholder="Optional reason for declining"
                    onChange={(event) => setFireOverwatchPassReason(event.target.value)}
                  />
                  <button type="button" onClick={declineFireOverwatch}>
                    Decline Fire Overwatch
                  </button>
                </div>
              </div>
            )}
            {battleClock.status === "active" &&
              battleClock.phase === "charge" &&
              battleClock.step === "charge_moves" &&
              !pendingFireOverwatch &&
              !pendingHeroicIntervention &&
              attackerBattleFormationId &&
              targetBattleFormationId &&
              attackerPlayerId === battleClock.activePlayerId && (
                <div className="action-tracker">
                  <strong>
                    {attackerFormation?.name ?? "Selected formation"} charges{" "}
                    {targetFormation?.name ?? "selected target"}
                  </strong>
                  {selectedChargeCurrent ? (
                    <span>
                      {selectedCharge?.successful ? "Successful" : "Failed"} ·{" "}
                      {selectedCharge?.rolls
                        ? `${selectedCharge.rolls.join(" + ")} · ${(
                            selectedCharge.chargeDistanceThousandths / 1000
                          ).toFixed(3)}″`
                        : `legacy roll ${selectedCharge?.roll}`}
                    </span>
                  ) : (
                    <div className="action-buttons">
                      <label>
                        <span>First D6</span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={chargeDice[0]}
                          onChange={(event) => updateChargeDie(0, +event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Second D6</span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={chargeDice[1]}
                          onChange={(event) => updateChargeDie(1, +event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Roll modifier</span>
                        <input
                          type="number"
                          min={-12}
                          max={12}
                          value={chargeRollModifier}
                          onChange={(event) => updateChargeRollModifier(+event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!selectedChargeDeclaration}
                        onClick={rollSelectedCharge}
                      >
                        Roll 2D6 securely
                      </button>
                      <label>
                        <span>Effective Charge distance (inches)</span>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={0.001}
                          value={chargeDistance}
                          onChange={(event) =>
                            setChargeDistance(Math.min(24, Math.max(0, +event.target.value || 0)))
                          }
                        />
                      </label>
                      <label>
                        <span>Roll override reason</span>
                        <input
                          value={chargeRollOverrideReason}
                          maxLength={300}
                          onChange={(event) => setChargeRollOverrideReason(event.target.value)}
                          placeholder="Required when distance differs from dice plus modifier"
                        />
                      </label>
                      <label>
                        <span>Target distance at declaration (inches)</span>
                        <input
                          type="number"
                          min={0.001}
                          max={12}
                          step={0.001}
                          value={chargeTargetDistance}
                          onChange={(event) =>
                            setChargeTargetDistance(
                              Math.min(12, Math.max(0.001, +event.target.value || 0.001)),
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>Longest model move (inches)</span>
                        <input
                          type="number"
                          min={0.001}
                          max={24}
                          step={0.001}
                          value={chargeMaximumModelMove}
                          onChange={(event) =>
                            setChargeMaximumModelMove(
                              Math.min(24, Math.max(0.001, +event.target.value || 0.001)),
                            )
                          }
                        />
                      </label>
                      {[
                        ["phaseStartEligible", "Within 12″ of an enemy at phase start"],
                        ["startedOutsideEngagementRange", "Started outside Engagement Range"],
                        [
                          "targetEndsWithinEngagementRange",
                          "Every target ends in Engagement Range",
                        ],
                        ["unitCoherency", "Charge move ends in Unit Coherency"],
                        ["nonTargetsAvoided", "No non-target Engagement Range entered"],
                        ["allModelsCloser", "Every moved model ends closer to a target"],
                        ["baseContactMaximized", "Base contact maximized where possible"],
                        ["reviewedByPlayer", "Player reviewed the complete move"],
                      ].map(([key, label]) => (
                        <label className="check-line" key={key}>
                          <input
                            type="checkbox"
                            checked={chargeFacts[key as keyof typeof chargeFacts]}
                            onChange={(event) =>
                              setChargeFacts((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                      <label>
                        <span>Movement review</span>
                        <input
                          value={chargeMovementReviewReason}
                          maxLength={300}
                          onChange={(event) => setChargeMovementReviewReason(event.target.value)}
                          placeholder="Measurement or tabletop review"
                        />
                      </label>
                      <label>
                        <span>Failure reason</span>
                        <input
                          value={chargeFailureReason}
                          maxLength={300}
                          onChange={(event) => setChargeFailureReason(event.target.value)}
                          placeholder="Required for a failed charge"
                        />
                      </label>
                      <button type="button" onClick={() => recordSelectedCharge(true)}>
                        {selectedChargeDeclaration ? "Record successful move" : "Declare charge"}
                      </button>
                      {selectedChargeDeclaration && (
                        <button type="button" onClick={() => recordSelectedCharge(false)}>
                          Record failed charge
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            {battleClock.status === "active" && pendingHeroicIntervention && (
              <div className="action-tracker" aria-labelledby="heroic-intervention-heading">
                <strong id="heroic-intervention-heading">Heroic Intervention response</strong>
                <span>
                  The responding player may spend 1CP. Select an eligible unit within 6″ of the
                  charging unit, resolve a Charge move against only that unit, and do not grant a
                  Charge Bonus.
                </span>
                <div className="action-buttons">
                  <label>
                    <span>Intervening formation</span>
                    <select
                      value={selectedHeroicFormationId}
                      onChange={(event) => setHeroicFormationId(event.target.value)}
                    >
                      {heroicFormationOptions.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>Available CP: {heroicResponderCommandPoints}</span>
                  <label>
                    <span>CP cost</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={heroicCommandPointCost}
                      onChange={(event) =>
                        setHeroicCommandPointCost(
                          Math.min(5, Math.max(0, +event.target.value || 0)),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Cost override source</span>
                    <input
                      value={heroicCostOverrideReason}
                      maxLength={300}
                      placeholder="Required unless the cost is 1CP"
                      onChange={(event) => setHeroicCostOverrideReason(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>First D6</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={heroicDice[0]}
                      onChange={(event) => updateHeroicDie(0, +event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Second D6</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={heroicDice[1]}
                      onChange={(event) => updateHeroicDie(1, +event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Roll modifier</span>
                    <input
                      type="number"
                      min={-12}
                      max={12}
                      value={heroicRollModifier}
                      onChange={(event) => {
                        const modifier = Math.min(12, Math.max(-12, +event.target.value || 0));
                        const distance = Math.max(0, heroicDice[0] + heroicDice[1] + modifier);
                        setHeroicRollModifier(modifier);
                        setHeroicDistance(distance);
                        setHeroicMaximumModelMove(Math.min(6, distance));
                        setHeroicRollOverrideReason("");
                      }}
                    />
                  </label>
                  <button type="button" onClick={rollHeroicIntervention}>
                    Roll 2D6 securely
                  </button>
                  <label>
                    <span>Effective Charge distance (inches)</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.001}
                      value={heroicDistance}
                      onChange={(event) =>
                        setHeroicDistance(Math.min(24, Math.max(0, +event.target.value || 0)))
                      }
                    />
                  </label>
                  <label>
                    <span>Starting distance (inches)</span>
                    <input
                      type="number"
                      min={0.001}
                      max={6}
                      step={0.001}
                      value={heroicStartDistance}
                      onChange={(event) =>
                        setHeroicStartDistance(
                          Math.min(6, Math.max(0.001, +event.target.value || 0.001)),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Longest model move (inches)</span>
                    <input
                      type="number"
                      min={0.001}
                      max={24}
                      step={0.001}
                      value={heroicMaximumModelMove}
                      onChange={(event) =>
                        setHeroicMaximumModelMove(
                          Math.min(24, Math.max(0.001, +event.target.value || 0.001)),
                        )
                      }
                    />
                  </label>
                  {[
                    ["targetEligibilityConfirmed", "Within 6″ and otherwise eligible to charge"],
                    ["startedOutsideEngagementRange", "Started outside Engagement Range"],
                    ["endsWithinEngagementRange", "Ends in Engagement Range of the charger"],
                    ["unitCoherencyConfirmed", "Move ends in Unit Coherency"],
                    ["nonTargetEngagementRangeAvoided", "No other Engagement Range entered"],
                    ["allModelsCloserToTarget", "Every moved model ends closer"],
                    ["baseContactMaximized", "Base contact maximized where possible"],
                    ["movementReviewedByPlayer", "Player reviewed the complete move"],
                  ].map(([key, label]) => (
                    <label className="check-line" key={key}>
                      <input
                        type="checkbox"
                        checked={heroicFacts[key as keyof typeof heroicFacts]}
                        onChange={(event) =>
                          setHeroicFacts((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                  <label>
                    <span>Movement review</span>
                    <input
                      value={heroicMovementReviewReason}
                      maxLength={300}
                      onChange={(event) => setHeroicMovementReviewReason(event.target.value)}
                      placeholder="Physical-table endpoint review"
                    />
                  </label>
                  <label>
                    <span>Roll override source</span>
                    <input
                      value={heroicRollOverrideReason}
                      maxLength={300}
                      onChange={(event) => setHeroicRollOverrideReason(event.target.value)}
                      placeholder="Required if distance differs from dice plus modifier"
                    />
                  </label>
                  <label>
                    <span>Stratagem eligibility override</span>
                    <input
                      value={heroicEligibilityOverrideReason}
                      maxLength={300}
                      onChange={(event) => setHeroicEligibilityOverrideReason(event.target.value)}
                      placeholder="Required for Battle-shocked or Aircraft formations"
                    />
                  </label>
                  <label>
                    <span>Once-per-phase override</span>
                    <input
                      value={heroicUsageOverrideReason}
                      maxLength={300}
                      onChange={(event) => setHeroicUsageOverrideReason(event.target.value)}
                      placeholder="Only when a source rule permits another use"
                    />
                  </label>
                  <label>
                    <span>Failure reason</span>
                    <input
                      value={heroicFailureReason}
                      maxLength={300}
                      onChange={(event) => setHeroicFailureReason(event.target.value)}
                      placeholder="Required for a failed Charge roll or move"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!selectedHeroicFormationId}
                    onClick={() => recordHeroicIntervention(true)}
                  >
                    Resolve successful intervention
                  </button>
                  <button
                    type="button"
                    disabled={!selectedHeroicFormationId}
                    onClick={() => recordHeroicIntervention(false)}
                  >
                    Resolve failed intervention
                  </button>
                  <label>
                    <span>Pass reason</span>
                    <input
                      value={heroicPassReason}
                      maxLength={300}
                      onChange={(event) => setHeroicPassReason(event.target.value)}
                      placeholder="Optional note"
                    />
                  </label>
                  <button type="button" onClick={passPendingHeroicIntervention}>
                    Decline Heroic Intervention
                  </button>
                </div>
              </div>
            )}
            {battleClock.status === "active" &&
              battleClock.phase === "fight" &&
              ["fights_first", "remaining_combats"].includes(battleClock.step) &&
              !activeFormationActivation && (
                <div className="action-tracker">
                  <strong>
                    Fight priority ·{" "}
                    {battleState.players.find(
                      (player) => player.id === battleClock.priorityPlayerId,
                    )?.name ?? "Player"}
                  </strong>
                  <span>
                    Select that player’s eligible formation, or pass if none can activate.
                  </span>
                  <button
                    type="button"
                    disabled={
                      !attackerBattleFormationId ||
                      attackerPlayerId !== battleClock.priorityPlayerId
                    }
                    onClick={beginSelectedFightActivation}
                  >
                    Begin selected Fight activation
                  </button>
                  <button type="button" onClick={yieldFightPriority}>
                    Pass Fight priority
                  </button>
                </div>
              )}
            {battleClock.status === "setup" &&
              replayedBattle &&
              replayedBattle.deploymentByFormation.size === 0 && (
                <form className="mission-setup" onSubmit={configureMission}>
                  <label>
                    <span>Mission</span>
                    <input
                      name="mission"
                      defaultValue={replayedBattle.mission.name}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    <span>Battle size (points)</span>
                    <input
                      name="points-limit"
                      type="number"
                      min="0"
                      max="100000"
                      defaultValue={replayedBattle.mission.pointsLimit}
                    />
                  </label>
                  <label>
                    <span>Deploy first</span>
                    <select
                      name="deployment-first"
                      defaultValue={replayedBattle.mission.deploymentFirstPlayerId}
                    >
                      {battleState.players.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Objectives</span>
                    <input
                      name="objectives"
                      type="number"
                      min="0"
                      max="12"
                      defaultValue={replayedBattle.mission.objectives.length}
                    />
                  </label>
                  <label>
                    <span>CP each Command phase</span>
                    <input
                      name="command-points"
                      type="number"
                      min="0"
                      max="10"
                      defaultValue={replayedBattle.mission.commandPointsPerCommandPhase}
                    />
                  </label>
                  {battleState.players.map((player) => (
                    <label key={player.id}>
                      <span>{player.name} starting CP</span>
                      <input
                        name={`starting-${player.id}`}
                        type="number"
                        min="0"
                        max="100"
                        defaultValue={replayedBattle.mission.startingCommandPoints[player.id]}
                      />
                    </label>
                  ))}
                  <button type="submit">Save mission setup</button>
                </form>
              )}
            {battleClock.status === "setup" &&
              replayedBattle.deploymentByFormation.size === 0 &&
              !battleState.migration && (
                <form className="deployment-planner" onSubmit={declareDeployments}>
                  <div>
                    <strong>Declare battle formations</strong>
                    <span>
                      Put every formation on the battlefield, in Reserves, in Strategic Reserves, or
                      inside its assigned Transport before either player deploys a model.
                    </span>
                  </div>
                  {[...replayedBattle.formations.values()].map((formation) => (
                    <fieldset key={formation.id}>
                      <legend>
                        {battleState.players.find((player) => player.id === formation.playerId)
                          ?.name ?? "Player"}{" "}
                        · {formation.name}
                      </legend>
                      <label>
                        <span>Starting location</span>
                        <select name={"location-" + formation.id} defaultValue="battlefield">
                          <option value="battlefield">Battlefield</option>
                          {formation.assignedTransportFormationId && (
                            <option value="embarked">
                              Embarked in{" "}
                              {replayedBattle.formations.get(formation.assignedTransportFormationId)
                                ?.name ?? "assigned Transport"}
                            </option>
                          )}
                          <option value="reserves">Reserves (source rule)</option>
                          <option value="strategic_reserves">Strategic Reserves</option>
                        </select>
                      </label>
                      <label>
                        <span>Points if in Strategic Reserves</span>
                        <input
                          name={"points-" + formation.id}
                          type="number"
                          min="0"
                          max="100000"
                          defaultValue="0"
                        />
                      </label>
                      <label>
                        <span>Earliest arrival round</span>
                        <input
                          name={"round-" + formation.id}
                          type="number"
                          min="1"
                          max="5"
                          defaultValue="2"
                        />
                      </label>
                      <label className="confirmation-row">
                        <input type="checkbox" name={"eligible-" + formation.id} />
                        Reserve eligibility confirmed when this formation or its Transport starts in
                        Reserves
                      </label>
                      <label>
                        <span>Reserve source rule</span>
                        <input
                          name={"reason-" + formation.id}
                          maxLength={300}
                          placeholder="Deep Strike, Strategic Reserves, mission rule…"
                        />
                      </label>
                    </fieldset>
                  ))}
                  <button type="submit">Lock deployment declarations</button>
                </form>
              )}
            {battleClock.status === "setup" &&
              replayedBattle.deploymentByFormation.size > 0 &&
              !replayedBattle.deploymentComplete && (
                <div className="deployment-planner">
                  <div>
                    <strong>
                      Deploy{" "}
                      {battleState.players.find(
                        (player) => player.id === replayedBattle.deploymentPriorityPlayerId,
                      )?.name ?? "next player"}
                    </strong>
                    <span>Place one formation, then alternate. Confirm physical placement.</span>
                  </div>
                  <label className="confirmation-row">
                    <input
                      type="checkbox"
                      checked={deploymentPlacementConfirmed}
                      onChange={(event) => setDeploymentPlacementConfirmed(event.target.checked)}
                    />
                    Deployment-zone and table-state placement confirmed
                  </label>
                  <input
                    value={deploymentPlacementReason}
                    maxLength={300}
                    placeholder="Deployment zone and applicable setup rules checked"
                    onChange={(event) => setDeploymentPlacementReason(event.target.value)}
                  />
                  <div className="deployment-options">
                    {[...replayedBattle.formations.values()]
                      .filter(
                        (formation) =>
                          replayedBattle.deploymentByFormation.get(formation.id)?.location ===
                            "battlefield" && !replayedBattle.deployedFormationIds.has(formation.id),
                      )
                      .map((formation) => (
                        <button
                          type="button"
                          key={formation.id}
                          disabled={
                            formation.playerId !== replayedBattle.deploymentPriorityPlayerId
                          }
                          onClick={() => recordFormationDeployment(formation.id)}
                        >
                          Deploy {formation.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            {battleClock.status === "setup" && replayedBattle.deploymentComplete && (
              <div className="action-tracker" role="status">
                <strong>Deployment complete</strong>
                <span>
                  {
                    [...replayedBattle.deploymentByFormation.values()].filter((deployment) =>
                      ["reserves", "strategic_reserves"].includes(deployment.location),
                    ).length
                  }{" "}
                  in Reserves · {replayedBattle.embarkedByFormation.size} embarked.
                </span>
              </div>
            )}
            {replayedBattle && (
              <div className="battle-trackers" aria-label="Battle score and resources">
                {battleState.players.map((player) => {
                  const resources = [...replayedBattle.resources.get(player.id).values()];
                  const commandPoints = resources.find(
                    (resource) => resource.id === "command_points",
                  );
                  const victoryPoints = resources.find(
                    (resource) => resource.id === "victory_points",
                  );
                  const customResources = resources.filter(
                    (resource) =>
                      resource.id !== "command_points" && resource.id !== "victory_points",
                  );
                  return (
                    <section key={player.id} className="player-tracker">
                      <h3>{player.name}</h3>
                      <div className="primary-trackers">
                        <div>
                          <span>CP</span>
                          <strong>{commandPoints?.value ?? 0}</strong>
                          <div>
                            <button
                              type="button"
                              disabled={battleClock.status !== "active" || !commandPoints?.value}
                              onClick={() =>
                                updateTrackedResource(
                                  player.id,
                                  "command_points",
                                  "Command Points",
                                  -1,
                                  null,
                                  "Spent Command Point",
                                )
                              }
                            >
                              Spend 1
                            </button>
                            <button
                              type="button"
                              disabled={battleClock.status !== "active"}
                              onClick={() =>
                                updateTrackedResource(
                                  player.id,
                                  "command_points",
                                  "Command Points",
                                  1,
                                  null,
                                  "Manual Command Point gain",
                                )
                              }
                            >
                              Gain 1
                            </button>
                          </div>
                        </div>
                        <div>
                          <span>VP</span>
                          <strong>{victoryPoints?.value ?? 0}</strong>
                          <div>
                            <button
                              type="button"
                              disabled={battleClock.status !== "active"}
                              onClick={() =>
                                recordScore(player.id, 5, "primary", "Manual primary score")
                              }
                            >
                              +5 primary
                            </button>
                            <button
                              type="button"
                              disabled={battleClock.status !== "active" || !victoryPoints?.value}
                              onClick={() =>
                                recordScore(player.id, -1, "correction", "Manual score correction")
                              }
                            >
                              Correct −1
                            </button>
                          </div>
                        </div>
                      </div>
                      <form
                        className="score-setup"
                        onSubmit={(event) => recordCustomScore(player.id, event)}
                      >
                        <input
                          aria-label={`${player.name} score points`}
                          name="score-points"
                          type="number"
                          min="-1000"
                          max="1000"
                          placeholder="VP"
                        />
                        <select
                          aria-label={`${player.name} score category`}
                          name="score-category"
                          defaultValue="secondary"
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary">Secondary</option>
                          <option value="other">Other</option>
                          <option value="correction">Correction</option>
                        </select>
                        <input
                          aria-label={`${player.name} score reason`}
                          name="score-reason"
                          placeholder="Objective or reason"
                          maxLength={300}
                        />
                        <button type="submit" disabled={battleClock.status !== "active"}>
                          Record score
                        </button>
                      </form>
                      {customResources.map((resource) => (
                        <div key={resource.id} className="custom-resource">
                          <span>
                            {resource.name} · {resource.value}
                            {resource.maximum === null ? "" : `/${resource.maximum}`}
                          </span>
                          <div>
                            <button
                              type="button"
                              disabled={battleClock.status === "complete" || resource.value < 1}
                              onClick={() =>
                                updateTrackedResource(
                                  player.id,
                                  resource.id,
                                  resource.name,
                                  -1,
                                  resource.maximum,
                                  `Spent ${resource.name}`,
                                )
                              }
                            >
                              −1
                            </button>
                            <button
                              type="button"
                              disabled={
                                battleClock.status === "complete" ||
                                (resource.maximum !== null && resource.value >= resource.maximum)
                              }
                              onClick={() =>
                                updateTrackedResource(
                                  player.id,
                                  resource.id,
                                  resource.name,
                                  1,
                                  resource.maximum,
                                  `Gained ${resource.name}`,
                                )
                              }
                            >
                              +1
                            </button>
                          </div>
                        </div>
                      ))}
                      <form
                        className="resource-setup"
                        onSubmit={(event) => addTrackedResource(player.id, event)}
                      >
                        <input
                          aria-label={`${player.name} resource name`}
                          name="resource-name"
                          placeholder="Resource name"
                          maxLength={100}
                        />
                        <input
                          aria-label={`${player.name} resource maximum`}
                          name="resource-maximum"
                          type="number"
                          min="0"
                          max="100000"
                          placeholder="Max"
                        />
                        <button type="submit" disabled={battleClock.status === "complete"}>
                          Add tracker
                        </button>
                      </form>
                    </section>
                  );
                })}
              </div>
            )}
            {battleClock.status !== "setup" && battleObjectives.length > 0 && (
              <div className="objective-trackers" aria-label="Objective control">
                {battleObjectives.map((objective) => (
                  <div key={objective.id}>
                    <strong>{objective.name}</strong>
                    <div>
                      {battleState.players.map((player) => (
                        <button
                          type="button"
                          key={player.id}
                          aria-pressed={objective.controllerPlayerId === player.id}
                          disabled={battleClock.status !== "active"}
                          onClick={() => updateObjectiveControl(objective.id, player.id, false)}
                        >
                          {player.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={objective.contested}
                        disabled={battleClock.status !== "active"}
                        onClick={() => updateObjectiveControl(objective.id, "", true)}
                      >
                        Contested
                      </button>
                      <button
                        type="button"
                        aria-pressed={!objective.contested && !objective.controllerPlayerId}
                        disabled={battleClock.status !== "active"}
                        onClick={() => updateObjectiveControl(objective.id, "", false)}
                      >
                        Uncontrolled
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {battleScoringEvents.length > 0 && (
              <ol className="scoring-events" aria-label="Scoring history">
                {battleScoringEvents
                  .slice(-6)
                  .reverse()
                  .map((event) => (
                    <li key={event.id}>
                      {battleState.players.find((player) => player.id === event.playerId)?.name} ·{" "}
                      {event.points >= 0 ? "+" : ""}
                      {event.points} VP · {event.reason}
                    </li>
                  ))}
              </ol>
            )}
            {pendingBattleChoices.map((choice) => {
              const selected = pendingChoiceSelections[choice.id] ?? [];
              return (
                <fieldset key={choice.id} className="pending-choice">
                  <legend>{choice.prompt}</legend>
                  {choice.options.map((option) => (
                    <label key={option.id}>
                      <input
                        type={choice.maximumSelections === 1 ? "radio" : "checkbox"}
                        name={`choice-${choice.id}`}
                        checked={selected.includes(option.id)}
                        onChange={() =>
                          togglePendingChoice(choice.id, option.id, choice.maximumSelections)
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={
                      selected.length < choice.minimumSelections ||
                      selected.length > choice.maximumSelections
                    }
                    onClick={() => finishPendingChoice(choice.id)}
                  >
                    Confirm choice
                  </button>
                </fieldset>
              );
            })}
            {activeBattleEffects.length > 0 && (
              <ul className="active-effects" aria-label="Active battle effects">
                {activeBattleEffects.map((effect) => (
                  <li key={effect.id}>
                    {effect.name} · {effect.duration.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="battle-log-head">
          <div>
            <span className="section-kicker">Attack history</span>
            <h2>Battle log</h2>
          </div>
          <div className="battle-log-actions">
            {attackerListId && targetListId && attackerListId !== targetListId && (
              <button type="button" onClick={swapSides}>
                Swap sides
              </button>
            )}
            {battleState && activeBattleAttacks(battleState).length > 0 && (
              <button type="button" onClick={undoLastAttack}>
                Undo last attack
              </button>
            )}
            {battleState && (
              <button type="button" onClick={exportBattle}>
                Export battle
              </button>
            )}
            <button type="button" onClick={() => importBattleInput.current?.click()}>
              Import battle
            </button>
            <input
              ref={importBattleInput}
              className="visually-hidden-input"
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              onChange={(event) => {
                void importBattle(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={resetBattle}>
              Reset battle
            </button>
          </div>
        </div>
        <small className="storage-note">
          Selections, overrides, limited ability uses, wounds, casualties, and the event log recover
          automatically on this device.
        </small>
        {history.length === 0 ? (
          <p>Resolved attacks will appear here for this play session.</p>
        ) : (
          history.map((entry, index) => (
            <article key={entry.id}>
              <b>{history.length - index}</b>
              <span>{entry.attacker}</span>
              <span>{entry.weapon}</span>
              <span>into {entry.target}</span>
              <strong>{entry.damage} damage</strong>
              <small>{entry.successful} through</small>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
