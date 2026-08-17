import {
  ACTION_BATTLE_STATE_VERSION,
  ATTACHED_SEPARATION_BATTLE_STATE_VERSION,
  BATTLE_SHOCK_COMPARATOR_BATTLE_STATE_VERSION,
  COMMAND_BATTLE_SHOCK_BATTLE_STATE_VERSION,
  DESPERATE_ESCAPE_BATTLE_STATE_VERSION,
  BATTLE_EVENT_VERSION,
  BATTLE_STATE_VERSION,
  DETACHMENT_RULE_STATE_BATTLE_STATE_VERSION,
  OATH_OF_MOMENT_BATTLE_STATE_VERSION,
  REANIMATION_PROTOCOLS_BATTLE_STATE_VERSION,
  SHADOW_IN_THE_WARP_BATTLE_STATE_VERSION,
  MISSION_TRACKING_BATTLE_STATE_VERSION,
  TERRAIN_CLEARANCE_BATTLE_STATE_VERSION,
  CONVEX_SILHOUETTE_BATTLE_STATE_VERSION,
  ENDPOINT_CLEARANCE_BATTLE_STATE_VERSION,
  RANGED_GEOMETRY_BATTLE_STATE_VERSION,
  TERRAIN_VISIBILITY_BATTLE_STATE_VERSION,
  EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION,
  SPATIAL_FACTS_BATTLE_STATE_VERSION,
  TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION,
  CHARGE_MOVE_BATTLE_STATE_VERSION,
  COUNTER_OFFENSIVE_BATTLE_STATE_VERSION,
  FIGHT_MOVE_BATTLE_STATE_VERSION,
  FIRE_OVERWATCH_BATTLE_STATE_VERSION,
  GO_TO_GROUND_BATTLE_STATE_VERSION,
  HAZARDOUS_BATTLE_STATE_VERSION,
  HEROIC_INTERVENTION_BATTLE_STATE_VERSION,
  RANGED_DECLARATION_BATTLE_STATE_VERSION,
  RAPID_INGRESS_BATTLE_STATE_VERSION,
  RULE_COVERAGE_BATTLE_STATE_VERSION,
  SETUP_RULES_BATTLE_STATE_VERSION,
  SMOKESCREEN_BATTLE_STATE_VERSION,
  ROSTER_BATTLE_STATE_VERSION,
  MODEL_PLACEMENT_BATTLE_STATE_VERSION,
  MODEL_POSITION_BATTLE_STATE_VERSION,
  OBJECTIVE_CONTROL_BATTLE_STATE_VERSION,
  TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
  TABLE_GEOMETRY_BATTLE_STATE_VERSION,
  TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION,
  TIMELINE_BATTLE_STATE_VERSION,
  TRANSPORT_BATTLE_STATE_VERSION,
  TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION,
  WEAPON_BEARER_BATTLE_STATE_VERSION,
  WEAPON_INVENTORY_BATTLE_STATE_VERSION,
  createBattleState,
  configureBattleRuleCoverage,
  normalizeBattleState,
  replayBattleState,
} from "./battle-state.mjs";
import {
  bindBattleRuleSelections,
  deriveBattleRuleSelectionPlan,
  verifyBattleRuleCoverageBinding,
} from "./battle-rule-selection.mjs";
import {
  savedFormationBattleRegistration,
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationTargetSequence,
} from "./formations.mjs";
import { validateMissionTerrainSelection } from "./mission-pack.mjs";
import { transportAssignmentReport } from "./transport.mjs";

function listRevision(list) {
  if (!Number.isSafeInteger(list?.updatedAt) || list.updatedAt < 0) {
    throw new Error("Each battle list must have a valid saved revision");
  }
  return list.updatedAt;
}

function listsForPlayers(state, firstList, secondList) {
  const available = [firstList, secondList];
  return state.players.map((player, index) => {
    const exact = available.find(
      (list, candidateIndex) => candidateIndex === index && list?.id === player.listId,
    );
    const fallback = available.find((list) => list?.id === player.listId);
    const list = exact ?? fallback;
    if (!list) throw new Error("Battle references a saved list that is not selected");
    return list;
  });
}

function newPlayers(firstList, secondList) {
  return [firstList, secondList].map((list, index) => ({
    id: `player-${index + 1}`,
    listId: list.id,
    listUpdatedAt: listRevision(list),
    name: list.name,
  }));
}

