import { targetSequenceState } from "./allocation.mjs";
import {
  BATTLE_EFFECT_DURATIONS,
  BATTLE_PHASE_STEPS,
  battleAttackWindow,
  effectExpiresOnAdvance,
  nextBattleClock,
  sameBattleClock,
  setupBattleClock,
  startBattleClock,
} from "./battle-clock.mjs";
import { normalizeDefensiveEquipmentCounts } from "./defensive-equipment.mjs";

export const BATTLE_STATE_VERSION = 10;
export const WEAPON_BEARER_BATTLE_STATE_VERSION = 10;
export const WEAPON_INVENTORY_BATTLE_STATE_VERSION = 9;
export const TARGET_ELIGIBILITY_BATTLE_STATE_VERSION = 8;
export const TRANSPORT_BATTLE_STATE_VERSION = 7;
export const DEPLOYMENT_BATTLE_STATE_VERSION = 6;
export const ACTION_BATTLE_STATE_VERSION = 5;
export const TRACKER_BATTLE_STATE_VERSION = 4;
export const TIMELINE_BATTLE_STATE_VERSION = 3;
export const ROSTER_BATTLE_STATE_VERSION = 2;
export const BATTLE_EVENT_VERSION = 1;
export const LEGACY_BATTLE_STATE_VERSION = 1;

function record(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function boundedString(value, name, maximum = 200) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function nonnegativeInteger(value, name, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

function boundedInteger(value, name, minimum = -1_000_000, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

const MOVEMENT_KINDS = Object.freeze(["stationary", "normal", "advance", "fall_back"]);
const ACTIVATION_TYPES = Object.freeze(["shooting", "fight"]);
const DEPLOYMENT_LOCATIONS = Object.freeze([
  "battlefield",
  "reserves",
  "strategic_reserves",
  "embarked",
]);
const TARGET_MEASUREMENT_METHODS = Object.freeze(["manual", "uwb", "camera", "imported"]);

export function rangedTargetEligibilityIsValid(fact, declaredWeaponCount) {
  return Boolean(
    fact &&
      Number.isSafeInteger(fact.publishedRangeThousandths) &&
      fact.publishedRangeThousandths > 0 &&
      Number.isSafeInteger(fact.effectiveRangeThousandths) &&
      fact.effectiveRangeThousandths > 0 &&
      Number.isSafeInteger(fact.measuredDistanceThousandths) &&
      fact.measuredDistanceThousandths > 0 &&
      fact.measuredDistanceThousandths <= fact.effectiveRangeThousandths &&
      Number.isSafeInteger(fact.eligibleWeaponCount) &&
      Number.isSafeInteger(declaredWeaponCount) &&
      declaredWeaponCount > 0 &&
      declaredWeaponCount <= fact.eligibleWeaponCount &&
      fact.reviewedByPlayer &&
      (!fact.fullyVisible || fact.visible) &&
      ((fact.visible && !fact.indirectFire) ||
        (!fact.visible && fact.indirectFire && fact.weaponHasIndirect)) &&
      (fact.publishedRangeThousandths === fact.effectiveRangeThousandths ||
        Boolean(fact.rangeOverrideReason?.trim())),
  );
}

export function weaponInventoryDeclarationIsValid(
  inventoryCount,
  sourceModelsRemaining,
  usedCount,
  declaredCount,
  inventoryFlags,
  declaredFlags,
) {
  return Boolean(
    Number.isSafeInteger(inventoryCount) &&
      inventoryCount > 0 &&
      Number.isSafeInteger(sourceModelsRemaining) &&
      sourceModelsRemaining > 0 &&
      Number.isSafeInteger(usedCount) &&
      usedCount >= 0 &&
      usedCount <= inventoryCount &&
      Number.isSafeInteger(declaredCount) &&
      declaredCount > 0 &&
      declaredCount <= inventoryCount - usedCount &&
      Number.isSafeInteger(inventoryFlags) &&
      inventoryFlags >= 0 &&
      inventoryFlags <= 3 &&
      Number.isSafeInteger(declaredFlags) &&
      declaredFlags >= 0 &&
      declaredFlags <= 3 &&
      ((declaredFlags & 1) === 0 || (inventoryFlags & 1) !== 0) &&
      ((declaredFlags & 2) === 0 || (inventoryFlags & 2) !== 0),
  );
}

export function weaponBearerDeclarationIsValid(
  inventoryCount,
  survivingBearerCount,
  usedCount,
  declaredCount,
  inventoryFlags,
  declaredFlags,
) {
  return Boolean(
    weaponInventoryDeclarationIsValid(
      inventoryCount,
      1,
      usedCount,
      declaredCount,
      inventoryFlags,
      declaredFlags,
    ) &&
      Number.isSafeInteger(survivingBearerCount) &&
      survivingBearerCount > 0 &&
      survivingBearerCount <= inventoryCount &&
      usedCount <= survivingBearerCount &&
      declaredCount <= survivingBearerCount - usedCount,
  );
}

function formationDestroyed(formation) {
  return Object.values(formation?.health ?? {}).every((health) => health.modelsRemaining === 0);
}

function sameTurn(left, right) {
  return (
    left?.status === "active" &&
    right?.status === "active" &&
    left.battleRound === right.battleRound &&
    left.turn === right.turn &&
    left.activePlayerId === right.activePlayerId
  );
}

function samePhase(left, right) {
  return sameTurn(left, right) && left.phase === right.phase;
}

function otherPlayerId(players, playerId) {
  const other = players.find((player) => player.id !== playerId);
  if (!other) throw new Error("Battle state cannot determine the other player");
  return other.id;
}

function defaultMission(players) {
  return {
    name: "Custom mission",
    pointsLimit: 2000,
    deploymentFirstPlayerId: players[0].id,
    commandPointsPerCommandPhase: 1,
    startingCommandPoints: Object.fromEntries(players.map((player) => [player.id, 0])),
    objectives: Array.from({ length: 5 }, (_, index) => ({
      id: `objective-${index + 1}`,
      name: `Objective ${index + 1}`,
    })),
  };
}

function normalizeMission(candidate, players) {
  const mission = record(candidate, "Battle mission must be an object");
  if (!Array.isArray(mission.objectives) || mission.objectives.length > 12) {
    throw new Error("Battle mission must contain at most 12 objectives");
  }
  const objectives = mission.objectives.map((candidateObjective) => {
    const objective = record(candidateObjective, "Each objective must be an object");
    return {
      id: boundedString(objective.id, "Objective id", 100),
      name: boundedString(objective.name, "Objective name", 100),
    };
  });
  if (new Set(objectives.map((objective) => objective.id)).size !== objectives.length) {
    throw new Error("Objective ids must be unique");
  }
  const starting = record(
    mission.startingCommandPoints,
    "Mission startingCommandPoints must be an object",
  );
  const startingCommandPoints = Object.fromEntries(
    [...players].map((playerId) => [
      playerId,
      nonnegativeInteger(starting[playerId], `Starting Command Points for ${playerId}`, 100),
    ]),
  );
  if (Object.keys(starting).some((playerId) => !players.has(playerId))) {
    throw new Error("Mission startingCommandPoints contains an unknown player");
  }
  const deploymentFirstPlayerId = boundedString(
    mission.deploymentFirstPlayerId ?? [...players][0],
    "Mission deployment first player",
    100,
  );
  if (!players.has(deploymentFirstPlayerId)) {
    throw new Error("Mission deployment first player is unknown");
  }
  return {
    name: boundedString(mission.name, "Mission name", 200),
    pointsLimit: nonnegativeInteger(mission.pointsLimit ?? 2000, "Mission points limit", 100000),
    deploymentFirstPlayerId,
    commandPointsPerCommandPhase: nonnegativeInteger(
      mission.commandPointsPerCommandPhase,
      "Command Points per Command phase",
      10,
    ),
    startingCommandPoints,
    objectives,
  };
}

function normalizePlayers(players, stateVersion) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error("Battle state must contain exactly two players");
  }
  const normalized = players.map((candidate) => {
    const player = record(candidate, "Each battle player must be an object");
    const normalized = {
      id: boundedString(player.id, "Player id", 100),
      listId: boundedString(player.listId, "Player list id", 100),
      name: boundedString(player.name, "Player name"),
    };
    if (stateVersion >= ROSTER_BATTLE_STATE_VERSION) {
      normalized.listUpdatedAt = nonnegativeInteger(
        player.listUpdatedAt,
        "Player listUpdatedAt",
        Number.MAX_SAFE_INTEGER,
      );
    }
    return normalized;
  });
  if (new Set(normalized.map((player) => player.id)).size !== normalized.length) {
    throw new Error("Battle player ids must be unique");
  }
  return normalized;
}

function normalizeClock(candidate, players) {
  const clock = record(candidate, "Battle clock must be an object");
  const normalized = {
    status: boundedString(clock.status, "Battle clock status", 20),
    battleRound: nonnegativeInteger(clock.battleRound, "Battle round", 5),
    turn: nonnegativeInteger(clock.turn, "Battle turn", 2),
    phase: boundedString(clock.phase, "Battle phase", 40),
    step: boundedString(clock.step, "Battle step", 40),
    firstPlayerId: typeof clock.firstPlayerId === "string" ? clock.firstPlayerId : "",
    activePlayerId: typeof clock.activePlayerId === "string" ? clock.activePlayerId : "",
    priorityPlayerId: typeof clock.priorityPlayerId === "string" ? clock.priorityPlayerId : "",
  };
  if (normalized.status === "setup") {
    if (!sameBattleClock(normalized, setupBattleClock())) {
      throw new Error("Setup battle clock is invalid");
    }
    return normalized;
  }
  if (normalized.status === "complete") {
    if (
      normalized.battleRound !== 5 ||
      normalized.turn !== 2 ||
      normalized.phase !== "complete" ||
      normalized.step !== "complete" ||
      normalized.activePlayerId ||
      normalized.priorityPlayerId ||
      !players.has(normalized.firstPlayerId)
    ) {
      throw new Error("Completed battle clock is invalid");
    }
    return normalized;
  }
  if (
    normalized.status !== "active" ||
    normalized.battleRound < 1 ||
    normalized.turn < 1 ||
    !BATTLE_PHASE_STEPS[normalized.phase]?.includes(normalized.step) ||
    !players.has(normalized.firstPlayerId) ||
    !players.has(normalized.activePlayerId) ||
    !players.has(normalized.priorityPlayerId)
  ) {
    throw new Error("Active battle clock is invalid");
  }
  return normalized;
}

function normalizeStringArray(value, name, maximum = 100) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || !entry || entry.length > 200) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${name} must contain at most ${maximum} unique strings`);
  }
  return [...value];
}

function normalizeChoice(candidate, players) {
  const choice = record(candidate, "Pending choice must be an object");
  if (!Array.isArray(choice.options) || choice.options.length < 1 || choice.options.length > 32) {
    throw new Error("Pending choice must contain 1 to 32 options");
  }
  const options = choice.options.map((candidateOption) => {
    const option = record(candidateOption, "Each pending choice option must be an object");
    return {
      id: boundedString(option.id, "Pending choice option id", 100),
      label: boundedString(option.label, "Pending choice option label"),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new Error("Pending choice option ids must be unique");
  }
  const minimumSelections = nonnegativeInteger(
    choice.minimumSelections,
    "Pending choice minimum selections",
    options.length,
  );
  const maximumSelections = nonnegativeInteger(
    choice.maximumSelections,
    "Pending choice maximum selections",
    options.length,
  );
  if (minimumSelections > maximumSelections) {
    throw new Error("Pending choice selection bounds are invalid");
  }
  const ownerPlayerId = boundedString(choice.ownerPlayerId, "Pending choice owner", 100);
  if (!players.has(ownerPlayerId)) throw new Error("Pending choice owner is unknown");
  return {
    id: boundedString(choice.id, "Pending choice id", 100),
    kind: boundedString(choice.kind, "Pending choice kind", 60),
    ownerPlayerId,
    prompt: boundedString(choice.prompt, "Pending choice prompt", 500),
    minimumSelections,
    maximumSelections,
    options,
  };
}

function normalizeEffect(candidate, players) {
  const effect = record(candidate, "Battle effect must be an object");
  const ownerPlayerId = boundedString(effect.ownerPlayerId, "Battle effect owner", 100);
  if (!players.has(ownerPlayerId)) throw new Error("Battle effect owner is unknown");
  const duration = boundedString(effect.duration, "Battle effect duration", 40);
  if (!BATTLE_EFFECT_DURATIONS.includes(duration)) {
    throw new Error("Battle effect duration is unsupported");
  }
  const normalized = {
    id: boundedString(effect.id, "Battle effect id", 100),
    name: boundedString(effect.name, "Battle effect name"),
    ownerPlayerId,
    sourceFormationId:
      typeof effect.sourceFormationId === "string" && effect.sourceFormationId
        ? boundedString(effect.sourceFormationId, "Battle effect source formation id")
        : "",
    duration,
    appliedAt: normalizeClock(effect.appliedAt, players),
  };
  if (normalized.appliedAt.status !== "active") {
    throw new Error("Battle effects require an active clock");
  }
  return normalized;
}

function normalizeSegment(candidate) {
  const segment = record(candidate, "Each formation segment must be an object");
  const wounds = nonnegativeInteger(segment.wounds, "Segment wounds", 1024);
  const startingModels = nonnegativeInteger(
    segment.startingModels,
    "Segment starting models",
    1000,
  );
  if (wounds < 1 || startingModels < 1) {
    throw new Error("Formation segments must contain at least one model with at least one wound");
  }
  const feelNoPain = nonnegativeInteger(segment.feelNoPain ?? 0, "Segment Feel No Pain", 6);
  if (feelNoPain === 1) throw new Error("Segment Feel No Pain must be 0 or from 2 to 6");
  const normalized = {
    id: boundedString(segment.id, "Segment id"),
    savedUnitId: boundedString(segment.savedUnitId, "Segment saved unit id", 100),
    unitName: boundedString(segment.unitName, "Segment unit name"),
    modelName: boundedString(segment.modelName, "Segment model name"),
    role: boundedString(segment.role, "Segment role", 40),
    wounds,
    feelNoPain,
    startingModels,
  };
  if (segment.baseSegmentId !== undefined || segment.modelIds !== undefined) {
    normalized.baseSegmentId = boundedString(segment.baseSegmentId, "Segment base id");
    normalized.modelIds = normalizeStringArray(segment.modelIds, "Segment model ids", 1000);
    if (
      normalized.modelIds.length !== startingModels ||
      new Set(normalized.modelIds).size !== normalized.modelIds.length
    ) {
      throw new Error("Exact battle segments require one unique model id per starting model");
    }
    if (!Array.isArray(segment.weaponCopies) || segment.weaponCopies.length > 256) {
      throw new Error("Segment weapon copies must contain at most 256 groups");
    }
    normalized.weaponCopies = segment.weaponCopies.map((candidateCopy) => {
      const copy = record(candidateCopy, "Each segment weapon copy must be an object");
      return {
        groupId: boundedString(copy.groupId, "Segment weapon group id", 200),
        name: boundedString(copy.name, "Segment weapon name", 200),
        count: nonnegativeInteger(copy.count, "Segment weapon copies per model", 1000),
      };
    });
    if (
      normalized.weaponCopies.some((copy) => copy.count < 1) ||
      new Set(normalized.weaponCopies.map((copy) => copy.groupId)).size !==
        normalized.weaponCopies.length
    ) {
      throw new Error("Segment weapon copies must be positive and unique");
    }
  }
  return normalized;
}

function normalizeModelInstances(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw new Error("Exact battle formation must contain 1 to 1000 model instances");
  }
  const models = value.map((candidate) => {
    const model = record(candidate, "Each battle model instance must be an object");
    return {
      id: boundedString(model.id, "Battle model instance id"),
      baseSegmentId: boundedString(model.baseSegmentId, "Battle model base segment id"),
      savedUnitId: boundedString(model.savedUnitId, "Battle model saved unit id", 100),
      unitName: boundedString(model.unitName, "Battle model unit name"),
      modelName: boundedString(model.modelName, "Battle model name"),
      ordinal: nonnegativeInteger(model.ordinal, "Battle model ordinal", 1000),
    };
  });
  if (
    models.some((model) => model.ordinal < 1) ||
    new Set(models.map((model) => model.id)).size !== models.length
  ) {
    throw new Error("Battle model instances require positive ordinals and unique ids");
  }
  return models;
}

function normalizeRepeatedStringArray(value, name, maximum = 1000) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${name} must contain at most ${maximum} strings`);
  }
  return value.map((entry) => boundedString(entry, name, 200));
}

