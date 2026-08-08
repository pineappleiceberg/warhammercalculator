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
  type CombatProfile,
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
  attackKeywordsForWeapon,
  selectedAndAutomaticCombatPresets,
} from "../../lib/combat-presets.mjs";
import {
  createPlayRecovery,
  parsePlayRecovery,
  PLAY_RECOVERY_KEY,
} from "../../lib/play-recovery.mjs";

type LogEntry = {
  id: string;
  attacker: string;
  weapon: string;
  target: string;
  damage: number;
  successful: number;
};

export default function PlayMode() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [lists, setLists] = useState<ArmyListRecord[]>([]);
  const [attackerListId, setAttackerListId] = useState("");
  const [targetListId, setTargetListId] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [weaponId, setWeaponId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [targetModelId, setTargetModelId] = useState("");
  const [activeAttackerPresetIds, setActiveAttackerPresetIds] = useState<string[]>([]);
  const [activeTargetPresetIds, setActiveTargetPresetIds] = useState<string[]>([]);
  const [supportUnitId, setSupportUnitId] = useState("");
  const [activeSupportPresetIds, setActiveSupportPresetIds] = useState<string[]>([]);
  const [targetSupportUnitId, setTargetSupportUnitId] = useState("");
  const [activeTargetSupportPresetIds, setActiveTargetSupportPresetIds] = useState<string[]>([]);
  const [supportUsesSpent, setSupportUsesSpent] = useState<Record<string, Record<string, number>>>(
    {},
  );
  const [profile, setProfile] = useState<CombatProfile>(DEFAULT_PROFILE);
  const [result, setResult] = useState<RollResult | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("Select two saved lists");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const recovered = useRef(false);
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
          const saved = parsePlayRecovery(JSON.parse(raw)) as unknown as {
            attackerListId: string;
            targetListId: string;
            attackerUnitId: string;
            targetUnitId: string;
            weaponId: string;
            profileId: string;
            targetModelId: string;
            profile: unknown;
            history: LogEntry[];
            activeAttackerPresetIds: string[];
            activeTargetPresetIds: string[];
            supportUnitId: string;
            activeSupportPresetIds: string[];
            targetSupportUnitId: string;
            activeTargetSupportPresetIds: string[];
            supportUsesSpent: Record<string, Record<string, number>>;
          };
          setAttackerListId(saved.attackerListId);
          setTargetListId(saved.targetListId);
          setAttackerUnitId(saved.attackerUnitId);
          setTargetUnitId(saved.targetUnitId);
          setWeaponId(saved.weaponId);
          setProfileId(saved.profileId);
          setTargetModelId(saved.targetModelId);
          setActiveAttackerPresetIds(saved.activeAttackerPresetIds);
          setActiveTargetPresetIds(saved.activeTargetPresetIds);
          setSupportUnitId(saved.supportUnitId);
          setActiveSupportPresetIds(saved.activeSupportPresetIds);
          setTargetSupportUnitId(saved.targetSupportUnitId);
          setActiveTargetSupportPresetIds(saved.activeTargetSupportPresetIds);
          setSupportUsesSpent(saved.supportUsesSpent);
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
      activeAttackerPresetIds,
      activeTargetPresetIds,
      supportUnitId,
      activeSupportPresetIds,
      targetSupportUnitId,
      activeTargetSupportPresetIds,
      supportUsesSpent,
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
    targetUnitId,
    supportUnitId,
    targetSupportUnitId,
    supportUsesSpent,
    weaponId,
  ]);

  const attackerList = lists.find((list) => list.id === attackerListId);
  const targetList = lists.find((list) => list.id === targetListId);
  const attackerUnit = attackerList?.units.find((unit) => unit.id === attackerUnitId);
  const targetUnit = targetList?.units.find((unit) => unit.id === targetUnitId);
  const selectedWeapon = attackerUnit?.weapons.find(
    (weapon) => String(weapon.weaponId) === weaponId,
  );
  const attackerCatalogueUnit = catalogue?.units.find((unit) => unit.id === attackerUnit?.unitId);
  const targetCatalogueUnit = catalogue?.units.find((unit) => unit.id === targetUnit?.unitId);
  const playSupportUnits =
    attackerList?.units
      .filter((unit) => unit.id !== attackerUnitId)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        combatPresets:
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId)
            ?.combatPresets ?? [],
      })) ?? [];
  const supportArmyUnit = attackerList?.units.find((unit) => unit.id === supportUnitId);
  const supportCatalogueUnit = catalogue?.units.find((unit) => unit.id === supportArmyUnit?.unitId);
  const playTargetSupportUnits =
    targetList?.units
      .filter((unit) => unit.id !== targetUnitId)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        combatPresets:
          catalogue?.units.find((catalogueUnit) => catalogueUnit.id === unit.unitId)
            ?.combatPresets ?? [],
      })) ?? [];
  const targetSupportArmyUnit = targetList?.units.find((unit) => unit.id === targetSupportUnitId);
  const targetSupportCatalogueUnit = catalogue?.units.find(
    (unit) => unit.id === targetSupportArmyUnit?.unitId,
  );
  const weaponGroups = groupWeaponProfiles(attackerCatalogueUnit?.weapons ?? []);
  const selectedWeaponGroup = weaponGroups.find(
    (group) =>
      group.id === selectedWeapon?.groupId ||
      group.profiles.some((weapon) => weapon.id === selectedWeapon?.weaponId),
  );
  const weaponProfile =
    selectedWeaponGroup?.profiles.find((weapon) => String(weapon.id) === profileId) ??
    selectedWeaponGroup?.profiles[0];
  const targetProfiles = targetCatalogueUnit?.models ?? [];

  const selectedCombatPresets = (
    ids: string[],
    unit: typeof attackerCatalogueUnit,
    weapon = weaponProfile,
    targetKeywords = targetProfiles.find((entry) => String(entry.id) === targetModelId)?.keywords ??
      [],
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
    );

  const refreshProfile = (
    nextWeaponId = weaponId,
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
  ) => {
    const listWeapon = attackerUnit?.weapons.find(
      (entry) => String(entry.weaponId) === nextWeaponId,
    );
    const groups = groupWeaponProfiles(attackerCatalogueUnit?.weapons ?? []);
    const group = groups.find(
      (entry) =>
        entry.id === listWeapon?.groupId ||
        entry.profiles.some((profile) => profile.id === listWeapon?.weaponId),
    );
    const weapon =
      group?.profiles.find((entry) => String(entry.id) === nextProfileId) ?? group?.profiles[0];
    const model =
      targetProfiles.find((entry) => String(entry.id) === nextTargetModelId) ?? targetProfiles[0];
    if (!weapon || !model) return;
    setProfile(
      applyCombatPresets(
        applyWeaponProfile(
          {
            ...applyTargetProfile(DEFAULT_PROFILE, model),
            weaponCount: listWeapon?.count ?? 1,
            targetModels: targetUnit?.modelCount ?? 1,
            targetDistance: nextTargetDistance,
            attackerUnitModels: nextAttackerUnitModels,
            nearbyEnemyModels: nextNearbyEnemyModels,
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
            nextAttackerPresetIds,
            attackerCatalogueUnit,
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
            attackerCatalogueUnit?.models[0]?.keywords ?? [],
            nextSupportDistance,
            nextTargetClosestEligible,
          ),
        ],
        [
          ...selectedCombatPresets(
            nextTargetPresetIds,
            targetCatalogueUnit,
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
          ),
        ],
        weapon.type,
        {
          targetKeywords: model.keywords,
          attackKeywords: attackKeywordsForWeapon(weapon),
          targetDistance: nextTargetDistance,
          attackerUnitModels: nextAttackerUnitModels,
          nearbyEnemyModels: nextNearbyEnemyModels,
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
          attackerBattleShocked: nextAttackerBattleShocked,
          targetBattleShocked: nextTargetBattleShocked,
          targetStrengthState: nextTargetStrengthState,
          supportDistance: nextSupportDistance,
          supportedUnitKeywords: attackerCatalogueUnit?.models[0]?.keywords ?? [],
          targetSupportDistance: nextTargetSupportDistance,
          targetSupportedUnitKeywords: model.keywords,
        },
      ),
    );
    setResult(null);
  };

  const chooseWeapon = (id: string) => {
    const listWeapon = attackerUnit?.weapons.find((entry) => String(entry.weaponId) === id);
    const group = weaponGroups.find(
      (entry) =>
        entry.id === listWeapon?.groupId ||
        entry.profiles.some((profile) => profile.id === listWeapon?.weaponId),
    );
    const initialProfile = listWeapon?.groupId
      ? group?.profiles[0]
      : group?.profiles.find((profile) => profile.id === listWeapon?.weaponId);
    const firstProfileId = initialProfile ? String(initialProfile.id) : "";
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

  const chooseTargetUnit = (id: string) => {
    const nextTarget = targetList?.units.find((unit) => unit.id === id);
    const nextTargetCatalogueUnit = catalogue?.units.find((unit) => unit.id === nextTarget?.unitId);
    const model = nextTargetCatalogueUnit?.models[0];
    const nextTargetPresetIds = nextTarget?.combatPresetIds ?? [];
    setTargetUnitId(id);
    const nextTargetBattleShocked = false;
    const nextTargetAttached = false;
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
    const nextTargetStrengthState = "full" as const;
    setTargetModelId(model ? String(model.id) : "");
    setActiveTargetPresetIds(nextTargetPresetIds);
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
            targetModels: nextTarget.modelCount,
            targetDistance: profile.targetDistance,
            attackerUnitModels: profile.attackerUnitModels,
            nearbyEnemyModels: profile.nearbyEnemyModels,
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
            targetStrengthState: nextTargetStrengthState,
            supportDistance: profile.supportDistance,
            targetSupportDistance: 0,
          },
          weaponProfile,
          model.keywords,
        ),
        [
          ...selectedCombatPresets(
            activeAttackerPresetIds,
            attackerCatalogueUnit,
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
            attackerCatalogueUnit?.models[0]?.keywords ?? [],
            profile.supportDistance,
            nextTargetClosestEligible,
          ),
        ],
        selectedCombatPresets(
          nextTargetPresetIds,
          nextTargetCatalogueUnit,
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
        ),
        weaponProfile.type,
        {
          targetKeywords: model.keywords,
          attackKeywords: attackKeywordsForWeapon(weaponProfile),
          targetDistance: profile.targetDistance,
          attackerUnitModels: profile.attackerUnitModels,
          nearbyEnemyModels: profile.nearbyEnemyModels,
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
          attackerBattleShocked: profile.attackerBattleShocked,
          targetBattleShocked: nextTargetBattleShocked,
          targetStrengthState: nextTargetStrengthState,
          supportDistance: profile.supportDistance,
          supportedUnitKeywords: attackerCatalogueUnit?.models[0]?.keywords ?? [],
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
    let rolled: RollResult;
    try {
      rolled = simulateAttack(profile);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack could not be resolved");
      return;
    }
    setResult(rolled);
    setHistory((current) =>
      [
        {
          id: crypto.randomUUID(),
          attacker: attackerUnit.name,
          weapon: weaponProfile.name,
          target: targetUnit.name,
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
    attackerUnit && targetUnit && selectedWeapon && weaponProfile && targetModelId,
  );
  const readyLabel = !attackerList
    ? "Choose an attacking list"
    : !attackerUnit
      ? "Choose an attacking unit"
      : !selectedWeapon
        ? "Choose a weapon"
        : !targetList
          ? "Choose a target list"
          : !targetUnit
            ? "Choose a target unit"
            : !targetModelId
              ? "Choose a target profile"
              : `${attackerUnit.name} into ${targetUnit.name}`;

  const resetBattle = () => {
    suppressRecoverySave.current = true;
    setAttackerListId("");
    setTargetListId("");
    setAttackerUnitId("");
    setTargetUnitId("");
    setWeaponId("");
    setProfileId("");
    setTargetModelId("");
    setActiveAttackerPresetIds([]);
    setActiveTargetPresetIds([]);
    setSupportUnitId("");
    setActiveSupportPresetIds([]);
    setTargetSupportUnitId("");
    setActiveTargetSupportPresetIds([]);
    setSupportUsesSpent({});
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
                    value={attackerUnitId}
                    disabled={!attackerList}
                    onChange={(event) => {
                      const nextUnit = attackerList?.units.find(
                        (unit) => unit.id === event.target.value,
                      );
                      setAttackerUnitId(event.target.value);
                      setActiveAttackerPresetIds(nextUnit?.combatPresetIds ?? []);
                      setSupportUnitId("");
                      setActiveSupportPresetIds([]);
                      setWeaponId("");
                      setProfileId("");
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
                        attackerBattleShocked: false,
                        supportDistance: 0,
                      }));
                      setResult(null);
                    }}
                  >
                    <option value="">Choose unit</option>
                    {attackerList?.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name} ({unit.modelCount})
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
                  </select>
                </label>
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
                    value={targetUnitId}
                    disabled={!targetList}
                    onChange={(event) => chooseTargetUnit(event.target.value)}
                  >
                    <option value="">Choose unit</option>
                    {targetList?.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name} ({unit.modelCount})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Profile</span>
                  <select
                    value={targetModelId}
                    disabled={!targetUnit}
                    onChange={(event) => chooseTargetProfile(event.target.value)}
                  >
                    <option value="">Choose profile</option>
                    {targetProfiles.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
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
              {attackerCatalogueUnit && (
                <CombatPresetSelector
                  presets={attackerCatalogueUnit.combatPresets}
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
                />
              )}
              {attackerCatalogueUnit ? (
                <SupportPresetSelector
                  units={playSupportUnits}
                  role="attacker"
                  selectedUnitId={supportUnitId}
                  selectedIds={activeSupportPresetIds}
                  supportUsesSpent={supportUsesSpent}
                  onSupportUsesChange={setSupportUsesSpent}
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
                  supportedUnitKeywords={attackerCatalogueUnit.models[0]?.keywords ?? []}
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
                />
              ) : null}
              {targetCatalogueUnit && (
                <CombatPresetSelector
                  presets={targetCatalogueUnit.combatPresets}
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
                />
              )}
              {targetCatalogueUnit ? (
                <SupportPresetSelector
                  units={playTargetSupportUnits}
                  role="target"
                  selectedUnitId={targetSupportUnitId}
                  selectedIds={activeTargetSupportPresetIds}
                  supportUsesSpent={supportUsesSpent}
                  onSupportUsesChange={setSupportUsesSpent}
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
                  supportedUnitKeywords={
                    targetProfiles.find((entry) => String(entry.id) === targetModelId)?.keywords ??
                    []
                  }
                  attackerCharged={profile.attackerCharged}
                  attackerRemainedStationary={profile.attackerRemainedStationary}
                  attackerBattleShocked={profile.attackerBattleShocked}
                  targetBattleShocked={profile.targetBattleShocked}
                  targetStrengthState={profile.targetStrengthState}
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
          Selections, overrides, limited supporting-ability uses, and the attack log recover
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
