"use client";

import { useEffect, useRef, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { CombatPresetSelector } from "../../components/combat-preset-selector";
import { SupportPresetSelector } from "../../components/support-preset-selector";
import { fetchArmyLists, type ArmyListRecord } from "../../lib/army-list";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  simulateAttack,
  simulateOrderedVolley,
  type CombatProfile,
  type OrderedVolleyRollResult,
  type RollResult,
} from "../../lib/combat";
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
  const [status, setStatus] = useState("Select two saved lists");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const recovered = useRef(false);
  const migrateLegacyLimitedUses = useRef(false);
  const suppressRecoverySave = useRef(false);
  const latestResult = useRef<HTMLElement>(null);

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

  const attackerList = lists.find((list) => list.id === attackerListId);
  const targetList = lists.find((list) => list.id === targetListId);
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
  const validFiringDeckPassengerIds = new Set(
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
  const targetFormationModels = savedFormationTargetSequence(
    targetFormation,
    targetModelId,
    targetDefensiveEquipmentCounts,
  );
  const targetProfiles = targetFormationModels.segments;
  const targetAllocationOptions = targetFormationModels.allocationOptions;
  const selectedTargetSegment = targetFormationModels.first;
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
    const next = { ...targetDefensiveEquipmentCounts };
    if (count > 0) next[key] = count;
    else delete next[key];
    const nextSequence = savedFormationTargetSequence(targetFormation, targetModelId, next);
    const nextTargetModelId = nextSequence.first?.id ?? "";
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
    const nextTargetDefensiveEquipmentCounts =
      savedFormationDefensiveEquipmentDefaults(nextFormation);
    const nextTargetSequence = savedFormationTargetSequence(
      nextFormation,
      "",
      nextTargetDefensiveEquipmentCounts,
    );
    const firstSegment = nextTargetSequence.first;
    const model = firstSegment?.model ?? nextTargetCatalogueUnit?.models[0];
    const nextTargetPresetIds = nextFormation
      ? savedFormationCombatPresetIds(nextFormation)
      : savedUnitCombatPresetIds(nextTarget, nextTargetCatalogueUnit);
    setTargetUnitId(id);
    setTargetDefensiveEquipmentCounts(nextTargetDefensiveEquipmentCounts);
    const nextTargetBattleShocked = false;
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
    let rolled: RollResult | OrderedVolleyRollResult;
    try {
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
        profile.attackerBattleShocked,
        profile.targetBattleShocked,
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
            attackerBattleShocked: profile.attackerBattleShocked,
            targetBattleShocked: profile.targetBattleShocked,
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
        const base = { ...profile, weaponCount: segment.count };
        if (
          selectedSourceEquipmentSegments.length <= 1 ||
          !(segment.sourceEquipmentPresetIds ?? []).length
        ) {
          return base;
        }
        return applyCombatPresets(
          base,
          selectedCombatPresets(
            segment.sourceEquipmentPresetIds ?? [],
            weaponSourceCatalogueUnit,
            weaponProfile,
            selectedTargetSegment?.model.keywords ?? [],
            profile.targetDistance,
            profile.attackerCharged,
            profile.attackerBattleShocked,
            profile.targetBattleShocked,
            profile.targetStrengthState,
            profile.attackerRemainedStationary,
          ),
          [],
          weaponProfile.type,
          {
            attackerCharged: profile.attackerCharged,
            attackerBattleShocked: profile.attackerBattleShocked,
            targetBattleShocked: profile.targetBattleShocked,
            targetStrengthState: profile.targetStrengthState,
            targetKeywords: selectedTargetSegment?.model.keywords ?? [],
            attackKeywords,
          },
        );
      });
      rolled =
        attackProfiles.length > 1 ||
        orderedTargets.length > 1 ||
        Object.keys(targetDefensiveEquipmentCounts).length > 0
          ? simulateOrderedVolley(attackProfiles, orderedTargets)
          : simulateAttack(attackProfiles[0]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack could not be resolved");
      return;
    }
    setResult(rolled);
    setHistory((current) =>
      [
        {
          id: crypto.randomUUID(),
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

  const ready = Boolean(
    attackerUnit &&
      targetUnit &&
      selectedWeapon &&
      weaponProfile &&
      targetModelId &&
      targetFormationModels.ambiguousComponents.length === 0 &&
      !(firingDeckChoice && !validFiringDeckPassengerIds.has(firingDeckChoice.passengerUnitId)) &&
      !(firingDeckChoice && firingDeckPassengerAlreadyShot),
  );
  const readyLabel = !attackerList
    ? "Choose an attacking list"
    : !attackerUnit
      ? "Choose an attacking unit"
      : firingDeckChoice && !validFiringDeckPassengerIds.has(firingDeckChoice.passengerUnitId)
        ? "Passenger is not legally assigned to this Transport"
        : firingDeckChoice && firingDeckPassengerAlreadyShot
          ? "Passenger unit has already shot"
          : !selectedWeapon
            ? "Choose a weapon"
            : !targetList
              ? "Choose a target list"
              : !targetUnit
                ? "Choose a target unit"
                : !targetModelId
                  ? "Choose a target profile"
                  : targetFormationModels.ambiguousComponents.length > 0
                    ? `Exact composition unavailable for ${targetFormationModels.ambiguousComponents.join(
                        ", ",
                      )}`
                    : `${attackerFormation?.name ?? attackerUnit.name} into ${
                        targetFormation?.name ?? targetUnit.name
                      }`;

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
    window.localStorage.removeItem(PLAY_RECOVERY_KEY);
    setStatus("Battle reset");
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
                        attackerBattleShocked: false,
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
                    value={targetModelId}
                    disabled={!targetUnit}
                    onChange={(event) => chooseTargetProfile(event.target.value)}
                  >
                    <option value="">Choose profile</option>
                    {targetAllocationOptions.map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.unitName} · {segment.model.name} × {segment.modelCount}
                      </option>
                    ))}
                  </select>
                  {targetProfiles.length > 1 && (
                    <small>
                      The chosen profile resolves first; remaining profiles follow roster order.
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
                      checked={profile.attackerBattleShocked}
                      onChange={(event) =>
                        refreshProfile(
                          weaponId,
                          targetModelId,
                          profileId,
                          activeAttackerPresetIds,
                          activeTargetPresetIds,
                          profile.targetDistance,
                          profile.attackerCharged,
                          event.target.checked,
                          profile.targetBattleShocked,
                        )
                      }
                    />
                    Attacker
                  </span>
                  <span className="inline-checkbox">
                    <input
                      aria-label="Target is Battle-shocked"
                      type="checkbox"
                      checked={profile.targetBattleShocked}
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
                          event.target.checked,
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
        <div className="battle-log-head">
          <div>
            <span className="section-kicker">Attack history</span>
            <h2>Battle log</h2>
          </div>
          <div className="battle-log-actions">
            {history.length > 0 && (
              <button type="button" onClick={() => setHistory([])}>
                Clear log
              </button>
            )}
            <button type="button" onClick={resetBattle}>
              Reset battle
            </button>
          </div>
        </div>
        <small className="storage-note">
          Selections, overrides, limited ability uses, and the attack log recover automatically on
          this device.
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