function normalizeWeaponProfile(candidate) {
  const profile = record(candidate, "Each weapon inventory profile must be an object");
  const type = boundedString(profile.type, "Weapon inventory profile type", 20);
  if (type !== "Ranged" && type !== "Melee") {
    throw new Error("Weapon inventory profile type must be Ranged or Melee");
  }
  const publishedRangeThousandths = nonnegativeInteger(
    profile.publishedRangeThousandths,
    "Weapon inventory published Range",
    1_000_000,
  );
  if (
    (type === "Ranged" && publishedRangeThousandths < 1) ||
    (type === "Melee" && publishedRangeThousandths !== 0)
  ) {
    throw new Error("Weapon inventory profile Range does not match its type");
  }
  return {
    weaponId: boundedString(profile.weaponId, "Weapon inventory profile id", 100),
    name: boundedString(profile.name, "Weapon inventory profile name", 200),
    type,
    publishedRangeThousandths,
    hasAssault: Boolean(profile.hasAssault),
    hasIndirect: Boolean(profile.hasIndirect),
  };
}

function normalizeWeaponInventory(value, segments, stateVersion, modelInstances, tracking) {
  if (stateVersion < WEAPON_INVENTORY_BATTLE_STATE_VERSION) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Formation weapon inventory must contain at most 256 weapon groups");
  }
  const savedUnitIds = new Set(segments.map((segment) => segment.savedUnitId));
  const inventory = value.map((candidate) => {
    const group = record(candidate, "Each weapon inventory group must be an object");
    const sourceSavedUnitId = boundedString(
      group.sourceSavedUnitId,
      "Weapon inventory source saved unit id",
      100,
    );
    if (!savedUnitIds.has(sourceSavedUnitId)) {
      throw new Error("Weapon inventory source is not part of its formation");
    }
    if (!Array.isArray(group.profiles) || group.profiles.length < 1 || group.profiles.length > 16) {
      throw new Error("Weapon inventory group must contain 1 to 16 profiles");
    }
    const profiles = group.profiles.map(normalizeWeaponProfile);
    if (new Set(profiles.map((profile) => profile.weaponId)).size !== profiles.length) {
      throw new Error("Weapon inventory profile ids must be unique within a group");
    }
    const normalized = {
      sourceSavedUnitId,
      groupId: boundedString(group.groupId, "Weapon inventory group id", 200),
      name: boundedString(group.name, "Weapon inventory group name", 200),
      count: nonnegativeInteger(group.count, "Weapon inventory equipped count", 1000),
      profiles,
    };
    if (stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
      normalized.bearerModelIds = normalizeRepeatedStringArray(
        group.bearerModelIds ?? [],
        "Weapon bearer model ids",
        1000,
      );
      normalized.bearerAssignmentsReviewed = Boolean(group.bearerAssignmentsReviewed);
      normalized.bearerAssignmentSource = boundedString(
        group.bearerAssignmentSource ??
          (tracking === "legacy_aggregate" ? "legacy" : "setup_required"),
        "Weapon bearer assignment source",
        40,
      );
      if (tracking === "exact") {
        if (normalized.bearerModelIds.length !== normalized.count) {
          throw new Error("Every equipped weapon copy requires an exact bearer model id");
        }
        const models = new Map(modelInstances.map((model) => [model.id, model]));
        if (
          normalized.bearerModelIds.some(
            (modelId) => models.get(modelId)?.savedUnitId !== sourceSavedUnitId,
          )
        ) {
          throw new Error("Weapon bearers must belong to the weapon source saved unit");
        }
      } else if (normalized.bearerModelIds.length > 0) {
        throw new Error("Legacy aggregate weapon inventory cannot claim exact bearer ids");
      }
    }
    return normalized;
  });
  if (inventory.some((group) => group.count < 1)) {
    throw new Error("Weapon inventory groups must contain at least one equipped copy");
  }
  const keys = inventory.map((group) => `${group.sourceSavedUnitId}\u0000${group.groupId}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Formation weapon inventory groups must be unique per source unit");
  }
  return inventory;
}

function normalizeFormation(candidate, stateVersion) {
  const formation = record(candidate, "Formation registration must be an object");
  if (
    !Array.isArray(formation.segments) ||
    formation.segments.length < 1 ||
    formation.segments.length > 32
  ) {
    throw new Error("Formation must contain 1 to 32 model segments");
  }
  const segments = formation.segments.map(normalizeSegment);
  if (new Set(segments.map((segment) => segment.id)).size !== segments.length) {
    throw new Error("Formation segment ids must be unique");
  }
  const tracking =
    stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION
      ? boundedString(
          formation.weaponBearerTracking ?? "legacy_aggregate",
          "Weapon bearer tracking mode",
          30,
        )
      : "legacy_aggregate";
  if (tracking !== "exact" && tracking !== "legacy_aggregate") {
    throw new Error("Weapon bearer tracking mode must be exact or legacy_aggregate");
  }
  const modelInstances =
    stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION && tracking === "exact"
      ? normalizeModelInstances(formation.modelInstances)
      : [];
  const normalized = {
    id: boundedString(formation.id, "Formation id"),
    playerId: boundedString(formation.playerId, "Formation player id", 100),
    sourceFormationId: boundedString(
      formation.sourceFormationId,
      "Formation source formation id",
      100,
    ),
    name: boundedString(formation.name, "Formation name"),
    assignedTransportFormationId:
      typeof formation.assignedTransportFormationId === "string" &&
      formation.assignedTransportFormationId
        ? boundedString(
            formation.assignedTransportFormationId,
            "Assigned Transport formation id",
            100,
          )
        : "",
    keywords: normalizeStringArray(formation.keywords ?? [], "Formation keywords", 100).map(
      (keyword) => keyword.toLowerCase(),
    ),
    segments,
  };
  if (stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
    normalized.weaponBearerTracking = tracking;
    normalized.modelInstances = modelInstances;
  }
  normalized.weaponInventory = normalizeWeaponInventory(
    formation.weaponInventory ?? [],
    segments,
    stateVersion,
    modelInstances,
    tracking,
  );
  normalized.defensiveEquipmentCounts = normalizeDefensiveEquipmentCounts(
    formation.defensiveEquipmentCounts ?? {},
    "Formation defensiveEquipmentCounts",
  );
  if (tracking === "exact") {
    const instances = new Map(modelInstances.map((model) => [model.id, model]));
    const assignedModels = segments.flatMap((segment) => segment.modelIds ?? []);
    if (
      assignedModels.length !== modelInstances.length ||
      new Set(assignedModels).size !== modelInstances.length ||
      assignedModels.some((modelId) => !instances.has(modelId))
    ) {
      throw new Error("Exact battle segments must partition every registered model instance");
    }
    for (const segment of segments) {
      if (!segment.baseSegmentId || !segment.modelIds || !segment.weaponCopies) {
        throw new Error("Exact weapon bearer tracking requires exact battle segments");
      }
      if (
        segment.modelIds.some(
          (modelId) => instances.get(modelId)?.baseSegmentId !== segment.baseSegmentId,
        )
      ) {
        throw new Error("Exact battle segment contains a model from another base profile");
      }
      const expected = normalized.weaponInventory.flatMap((group) => {
        const count = group.bearerModelIds.filter(
          (modelId) => modelId === segment.modelIds[0],
        ).length;
        return count > 0 ? [{ groupId: group.groupId, name: group.name, count }] : [];
      });
      if (
        segment.modelIds.some((modelId) =>
          normalized.weaponInventory.some(
            (group) =>
              group.bearerModelIds.filter((candidate) => candidate === modelId).length !==
              (expected.find((copy) => copy.groupId === group.groupId)?.count ?? 0),
          ),
        ) ||
        JSON.stringify(segment.weaponCopies) !== JSON.stringify(expected)
      ) {
        throw new Error(
          "Exact battle segment weapon signature does not match its bearer assignments",
        );
      }
    }
  }
  return normalized;
}

function weaponInventoryProfileIdentity(inventory) {
  return inventory.map(({ sourceSavedUnitId, groupId, name, count, profiles }) => ({
    sourceSavedUnitId,
    groupId,
    name,
    count,
    profiles,
  }));
}

function segmentsForBearerAssignments(formation, weaponInventory) {
  const existingByModelId = new Map(
    formation.segments.flatMap((segment) =>
      (segment.modelIds ?? []).map((modelId) => [modelId, segment]),
    ),
  );
  const grouped = new Map();
  for (const model of formation.modelInstances) {
    const source = existingByModelId.get(model.id);
    if (!source) throw new Error("Battle model is absent from its exact health segments");
    const weaponCopies = weaponInventory.flatMap((group) => {
      const count = group.bearerModelIds.filter((modelId) => modelId === model.id).length;
      return count > 0 ? [{ groupId: group.groupId, name: group.name, count }] : [];
    });
    const key = `${model.baseSegmentId}\u0000${JSON.stringify(
      weaponCopies.map(({ groupId, count }) => [groupId, count]),
    )}`;
    const entry = grouped.get(key) ?? { source, model, weaponCopies, modelIds: [] };
    entry.modelIds.push(model.id);
    grouped.set(key, entry);
  }
  const perBaseIndex = new Map();
  return [...grouped.values()].map(({ source, model, weaponCopies, modelIds }) => {
    const index = (perBaseIndex.get(model.baseSegmentId) ?? 0) + 1;
    perBaseIndex.set(model.baseSegmentId, index);
    return {
      id: `${model.baseSegmentId}:loadout:${index}`,
      baseSegmentId: model.baseSegmentId,
      savedUnitId: source.savedUnitId,
      unitName: source.unitName,
      modelName: source.modelName,
      role: source.role,
      wounds: source.wounds,
      feelNoPain: source.feelNoPain,
      startingModels: modelIds.length,
      modelIds,
      weaponCopies,
    };
  });
}

function prepareExactFormationRegistration(formation) {
  if (formation.weaponBearerTracking) return formation;
  const modelInstances = formation.segments.flatMap((segment) =>
    Array.from({ length: segment.startingModels }, (_, index) => ({
      id: `${segment.id}:model:${index + 1}`,
      baseSegmentId: segment.id,
      savedUnitId: segment.savedUnitId,
      unitName: segment.unitName,
      modelName: segment.modelName,
      ordinal: index + 1,
    })),
  );
  const weaponInventory = (formation.weaponInventory ?? []).map((group) => {
    const candidates = modelInstances.filter(
      (model) => model.savedUnitId === group.sourceSavedUnitId,
    );
    if (candidates.length < 1) {
      throw new Error("Weapon inventory source has no registered model bearer");
    }
    const exact = candidates.length === 1 || group.count === candidates.length;
    const bearerModelIds =
      candidates.length === 1
        ? Array.from({ length: group.count }, () => candidates[0].id)
        : Array.from(
            { length: group.count },
            (_, index) => candidates[index % candidates.length].id,
          );
    return {
      ...group,
      bearerModelIds,
      bearerAssignmentsReviewed: exact,
      bearerAssignmentSource:
        candidates.length === 1 ? "single_model" : exact ? "one_per_model" : "setup_required",
    };
  });
  const provisional = {
    ...formation,
    weaponBearerTracking: "exact",
    modelInstances,
    weaponInventory,
    segments: formation.segments.map((segment) => ({
      ...segment,
      baseSegmentId: segment.id,
      modelIds: modelInstances
        .filter((model) => model.baseSegmentId === segment.id)
        .map((model) => model.id),
      weaponCopies: [],
    })),
  };
  const split = segmentsForBearerAssignments(provisional, weaponInventory);
  const countsByBase = new Map();
  for (const segment of split) {
    countsByBase.set(segment.baseSegmentId, (countsByBase.get(segment.baseSegmentId) ?? 0) + 1);
  }
  return {
    ...provisional,
    segments: split.map((segment) => ({
      ...segment,
      id: countsByBase.get(segment.baseSegmentId) === 1 ? segment.baseSegmentId : segment.id,
    })),
  };
}

function normalizeHealth(candidate, segment, label) {
  const health = record(candidate, `${label} health must be an object`);
  const modelsRemaining = nonnegativeInteger(
    health.modelsRemaining,
    `${label} modelsRemaining`,
    segment.startingModels,
  );
  const woundsLost = nonnegativeInteger(
    health.woundsLost,
    `${label} woundsLost`,
    segment.wounds - 1,
  );
  if (modelsRemaining === 0 && woundsLost !== 0) {
    throw new Error(`${label} destroyed segment cannot retain wounds`);
  }
  return { modelsRemaining, woundsLost };
}

function normalizeHealthAllocations(value, formation, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(`${label} must contain 1 to 32 segment allocations`);
  }
  const segmentMap = new Map(formation.segments.map((segment) => [segment.id, segment]));
  const allocations = value.map((candidateAllocation) => {
    const allocation = record(candidateAllocation, `Each ${label} allocation must be an object`);
    const segmentId = boundedString(allocation.segmentId, `${label} segment id`);
    const segment = segmentMap.get(segmentId);
    if (!segment) throw new Error(`${label} references an unknown segment`);
    return {
      segmentId,
      before: normalizeHealth(allocation.before, segment, `${label} before`),
      after: normalizeHealth(allocation.after, segment, `${label} after`),
    };
  });
  if (new Set(allocations.map((allocation) => allocation.segmentId)).size !== allocations.length) {
    throw new Error(`${label} allocations must reference unique segments`);
  }
  return allocations;
}

function normalizeDieRolls(value, name, { allowZero = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some((roll) => !Number.isSafeInteger(roll) || roll < (allowZero ? 0 : 1) || roll > 6)
  ) {
    throw new Error(`${name} must contain at most 1000 D6 results`);
  }
  return [...value];
}

function normalizeSummary(candidate) {
  const summary = record(candidate, "Attack summary must be an object");
  const normalized = {};
  for (const key of ["damage", "successful", "modelsDestroyed"]) {
    normalized[key] = nonnegativeInteger(summary[key], `Attack summary ${key}`);
  }
  for (const key of ["attacker", "weapon", "target"]) {
    normalized[key] = boundedString(summary[key], `Attack summary ${key}`);
  }
  return normalized;
}

function normalizeEvent(candidate, sequence, formations, stateVersion) {
  const event = record(candidate, "Each battle event must be an object");
  const normalized = {
    version: nonnegativeInteger(event.version, "Event version", BATTLE_EVENT_VERSION),
    id: boundedString(event.id, "Event id", 100),
    sequence: nonnegativeInteger(event.sequence, "Event sequence"),
    at: nonnegativeInteger(event.at, "Event timestamp", Number.MAX_SAFE_INTEGER),
    type: boundedString(event.type, "Event type", 40),
  };
  if (normalized.version !== BATTLE_EVENT_VERSION)
    throw new Error("Unsupported battle event version");
  if (normalized.sequence !== sequence) throw new Error("Battle event sequence is not contiguous");
  if (
    stateVersion < TIMELINE_BATTLE_STATE_VERSION &&
    [
      "battle_started",
      "clock_advanced",
      "choice_opened",
      "choice_resolved",
      "effect_applied",
    ].includes(event.type)
  ) {
    throw new Error("Battle timeline events require battle-state version 3");
  }
  if (
    stateVersion < TRACKER_BATTLE_STATE_VERSION &&
    [
      "mission_configured",
      "resource_changed",
      "score_recorded",
      "objective_control_changed",
      "battleshock_changed",
    ].includes(event.type)
  ) {
    throw new Error("Battle tracker events require battle-state version 4");
  }
  if (
    stateVersion < ACTION_BATTLE_STATE_VERSION &&
    [
      "movement_recorded",
      "charge_recorded",
      "activation_started",
      "activation_completed",
      "fight_priority_passed",
    ].includes(event.type)
  ) {
    throw new Error("Battle action events require battle-state version 5");
  }
  if (
    stateVersion < DEPLOYMENT_BATTLE_STATE_VERSION &&
    ["deployment_declared", "formation_deployed", "reserve_arrived"].includes(event.type)
  ) {
    throw new Error("Battle deployment events require battle-state version 6");
  }
  if (
    stateVersion < TRANSPORT_BATTLE_STATE_VERSION &&
    ["formation_embarked", "formation_disembarked", "transport_destroyed_resolved"].includes(
      event.type,
    )
  ) {
    throw new Error("Transport events require battle-state version 7");
  }
  if (
    stateVersion < TARGET_ELIGIBILITY_BATTLE_STATE_VERSION &&
    event.type === "ranged_target_eligibility_recorded"
  ) {
    throw new Error("Structured target eligibility requires battle-state version 8");
  }
  if (event.type === "formation_registered") {
    const formation = normalizeFormation(event.formation, stateVersion);
    if (!formations.players.has(formation.playerId)) throw new Error("Formation player is unknown");
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "formation_configured") {
    const formation = normalizeFormation(event.formation, stateVersion);
    const previous = formations.byId.get(formation.id);
    if (!previous) throw new Error("Configured formation is not registered");
    if (
      previous.playerId !== formation.playerId ||
      previous.sourceFormationId !== formation.sourceFormationId ||
      previous.assignedTransportFormationId !== formation.assignedTransportFormationId ||
      JSON.stringify(weaponInventoryProfileIdentity(previous.weaponInventory)) !==
        JSON.stringify(weaponInventoryProfileIdentity(formation.weaponInventory))
    ) {
      throw new Error("Formation identity cannot change during battle setup");
    }
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "battle_started") {
    normalized.firstPlayerId = boundedString(event.firstPlayerId, "First player id", 100);
    if (!formations.players.has(normalized.firstPlayerId)) {
      throw new Error("First player is unknown");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "clock_advanced") {
    normalized.from = normalizeClock(event.from, formations.players);
    normalized.to = normalizeClock(event.to, formations.players);
    normalized.expiredEffectIds = normalizeStringArray(
      event.expiredEffectIds,
      "Expired effect ids",
      1000,
    );
    return normalized;
  }
  if (event.type === "choice_opened") {
    normalized.choice = normalizeChoice(event.choice, formations.players);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "choice_resolved") {
    normalized.choiceId = boundedString(event.choiceId, "Resolved choice id", 100);
    normalized.selectedOptionIds = normalizeStringArray(
      event.selectedOptionIds,
      "Selected option ids",
      32,
    );
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "effect_applied") {
    normalized.effect = normalizeEffect(event.effect, formations.players);
    return normalized;
  }
  if (event.type === "mission_configured") {
    normalized.mission = normalizeMission(event.mission, formations.players);
    return normalized;
  }
  if (event.type === "resource_changed") {
    normalized.playerId = boundedString(event.playerId, "Resource player id", 100);
    if (!formations.players.has(normalized.playerId)) throw new Error("Resource player is unknown");
    normalized.resourceId = boundedString(event.resourceId, "Resource id", 100);
    normalized.name = boundedString(event.name, "Resource name", 100);
    normalized.before = nonnegativeInteger(event.before, "Resource value before change", 100000);
    normalized.after = nonnegativeInteger(event.after, "Resource value after change", 100000);
    normalized.maximum =
      event.maximum === null ? null : nonnegativeInteger(event.maximum, "Resource maximum", 100000);
    if (normalized.maximum !== null && normalized.after > normalized.maximum) {
      throw new Error("Resource value cannot exceed its maximum");
    }
    normalized.reason = boundedString(event.reason, "Resource change reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "score_recorded") {
    normalized.playerId = boundedString(event.playerId, "Scoring player id", 100);
    if (!formations.players.has(normalized.playerId)) throw new Error("Scoring player is unknown");
    normalized.category = boundedString(event.category, "Scoring category", 60);
    normalized.points = boundedInteger(event.points, "Scoring points", -1000, 1000);
    normalized.before = nonnegativeInteger(event.before, "Victory Points before score", 100000);
    normalized.after = nonnegativeInteger(event.after, "Victory Points after score", 100000);
    normalized.reason = boundedString(event.reason, "Scoring reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "objective_control_changed") {
    normalized.objectiveId = boundedString(event.objectiveId, "Objective id", 100);
    normalized.controllerPlayerId =
      typeof event.controllerPlayerId === "string" && event.controllerPlayerId
        ? boundedString(event.controllerPlayerId, "Objective controller", 100)
        : "";
    if (normalized.controllerPlayerId && !formations.players.has(normalized.controllerPlayerId)) {
      throw new Error("Objective controller is unknown");
    }
    normalized.contested = Boolean(event.contested);
    if (normalized.controllerPlayerId && normalized.contested) {
      throw new Error("A controlled objective cannot also be contested");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "battleshock_changed") {
    normalized.formationId = boundedString(event.formationId, "Battle-shock formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Battle-shock formation is not registered");
    }
    normalized.battleShocked = Boolean(event.battleShocked);
    normalized.reason = boundedString(event.reason, "Battle-shock reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "movement_recorded") {
    normalized.formationId = boundedString(event.formationId, "Movement formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Movement formation is not registered");
    }
    normalized.movement = boundedString(event.movement, "Movement kind", 20);
    if (!MOVEMENT_KINDS.includes(normalized.movement)) {
      throw new Error("Movement kind is unsupported");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "deployment_declared") {
    normalized.formationId = boundedString(event.formationId, "Deployment formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Deployment formation is not registered");
    }
    normalized.location = boundedString(event.location, "Deployment location", 40);
    if (!DEPLOYMENT_LOCATIONS.includes(normalized.location)) {
      throw new Error("Deployment location is unsupported");
    }
    normalized.transportFormationId =
      normalized.location === "embarked"
        ? boundedString(event.transportFormationId, "Embarked Transport formation id", 100)
        : "";
    if (normalized.transportFormationId && !formations.byId.has(normalized.transportFormationId)) {
      throw new Error("Embarked Transport formation is not registered");
    }
    normalized.points = nonnegativeInteger(event.points, "Deployment points", 100000);
    normalized.earliestBattleRound = nonnegativeInteger(
      event.earliestBattleRound,
      "Earliest reserve battle round",
      5,
    );
    if (normalized.earliestBattleRound < 1) {
      throw new Error("Earliest reserve battle round must be from 1 to 5");
    }
    if (
      normalized.location === "strategic_reserves" &&
      (normalized.points < 1 || normalized.earliestBattleRound < 2)
    ) {
      throw new Error("Strategic Reserves require points and cannot arrive in round one");
    }
    normalized.eligibilityConfirmed = Boolean(event.eligibilityConfirmed);
    normalized.eligibilityReason = normalized.eligibilityConfirmed
      ? boundedString(event.eligibilityReason, "Reserve eligibility confirmation", 300)
      : "";
    if (
      ["reserves", "strategic_reserves"].includes(normalized.location) &&
      !normalized.eligibilityConfirmed
    ) {
      throw new Error("A Reserves declaration requires explicit source-rule eligibility");
    }
    return normalized;
  }
  if (event.type === "formation_deployed") {
    normalized.formationId = boundedString(event.formationId, "Deployed formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Deployed formation is not registered");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Deployment placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Deployment requires explicit deployment-zone and table-state confirmation");
    }
    return normalized;
  }
  if (event.type === "reserve_arrived") {
    normalized.formationId = boundedString(event.formationId, "Reserve formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Reserve formation is not registered");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Reserve placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Reserve arrival requires explicit placement confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "formation_embarked") {
    normalized.formationId = boundedString(event.formationId, "Embarking formation id", 100);
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Embarkation Transport formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.transportFormationId)
    ) {
      throw new Error("Embarkation references an unregistered formation");
    }
    normalized.rangeConfirmed = Boolean(event.rangeConfirmed);
    normalized.rangeReason = normalized.rangeConfirmed
      ? boundedString(event.rangeReason, "Embarkation range confirmation", 300)
      : "";
    if (!normalized.rangeConfirmed) {
      throw new Error("Embarkation requires explicit whole-unit 3-inch range confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "formation_disembarked") {
    normalized.formationId = boundedString(event.formationId, "Disembarking formation id", 100);
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Disembarkation Transport formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.transportFormationId)
    ) {
      throw new Error("Disembarkation references an unregistered formation");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Disembarkation placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Disembarkation requires explicit 3-inch placement confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "transport_destroyed_resolved") {
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Destroyed Transport formation id",
      100,
    );
    normalized.causeEventId = boundedString(
      event.causeEventId,
      "Destroyed Transport cause id",
      100,
    );
    if (!formations.byId.has(normalized.transportFormationId)) {
      throw new Error("Destroyed Transport is not registered");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    normalized.deadlyDemiseResolvedConfirmed = Boolean(event.deadlyDemiseResolvedConfirmed);
    normalized.deadlyDemiseResolutionReason = normalized.deadlyDemiseResolvedConfirmed
      ? boundedString(
          event.deadlyDemiseResolutionReason,
          "Deadly Demise resolution confirmation",
          300,
        )
      : "";
    if (!normalized.deadlyDemiseResolvedConfirmed) {
      throw new Error(
        "Destroyed Transport resolution requires confirmation that Deadly Demise was resolved first or does not apply",
      );
    }
    if (
      !Array.isArray(event.passengers) ||
      event.passengers.length < 1 ||
      event.passengers.length > 32
    ) {
      throw new Error("Destroyed Transport resolution must contain 1 to 32 passengers");
    }
    normalized.passengers = event.passengers.map((candidatePassenger) => {
      const passenger = record(
        candidatePassenger,
        "Each destroyed Transport passenger must be an object",
      );
      const formationId = boundedString(
        passenger.formationId,
        "Destroyed Transport passenger id",
        100,
      );
      const formation = formations.byId.get(formationId);
      if (!formation) throw new Error("Destroyed Transport passenger is not registered");
      const firstSegmentId = boundedString(
        passenger.firstSegmentId,
        "Destroyed Transport first allocation profile",
        100,
      );
      if (!formation.segments.some((segment) => segment.id === firstSegmentId)) {
        throw new Error("Destroyed Transport allocation profile is not in the passenger unit");
      }
      const emergency = Boolean(passenger.emergency);
      const placementConfirmed = Boolean(passenger.placementConfirmed);
      const placementReason = placementConfirmed
        ? boundedString(
            passenger.placementReason,
            "Destroyed Transport placement confirmation",
            300,
          )
        : "";
      if (!placementConfirmed) {
        throw new Error("Destroyed Transport disembarkation requires placement confirmation");
      }
      return {
        formationId,
        firstSegmentId,
        emergency,
        placementConfirmed,
        placementReason,
        unplacedModels: nonnegativeInteger(
          passenger.unplacedModels,
          "Unplaced passenger models",
          1000,
        ),
        rolls: normalizeDieRolls(passenger.rolls, "Destroyed Transport rolls"),
        feelNoPainRolls: normalizeDieRolls(
          passenger.feelNoPainRolls,
          "Destroyed Transport Feel No Pain rolls",
          { allowZero: true },
        ),
        summary: {
          damage: nonnegativeInteger(passenger.summary?.damage, "Destroyed Transport damage"),
          modelsDestroyed: nonnegativeInteger(
            passenger.summary?.modelsDestroyed,
            "Destroyed Transport casualties",
            1000,
          ),
        },
        allocations: normalizeHealthAllocations(
          passenger.allocations,
          formation,
          "Destroyed Transport",
        ),
      };
    });
    if (
      new Set(normalized.passengers.map((passenger) => passenger.formationId)).size !==
      normalized.passengers.length
    ) {
      throw new Error("Destroyed Transport passengers must be unique");
    }
    return normalized;
  }
  if (event.type === "charge_recorded") {
    normalized.formationId = boundedString(event.formationId, "Charge formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Charging formation is not registered");
    }
    normalized.targetFormationIds = normalizeStringArray(
      event.targetFormationIds,
      "Charge target formation ids",
      12,
    );
    if (normalized.targetFormationIds.length < 1) {
      throw new Error("A charge must name at least one target formation");
    }
    if (normalized.targetFormationIds.some((id) => !formations.byId.has(id))) {
      throw new Error("Charge target formation is not registered");
    }
    normalized.successful = Boolean(event.successful);
    normalized.roll = nonnegativeInteger(event.roll, "Charge roll", 12);
    if (normalized.roll < 2) throw new Error("Charge roll must be from 2 to 12");
    normalized.targetEligibilityConfirmed = Boolean(event.targetEligibilityConfirmed);
    normalized.targetEligibilityReason = normalized.targetEligibilityConfirmed
      ? boundedString(event.targetEligibilityReason, "Charge target eligibility reason", 300)
      : "";
    normalized.eligibilityOverride = Boolean(event.eligibilityOverride);
    normalized.overrideReason = normalized.eligibilityOverride
      ? boundedString(event.overrideReason, "Charge eligibility override reason", 300)
      : "";
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "activation_started") {
    normalized.formationId = boundedString(event.formationId, "Activation formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Activation formation is not registered");
    }
    normalized.activationType = boundedString(event.activationType, "Activation type", 20);
    if (!ACTIVATION_TYPES.includes(normalized.activationType)) {
      throw new Error("Activation type is unsupported");
    }
    normalized.weaponHasAssault = Boolean(event.weaponHasAssault);
    normalized.eligibilityOverride = Boolean(event.eligibilityOverride);
    normalized.overrideReason = normalized.eligibilityOverride
      ? boundedString(event.overrideReason, "Activation eligibility override reason", 300)
      : "";
    normalized.fightsFirst = Boolean(event.fightsFirst);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "activation_completed") {
    normalized.formationId = boundedString(event.formationId, "Activation formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Activation formation is not registered");
    }
    normalized.activationType = boundedString(event.activationType, "Activation type", 20);
    if (!ACTIVATION_TYPES.includes(normalized.activationType)) {
      throw new Error("Activation type is unsupported");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "fight_priority_passed") {
    normalized.playerId = boundedString(event.playerId, "Passing player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Passing player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Fight priority pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "ranged_target_eligibility_recorded") {
    normalized.attackerFormationId = boundedString(
      event.attackerFormationId,
      "Target measurement attacker formation id",
      100,
    );
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Target measurement target formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.attackerFormationId) ||
      !formations.byId.has(normalized.targetFormationId)
    ) {
      throw new Error("Target measurement references an unregistered formation");
    }
    normalized.weaponId = boundedString(event.weaponId, "Target measurement weapon id", 100);
    normalized.weaponName = boundedString(event.weaponName, "Target measurement weapon name", 200);
    if (stateVersion >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.weaponSourceFormationId = event.weaponSourceFormationId
        ? boundedString(
            event.weaponSourceFormationId,
            "Target measurement weapon source formation id",
            100,
          )
        : "";
      normalized.sourceSavedUnitId = event.sourceSavedUnitId
        ? boundedString(
            event.sourceSavedUnitId,
            "Target measurement weapon source saved unit id",
            100,
          )
        : "";
      normalized.weaponGroupId = event.weaponGroupId
        ? boundedString(event.weaponGroupId, "Target measurement weapon group id", 200)
        : "";
      normalized.clock = normalizeClock(event.clock, formations.players);
    }
    normalized.publishedRangeThousandths = nonnegativeInteger(
      event.publishedRangeThousandths,
      "Published weapon range thousandths",
      1_000_000,
    );
    normalized.effectiveRangeThousandths = nonnegativeInteger(
      event.effectiveRangeThousandths,
      "Effective weapon range thousandths",
      1_000_000,
    );
    normalized.measuredDistanceThousandths = nonnegativeInteger(
      event.measuredDistanceThousandths,
      "Measured target distance thousandths",
      1_000_000,
    );
    normalized.visible = Boolean(event.visible);
    normalized.fullyVisible = Boolean(event.fullyVisible);
    if (normalized.fullyVisible && !normalized.visible) {
      throw new Error("A fully visible target must also be visible");
    }
    normalized.indirectFire = Boolean(event.indirectFire);
    normalized.weaponHasIndirect = Boolean(event.weaponHasIndirect);
    if (normalized.indirectFire && normalized.visible) {
      throw new Error("Indirect Fire state applies only when the target is not visible");
    }
    normalized.eligibleWeaponCount = nonnegativeInteger(
      event.eligibleWeaponCount,
      "Eligible weapon count",
      1000,
    );
    normalized.method = boundedString(event.method, "Target measurement method", 20);
    if (!TARGET_MEASUREMENT_METHODS.includes(normalized.method)) {
      throw new Error("Target measurement method is unsupported");
    }
    normalized.reviewedByPlayer = Boolean(event.reviewedByPlayer);
    normalized.reviewReason = normalized.reviewedByPlayer
      ? boundedString(event.reviewReason, "Target measurement review", 300).trim()
      : "";
    if (!normalized.reviewedByPlayer) {
      throw new Error("Target measurement must be reviewed by a player");
    }
    if (!normalized.reviewReason) {
      throw new Error("Target measurement review must explain the checked tabletop facts");
    }
    normalized.rangeOverrideReason =
      normalized.effectiveRangeThousandths !== normalized.publishedRangeThousandths
        ? boundedString(event.rangeOverrideReason, "Weapon range override reason", 300).trim()
        : "";
    if (
      normalized.effectiveRangeThousandths !== normalized.publishedRangeThousandths &&
      !normalized.rangeOverrideReason
    ) {
      throw new Error("Weapon range override must name the rule or effect changing Range");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "attack_resolved") {
    normalized.attackerFormationId = boundedString(
      event.attackerFormationId,
      "Attacker formation id",
    );
    normalized.targetFormationId = boundedString(event.targetFormationId, "Target formation id");
    if (
      stateVersion >= TIMELINE_BATTLE_STATE_VERSION &&
      !formations.byId.has(normalized.attackerFormationId)
    ) {
      throw new Error("Attack attacker formation is not registered");
    }
    const target = formations.byId.get(normalized.targetFormationId);
    if (!target) throw new Error("Attack target formation is not registered");
    normalized.summary = normalizeSummary(event.summary);
    normalized.weaponHasAssault = Boolean(event.weaponHasAssault);
    normalized.weaponType =
      event.weaponType === "Ranged" || event.weaponType === "Melee" ? event.weaponType : "";
    normalized.targetEligibilityConfirmed = Boolean(event.targetEligibilityConfirmed);
    normalized.targetEligibilityReason = normalized.targetEligibilityConfirmed
      ? boundedString(event.targetEligibilityReason, "Target eligibility confirmation", 300)
      : "";
    if (stateVersion >= TARGET_ELIGIBILITY_BATTLE_STATE_VERSION) {
      normalized.targetEligibilityEventId = event.targetEligibilityEventId
        ? boundedString(event.targetEligibilityEventId, "Target eligibility event id", 100)
        : "";
      normalized.weaponId = event.weaponId
        ? boundedString(event.weaponId, "Attack weapon id", 100)
        : "";
      normalized.declaredWeaponCount = nonnegativeInteger(
        event.declaredWeaponCount ?? 0,
        "Declared attacking weapon count",
        1000,
      );
      normalized.indirectFire = Boolean(event.indirectFire);
    }
    if (stateVersion >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.weaponSourceFormationId = event.weaponSourceFormationId
        ? boundedString(event.weaponSourceFormationId, "Attack weapon source formation id", 100)
        : "";
      normalized.sourceSavedUnitId = event.sourceSavedUnitId
        ? boundedString(event.sourceSavedUnitId, "Attack weapon source saved unit id", 100)
        : "";
      normalized.weaponGroupId = event.weaponGroupId
        ? boundedString(event.weaponGroupId, "Attack weapon group id", 200)
        : "";
      normalized.clock = event.clock
        ? normalizeClock(event.clock, formations.players)
        : setupBattleClock();
    }
    if (
      !Array.isArray(event.allocations) ||
      event.allocations.length < 1 ||
      event.allocations.length > 32
    ) {
      throw new Error("Attack must contain 1 to 32 segment allocations");
    }
    const segmentMap = new Map(target.segments.map((segment) => [segment.id, segment]));
    normalized.allocations = event.allocations.map((candidateAllocation) => {
      const allocation = record(candidateAllocation, "Each attack allocation must be an object");
      const segmentId = boundedString(allocation.segmentId, "Allocation segment id");
      const segment = segmentMap.get(segmentId);
      if (!segment) throw new Error("Attack allocation references an unknown segment");
      return {
        segmentId,
        before: normalizeHealth(allocation.before, segment, "Allocation before"),
        after: normalizeHealth(allocation.after, segment, "Allocation after"),
      };
    });
    if (
      new Set(normalized.allocations.map((allocation) => allocation.segmentId)).size !==
      normalized.allocations.length
    ) {
      throw new Error("Attack allocations must reference unique segments");
    }
    return normalized;
  }
  if (event.type === "attack_reverted") {
    normalized.revertsEventId = boundedString(event.revertsEventId, "Reverted event id", 100);
    return normalized;
  }
  throw new Error(`Unsupported battle event type: ${event.type}`);
}

export function createBattleState({ id, createdAt, rulesSnapshot = "catalogue-current", players }) {
  return normalizeBattleState({
    version: BATTLE_STATE_VERSION,
    id,
    createdAt,
    rulesSnapshot,
    players,
    events: [],
  });
}

export function normalizeBattleState(candidate) {
  const state = record(candidate, "Battle state must be an object");
  if (
    ![
      LEGACY_BATTLE_STATE_VERSION,
      ROSTER_BATTLE_STATE_VERSION,
      TIMELINE_BATTLE_STATE_VERSION,
      TRACKER_BATTLE_STATE_VERSION,
      ACTION_BATTLE_STATE_VERSION,
      DEPLOYMENT_BATTLE_STATE_VERSION,
      TRANSPORT_BATTLE_STATE_VERSION,
      TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
      WEAPON_INVENTORY_BATTLE_STATE_VERSION,
      BATTLE_STATE_VERSION,
    ].includes(state.version)
  ) {
    throw new Error(`Unsupported battle state version: ${String(state.version)}`);
  }
  const players = normalizePlayers(state.players, state.version);
  if (!Array.isArray(state.events) || state.events.length > 10_000) {
    throw new Error("Battle state events must contain at most 10000 entries");
  }
  const formations = { players: new Set(players.map((player) => player.id)), byId: new Map() };
  const events = state.events.map((event, index) =>
    normalizeEvent(event, index + 1, formations, state.version),
  );
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error("Battle event ids must be unique");
  }
  const normalized = {
    version: state.version,
    id: boundedString(state.id, "Battle state id", 100),
    createdAt: nonnegativeInteger(state.createdAt, "Battle createdAt", Number.MAX_SAFE_INTEGER),
    rulesSnapshot: boundedString(state.rulesSnapshot, "Battle rules snapshot"),
    players,
    events,
  };
  if (state.version >= TIMELINE_BATTLE_STATE_VERSION && state.migration !== undefined) {
    const migration = record(state.migration, "Battle migration must be an object");
    const sourceVersion = nonnegativeInteger(
      migration.sourceVersion,
      "Battle migration source version",
      state.version - 1,
    );
    if (
      ![
        LEGACY_BATTLE_STATE_VERSION,
        ROSTER_BATTLE_STATE_VERSION,
        TIMELINE_BATTLE_STATE_VERSION,
        TRACKER_BATTLE_STATE_VERSION,
        ACTION_BATTLE_STATE_VERSION,
        DEPLOYMENT_BATTLE_STATE_VERSION,
        TRANSPORT_BATTLE_STATE_VERSION,
        TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
        WEAPON_INVENTORY_BATTLE_STATE_VERSION,
      ]
        .filter((version) => version < state.version)
        .includes(sourceVersion)
    ) {
      throw new Error("Battle migration source version is unsupported");
    }
    normalized.migration = {
      sourceVersion,
      legacyUntimedThroughSequence: nonnegativeInteger(
        migration.legacyUntimedThroughSequence,
        "Legacy untimed event sequence",
        events.length,
      ),
    };
    if (state.version >= ACTION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyUnactionedThroughSequence = nonnegativeInteger(
        migration.legacyUnactionedThroughSequence,
        "Legacy unactioned event sequence",
        events.length,
      );
    }
    if (state.version >= DEPLOYMENT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyDeploymentThroughSequence = nonnegativeInteger(
        migration.legacyDeploymentThroughSequence,
        "Legacy deployment event sequence",
        events.length,
      );
    }
    if (state.version >= TRANSPORT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTransportThroughSequence = nonnegativeInteger(
        migration.legacyTransportThroughSequence,
        "Legacy Transport event sequence",
        events.length,
      );
    }
    if (state.version >= TARGET_ELIGIBILITY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTargetEligibilityThroughSequence = nonnegativeInteger(
        migration.legacyTargetEligibilityThroughSequence,
        "Legacy target eligibility event sequence",
        events.length,
      );
    }
    if (state.version >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyWeaponInventoryThroughSequence = nonnegativeInteger(
        migration.legacyWeaponInventoryThroughSequence,
        "Legacy weapon inventory event sequence",
        events.length,
      );
    }
    if (state.version >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
      normalized.migration.legacyWeaponBearersThroughSequence = nonnegativeInteger(
        migration.legacyWeaponBearersThroughSequence,
        "Legacy weapon bearer event sequence",
        events.length,
      );
    }
  }
  if (
    state.version >= WEAPON_BEARER_BATTLE_STATE_VERSION &&
    events.some(
      (event) =>
        ["formation_registered", "formation_configured"].includes(event.type) &&
        event.formation.weaponBearerTracking === "legacy_aggregate",
    ) &&
    normalized.migration?.sourceVersion !== WEAPON_INVENTORY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TARGET_ELIGIBILITY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRANSPORT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== DEPLOYMENT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== ACTION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRACKER_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TIMELINE_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== ROSTER_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== LEGACY_BATTLE_STATE_VERSION
  ) {
    throw new Error("Legacy aggregate weapon bearers require explicit migration provenance");
  }
  replayBattleState(normalized);
  return normalized;
}

function initialHealth(formation) {
  return Object.fromEntries(
    formation.segments.map((segment) => [
      segment.id,
      { modelsRemaining: segment.startingModels, woundsLost: 0 },
    ]),
  );
}

function formationSourceModelsRemaining(formation, sourceSavedUnitId) {
  return formation.segments
    .filter((segment) => segment.savedUnitId === sourceSavedUnitId)
    .reduce((total, segment) => total + formation.health[segment.id].modelsRemaining, 0);
}

function formationSurvivingWeaponCount(formation, sourceSavedUnitId, groupId) {
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  if (!group) return 0;
  if (formation.weaponBearerTracking !== "exact") {
    return formationSourceModelsRemaining(formation, sourceSavedUnitId) > 0 ? group.count : 0;
  }
  return formation.segments.reduce((total, segment) => {
    if (segment.savedUnitId !== sourceSavedUnitId) return total;
    const copies = segment.weaponCopies.find((copy) => copy.groupId === groupId)?.count ?? 0;
    return total + copies * formation.health[segment.id].modelsRemaining;
  }, 0);
}

function formationWeaponProfile(formation, sourceSavedUnitId, groupId, weaponId) {
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  const profile = group?.profiles.find((candidate) => candidate.weaponId === weaponId);
  return group && profile ? { group, profile } : null;
}

function weaponProfileFlags(profile) {
  return (profile.hasAssault ? 1 : 0) | (profile.hasIndirect ? 2 : 0);
}

function sameHealth(left, right) {
  return left.modelsRemaining === right.modelsRemaining && left.woundsLost === right.woundsLost;
}

function trackerResources(players, mission) {
  return new Map(
    players.map((player) => [
      player.id,
      new Map([
        [
          "command_points",
          {
            id: "command_points",
            name: "Command Points",
            value: mission.startingCommandPoints[player.id],
            maximum: null,
          },
        ],
        [
          "victory_points",
          { id: "victory_points", name: "Victory Points", value: 0, maximum: null },
        ],
      ]),
    ]),
  );
}

function trackerObjectives(mission) {
  return new Map(
    mission.objectives.map((objective) => [
      objective.id,
      { ...objective, controllerPlayerId: "", contested: false },
    ]),
  );
}

function awardCommandPhasePoints(resources, players, mission) {
  if (mission.commandPointsPerCommandPhase < 1) return;
  for (const player of players) {
    const current = resources.get(player.id).get("command_points");
    resources.get(player.id).set("command_points", {
      ...current,
      value: current.value + mission.commandPointsPerCommandPhase,
    });
  }
}

function commandPhaseStarted(clock) {
  return clock.status === "active" && clock.phase === "command" && clock.step === "start";
}

function deploymentDeclarationsComplete(formations, deploymentByFormation) {
  return formations.size > 0 && deploymentByFormation.size === formations.size;
}

function undeployedBattlefieldFormations(
  formations,
  deploymentByFormation,
  deployedFormationIds,
  playerId,
) {
  return [...formations.values()].filter(
    (formation) =>
      formation.playerId === playerId &&
      deploymentByFormation.get(formation.id)?.location === "battlefield" &&
      !deployedFormationIds.has(formation.id),
  );
}

function nextDeploymentPlayer(
  players,
  preferredPlayerId,
  formations,
  deploymentByFormation,
  deployedFormationIds,
) {
  if (
    undeployedBattlefieldFormations(
      formations,
      deploymentByFormation,
      deployedFormationIds,
      preferredPlayerId,
    ).length > 0
  ) {
    return preferredPlayerId;
  }
  const other = otherPlayerId(players, preferredPlayerId);
  return undeployedBattlefieldFormations(
    formations,
    deploymentByFormation,
    deployedFormationIds,
    other,
  ).length > 0
    ? other
    : "";
}

function formationIsOnBattlefield(
  formationId,
  deploymentByFormation,
  deployedFormationIds,
  embarkedByFormation = new Map(),
) {
  const deployment = deploymentByFormation.get(formationId);
  return Boolean(
    deployment && deployedFormationIds.has(formationId) && !embarkedByFormation.has(formationId),
  );
}

function liveModelCount(formation) {
  return Object.values(formation.health).reduce(
    (total, health) => total + health.modelsRemaining,
    0,
  );
}

function secureRandomUint32() {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}

function randomDie(sides, randomUint32 = secureRandomUint32) {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  let value;
  do {
    value = randomUint32();
  } while (!Number.isSafeInteger(value) || value < 0 || value >= limit);
  return (value % sides) + 1;
}

function transportAllocationOrder(formation, health, firstSegmentId = "") {
  const wounded = formation.segments.find((segment) => health[segment.id].woundsLost > 0);
  if (wounded) {
    return [wounded, ...formation.segments.filter((segment) => segment.id !== wounded.id)];
  }
  if (!firstSegmentId) return formation.segments;
  const first = formation.segments.find((segment) => segment.id === firstSegmentId);
  if (!first) throw new Error("Destroyed Transport allocation profile is unknown");
  return [first, ...formation.segments.filter((segment) => segment.id !== first.id)];
}

function nextTransportAllocationSegment(formation, health, firstSegmentId = "") {
  return transportAllocationOrder(formation, health, firstSegmentId).find(
    (segment) => health[segment.id].modelsRemaining > 0,
  );
}

function replayDestroyedPassengerResolution(formation, passenger, randomUint32 = null) {
  const before = Object.fromEntries(
    formation.segments.map((segment) => [segment.id, { ...formation.health[segment.id] }]),
  );
  const after = structuredClone(before);
  const startingLiveModels = liveModelCount(formation);
  const firstSegment = formation.segments.find(
    (segment) => segment.id === passenger.firstSegmentId,
  );
  if (!firstSegment || before[firstSegment.id].modelsRemaining < 1) {
    throw new Error("Destroyed Transport allocation must select a surviving model profile");
  }
  const wounded = formation.segments.find((segment) => before[segment.id].woundsLost > 0);
  if (wounded && firstSegment.id !== wounded.id) {
    throw new Error("Destroyed Transport damage must remain allocated to the wounded model");
  }
  if (!passenger.emergency && passenger.unplacedModels > 0) {
    throw new Error(
      "Models that cannot disembark within 3 inches require Emergency Disembarkation",
    );
  }
  if (passenger.rolls.length + passenger.unplacedModels !== startingLiveModels) {
    throw new Error("Destroyed Transport rolls must cover every model that disembarks");
  }
  let unplacedRemaining = passenger.unplacedModels;
  while (unplacedRemaining > 0) {
    const segment = nextTransportAllocationSegment(formation, after, passenger.firstSegmentId);
    if (!segment) throw new Error("Unplaced passenger count exceeds the surviving unit");
    const health = after[segment.id];
    health.modelsRemaining -= 1;
    health.woundsLost = 0;
    unplacedRemaining -= 1;
  }
  const failedRolls = passenger.rolls.filter((roll) =>
    passenger.emergency ? roll <= 3 : roll === 1,
  );
  if (!randomUint32 && passenger.feelNoPainRolls.length !== failedRolls.length) {
    throw new Error("Destroyed Transport Feel No Pain rolls must match its mortal wounds");
  }
  const feelNoPainRolls = [];
  failedRolls.forEach((_roll, index) => {
    const segment = nextTransportAllocationSegment(formation, after, passenger.firstSegmentId);
    const threshold = segment?.feelNoPain ?? 0;
    const feelNoPainRoll =
      randomUint32 && threshold > 0
        ? randomDie(6, randomUint32)
        : randomUint32
          ? 0
          : passenger.feelNoPainRolls[index];
    feelNoPainRolls.push(feelNoPainRoll);
    if (!segment) {
      if (feelNoPainRoll !== 0) {
        throw new Error("Feel No Pain cannot be rolled after the passenger unit is destroyed");
      }
      return;
    }
    if ((threshold === 0 && feelNoPainRoll !== 0) || (threshold > 0 && feelNoPainRoll === 0)) {
      throw new Error("Destroyed Transport Feel No Pain roll does not match the allocated model");
    }
    if (threshold > 0 && feelNoPainRoll >= threshold) return;
    const health = after[segment.id];
    health.woundsLost += 1;
    if (health.woundsLost === segment.wounds) {
      health.modelsRemaining -= 1;
      health.woundsLost = 0;
    }
  });
  let damage = 0;
  let modelsDestroyed = 0;
  for (const segment of formation.segments) {
    const previous = before[segment.id];
    const current = after[segment.id];
    damage +=
      (previous.modelsRemaining - current.modelsRemaining) * segment.wounds +
      current.woundsLost -
      previous.woundsLost;
    modelsDestroyed += previous.modelsRemaining - current.modelsRemaining;
  }
  return {
    feelNoPainRolls,
    summary: { damage, modelsDestroyed },
    allocations: formation.segments.map((segment) => ({
      segmentId: segment.id,
      before: before[segment.id],
      after: after[segment.id],
    })),
  };
}

export function replayBattleState(state) {
  const formations = new Map();
  const attacks = new Map();
  const activeAttackIds = [];
  const targetedFormationIds = new Set();
  const pendingChoices = new Map();
  const resolvedChoices = new Map();
  const effects = new Map();
  const battleShockedFormations = new Map();
  const scoringEvents = [];
  const movementByFormation = new Map();
  const chargeByFormation = new Map();
  const deploymentByFormation = new Map();
  const deployedFormationIds = new Set();
  const reserveArrivals = new Map();
  const embarkedByFormation = new Map();
  const disembarkedByFormation = new Map();
  const movementPhaseStartEmbarkedFormationIds = new Set();
  const pendingTransportDestructions = new Map();
  const transportDestructionResolutions = new Map();
  const targetEligibilityFacts = new Map();
  const completedActivations = new Set();
  let activeActivation = null;
  let deploymentPriorityPlayerId = "";
  let clock = setupBattleClock();
  let mission = defaultMission(state.players);
  let resources = trackerResources(state.players, mission);
  let objectives = trackerObjectives(mission);
  const legacyUntimedThroughSequence =
    state.version < TIMELINE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyUntimedThroughSequence ?? 0);
  const legacyUnactionedThroughSequence =
    state.version < ACTION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyUnactionedThroughSequence ?? 0);
  const legacyTargetEligibilityThroughSequence =
    state.version < TARGET_ELIGIBILITY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTargetEligibilityThroughSequence ?? 0);
  const legacyWeaponInventoryThroughSequence =
    state.version < WEAPON_INVENTORY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyWeaponInventoryThroughSequence ?? 0);
  for (const event of state.events) {
    if (pendingTransportDestructions.size > 0 && event.type !== "transport_destroyed_resolved") {
      throw new Error("Destroyed Transport passengers must disembark immediately");
    }
    if (event.type === "formation_registered") {
      if (state.version >= TIMELINE_BATTLE_STATE_VERSION && clock.status !== "setup") {
        throw new Error("Formations must be registered during battle setup");
      }
      if (formations.has(event.formation.id)) throw new Error("Formation is already registered");
      formations.set(event.formation.id, {
        ...event.formation,
        health: initialHealth(event.formation),
      });
      continue;
    }
    if (event.type === "formation_configured") {
      if (state.version >= TIMELINE_BATTLE_STATE_VERSION && clock.status !== "setup") {
        throw new Error("Formation equipment is locked after the battle starts");
      }
      if (targetedFormationIds.has(event.formation.id)) {
        throw new Error("Formation cannot be configured after it has been attacked");
      }
      formations.set(event.formation.id, {
        ...event.formation,
        health: initialHealth(event.formation),
      });
      continue;
    }
    if (event.type === "deployment_declared") {
      if (clock.status !== "setup") {
        throw new Error("Deployment declarations are locked after the battle starts");
      }
      if (deployedFormationIds.size > 0) {
        throw new Error("Deployment declarations are locked after deployment begins");
      }
      const formation = formations.get(event.formationId);
      if (!formation) throw new Error("Deployment formation is not registered");
      if (deploymentByFormation.has(event.formationId)) {
        throw new Error("Formation deployment has already been declared");
      }
      if (event.location === "embarked") {
        const transport = formations.get(event.transportFormationId);
        if (!transport || transport.playerId !== formation.playerId) {
          throw new Error("A formation can start embarked only in a friendly Transport");
        }
        if (formation.assignedTransportFormationId !== transport.id) {
          throw new Error("Formation is not assigned to that Transport in the locked roster");
        }
        if (!transport.keywords.includes("transport")) {
          throw new Error("Assigned carrier does not have the Transport keyword");
        }
        embarkedByFormation.set(event.formationId, event.transportFormationId);
      }
      if (
        event.location === "strategic_reserves" &&
        formation.keywords.some((keyword) => ["fortification", "fortifications"].includes(keyword))
      ) {
        throw new Error("Fortifications cannot be placed into Strategic Reserves");
      }
      deploymentByFormation.set(event.formationId, event);
      for (const [passengerId, transportId] of embarkedByFormation) {
        const passengerDeployment = deploymentByFormation.get(passengerId);
        const transportDeployment = deploymentByFormation.get(transportId);
        if (
          passengerDeployment &&
          transportDeployment &&
          ["reserves", "strategic_reserves"].includes(transportDeployment.location) &&
          !passengerDeployment.eligibilityConfirmed
        ) {
          throw new Error(
            "A unit starting embarked in a Reserve Transport requires explicit Reserve eligibility",
          );
        }
        if (
          passengerDeployment &&
          transportDeployment?.location === "strategic_reserves" &&
          passengerDeployment.points < 1
        ) {
          throw new Error(
            "A unit embarked in Strategic Reserves must include its points in the limit",
          );
        }
      }
      const strategicPoints = [...deploymentByFormation.values()]
        .filter(
          (deployment) =>
            (deployment.location === "strategic_reserves" ||
              (deployment.location === "embarked" &&
                deploymentByFormation.get(deployment.transportFormationId)?.location ===
                  "strategic_reserves")) &&
            formations.get(deployment.formationId)?.playerId === formation.playerId,
        )
        .reduce((total, deployment) => total + deployment.points, 0);
      if (strategicPoints > Math.floor(mission.pointsLimit / 4)) {
        throw new Error(
          `Strategic Reserves exceed the ${Math.floor(mission.pointsLimit / 4)} point limit`,
        );
      }
      deploymentPriorityPlayerId = deploymentDeclarationsComplete(formations, deploymentByFormation)
        ? nextDeploymentPlayer(
            state.players,
            mission.deploymentFirstPlayerId,
            formations,
            deploymentByFormation,
            deployedFormationIds,
          )
        : "";
      continue;
    }
    if (event.type === "formation_deployed") {
      if (clock.status !== "setup") throw new Error("Formation deployment is locked after start");
      if (!deploymentDeclarationsComplete(formations, deploymentByFormation)) {
        throw new Error("Declare every formation before deploying armies");
      }
      const formation = formations.get(event.formationId);
      const deployment = deploymentByFormation.get(event.formationId);
      if (deployment?.location !== "battlefield") {
        throw new Error("Only a battlefield formation can be deployed");
      }
      if (deployedFormationIds.has(event.formationId)) {
        throw new Error("Formation has already been deployed");
      }
      const expectedPlayerId = nextDeploymentPlayer(
        state.players,
        deploymentPriorityPlayerId || mission.deploymentFirstPlayerId,
        formations,
        deploymentByFormation,
        deployedFormationIds,
      );
      if (!expectedPlayerId || formation.playerId !== expectedPlayerId) {
        throw new Error("Formation was deployed out of alternating player order");
      }
      deployedFormationIds.add(event.formationId);
      for (const [passengerId, transportId] of embarkedByFormation) {
        if (transportId === event.formationId) deployedFormationIds.add(passengerId);
      }
      deploymentPriorityPlayerId = nextDeploymentPlayer(
        state.players,
        otherPlayerId(state.players, expectedPlayerId),
        formations,
        deploymentByFormation,
        deployedFormationIds,
      );
      continue;
    }
    if (event.type === "battle_started") {
      if (clock.status !== "setup") throw new Error("Battle has already started");
      if (pendingChoices.size > 0) throw new Error("Pending choices block the battle start");
      if (
        (state.version < DEPLOYMENT_BATTLE_STATE_VERSION || state.migration) &&
        deploymentByFormation.size === 0
      ) {
        for (const formation of formations.values()) {
          deploymentByFormation.set(formation.id, {
            formationId: formation.id,
            location: "battlefield",
            points: 0,
            earliestBattleRound: 1,
            eligibilityConfirmed: true,
            eligibilityReason: "Migrated battle assumed deployed on battlefield",
            legacyAssumed: true,
          });
          deployedFormationIds.add(formation.id);
        }
      }
      if (!deploymentDeclarationsComplete(formations, deploymentByFormation)) {
        throw new Error("Every formation must have a deployment declaration before battle start");
      }
      if (
        [...deploymentByFormation.values()].some(
          (deployment) =>
            deployment.location === "battlefield" &&
            !deployedFormationIds.has(deployment.formationId),
        )
      ) {
        throw new Error("Every battlefield formation must be deployed before battle start");
      }
      for (const [passengerId, transportId] of embarkedByFormation) {
        const passenger = formations.get(passengerId);
        const transport = formations.get(transportId);
        if (!passenger || !transport || passenger.playerId !== transport.playerId) {
          throw new Error("Starting Transport occupancy is invalid");
        }
        const transportDeployment = deploymentByFormation.get(transportId);
        if (!transportDeployment || transportDeployment.location === "embarked") {
          throw new Error("A starting Transport cannot itself be embarked in this guided workflow");
        }
      }
      const expected = startBattleClock(state.players, event.firstPlayerId);
      if (!sameBattleClock(event.clock, expected)) {
        throw new Error("Battle start clock is not canonical");
      }
      clock = expected;
      if (state.version >= TRACKER_BATTLE_STATE_VERSION) {
        awardCommandPhasePoints(resources, state.players, mission);
      }
      continue;
    }
    if (event.type === "clock_advanced") {
      if (pendingChoices.size > 0) {
        throw new Error("Pending choices must be resolved before advancing the battle");
      }
      if (activeActivation) {
        throw new Error("The active formation must finish its activation before advancing");
      }
      if (!sameBattleClock(event.from, clock)) {
        throw new Error("Battle clock advance does not match replayed state");
      }
      const expected = nextBattleClock(clock, state.players);
      if (!sameBattleClock(event.to, expected)) {
        throw new Error("Battle clock advance is not canonical");
      }
      const expiredEffectIds = [...effects.values()]
        .filter((effect) => effectExpiresOnAdvance(effect, clock, expected))
        .map((effect) => effect.id)
        .sort();
      const recordedExpiredEffectIds = [...event.expiredEffectIds].sort();
      if (
        expiredEffectIds.length !== recordedExpiredEffectIds.length ||
        expiredEffectIds.some((id, index) => id !== recordedExpiredEffectIds[index])
      ) {
        throw new Error("Battle clock advance has an incorrect effect-expiry set");
      }
      for (const id of expiredEffectIds) effects.delete(id);
      if (state.version >= TRACKER_BATTLE_STATE_VERSION && commandPhaseStarted(expected)) {
        awardCommandPhasePoints(resources, state.players, mission);
        for (const [formationId] of battleShockedFormations) {
          if (formations.get(formationId)?.playerId === expected.activePlayerId) {
            battleShockedFormations.delete(formationId);
          }
        }
      }
      if (
        expected.status === "active" &&
        expected.phase === "movement" &&
        expected.step === "start"
      ) {
        movementPhaseStartEmbarkedFormationIds.clear();
        for (const formationId of embarkedByFormation.keys()) {
          if (formations.get(formationId)?.playerId === expected.activePlayerId) {
            movementPhaseStartEmbarkedFormationIds.add(formationId);
          }
        }
      }
      clock = expected;
      continue;
    }
    if (event.type === "choice_opened") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Pending choice was opened outside its battle timing window");
      }
      if (pendingChoices.has(event.choice.id) || resolvedChoices.has(event.choice.id)) {
        throw new Error("Pending choice id has already been used");
      }
      pendingChoices.set(event.choice.id, event.choice);
      continue;
    }
    if (event.type === "choice_resolved") {
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Pending choice was resolved outside its battle timing window");
      }
      const choice = pendingChoices.get(event.choiceId);
      if (!choice) throw new Error("Resolved choice is not pending");
      const options = new Set(choice.options.map((option) => option.id));
      if (
        event.selectedOptionIds.length < choice.minimumSelections ||
        event.selectedOptionIds.length > choice.maximumSelections ||
        event.selectedOptionIds.some((id) => !options.has(id))
      ) {
        throw new Error("Resolved choice selections are invalid");
      }
      pendingChoices.delete(event.choiceId);
      resolvedChoices.set(event.choiceId, [...event.selectedOptionIds]);
      continue;
    }
    if (event.type === "effect_applied") {
      if (clock.status !== "active" || !sameBattleClock(event.effect.appliedAt, clock)) {
        throw new Error("Battle effect was applied outside its timing window");
      }
      if (effects.has(event.effect.id)) throw new Error("Battle effect id has already been used");
      if (event.effect.sourceFormationId && !formations.has(event.effect.sourceFormationId)) {
        throw new Error("Battle effect source formation is not registered");
      }
      effects.set(event.effect.id, event.effect);
      continue;
    }
    if (event.type === "mission_configured") {
      if (clock.status !== "setup") throw new Error("Mission setup is locked after battle start");
      if (deploymentByFormation.size > 0) {
        throw new Error("Mission setup is locked after deployment declarations begin");
      }
      const customResources = new Map(
        state.players.map((player) => [
          player.id,
          [...resources.get(player.id).values()].filter(
            (resource) => resource.id !== "command_points" && resource.id !== "victory_points",
          ),
        ]),
      );
      mission = event.mission;
      resources = trackerResources(state.players, mission);
      for (const player of state.players) {
        for (const resource of customResources.get(player.id)) {
          resources.get(player.id).set(resource.id, resource);
        }
      }
      objectives = trackerObjectives(mission);
      continue;
    }
    if (event.type === "resource_changed") {
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Resource change does not match the replayed battle clock");
      }
      if (event.resourceId === "victory_points") {
        throw new Error("Victory Points must be changed by a scoring event");
      }
      const playerResources = resources.get(event.playerId);
      const previous = playerResources.get(event.resourceId);
      if ((previous?.value ?? 0) !== event.before) {
        throw new Error("Resource change does not match the replayed value");
      }
      if (previous && (previous.name !== event.name || previous.maximum !== event.maximum)) {
        throw new Error("Resource identity cannot change during a battle");
      }
      playerResources.set(event.resourceId, {
        id: event.resourceId,
        name: event.name,
        value: event.after,
        maximum: event.maximum,
      });
      continue;
    }
    if (event.type === "score_recorded") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Score was recorded outside its battle timing window");
      }
      const playerResources = resources.get(event.playerId);
      const previous = playerResources.get("victory_points");
      if (previous.value !== event.before || event.after !== event.before + event.points) {
        throw new Error("Scoring event does not match the replayed Victory Points");
      }
      playerResources.set("victory_points", { ...previous, value: event.after });
      scoringEvents.push(event);
      continue;
    }
    if (event.type === "objective_control_changed") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Objective control changed outside its battle timing window");
      }
      const objective = objectives.get(event.objectiveId);
      if (!objective) throw new Error("Objective control references an unknown objective");
      objectives.set(event.objectiveId, {
        ...objective,
        controllerPlayerId: event.controllerPlayerId,
        contested: event.contested,
      });
      continue;
    }
    if (event.type === "battleshock_changed") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Battle-shock changed outside its battle timing window");
      }
      if (event.battleShocked) {
        battleShockedFormations.set(event.formationId, {
          formationId: event.formationId,
          reason: event.reason,
          appliedAt: event.clock,
        });
      } else {
        if (!battleShockedFormations.has(event.formationId)) {
          throw new Error("Formation is not currently Battle-shocked");
        }
        battleShockedFormations.delete(event.formationId);
      }
      continue;
    }
    if (event.type === "reserve_arrived") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "reinforcements" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Reserves can only arrive in the Reinforcements step");
      }
      const formation = formations.get(event.formationId);
      const deployment = deploymentByFormation.get(event.formationId);
      if (!formation || !["reserves", "strategic_reserves"].includes(deployment?.location)) {
        throw new Error("Formation did not start the battle in Reserves");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's Reserves can arrive");
      }
      if (deployedFormationIds.has(event.formationId) || reserveArrivals.has(event.formationId)) {
        throw new Error("Reserve formation is already on the battlefield");
      }
      if (clock.battleRound < deployment.earliestBattleRound) {
        throw new Error(
          `This Reserve formation cannot arrive before battle round ${deployment.earliestBattleRound}`,
        );
      }
      deployedFormationIds.add(event.formationId);
      for (const [passengerId, transportId] of embarkedByFormation) {
        if (transportId === event.formationId) deployedFormationIds.add(passengerId);
      }
      reserveArrivals.set(event.formationId, event);
      movementByFormation.set(event.formationId, {
        formationId: event.formationId,
        movement: "normal",
        clock: event.clock,
        fromReserves: true,
      });
      continue;
    }
    if (event.type === "formation_embarked") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("A formation can embark only in the Move Units step");
      }
      const formation = formations.get(event.formationId);
      const transport = formations.get(event.transportFormationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        !formationIsOnBattlefield(
          event.transportFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Both the passenger and Transport must be on the battlefield");
      }
      if (
        formation.playerId !== clock.activePlayerId ||
        transport.playerId !== formation.playerId
      ) {
        throw new Error("Only the active player's formation can embark in a friendly Transport");
      }
      if (formation.assignedTransportFormationId !== transport.id) {
        throw new Error("Formation is not assigned to that Transport in the locked roster");
      }
      if (!transport.keywords.includes("transport") || formationDestroyed(transport)) {
        throw new Error("A formation can embark only in a surviving Transport");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot embark");
      const movement = movementByFormation.get(event.formationId);
      if (
        !movement ||
        !sameTurn(movement.clock, clock) ||
        !["normal", "advance", "fall_back"].includes(movement.movement)
      ) {
        throw new Error("Embarkation requires a completed Normal, Advance, or Fall Back move");
      }
      const disembarkation = disembarkedByFormation.get(event.formationId);
      if (disembarkation && samePhase(disembarkation.clock, clock)) {
        throw new Error("A formation cannot embark after disembarking in the same phase");
      }
      embarkedByFormation.set(event.formationId, event.transportFormationId);
      continue;
    }
    if (event.type === "formation_disembarked") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("A formation can disembark only in the Move Units step");
      }
      const formation = formations.get(event.formationId);
      const transport = formations.get(event.transportFormationId);
      if (
        formation.playerId !== clock.activePlayerId ||
        transport.playerId !== formation.playerId
      ) {
        throw new Error("Only the active player's formation can disembark");
      }
      if (embarkedByFormation.get(event.formationId) !== event.transportFormationId) {
        throw new Error("Formation is not embarked in the selected Transport");
      }
      if (!movementPhaseStartEmbarkedFormationIds.has(event.formationId)) {
        throw new Error("Only a unit that started the Movement phase embarked can disembark");
      }
      if (formationDestroyed(transport)) {
        throw new Error("Destroyed Transport passengers require immediate forced disembarkation");
      }
      const transportMovement = movementByFormation.get(event.transportFormationId);
      const currentTransportMovement =
        transportMovement && sameTurn(transportMovement.clock, clock) ? transportMovement : null;
      if (["advance", "fall_back"].includes(currentTransportMovement?.movement)) {
        throw new Error("A unit cannot disembark after its Transport Advanced or Fell Back");
      }
      embarkedByFormation.delete(event.formationId);
      deployedFormationIds.add(event.formationId);
      disembarkedByFormation.set(event.formationId, event);
      if (currentTransportMovement?.movement === "normal") {
        movementByFormation.set(event.formationId, {
          formationId: event.formationId,
          movement: "normal",
          clock: event.clock,
          fromMovedTransport: true,
        });
      }
      continue;
    }
    if (event.type === "transport_destroyed_resolved") {
      const pending = pendingTransportDestructions.get(event.transportFormationId);
      if (
        !pending ||
        pending.causeEventId !== event.causeEventId ||
        !sameBattleClock(event.clock, pending.clock)
      ) {
        throw new Error("Destroyed Transport resolution does not match the pending destruction");
      }
      const expectedPassengerIds = [...pending.passengerFormationIds].sort();
      const recordedPassengerIds = event.passengers
        .map((passenger) => passenger.formationId)
        .sort();
      if (
        expectedPassengerIds.length !== recordedPassengerIds.length ||
        expectedPassengerIds.some((id, index) => id !== recordedPassengerIds[index])
      ) {
        throw new Error("Destroyed Transport resolution does not contain every passenger");
      }
      pendingTransportDestructions.delete(event.transportFormationId);
      for (const passenger of event.passengers) {
        const formation = formations.get(passenger.formationId);
        const expected = replayDestroyedPassengerResolution(formation, passenger);
        if (
          expected.summary.damage !== passenger.summary.damage ||
          expected.summary.modelsDestroyed !== passenger.summary.modelsDestroyed ||
          expected.allocations.some((allocation, index) => {
            const recorded = passenger.allocations[index];
            return (
              !recorded ||
              allocation.segmentId !== recorded.segmentId ||
              !sameHealth(allocation.before, recorded.before) ||
              !sameHealth(allocation.after, recorded.after)
            );
          })
        ) {
          throw new Error("Destroyed Transport passenger health does not match its recorded rolls");
        }
        for (const allocation of passenger.allocations) {
          formation.health[allocation.segmentId] = { ...allocation.after };
        }
        embarkedByFormation.delete(passenger.formationId);
        deployedFormationIds.add(passenger.formationId);
        disembarkedByFormation.set(passenger.formationId, {
          ...passenger,
          transportFormationId: event.transportFormationId,
          destroyedTransport: true,
          clock: event.clock,
        });
        movementByFormation.set(passenger.formationId, {
          formationId: passenger.formationId,
          movement: "normal",
          clock: event.clock,
          fromDestroyedTransport: true,
        });
        if (!formationDestroyed(formation)) {
          battleShockedFormations.set(passenger.formationId, {
            formationId: passenger.formationId,
            reason: "Disembarked from a destroyed Transport",
            appliedAt: event.clock,
          });
        }
        const nestedPassengers = [...embarkedByFormation]
          .filter(([, transportId]) => transportId === passenger.formationId)
          .map(([formationId]) => formationId)
          .sort();
        if (formationDestroyed(formation) && nestedPassengers.length > 0) {
          pendingTransportDestructions.set(passenger.formationId, {
            transportFormationId: passenger.formationId,
            causeEventId: event.id,
            passengerFormationIds: nestedPassengers,
            clock: event.clock,
          });
        }
      }
      transportDestructionResolutions.set(event.transportFormationId, event);
      continue;
    }
    if (event.type === "movement_recorded") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Movement was recorded outside the Move Units step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation that is not on the battlefield cannot move");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's formation can move");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot move");
      const disembarkation = disembarkedByFormation.get(event.formationId);
      if (
        event.movement === "stationary" &&
        disembarkation &&
        sameTurn(disembarkation.clock, clock)
      ) {
        throw new Error("A unit that disembarked this turn cannot Remain Stationary");
      }
      const previous = movementByFormation.get(event.formationId);
      if (previous && sameTurn(previous.clock, clock)) {
        throw new Error("Formation movement has already been recorded this turn");
      }
      movementByFormation.set(event.formationId, event);
      continue;
    }
    if (event.type === "charge_recorded") {
      if (
        clock.status !== "active" ||
        clock.phase !== "charge" ||
        clock.step !== "charge_moves" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Charge was recorded outside the Charge Moves step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation that is not on the battlefield cannot charge");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's formation can charge");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot charge");
      const previous = chargeByFormation.get(event.formationId);
      if (previous && sameTurn(previous.clock, clock)) {
        throw new Error("Formation has already attempted a charge this turn");
      }
      for (const targetFormationId of event.targetFormationIds) {
        const target = formations.get(targetFormationId);
        if (
          !formationIsOnBattlefield(
            targetFormationId,
            deploymentByFormation,
            deployedFormationIds,
            embarkedByFormation,
          )
        ) {
          throw new Error("A formation cannot charge a target outside the battlefield");
        }
        if (target.playerId === formation.playerId) {
          throw new Error("A formation cannot charge a friendly formation");
        }
        if (formationDestroyed(target))
          throw new Error("A formation cannot charge a destroyed target");
      }
      if (!event.targetEligibilityConfirmed) {
        throw new Error(
          "Charge eligibility requires an explicit confirmation of range and table state",
        );
      }
      const movement = movementByFormation.get(event.formationId);
      const currentMovement = movement && sameTurn(movement.clock, clock) ? movement : null;
      if (!currentMovement && !event.eligibilityOverride) {
        throw new Error(
          "Record this formation's movement or confirm a charge eligibility override",
        );
      }
      if (
        ["advance", "fall_back"].includes(currentMovement?.movement) &&
        !event.eligibilityOverride
      ) {
        throw new Error(
          `A formation that ${currentMovement.movement === "advance" ? "Advanced" : "Fell Back"} requires an explicit charge eligibility override`,
        );
      }
      if (
        (currentMovement?.fromMovedTransport || currentMovement?.fromDestroyedTransport) &&
        !event.eligibilityOverride
      ) {
        throw new Error("A unit that disembarked after movement cannot declare a charge this turn");
      }
      chargeByFormation.set(event.formationId, event);
      continue;
    }
    if (event.type === "fight_priority_passed") {
      if (
        !battleAttackWindow(clock) ||
        clock.phase !== "fight" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Fight priority can only pass during a Fight selection step");
      }
      if (activeActivation) throw new Error("Fight priority cannot pass during an activation");
      if (pendingChoices.size > 0) throw new Error("Pending choices block Fight priority");
      if (event.playerId !== clock.priorityPlayerId) {
        throw new Error("Only the player with Fight priority can pass");
      }
      clock = { ...clock, priorityPlayerId: otherPlayerId(state.players, event.playerId) };
      continue;
    }
    if (event.type === "activation_started") {
      if (!battleAttackWindow(clock) || !sameBattleClock(event.clock, clock)) {
        throw new Error("Formation activation started outside an attack step");
      }
      if (pendingChoices.size > 0) throw new Error("Pending choices block formation activation");
      if (activeActivation) throw new Error("Another formation activation is already in progress");
      const formation = formations.get(event.formationId);
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot activate");
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation outside the battlefield cannot activate");
      }
      const expectedType = clock.phase === "shooting" ? "shooting" : "fight";
      if (event.activationType !== expectedType) {
        throw new Error(`Only a ${expectedType} activation can start in this step`);
      }
      const activationKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.formationId}`;
      if (completedActivations.has(activationKey)) {
        throw new Error("Formation has already completed an activation this phase");
      }
      let weaponRestriction = "all";
      if (event.activationType === "shooting") {
        if (formation.playerId !== clock.activePlayerId) {
          throw new Error("Only the active player's formation can shoot");
        }
        const movement = movementByFormation.get(event.formationId);
        const currentMovement = movement && sameTurn(movement.clock, clock) ? movement : null;
        if (!currentMovement && !event.eligibilityOverride) {
          throw new Error(
            "Record this formation's movement or confirm a shooting eligibility override",
          );
        }
        if (
          currentMovement?.movement === "advance" &&
          !event.weaponHasAssault &&
          !event.eligibilityOverride
        ) {
          throw new Error("An Advanced formation requires an Assault weapon or explicit override");
        }
        if (currentMovement?.movement === "fall_back" && !event.eligibilityOverride) {
          throw new Error(
            "A formation that Fell Back requires an explicit shooting eligibility override",
          );
        }
        if (currentMovement?.movement === "advance" && !event.eligibilityOverride) {
          weaponRestriction = "assault_only";
        }
      } else {
        if (formation.playerId !== clock.priorityPlayerId) {
          throw new Error("Only the player with Fight priority can activate a formation");
        }
        const charge = chargeByFormation.get(event.formationId);
        const charged = Boolean(charge?.successful && sameTurn(charge.clock, clock));
        if (!charged && !event.eligibilityOverride) {
          throw new Error(
            "Confirm Engagement Range eligibility for a formation that did not charge",
          );
        }
        if (clock.step === "fights_first" && !charged && !event.fightsFirst) {
          throw new Error("Formation is not confirmed to have Fights First");
        }
      }
      activeActivation = { ...event, weaponRestriction };
      continue;
    }
    if (event.type === "activation_completed") {
      if (!activeActivation) throw new Error("No formation activation is in progress");
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Formation activation completed outside its timing window");
      }
      if (
        event.formationId !== activeActivation.formationId ||
        event.activationType !== activeActivation.activationType
      ) {
        throw new Error("Completed activation does not match the active formation");
      }
      completedActivations.add(
        `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.formationId}`,
      );
      activeActivation = null;
      if (event.activationType === "fight") {
        clock = {
          ...clock,
          priorityPlayerId: otherPlayerId(state.players, clock.priorityPlayerId),
        };
      }
      continue;
    }
    if (event.type === "ranged_target_eligibility_recorded") {
      if (
        !battleAttackWindow(clock) ||
        clock.phase !== "shooting" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Ranged target eligibility must be recorded in a Shooting attack step");
      }
      if (!activeActivation || activeActivation.formationId !== event.attackerFormationId) {
        throw new Error("Target eligibility does not belong to the active formation");
      }
      const attacker = formations.get(event.attackerFormationId);
      const target = formations.get(event.targetFormationId);
      if (attacker.playerId === target.playerId) {
        throw new Error("A ranged target must be an enemy formation");
      }
      if (
        !formationIsOnBattlefield(
          event.attackerFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        !formationIsOnBattlefield(
          event.targetFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Ranged target eligibility requires both formations on the battlefield");
      }
      if (formationDestroyed(attacker) || formationDestroyed(target)) {
        throw new Error("Ranged target eligibility cannot reference a destroyed formation");
      }
      if (event.sequence > legacyWeaponInventoryThroughSequence) {
        const source = formations.get(event.weaponSourceFormationId);
        if (!source) throw new Error("Target eligibility weapon source is not registered");
        if (source.id !== attacker.id && embarkedByFormation.get(source.id) !== attacker.id) {
          throw new Error("Target eligibility weapon source is not the attacker or its passenger");
        }
        const inventory = formationWeaponProfile(
          source,
          event.sourceSavedUnitId,
          event.weaponGroupId,
          event.weaponId,
        );
        if (!inventory || inventory.profile.type !== "Ranged") {
          throw new Error("Target eligibility weapon is absent from the locked ranged inventory");
        }
        if (
          inventory.profile.name !== event.weaponName ||
          inventory.profile.publishedRangeThousandths !== event.publishedRangeThousandths ||
          inventory.profile.hasIndirect !== event.weaponHasIndirect
        ) {
          throw new Error("Target eligibility weapon facts differ from the locked inventory");
        }
        if (
          formationSurvivingWeaponCount(source, event.sourceSavedUnitId, event.weaponGroupId) < 1 ||
          event.eligibleWeaponCount >
            formationSurvivingWeaponCount(source, event.sourceSavedUnitId, event.weaponGroupId)
        ) {
          throw new Error("Target eligibility exceeds the surviving locked weapon inventory");
        }
      }
      targetEligibilityFacts.set(event.id, event);
      continue;
    }
    if (event.type === "attack_resolved") {
      if (
        state.version >= TIMELINE_BATTLE_STATE_VERSION &&
        event.sequence > legacyUntimedThroughSequence
      ) {
        if (!battleAttackWindow(clock)) {
          throw new Error("Attacks can only resolve in a Shooting or Fight attack step");
        }
        if (pendingChoices.size > 0) {
          throw new Error("Pending choices must be resolved before resolving attacks");
        }
        if (event.sequence <= legacyUnactionedThroughSequence) {
          if (formations.get(event.attackerFormationId)?.playerId !== clock.activePlayerId) {
            throw new Error("Only the active player's formation can resolve an attack");
          }
        } else {
          if (!activeActivation || activeActivation.formationId !== event.attackerFormationId) {
            throw new Error("Attack does not belong to the active formation");
          }
          if (
            clock.phase === "shooting" &&
            activeActivation.weaponRestriction === "assault_only" &&
            !event.weaponHasAssault
          ) {
            throw new Error("Only Assault weapons can fire after this formation Advanced");
          }
          const expectedWeaponType = clock.phase === "shooting" ? "Ranged" : "Melee";
          if (event.weaponType !== expectedWeaponType) {
            throw new Error(`${expectedWeaponType} weapons are required in this attack step`);
          }
          if (
            event.weaponType === "Ranged" &&
            event.sequence > legacyTargetEligibilityThroughSequence
          ) {
            const eligibility = targetEligibilityFacts.get(event.targetEligibilityEventId);
            if (!eligibility) {
              throw new Error("Ranged attack requires a replayed target eligibility measurement");
            }
            if (
              eligibility.attackerFormationId !== event.attackerFormationId ||
              eligibility.targetFormationId !== event.targetFormationId ||
              eligibility.weaponId !== event.weaponId ||
              !sameBattleClock(eligibility.clock, clock)
            ) {
              throw new Error("Ranged attack does not match its target eligibility measurement");
            }
            if (event.sequence > legacyWeaponInventoryThroughSequence) {
              if (!sameBattleClock(event.clock, clock)) {
                throw new Error("Ranged attack weapon declaration is outside its recorded phase");
              }
              if (
                eligibility.weaponSourceFormationId !== event.weaponSourceFormationId ||
                eligibility.sourceSavedUnitId !== event.sourceSavedUnitId ||
                eligibility.weaponGroupId !== event.weaponGroupId
              ) {
                throw new Error("Ranged attack does not match its locked weapon source");
              }
              const source = formations.get(event.weaponSourceFormationId);
              const inventory = source
                ? formationWeaponProfile(
                    source,
                    event.sourceSavedUnitId,
                    event.weaponGroupId,
                    event.weaponId,
                  )
                : null;
              if (!source || !inventory || inventory.profile.type !== "Ranged") {
                throw new Error("Ranged attack weapon is absent from the locked inventory");
              }
              const usedCount = activeAttackIds
                .map((id) => attacks.get(id))
                .filter(
                  (attack) =>
                    attack?.weaponType === "Ranged" &&
                    attack.weaponSourceFormationId === event.weaponSourceFormationId &&
                    attack.sourceSavedUnitId === event.sourceSavedUnitId &&
                    attack.weaponGroupId === event.weaponGroupId &&
                    sameBattleClock(attack.clock ?? eligibility.clock, clock),
                )
                .reduce((total, attack) => total + attack.declaredWeaponCount, 0);
              const declaredFlags = (event.weaponHasAssault ? 1 : 0) | (event.indirectFire ? 2 : 0);
              if (
                !(source.weaponBearerTracking === "exact"
                  ? weaponBearerDeclarationIsValid(
                      inventory.group.count,
                      formationSurvivingWeaponCount(
                        source,
                        event.sourceSavedUnitId,
                        event.weaponGroupId,
                      ),
                      usedCount,
                      event.declaredWeaponCount,
                      weaponProfileFlags(inventory.profile),
                      declaredFlags,
                    )
                  : weaponInventoryDeclarationIsValid(
                      inventory.group.count,
                      formationSourceModelsRemaining(source, event.sourceSavedUnitId),
                      usedCount,
                      event.declaredWeaponCount,
                      weaponProfileFlags(inventory.profile),
                      declaredFlags,
                    )) ||
                eligibility.eligibleWeaponCount >
                  formationSurvivingWeaponCount(
                    source,
                    event.sourceSavedUnitId,
                    event.weaponGroupId,
                  ) -
                    usedCount
              ) {
                throw new Error("Ranged attack exceeds its surviving unused weapon inventory");
              }
            }
            if (eligibility.indirectFire !== event.indirectFire) {
              throw new Error("Ranged attack Indirect Fire state does not match its measurement");
            }
            if (!rangedTargetEligibilityIsValid(eligibility, event.declaredWeaponCount)) {
              throw new Error(
                "Ranged attack does not satisfy its reviewed target eligibility facts",
              );
            }
          } else if (!event.targetEligibilityConfirmed) {
            throw new Error(
              "Attack target eligibility requires explicit range, visibility, and table-state confirmation",
            );
          }
        }
      }
      const formation = formations.get(event.targetFormationId);
      if (!formation) throw new Error("Attack target formation is not registered");
      const wasDestroyed = formationDestroyed(formation);
      if (
        event.sequence > legacyUnactionedThroughSequence &&
        !formationIsOnBattlefield(
          event.targetFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Attack target is not on the battlefield");
      }
      let appliedDamage = 0;
      let modelsDestroyed = 0;
      for (const allocation of event.allocations) {
        if (!sameHealth(formation.health[allocation.segmentId], allocation.before)) {
          throw new Error("Attack allocation does not match replayed target health");
        }
        const segment = formation.segments.find(
          (candidate) => candidate.id === allocation.segmentId,
        );
        const damage =
          (allocation.before.modelsRemaining - allocation.after.modelsRemaining) * segment.wounds +
          allocation.after.woundsLost -
          allocation.before.woundsLost;
        if (
          damage < 0 ||
          allocation.after.modelsRemaining > allocation.before.modelsRemaining ||
          (allocation.after.modelsRemaining === allocation.before.modelsRemaining &&
            allocation.after.woundsLost < allocation.before.woundsLost)
        ) {
          throw new Error("Attack allocation cannot restore models or wounds");
        }
        appliedDamage += damage;
        modelsDestroyed += allocation.before.modelsRemaining - allocation.after.modelsRemaining;
        formation.health[allocation.segmentId] = { ...allocation.after };
      }
      if (appliedDamage !== event.summary.damage) {
        throw new Error("Attack summary damage does not match its allocations");
      }
      if (modelsDestroyed !== event.summary.modelsDestroyed) {
        throw new Error("Attack summary casualties do not match its allocations");
      }
      if (Object.values(formation.health).filter((health) => health.woundsLost > 0).length > 1) {
        throw new Error("A formation cannot contain more than one wounded model");
      }
      attacks.set(event.id, event);
      activeAttackIds.push(event.id);
      targetedFormationIds.add(event.targetFormationId);
      if (!wasDestroyed && formationDestroyed(formation)) {
        const passengerFormationIds = [...embarkedByFormation]
          .filter(([, transportId]) => transportId === event.targetFormationId)
          .map(([formationId]) => formationId)
          .sort();
        if (passengerFormationIds.length > 0) {
          pendingTransportDestructions.set(event.targetFormationId, {
            transportFormationId: event.targetFormationId,
            causeEventId: event.id,
            passengerFormationIds,
            clock,
          });
        }
      }
      continue;
    }
    if (event.type !== "attack_reverted") {
      throw new Error(`Unsupported replayed battle event type: ${event.type}`);
    }
    const reverted = attacks.get(event.revertsEventId);
    if (!reverted || activeAttackIds.at(-1) !== reverted.id) {
      throw new Error("Only the latest unreverted attack can be reverted");
    }
    if (
      [...transportDestructionResolutions.values()].some(
        (resolution) => resolution.causeEventId === reverted.id,
      )
    ) {
      throw new Error(
        "An attack cannot be reverted after resolving destroyed Transport passengers",
      );
    }
    const formation = formations.get(reverted.targetFormationId);
    for (const allocation of reverted.allocations) {
      if (!sameHealth(formation.health[allocation.segmentId], allocation.after)) {
        throw new Error("Reverted attack does not match replayed target health");
      }
      formation.health[allocation.segmentId] = { ...allocation.before };
    }
    activeAttackIds.pop();
  }
  const offBattlefieldFormationIds = new Set(
    [...formations.keys()].filter(
      (formationId) =>
        !formationIsOnBattlefield(
          formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ),
    ),
  );
  const reserveDestroyedFormationIds = new Set(
    clock.status === "complete"
      ? [...formations.keys()].filter((formationId) => {
          const deployment = deploymentByFormation.get(formationId);
          if (["reserves", "strategic_reserves"].includes(deployment?.location)) {
            return !deployedFormationIds.has(formationId);
          }
          if (deployment?.location === "embarked") {
            const transportDeployment = deploymentByFormation.get(deployment.transportFormationId);
            return (
              ["reserves", "strategic_reserves"].includes(transportDeployment?.location) &&
              !deployedFormationIds.has(deployment.transportFormationId)
            );
          }
          return false;
        })
      : [],
  );
  return {
    formations,
    activeAttackIds,
    clock,
    pendingChoices,
    resolvedChoices,
    effects,
    mission,
    resources,
    objectives,
    scoringEvents,
    battleShockedFormations,
    movementByFormation,
    chargeByFormation,
    deploymentByFormation,
    deployedFormationIds,
    deploymentPriorityPlayerId,
    deploymentComplete:
      deploymentDeclarationsComplete(formations, deploymentByFormation) &&
      [...deploymentByFormation.values()].every(
        (deployment) =>
          deployment.location !== "battlefield" || deployedFormationIds.has(deployment.formationId),
      ),
    reserveArrivals,
    embarkedByFormation,
    disembarkedByFormation,
    movementPhaseStartEmbarkedFormationIds,
    pendingTransportDestructions,
    transportDestructionResolutions,
    targetEligibilityFacts,
    offBattlefieldFormationIds,
    reserveDestroyedFormationIds,
    completedActivations,
    activeActivation,
  };
}

function appendEvent(state, event) {
  return normalizeBattleState({ ...state, events: [...state.events, event] });
}

export function declareFormationDeployment(
  state,
  formationId,
  location,
  {
    points = 0,
    earliestBattleRound = location === "strategic_reserves" ? 2 : 1,
    eligibilityConfirmed = false,
    eligibilityReason = "",
    transportFormationId = "",
  } = {},
  id,
  at,
) {
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "deployment_declared",
    formationId,
    location,
    points,
    earliestBattleRound,
    eligibilityConfirmed,
    eligibilityReason,
    transportFormationId,
  });
}