function upgradePlayers(state, firstList, secondList) {
  const lists = listsForPlayers(state, firstList, secondList);
  return state.players.map((player, index) => ({
    ...player,
    listUpdatedAt: listRevision(lists[index]),
  }));
}

function upgradeSpatialGeometry(events) {
  return events.map((event) => {
    if (event.type === "model_placements_recorded") {
      return {
        ...event,
        placement: {
          ...event.placement,
          models: event.placement.models.map((model) => ({
            ...model,
            verticalExtentThousandths: model.verticalExtentThousandths ?? 0,
          })),
        },
      };
    }
    if (event.type === "model_positions_recorded") {
      return {
        ...event,
        position: {
          ...event.position,
          models: event.position.models.map((model) => ({
            ...model,
            verticalExtentThousandths: model.verticalExtentThousandths ?? 0,
          })),
        },
      };
    }
    return event;
  });
}

function registrationFor(
  formation,
  player,
  equipmentOverride,
  assignedTransportFormationId = "",
  transportOptions = [],
) {
  const equipment = equipmentOverride ?? savedFormationDefensiveEquipmentDefaults(formation);
  const targetSequence = savedFormationTargetSequence(formation, "", equipment);
  if (targetSequence.ambiguousComponents.length > 0) {
    throw new Error(
      `Exact battle setup composition is unavailable for ${targetSequence.ambiguousComponents.join(
        ", ",
      )}`,
    );
  }
  return savedFormationBattleRegistration(
    formation,
    player.id,
    `${player.id}:${formation.id}`,
    targetSequence,
    equipment,
    assignedTransportFormationId,
    transportOptions,
  );
}

function exactTransportOptions(catalogue, list, formations, formationIdBySavedUnitId) {
  const clearedList = {
    ...list,
    units: list.units.map((unit) => ({ ...unit, transportId: "" })),
  };
  const optionsByFormationId = new Map(formations.map((formation) => [formation.id, []]));
  for (const passengerFormation of formations) {
    const passengerSavedUnitIds = new Set(
      passengerFormation.components.map((component) => component.unit.id),
    );
    for (const transportFormation of formations) {
      const transportComponents = transportFormation.components.filter(
        (component) => component.catalogueUnit?.transport?.exactRules,
      );
      if (
        transportComponents.length !== 1 ||
        passengerSavedUnitIds.has(transportComponents[0].unit.id)
      ) {
        continue;
      }
      const transportComponent = transportComponents[0];
      const hypothetical = {
        ...clearedList,
        units: clearedList.units.map((unit) =>
          passengerSavedUnitIds.has(unit.id)
            ? { ...unit, modelCount: 0, transportId: transportComponent.unit.id }
            : unit,
        ),
      };
      const report = transportAssignmentReport(catalogue, hypothetical);
      if (report.errors.length > 0) continue;
      const assignments = report.assignments.filter(
        (assignment) =>
          passengerSavedUnitIds.has(assignment.passengerUnit.id) &&
          assignment.transportUnit.id === transportComponent.unit.id,
      );
      if (
        assignments.length !== passengerSavedUnitIds.size ||
        new Set(assignments.map((assignment) => assignment.passengerUnit.id)).size !==
          passengerSavedUnitIds.size
      ) {
        continue;
      }
      optionsByFormationId.get(passengerFormation.id).push({
        transportFormationId: formationIdBySavedUnitId.get(transportComponent.unit.id),
        assignments: assignments.map((assignment) => ({
          sourceSavedUnitId: assignment.passengerUnit.id,
          modelCost: assignment.modelCost,
          poolPosition: assignment.poolPosition,
          poolKind: assignment.poolKind,
          poolCapacity: assignment.poolCapacity,
          poolLabel: assignment.poolLabel,
          sharedAllowancePosition: assignment.sharedAllowancePosition,
          sharedAllowanceMaximumModels: assignment.sharedAllowanceMaximumModels,
          sharedAllowancePrimaryCapacityWhileUsed:
            assignment.sharedAllowancePrimaryCapacityWhileUsed,
          sharedAllowanceNestedPassengerPolicy: assignment.sharedAllowanceNestedPassengerPolicy,
        })),
      });
    }
  }
  return optionsByFormationId;
}

