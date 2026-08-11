import {
  ACTION_BATTLE_STATE_VERSION,
  BATTLE_EVENT_VERSION,
  BATTLE_STATE_VERSION,
  CHARGE_MOVE_BATTLE_STATE_VERSION,
  FIGHT_MOVE_BATTLE_STATE_VERSION,
  FIRE_OVERWATCH_BATTLE_STATE_VERSION,
  HAZARDOUS_BATTLE_STATE_VERSION,
  HEROIC_INTERVENTION_BATTLE_STATE_VERSION,
  ROSTER_BATTLE_STATE_VERSION,
  TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
  TIMELINE_BATTLE_STATE_VERSION,
  TRANSPORT_BATTLE_STATE_VERSION,
  WEAPON_BEARER_BATTLE_STATE_VERSION,
  WEAPON_INVENTORY_BATTLE_STATE_VERSION,
  createBattleState,
  normalizeBattleState,
} from "./battle-state.mjs";
import {
  savedFormationBattleRegistration,
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationTargetSequence,
} from "./formations.mjs";
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

function registrationFor(formation, player, equipmentOverride, assignedTransportFormationId = "") {
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
  );
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
      );
    });
  });
}

function sameSegments(left, right) {
  return (
    left.length === right.length &&
    left.every((segment, index) =>
      Object.entries(segment).every(
        ([key, value]) => key === "feelNoPain" || value === right[index]?.[key],
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
    defensiveEquipmentCounts: existing.defensiveEquipmentCounts ?? desired.defensiveEquipmentCounts,
    assignedTransportFormationId: desired.assignedTransportFormationId,
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
            defensiveEquipmentCounts: formation.defensiveEquipmentCounts,
            weaponInventory: formation.weaponInventory,
            assignedTransportFormationId: formation.assignedTransportFormationId,
            segments: formation.segments,
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

export function initializeBattleForLists({
  catalogue,
  firstList,
  secondList,
  rulesSnapshot,
  state = null,
  id = "battle-current",
  legacyFormationEquipmentCounts = {},
}) {
  if (!catalogue || !firstList || !secondList) {
    throw new Error("Both saved lists and the catalogue are required for battle setup");
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
        },
      });
    } else if (!battleRosterRevisionsMatch(next, firstList, secondList)) {
      throw new Error("A saved roster changed after this battle was set up");
    }
  }
  return registerCompleteRosters(catalogue, next, firstList, secondList);
}