export function deployFormation(
  state,
  formationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_deployed",
    formationId,
    placementConfirmed,
    placementReason,
  });
}

export function arriveFromReserves(
  state,
  formationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "reserve_arrived",
    formationId,
    placementConfirmed,
    placementReason,
    clock,
  });
}

export function startBattle(state, firstPlayerId, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") throw new Error("Battle has already started");
  const unresolved = [...replayed.formations.values()].flatMap((formation) =>
    formation.weaponBearerTracking === "exact"
      ? formation.weaponInventory.filter((group) => !group.bearerAssignmentsReviewed)
      : [],
  );
  if (unresolved.length > 0) {
    throw new Error("Confirm every optional weapon bearer before starting the battle");
  }
  const clock = startBattleClock(state.players, firstPlayerId);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "battle_started",
    firstPlayerId,
    clock,
  });
}

export function advanceBattleClock(state, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.pendingChoices.size > 0) {
    throw new Error("Pending choices must be resolved before advancing the battle");
  }
  if (replayed.activeActivation) {
    throw new Error("The active formation must finish its activation before advancing");
  }
  const from = replayed.clock;
  const to = nextBattleClock(from, state.players);
  const expiredEffectIds = [...replayed.effects.values()]
    .filter((effect) => effectExpiresOnAdvance(effect, from, to))
    .map((effect) => effect.id)
    .sort();
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "clock_advanced",
    from,
    to,
    expiredEffectIds,
  });
}