function desiredRegistrations(catalogue, state, firstList, secondList, equipmentOverrides = {}) {
  const lists = listsForPlayers(state, firstList, secondList);
  return state.players.flatMap((player, playerIndex) => {
    const list = lists[playerIndex];
    const formations = savedFormationGroups(catalogue, list);
    const report = transportAssignmentReport(catalogue, list);
    if (report.errors.length > 0) {
      throw new Error(`Transport assignments are invalid: ${report.errors.join("; ")}`);
    }
    const formationIdBySavedUnitId = new Map(
      formations.flatMap((formation) =>
        formation.components.map((component) => [component.unit.id, formation.id]),
      ),
    );
    const transportOptionsByFormationId = exactTransportOptions(
      catalogue,
      list,
      formations,
      formationIdBySavedUnitId,
    );
    const assignedTransportByFormationId = new Map();
    for (const assignment of report.assignments) {
      const passengerFormationId = formationIdBySavedUnitId.get(assignment.passengerUnit.id);
      const transportFormationId = formationIdBySavedUnitId.get(assignment.transportUnit.id);
      if (!passengerFormationId || !transportFormationId) {
        throw new Error("Transport assignment does not map to an exact battle formation");
      }
      const previous = assignedTransportByFormationId.get(passengerFormationId);
      if (previous && previous !== transportFormationId) {
        throw new Error("An attached formation cannot be assigned to multiple Transports");
      }
      assignedTransportByFormationId.set(passengerFormationId, transportFormationId);
    }
    return formations.map((formation) => {
      const id = `${player.id}:${formation.id}`;
      const assignedSourceId = assignedTransportByFormationId.get(formation.id);
      return registrationFor(
        formation,
        player,
        equipmentOverrides[id],
        assignedSourceId ? `${player.id}:${assignedSourceId}` : "",
        (transportOptionsByFormationId.get(formation.id) ?? []).map((option) => ({
          ...option,
          transportFormationId: `${player.id}:${option.transportFormationId}`,
        })),
      );
    });
  });
}

function sameSegments(left, right) {
  return (
    left.length === right.length &&
    left.every((segment, index) =>
      Object.entries(segment).every(
        ([key, value]) =>
          key === "feelNoPain" || key === "objectiveControl" || value === right[index]?.[key],
      ),
    )
  );
}

function weaponInventoryProfileIdentity(inventory = []) {
  return inventory.map(({ sourceSavedUnitId, groupId, name, count, profiles }) => ({
    sourceSavedUnitId,
    groupId,
    name,
    count,
    profiles,
  }));
}

function weaponInventoryPreHazardousIdentity(inventory = []) {
  return weaponInventoryProfileIdentity(inventory).map((group) => ({
    ...group,
    profiles: group.profiles.map(({ hasHazardous, ...profile }) => {
      void hasHazardous;
      return profile;
    }),
  }));
}

