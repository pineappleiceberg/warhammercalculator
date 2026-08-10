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

export const BATTLE_STATE_VERSION = 5;
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

function otherPlayerId(players, playerId) {
  const other = players.find((player) => player.id !== playerId);
  if (!other) throw new Error("Battle state cannot determine the other player");
  return other.id;
}

function defaultMission(players) {
  return {
    name: "Custom mission",
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
  return {
    name: boundedString(mission.name, "Mission name", 200),
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
  return {
    id: boundedString(segment.id, "Segment id"),
    savedUnitId: boundedString(segment.savedUnitId, "Segment saved unit id", 100),
    unitName: boundedString(segment.unitName, "Segment unit name"),
    modelName: boundedString(segment.modelName, "Segment model name"),
    role: boundedString(segment.role, "Segment role", 40),
    wounds,
    startingModels,
  };
}

function normalizeFormation(candidate) {
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
  const normalized = {
    id: boundedString(formation.id, "Formation id"),
    playerId: boundedString(formation.playerId, "Formation player id", 100),
    sourceFormationId: boundedString(
      formation.sourceFormationId,
      "Formation source formation id",
      100,
    ),
    name: boundedString(formation.name, "Formation name"),
    segments,
  };
  normalized.defensiveEquipmentCounts = normalizeDefensiveEquipmentCounts(
    formation.defensiveEquipmentCounts ?? {},
    "Formation defensiveEquipmentCounts",
  );
  return normalized;
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
  if (event.type === "formation_registered") {
    const formation = normalizeFormation(event.formation);
    if (!formations.players.has(formation.playerId)) throw new Error("Formation player is unknown");
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "formation_configured") {
    const formation = normalizeFormation(event.formation);
    const previous = formations.byId.get(formation.id);
    if (!previous) throw new Error("Configured formation is not registered");
    if (
      previous.playerId !== formation.playerId ||
      previous.sourceFormationId !== formation.sourceFormationId
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
  const completedActivations = new Set();
  let activeActivation = null;
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
  for (const event of state.events) {
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
    if (event.type === "battle_started") {
      if (clock.status !== "setup") throw new Error("Battle has already started");
      if (pendingChoices.size > 0) throw new Error("Pending choices block the battle start");
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
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's formation can move");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot move");
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
          if (!event.targetEligibilityConfirmed) {
            throw new Error(
              "Attack target eligibility requires explicit range, visibility, and table-state confirmation",
            );
          }
        }
      }
      const formation = formations.get(event.targetFormationId);
      if (!formation) throw new Error("Attack target formation is not registered");
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
      continue;
    }
    if (event.type !== "attack_reverted") {
      throw new Error(`Unsupported replayed battle event type: ${event.type}`);
    }
    const reverted = attacks.get(event.revertsEventId);
    if (!reverted || activeAttackIds.at(-1) !== reverted.id) {
      throw new Error("Only the latest unreverted attack can be reverted");
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
    completedActivations,
    activeActivation,
  };
}

function appendEvent(state, event) {
  return normalizeBattleState({ ...state, events: [...state.events, event] });
}

export function startBattle(state, firstPlayerId, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") throw new Error("Battle has already started");
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
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_registered",
    formation,
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
  const previous = state.events[index].formation;
  if (
    previous.playerId !== formation.playerId ||
    previous.sourceFormationId !== formation.sourceFormationId
  ) {
    throw new Error("Formation identity cannot change during battle setup");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_configured",
    formation,
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