export function openBattleChoice(state, choice, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "choice_opened",
    choice,
    clock,
  });
}

export function resolveBattleChoice(state, choiceId, selectedOptionIds, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "choice_resolved",
    choiceId,
    selectedOptionIds,
    clock,
  });
}

export function applyBattleEffect(state, effect, id, at) {
  const appliedAt = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "effect_applied",
    effect: { ...effect, appliedAt },
  });
}

export function configureBattleMission(state, mission, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Mission setup is locked after the battle starts");
  }
  if (replayed.deploymentByFormation.size > 0) {
    throw new Error("Mission setup is locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "mission_configured",
    mission,
  });
}

export function changeBattleResource(
  state,
  { playerId, resourceId, name, delta, maximum = null, reason },
  id,
  at,
) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status === "complete") {
    throw new Error("Battle resources are locked after the battle ends");
  }
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error("Resource player is unknown");
  }
  if (resourceId === "victory_points") {
    throw new Error("Use a scoring event to change Victory Points");
  }
  const previous = replayed.resources.get(playerId)?.get(resourceId);
  const before = previous?.value ?? 0;
  const after = before + boundedInteger(delta, "Resource change", -100000, 100000);
  if (after < 0) throw new Error(`${previous?.name ?? name} cannot go below 0`);
  const normalizedMaximum = previous?.maximum ?? maximum;
  if (normalizedMaximum !== null && after > normalizedMaximum) {
    throw new Error(`${previous?.name ?? name} cannot exceed ${normalizedMaximum}`);
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "resource_changed",
    playerId,
    resourceId,
    name: previous?.name ?? name,
    before,
    after,
    maximum: normalizedMaximum,
    reason,
    clock: replayed.clock,
  });
}