function uniqueSetupEventId(used, playerIndex, formationIndex) {
  const base = `battle-setup-${playerIndex + 1}-${formationIndex + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

function legacyAggregateBearerFormation(existing, desired) {
  const historicalInventory = existing.weaponInventory?.length
    ? existing.weaponInventory
    : desired.weaponInventory;
  return {
    ...existing,
    keywords: desired.keywords,
    deploymentTraits: desired.deploymentTraits,
    defensiveEquipmentCounts: existing.defensiveEquipmentCounts ?? desired.defensiveEquipmentCounts,
    assignedTransportFormationId: desired.assignedTransportFormationId,
    transportOptions: desired.transportOptions,
    weaponBearerTracking: "legacy_aggregate",
    modelInstances: [],
    weaponInventory: historicalInventory.map((group) => ({
      ...group,
      bearerModelIds: [],
      bearerAssignmentsReviewed: true,
      bearerAssignmentSource: "legacy",
    })),
    segments: existing.segments.map((segment) => {
      const legacy = { ...segment };
      delete legacy.baseSegmentId;
      delete legacy.modelIds;
      delete legacy.weaponCopies;
      return legacy;
    }),
  };
}

function registerCompleteRosters(catalogue, state, firstList, secondList, equipmentOverrides = {}) {
  const desired = desiredRegistrations(catalogue, state, firstList, secondList, equipmentOverrides);
  const desiredIds = new Set(desired.map((formation) => formation.id));
  const existingEvents = state.events.filter((event) => event.type === "formation_registered");
  for (const event of existingEvents) {
    if (!desiredIds.has(event.formation.id)) {
      throw new Error(`Saved rosters no longer contain battle formation ${event.formation.name}`);
    }
  }
  const existingById = new Map(existingEvents.map((event) => [event.formation.id, event]));
  const registrationPrefix = state.events.slice(0, desired.length);
  const inventoryMismatch = desired.some(
    (formation) =>
      existingById.has(formation.id) &&
      JSON.stringify(
        weaponInventoryProfileIdentity(existingById.get(formation.id).formation.weaponInventory),
      ) !== JSON.stringify(weaponInventoryProfileIdentity(formation.weaponInventory)),
  );
  const lockedInventoryVersion = state.migration?.sourceVersion ?? state.version;
  const hazardousMetadataOnlyMismatch =
    lockedInventoryVersion < HAZARDOUS_BATTLE_STATE_VERSION &&
    desired.every(
      (formation) =>
        !existingById.has(formation.id) ||
        JSON.stringify(
          weaponInventoryPreHazardousIdentity(
            existingById.get(formation.id).formation.weaponInventory,
          ),
        ) === JSON.stringify(weaponInventoryPreHazardousIdentity(formation.weaponInventory)),
    );
  if (
    inventoryMismatch &&
    lockedInventoryVersion >= WEAPON_INVENTORY_BATTLE_STATE_VERSION &&
    !hazardousMetadataOnlyMismatch
  ) {
    throw new Error("Saved roster weapon inventory no longer matches its locked battle formation");
  }
  const needsEventRewrite =
    existingEvents.length !== desired.length ||
    registrationPrefix.some(
      (event, index) =>
        event.type !== "formation_registered" ||
        event.formation.id !== desired[index]?.id ||
        inventoryMismatch,
    );
  if (!needsEventRewrite && state.version >= BATTLE_STATE_VERSION) return state;
  const usedEventIds = new Set(state.events.map((event) => event.id));
  let formationIndex = 0;
  const registrations = desired.map((formation) => {
    const existing = existingById.get(formation.id);
    if (existing) {
      if (
        state.version < WEAPON_BEARER_BATTLE_STATE_VERSION ||
        state.migration?.sourceVersion < WEAPON_BEARER_BATTLE_STATE_VERSION
      ) {
        return {
          ...existing,
          formation: legacyAggregateBearerFormation(existing.formation, formation),
        };
      }
      if (
        (state.version < BATTLE_STATE_VERSION ||
          state.migration?.sourceVersion < BATTLE_STATE_VERSION) &&
        sameSegments(existing.formation.segments, formation.segments)
      ) {
        return {
          ...existing,
          formation: {
            ...existing.formation,
            keywords: formation.keywords,
            hasWaaaghAbility: formation.hasWaaaghAbility,
            hasOathOfMomentAbility: formation.hasOathOfMomentAbility,
            hasShadowInTheWarpAbility: formation.hasShadowInTheWarpAbility,
            reanimationProtocolSavedUnitIds: formation.reanimationProtocolSavedUnitIds,
            deploymentTraits: formation.deploymentTraits,
            defensiveEquipmentCounts: formation.defensiveEquipmentCounts,
            weaponInventory: formation.weaponInventory,
            assignedTransportFormationId: formation.assignedTransportFormationId,
            transportOptions: formation.transportOptions,
            segments:
              state.version < OBJECTIVE_CONTROL_BATTLE_STATE_VERSION
                ? existing.formation.segments
                : formation.segments,
          },
        };
      }
      return existing;
    }
    const playerIndex = state.players.findIndex((player) => player.id === formation.playerId);
    return {
      version: BATTLE_EVENT_VERSION,
      id: uniqueSetupEventId(usedEventIds, playerIndex, formationIndex++),
      sequence: 0,
      at: 0,
      type: "formation_registered",
      formation,
    };
  });
  const desiredById = new Map(desired.map((formation) => [formation.id, formation]));
  const combatEvents = state.events
    .filter((event) => event.type !== "formation_registered")
    .map((event) => {
      if (
        state.version >= WEAPON_BEARER_BATTLE_STATE_VERSION ||
        event.type !== "formation_configured"
      ) {
        return event;
      }
      const desiredFormation = desiredById.get(event.formation.id);
      if (!desiredFormation) return event;
      return {
        ...event,
        formation: legacyAggregateBearerFormation(event.formation, desiredFormation),
      };
    });
  const events = [...registrations, ...combatEvents].map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
  return normalizeBattleState({ ...state, events });
}

export function battleRosterRevisionsMatch(state, firstList, secondList) {
  if (!state || state.version < ROSTER_BATTLE_STATE_VERSION) return true;
  try {
    const lists = listsForPlayers(state, firstList, secondList);
    return state.players.every(
      (player, index) => player.listUpdatedAt === listRevision(lists[index]),
    );
  } catch {
    return false;
  }
}

function battleRuleSelectionIdentitiesMatch(plan, players, lists) {
  return players.every((player, index) => {
    const selected = plan.players.find((candidate) => candidate.playerId === player.id);
    const list = lists[index];
    return (
      selected?.faction.sourceId === list.factionId &&
      selected.datasheets.length === list.units.length &&
      list.units.every((unit) =>
        selected.datasheets.some(
          (datasheet) => datasheet.savedUnitId === unit.id && datasheet.datasheetId === unit.unitId,
        ),
      )
    );
  });
}

function validateArmyRuleCatalogueSelections(catalogue, players, lists, overrides) {
  if (!Array.isArray(catalogue.detachments) || !Array.isArray(catalogue.enhancements)) {
    throw new Error("The loaded catalogue does not include source-locked army rules");
  }
  const detachments = new Map(catalogue.detachments.map((entry) => [entry.id, entry]));
  const enhancements = new Map(catalogue.enhancements.map((entry) => [entry.id, entry]));
  players.forEach((player, index) => {
    const selection = overrides.players?.[player.id] ?? {};
    const detachmentId = selection.detachmentSourceId?.trim() ?? "";
    const enhancementIds = Array.isArray(selection.enhancementSourceIds)
      ? selection.enhancementSourceIds.map((id) => id.trim()).filter(Boolean)
      : [];
    if (
      selection.detachmentRuleIds !== undefined &&
      (enhancementIds.length === 0 || selection.enhancementRuleIds !== undefined)
    ) {
      return;
    }
    if (!detachmentId || detachmentId === "unselected") {
      if (enhancementIds.length > 0) {
        throw new Error(`${player.name} cannot select enhancements without a detachment`);
      }
      return;
    }
    const detachment = detachments.get(detachmentId);
    if (!detachment || detachment.factionId !== lists[index].factionId) {
      throw new Error(`${player.name} selected a detachment outside its source faction`);
    }
    const listDatasheetIds = new Set(lists[index].units.map((unit) => unit.unitId));
    for (const enhancementId of enhancementIds) {
      const enhancement = enhancements.get(enhancementId);
      if (!enhancement || enhancement.detachmentId !== detachmentId) {
        throw new Error(`${player.name} selected an enhancement outside its detachment`);
      }
      if (!enhancement.eligibleDatasheetIds.some((id) => listDatasheetIds.has(id))) {
        throw new Error(`${player.name} has no source-eligible bearer for an enhancement`);
      }
    }
  });
}

function validateMissionPackSelections(missionPackCatalogue, overrides) {
  if (overrides.missionRuleIds !== undefined && overrides.terrainRuleIds !== undefined) return;
  const missionId = overrides.missionSourceId?.trim() ?? "";
  const terrainId = overrides.terrainSourceId?.trim() ?? "";
  if (!missionId && !terrainId) return;
  if (!missionId || missionId === "unselected" || !terrainId || terrainId === "unselected") {
    return;
  }
  if (!missionPackCatalogue) {
    throw new Error("The source-locked mission pack catalogue is required");
  }
  validateMissionTerrainSelection(missionPackCatalogue, missionId, terrainId);
}

export function initializeBattleForLists({
  catalogue,
  firstList,
  secondList,
  rulesSnapshot,
  ruleCoverageMatrix,
  missionPackCatalogue = null,
  ruleSelectionOverrides = {},
  state = null,
  id = "battle-current",
  legacyFormationEquipmentCounts = {},
}) {
  if (!catalogue || !firstList || !secondList) {
    throw new Error("Both saved lists and the catalogue are required for battle setup");
  }
  if (!ruleCoverageMatrix?.sourceLocked) {
    throw new Error("A source-locked battle rule coverage matrix is required for battle setup");
  }
  let next = state;
  if (!next) {
    next = createBattleState({
      id,
      createdAt: 0,
      rulesSnapshot,
      players: newPlayers(firstList, secondList),
    });
  } else {
    listsForPlayers(next, firstList, secondList);
    if (next.rulesSnapshot !== rulesSnapshot) {
      throw new Error("Battle rules snapshot does not match the loaded catalogue");
    }
    if (next.version < BATTLE_STATE_VERSION) {
      const sourceVersion = next.version;
      next = registerCompleteRosters(
        catalogue,
        next,
        firstList,
        secondList,
        legacyFormationEquipmentCounts,
      );
      next = normalizeBattleState({
        ...next,
        version: BATTLE_STATE_VERSION,
        events:
          sourceVersion < SPATIAL_FACTS_BATTLE_STATE_VERSION
            ? upgradeSpatialGeometry(next.events)
            : next.events,
        players: upgradePlayers(next, firstList, secondList),
        migration: {
          sourceVersion,
          legacyUntimedThroughSequence:
            sourceVersion < TIMELINE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyUntimedThroughSequence ?? 0),
          legacyUnactionedThroughSequence:
            sourceVersion < ACTION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyUnactionedThroughSequence ?? 0),
          legacyDeploymentThroughSequence: next.events.length,
          legacyTransportThroughSequence:
            sourceVersion < TRANSPORT_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTransportThroughSequence ?? 0),
          legacyTransportCompatibilityThroughSequence:
            sourceVersion < TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTransportCompatibilityThroughSequence ?? 0),
          legacyTargetEligibilityThroughSequence:
            sourceVersion < TARGET_ELIGIBILITY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTargetEligibilityThroughSequence ?? 0),
          legacyWeaponInventoryThroughSequence:
            sourceVersion < WEAPON_INVENTORY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyWeaponInventoryThroughSequence ?? 0),
          legacyWeaponBearersThroughSequence:
            sourceVersion < WEAPON_BEARER_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyWeaponBearersThroughSequence ?? 0),
          legacyChargeMovementThroughSequence:
            sourceVersion < CHARGE_MOVE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyChargeMovementThroughSequence ?? 0),
          legacyFightMovementThroughSequence:
            sourceVersion < FIGHT_MOVE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyFightMovementThroughSequence ?? 0),
          legacyHeroicInterventionThroughSequence:
            sourceVersion < HEROIC_INTERVENTION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyHeroicInterventionThroughSequence ?? 0),
          legacyFireOverwatchThroughSequence:
            sourceVersion < FIRE_OVERWATCH_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyFireOverwatchThroughSequence ?? 0),
          legacyHazardousThroughSequence:
            sourceVersion < HAZARDOUS_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyHazardousThroughSequence ?? 0),
          legacyGoToGroundThroughSequence:
            sourceVersion < GO_TO_GROUND_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyGoToGroundThroughSequence ?? 0),
          legacyRangedDeclarationsThroughSequence:
            sourceVersion < RANGED_DECLARATION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyRangedDeclarationsThroughSequence ?? 0),
          legacySetupRulesThroughSequence:
            sourceVersion < SETUP_RULES_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacySetupRulesThroughSequence ?? 0),
          legacyCounterOffensiveThroughSequence:
            sourceVersion < COUNTER_OFFENSIVE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyCounterOffensiveThroughSequence ?? 0),
          legacySmokescreenThroughSequence:
            sourceVersion < SMOKESCREEN_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacySmokescreenThroughSequence ?? 0),
          legacyRapidIngressThroughSequence:
            sourceVersion < RAPID_INGRESS_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyRapidIngressThroughSequence ?? 0),
          legacyRuleCoverageThroughSequence:
            sourceVersion < RULE_COVERAGE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyRuleCoverageThroughSequence ?? 0),
          legacyTableGeometryThroughSequence:
            sourceVersion < TABLE_GEOMETRY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTableGeometryThroughSequence ?? 0),
          legacyTerrainFootprintsThroughSequence:
            sourceVersion < TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTerrainFootprintsThroughSequence ?? 0),
          legacyModelPlacementsThroughSequence:
            sourceVersion < MODEL_PLACEMENT_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyModelPlacementsThroughSequence ?? 0),
          legacyModelPositionsThroughSequence:
            sourceVersion < MODEL_POSITION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyModelPositionsThroughSequence ?? 0),
          legacyExtendedModelPositionsThroughSequence:
            sourceVersion < EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyExtendedModelPositionsThroughSequence ?? 0),
          legacyTransportModelLocationsThroughSequence:
            sourceVersion < TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTransportModelLocationsThroughSequence ?? 0),
          legacySpatialFactsThroughSequence:
            sourceVersion < SPATIAL_FACTS_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacySpatialFactsThroughSequence ?? 0),
          legacyTerrainVisibilityThroughSequence:
            sourceVersion < TERRAIN_VISIBILITY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTerrainVisibilityThroughSequence ?? 0),
          legacyRangedGeometryThroughSequence:
            sourceVersion < RANGED_GEOMETRY_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyRangedGeometryThroughSequence ?? 0),
          legacyConvexSilhouettesThroughSequence:
            sourceVersion < CONVEX_SILHOUETTE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyConvexSilhouettesThroughSequence ?? 0),
          legacyObjectiveControlThroughSequence:
            sourceVersion < OBJECTIVE_CONTROL_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyObjectiveControlThroughSequence ?? 0),
          legacyEndpointClearanceThroughSequence:
            sourceVersion < ENDPOINT_CLEARANCE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyEndpointClearanceThroughSequence ?? 0),
          legacyTerrainClearanceThroughSequence:
            sourceVersion < TERRAIN_CLEARANCE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyTerrainClearanceThroughSequence ?? 0),
          legacyMissionTrackingThroughSequence:
            sourceVersion < MISSION_TRACKING_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyMissionTrackingThroughSequence ?? 0),
          legacyDetachmentRulesThroughSequence:
            sourceVersion < DETACHMENT_RULE_STATE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyDetachmentRulesThroughSequence ?? 0),
          legacyMandatoryArmyRulesThroughSequence:
            sourceVersion < OATH_OF_MOMENT_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyMandatoryArmyRulesThroughSequence ?? 0),
          legacyReanimationProtocolsThroughSequence:
            sourceVersion < REANIMATION_PROTOCOLS_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyReanimationProtocolsThroughSequence ?? 0),
          legacyShadowInTheWarpThroughSequence:
            sourceVersion < SHADOW_IN_THE_WARP_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyShadowInTheWarpThroughSequence ?? 0),
          legacyBattleShockComparatorThroughSequence:
            sourceVersion < BATTLE_SHOCK_COMPARATOR_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyBattleShockComparatorThroughSequence ?? 0),
          legacyCommandBattleShockThroughSequence:
            sourceVersion < COMMAND_BATTLE_SHOCK_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyCommandBattleShockThroughSequence ?? 0),
          legacyDesperateEscapeThroughSequence:
            sourceVersion < DESPERATE_ESCAPE_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyDesperateEscapeThroughSequence ?? 0),
          legacyAttachedSeparationThroughSequence:
            sourceVersion < ATTACHED_SEPARATION_BATTLE_STATE_VERSION
              ? next.events.length
              : (next.migration?.legacyAttachedSeparationThroughSequence ?? 0),
        },
      });
    } else if (!battleRosterRevisionsMatch(next, firstList, secondList)) {
      throw new Error("A saved roster changed after this battle was set up");
    }
  }
  next = registerCompleteRosters(catalogue, next, firstList, secondList);
  const lists = listsForPlayers(next, firstList, secondList);
  const current = replayBattleState(next).ruleCoverage;
  if (current && Object.keys(ruleSelectionOverrides).length === 0) {
    const verified = verifyBattleRuleCoverageBinding(ruleCoverageMatrix, current);
    if (!battleRuleSelectionIdentitiesMatch(verified.plan, next.players, lists)) {
      throw new Error("Battle rule selections do not match the locked saved rosters");
    }
    return next;
  }
  validateArmyRuleCatalogueSelections(catalogue, next.players, lists, ruleSelectionOverrides);
  validateMissionPackSelections(missionPackCatalogue, ruleSelectionOverrides);
  const plan = deriveBattleRuleSelectionPlan(
    ruleCoverageMatrix,
    next.players,
    lists,
    ruleSelectionOverrides,
  );
  const coverage = bindBattleRuleSelections(ruleCoverageMatrix, plan);
  verifyBattleRuleCoverageBinding(ruleCoverageMatrix, coverage);
  if (JSON.stringify(current) !== JSON.stringify(coverage)) {
    next = configureBattleRuleCoverage(
      next,
      coverage,
      `battle-rule-coverage-${next.events.length + 1}`,
      next.events.length + 1,
    );
  }
  return next;
}
