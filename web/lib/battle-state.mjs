import { targetSequenceState } from "./allocation.mjs";

export const BATTLE_STATE_VERSION = 1;

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

function normalizePlayers(players) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error("Battle state must contain exactly two players");
  }
  const normalized = players.map((candidate) => {
    const player = record(candidate, "Each battle player must be an object");
    return {
      id: boundedString(player.id, "Player id", 100),
      listId: boundedString(player.listId, "Player list id", 100),
      name: boundedString(player.name, "Player name"),
    };
  });
  if (new Set(normalized.map((player) => player.id)).size !== normalized.length) {
    throw new Error("Battle player ids must be unique");
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
  return {
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

function normalizeEvent(candidate, sequence, formations) {
  const event = record(candidate, "Each battle event must be an object");
  const normalized = {
    version: nonnegativeInteger(event.version, "Event version", BATTLE_STATE_VERSION),
    id: boundedString(event.id, "Event id", 100),
    sequence: nonnegativeInteger(event.sequence, "Event sequence"),
    at: nonnegativeInteger(event.at, "Event timestamp", Number.MAX_SAFE_INTEGER),
    type: boundedString(event.type, "Event type", 40),
  };
  if (normalized.version !== BATTLE_STATE_VERSION)
    throw new Error("Unsupported battle event version");
  if (normalized.sequence !== sequence) throw new Error("Battle event sequence is not contiguous");
  if (event.type === "formation_registered") {
    const formation = normalizeFormation(event.formation);
    if (!formations.players.has(formation.playerId)) throw new Error("Formation player is unknown");
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "attack_resolved") {
    normalized.attackerFormationId = boundedString(
      event.attackerFormationId,
      "Attacker formation id",
    );
    normalized.targetFormationId = boundedString(event.targetFormationId, "Target formation id");
    const target = formations.byId.get(normalized.targetFormationId);
    if (!target) throw new Error("Attack target formation is not registered");
    normalized.summary = normalizeSummary(event.summary);
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
  if (state.version !== BATTLE_STATE_VERSION) {
    throw new Error(`Unsupported battle state version: ${String(state.version)}`);
  }
  const players = normalizePlayers(state.players);
  if (!Array.isArray(state.events) || state.events.length > 10_000) {
    throw new Error("Battle state events must contain at most 10000 entries");
  }
  const formations = { players: new Set(players.map((player) => player.id)), byId: new Map() };
  const events = state.events.map((event, index) => normalizeEvent(event, index + 1, formations));
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error("Battle event ids must be unique");
  }
  const normalized = {
    version: BATTLE_STATE_VERSION,
    id: boundedString(state.id, "Battle state id", 100),
    createdAt: nonnegativeInteger(state.createdAt, "Battle createdAt", Number.MAX_SAFE_INTEGER),
    rulesSnapshot: boundedString(state.rulesSnapshot, "Battle rules snapshot"),
    players,
    events,
  };
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

export function replayBattleState(state) {
  const formations = new Map();
  const attacks = new Map();
  const activeAttackIds = [];
  for (const event of state.events) {
    if (event.type === "formation_registered") {
      if (formations.has(event.formation.id)) throw new Error("Formation is already registered");
      formations.set(event.formation.id, {
        ...event.formation,
        health: initialHealth(event.formation),
      });
      continue;
    }
    if (event.type === "attack_resolved") {
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
      continue;
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
  return { formations, activeAttackIds };
}

function appendEvent(state, event) {
  return normalizeBattleState({ ...state, events: [...state.events, event] });
}

export function registerBattleFormation(state, formation, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.formations.has(formation.id)) return state;
  return appendEvent(state, {
    version: BATTLE_STATE_VERSION,
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
    version: BATTLE_STATE_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "attack_resolved",
    attackerFormationId,
    targetFormationId,
    summary: { ...summary, modelsDestroyed: result.modelsDestroyed },
    allocations,
  });
}

export function revertLatestAttack(state, id, at) {
  const replayed = replayBattleState(state);
  const revertsEventId = replayed.activeAttackIds.at(-1);
  if (!revertsEventId) throw new Error("There is no resolved attack to undo");
  return appendEvent(state, {
    version: BATTLE_STATE_VERSION,
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