export function scoreBattlePoints(state, playerId, points, category, reason, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "active") {
    throw new Error("Victory Points can only be scored during an active battle");
  }
  const before = replayed.resources.get(playerId)?.get("victory_points")?.value;
  if (before === undefined) throw new Error("Scoring player is unknown");
  const normalizedPoints = boundedInteger(points, "Scoring points", -1000, 1000);
  const after = before + normalizedPoints;
  if (after < 0) throw new Error("Victory Points cannot go below 0");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "score_recorded",
    playerId,
    category,
    points: normalizedPoints,
    before,
    after,
    reason,
    clock: replayed.clock,
  });
}

export function setBattleObjectiveControl(
  state,
  objectiveId,
  controllerPlayerId,
  contested,
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "objective_control_changed",
    objectiveId,
    controllerPlayerId,
    contested,
    clock,
  });
}

export function setFormationBattleShocked(state, formationId, battleShocked, reason, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "battleshock_changed",
    formationId,
    battleShocked,
    reason,
    clock,
  });
}

export function battleResource(state, playerId, resourceId) {
  return replayBattleState(state).resources.get(playerId)?.get(resourceId) ?? null;
}

export function battleFormationIsBattleShocked(state, formationId) {
  return replayBattleState(state).battleShockedFormations.has(formationId);
}

export function battleFormationIsOnBattlefield(state, formationId) {
  const replayed = replayBattleState(state);
  return formationIsOnBattlefield(
    formationId,
    replayed.deploymentByFormation,
    replayed.deployedFormationIds,
    replayed.embarkedByFormation,
  );
}

export function recordFormationMovement(state, formationId, movement, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "movement_recorded",
    formationId,
    movement,
    clock,
  });
}

export function embarkFormation(
  state,
  formationId,
  transportFormationId,
  { rangeConfirmed = false, rangeReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_embarked",
    formationId,
    transportFormationId,
    rangeConfirmed,
    rangeReason,
    clock,
  });
}

export function disembarkFormation(
  state,
  formationId,
  transportFormationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_disembarked",
    formationId,
    transportFormationId,
    placementConfirmed,
    placementReason,
    clock,
  });
}

export function resolveDestroyedTransport(
  state,
  transportFormationId,
  passengerOptions,
  id,
  at,
  randomUint32 = secureRandomUint32,
  { deadlyDemiseResolvedConfirmed = false, deadlyDemiseResolutionReason = "" } = {},
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingTransportDestructions.get(transportFormationId);
  if (!pending) throw new Error("Transport does not have a pending destruction resolution");
  const optionsByFormationId = new Map(
    (passengerOptions ?? []).map((options) => [options.formationId, options]),
  );
  if (
    !Array.isArray(passengerOptions) ||
    optionsByFormationId.size !== passengerOptions.length ||
    optionsByFormationId.size !== pending.passengerFormationIds.length
  ) {
    throw new Error("Destroyed Transport resolution must contain each passenger exactly once");
  }
  const passengers = pending.passengerFormationIds.map((formationId) => {
    const formation = replayed.formations.get(formationId);
    const options = optionsByFormationId.get(formationId);
    if (!options) throw new Error("Destroyed Transport resolution is missing a passenger");
    const firstSegmentId = boundedString(
      options.firstSegmentId,
      "Destroyed Transport first allocation profile",
      100,
    );
    const unplacedModels = nonnegativeInteger(
      options.unplacedModels ?? 0,
      "Unplaced passenger models",
      liveModelCount(formation),
    );
    const emergency = Boolean(options.emergency);
    const rolls = Array.from({ length: liveModelCount(formation) - unplacedModels }, () =>
      randomDie(6, randomUint32),
    );
    const resolved = replayDestroyedPassengerResolution(
      formation,
      { firstSegmentId, emergency, unplacedModels, rolls, feelNoPainRolls: [] },
      randomUint32,
    );
    return {
      formationId,
      firstSegmentId,
      emergency,
      placementConfirmed: Boolean(options.placementConfirmed),
      placementReason: options.placementReason ?? "",
      unplacedModels,
      rolls,
      feelNoPainRolls: resolved.feelNoPainRolls,
      summary: resolved.summary,
      allocations: resolved.allocations,
    };
  });
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "transport_destroyed_resolved",
    transportFormationId,
    causeEventId: pending.causeEventId,
    deadlyDemiseResolvedConfirmed,
    deadlyDemiseResolutionReason,
    passengers,
    clock: pending.clock,
  });
}

export function battleFormationEmbarkedTransport(state, formationId) {
  return replayBattleState(state).embarkedByFormation.get(formationId) ?? "";
}

export function recordRangedTargetEligibility(
  state,
  {
    attackerFormationId,
    targetFormationId,
    weaponId,
    weaponName,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    publishedRangeThousandths,
    effectiveRangeThousandths,
    measuredDistanceThousandths,
    visible = false,
    fullyVisible = false,
    indirectFire = false,
    weaponHasIndirect = false,
    eligibleWeaponCount = 0,
    method = "manual",
    reviewedByPlayer = false,
    reviewReason = "",
    rangeOverrideReason = "",
  },
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "ranged_target_eligibility_recorded",
    attackerFormationId,
    targetFormationId,
    weaponId,
    weaponName,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    publishedRangeThousandths,
    effectiveRangeThousandths,
    measuredDistanceThousandths,
    visible,
    fullyVisible,
    indirectFire,
    weaponHasIndirect,
    eligibleWeaponCount,
    method,
    reviewedByPlayer,
    reviewReason,
    rangeOverrideReason,
    clock,
  });
}

export function recordFormationCharge(
  state,
  formationId,
  targetFormationIds,
  successful,
  roll,
  {
    targetEligibilityConfirmed = false,
    targetEligibilityReason = "",
    eligibilityOverride = false,
    overrideReason = "",
  } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "charge_recorded",
    formationId,
    targetFormationIds,
    successful,
    roll,
    targetEligibilityConfirmed,
    targetEligibilityReason,
    eligibilityOverride,
    overrideReason,
    clock,
  });
}

export function startFormationActivation(
  state,
  formationId,
  {
    weaponHasAssault = false,
    eligibilityOverride = false,
    overrideReason = "",
    fightsFirst = false,
  } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  const activationType = clock.phase === "shooting" ? "shooting" : "fight";
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "activation_started",
    formationId,
    activationType,
    weaponHasAssault,
    eligibilityOverride,
    overrideReason,
    fightsFirst,
    clock,
  });
}

export function completeFormationActivation(state, id, at) {
  const replayed = replayBattleState(state);
  if (!replayed.activeActivation) throw new Error("No formation activation is in progress");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "activation_completed",
    formationId: replayed.activeActivation.formationId,
    activationType: replayed.activeActivation.activationType,
    clock: replayed.clock,
  });
}

export function passFightPriority(state, reason, id, at) {
  const replayed = replayBattleState(state);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "fight_priority_passed",
    playerId: replayed.clock.priorityPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function battleCanStartFormationActivation(
  state,
  attackerFormationId,
  {
    weaponHasAssault = false,
    weaponType = "",
    eligibilityOverride = false,
    fightsFirst = false,
  } = {},
) {
  if (!state) return false;
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(attackerFormationId);
  if (
    !formation ||
    formationDestroyed(formation) ||
    !formationIsOnBattlefield(
      attackerFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    ) ||
    !battleAttackWindow(replayed.clock) ||
    replayed.pendingChoices.size > 0 ||
    replayed.activeActivation ||
    replayed.completedActivations.has(
      `${replayed.clock.battleRound}:${replayed.clock.turn}:${replayed.clock.phase}:${attackerFormationId}`,
    )
  ) {
    return false;
  }
  if (replayed.clock.phase === "shooting") {
    if (weaponType !== "Ranged") return false;
    if (formation.playerId !== replayed.clock.activePlayerId) return false;
    const movement = replayed.movementByFormation.get(attackerFormationId);
    const currentMovement = movement && sameTurn(movement.clock, replayed.clock) ? movement : null;
    if (!currentMovement) return eligibilityOverride;
    if (currentMovement.movement === "advance") return weaponHasAssault || eligibilityOverride;
    if (currentMovement.movement === "fall_back") return eligibilityOverride;
    return true;
  }
  if (weaponType !== "Melee") return false;
  if (formation.playerId !== replayed.clock.priorityPlayerId) return false;
  const charge = replayed.chargeByFormation.get(attackerFormationId);
  const charged = Boolean(charge?.successful && sameTurn(charge.clock, replayed.clock));
  if (!charged && !eligibilityOverride) return false;
  return replayed.clock.step !== "fights_first" || charged || fightsFirst;
}

export function battleCanResolveAttack(state, attackerFormationId, options = {}) {
  if (!state) return false;
  if (!options.targetEligibilityConfirmed) return false;
  const replayed = replayBattleState(state);
  if (
    options.targetFormationId &&
    !formationIsOnBattlefield(
      options.targetFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    )
  ) {
    return false;
  }
  if (replayed.activeActivation) {
    const expectedWeaponType = replayed.clock.phase === "shooting" ? "Ranged" : "Melee";
    return (
      replayed.activeActivation.formationId === attackerFormationId &&
      options.weaponType === expectedWeaponType &&
      (replayed.activeActivation.weaponRestriction !== "assault_only" ||
        Boolean(options.weaponHasAssault))
    );
  }
  return battleCanStartFormationActivation(state, attackerFormationId, options);
}

export function registerBattleFormation(state, formation, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.formations.has(formation.id)) return state;
  const prepared = prepareExactFormationRegistration(formation);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_registered",
    formation: prepared,
  });
}

export function battleFormationHealth(state, formationId) {
  return replayBattleState(state).formations.get(formationId)?.health ?? null;
}

export function battleFormation(state, formationId) {
  return replayBattleState(state).formations.get(formationId) ?? null;
}

export function battleFormationWasTargeted(state, formationId) {
  return state.events.some(
    (event) => event.type === "attack_resolved" && event.targetFormationId === formationId,
  );
}

export function configureUnengagedBattleFormation(state, formation, id, at) {
  if (battleFormationWasTargeted(state, formation.id)) {
    throw new Error("Target equipment is locked after this formation has been attacked");
  }
  const index = state.events.findIndex(
    (event) => event.type === "formation_registered" && event.formation.id === formation.id,
  );
  if (index < 0) throw new Error("Formation is not registered for this battle");
  const previous = replayBattleState(state).formations.get(formation.id);
  if (
    previous.playerId !== formation.playerId ||
    previous.sourceFormationId !== formation.sourceFormationId ||
    previous.assignedTransportFormationId !== formation.assignedTransportFormationId
  ) {
    throw new Error("Formation identity cannot change during battle setup");
  }
  let configured = formation;
  if (
    previous.weaponBearerTracking === "exact" &&
    formation.weaponBearerTracking === "exact" &&
    JSON.stringify(weaponInventoryProfileIdentity(previous.weaponInventory)) ===
      JSON.stringify(weaponInventoryProfileIdentity(formation.weaponInventory))
  ) {
    const preservedInventory = formation.weaponInventory.map((group) => {
      const current = previous.weaponInventory.find(
        (candidate) =>
          candidate.sourceSavedUnitId === group.sourceSavedUnitId &&
          candidate.groupId === group.groupId,
      );
      return current
        ? {
            ...group,
            bearerModelIds: current.bearerModelIds,
            bearerAssignmentsReviewed: current.bearerAssignmentsReviewed,
            bearerAssignmentSource: current.bearerAssignmentSource,
          }
        : group;
    });
    configured = {
      ...formation,
      weaponInventory: preservedInventory,
      segments: segmentsForBearerAssignments(formation, preservedInventory),
    };
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_configured",
    formation: configured,
  });
}

export function configureBattleWeaponBearers(
  state,
  formationId,
  sourceSavedUnitId,
  groupId,
  bearerModelIds,
  id,
  at,
) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Weapon bearer assignments are locked after the battle starts");
  }
  const formation = replayed.formations.get(formationId);
  if (!formation || formation.weaponBearerTracking !== "exact") {
    throw new Error("Formation does not support exact weapon bearer assignments");
  }
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  if (!group) throw new Error("Weapon group is absent from the locked formation inventory");
  if (!Array.isArray(bearerModelIds) || bearerModelIds.length !== group.count) {
    throw new Error("Assign every equipped weapon copy to a bearer model");
  }
  const models = new Map(formation.modelInstances.map((model) => [model.id, model]));
  if (bearerModelIds.some((modelId) => models.get(modelId)?.savedUnitId !== sourceSavedUnitId)) {
    throw new Error("Every weapon bearer must belong to its source saved unit");
  }
  const weaponInventory = formation.weaponInventory.map((candidate) =>
    candidate === group
      ? {
          ...candidate,
          bearerModelIds: [...bearerModelIds],
          bearerAssignmentsReviewed: true,
          bearerAssignmentSource: "player_reviewed",
        }
      : candidate,
  );
  const configured = {
    ...formation,
    weaponInventory,
    segments: segmentsForBearerAssignments(formation, weaponInventory),
  };
  delete configured.health;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_configured",
    formation: configured,
  });
}

export function appendResolvedAttack(
  state,
  {
    id,
    at,
    attackerFormationId,
    targetFormationId,
    segmentIds,
    targets,
    initialWoundsLost,
    result,
    summary,
    weaponHasAssault = false,
    weaponType = "",
    targetEligibilityConfirmed = false,
    targetEligibilityReason = "",
    targetEligibilityEventId = "",
    weaponId = "",
    declaredWeaponCount = 0,
    indirectFire = false,
    weaponSourceFormationId = "",
    sourceSavedUnitId = "",
    weaponGroupId = "",
  },
) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(targetFormationId);
  if (!formation) throw new Error("Attack target formation is not registered");
  if (segmentIds.length !== targets.length || segmentIds.length < 1) {
    throw new Error("Attack segment ids must match the resolved target sequence");
  }
  const before = segmentIds.map((segmentId, index) => {
    const health = formation.health[segmentId];
    if (!health) throw new Error("Attack references an unregistered target segment");
    if (health.modelsRemaining !== targets[index].modelCount) {
      throw new Error("Attack target model count does not match battle state");
    }
    if ((index === 0 ? initialWoundsLost : 0) !== health.woundsLost) {
      throw new Error("Attack target wounds do not match battle state");
    }
    return { ...health };
  });
  const after = targetSequenceState(initialWoundsLost + result.appliedDamage, targets);
  const allocations = segmentIds.map((segmentId, index) => ({
    segmentId,
    before: before[index],
    after: {
      modelsRemaining: after[index].modelsRemaining,
      woundsLost: after[index].woundsLost,
    },
  }));
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "attack_resolved",
    attackerFormationId,
    targetFormationId,
    summary: { ...summary, modelsDestroyed: result.modelsDestroyed },
    weaponHasAssault,
    weaponType,
    targetEligibilityConfirmed,
    targetEligibilityReason,
    targetEligibilityEventId,
    weaponId,
    declaredWeaponCount,
    indirectFire,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    clock: replayed.clock,
    allocations,
  });
}

export function revertLatestAttack(state, id, at) {
  const replayed = replayBattleState(state);
  const revertsEventId = replayed.activeAttackIds.at(-1);
  if (!revertsEventId) throw new Error("There is no resolved attack to undo");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "attack_reverted",
    revertsEventId,
  });
}

export function activeBattleAttacks(state) {
  const replayed = replayBattleState(state);
  const active = new Set(replayed.activeAttackIds);
  return state.events.filter((event) => event.type === "attack_resolved" && active.has(event.id));
}

export function battleUnusedWeaponCount(
  state,
  weaponSourceFormationId,
  sourceSavedUnitId,
  weaponGroupId,
) {
  const replayed = replayBattleState(state);
  const source = replayed.formations.get(weaponSourceFormationId);
  const group = source?.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === weaponGroupId,
  );
  if (!source || !group) return 0;
  const surviving = formationSurvivingWeaponCount(source, sourceSavedUnitId, weaponGroupId);
  if (surviving < 1) return 0;
  const active = new Set(replayed.activeAttackIds);
  const used = state.events
    .filter(
      (event) =>
        event.type === "attack_resolved" &&
        active.has(event.id) &&
        event.weaponType === "Ranged" &&
        event.weaponSourceFormationId === weaponSourceFormationId &&
        event.sourceSavedUnitId === sourceSavedUnitId &&
        event.weaponGroupId === weaponGroupId &&
        sameBattleClock(event.clock, replayed.clock),
    )
    .reduce((total, event) => total + event.declaredWeaponCount, 0);
  return Math.max(0, surviving - used);
}

export function battleSurvivingWeaponCount(
  state,
  weaponSourceFormationId,
  sourceSavedUnitId,
  weaponGroupId,
) {
  const replayed = replayBattleState(state);
  const source = replayed.formations.get(weaponSourceFormationId);
  if (!source) return 0;
  return formationSurvivingWeaponCount(source, sourceSavedUnitId, weaponGroupId);
}
