import { BATTLE_STATE_VERSION, normalizeBattleState, replayBattleState } from "./battle-state.mjs";

export const GOLDEN_BATTLE_REPLAY_SCHEMA = "whc-golden-battle-replay";
export const GOLDEN_BATTLE_REPLAY_SCHEMA_VERSION = 1;

function eventPhaseStepCoverage(state) {
  const keys = [];
  for (const event of state.events) {
    const clock =
      event.type === "battle_started"
        ? event.clock
        : event.type === "clock_advanced"
          ? event.to
          : null;
    if (clock?.status === "active") {
      keys.push(
        `${clock.battleRound}:${clock.turn}:${clock.activePlayerId}:${clock.phase}:${clock.step}`,
      );
    }
  }
  return [...new Set(keys)];
}

export function goldenBattleReplaySummary(candidate) {
  const state = normalizeBattleState(candidate);
  const replayed = replayBattleState(state);
  const eventTypeCounts = {};
  for (const event of state.events) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
  }
  return {
    stateVersion: state.version,
    eventCount: state.events.length,
    eventTypeCounts: Object.fromEntries(Object.entries(eventTypeCounts).sort()),
    phaseStepCoverage: eventPhaseStepCoverage(state),
    finalClock: replayed.clock,
    players: state.players.map((player) => ({
      id: player.id,
      commandPoints: replayed.resources.get(player.id).get("command_points").value,
      victoryPoints: replayed.resources.get(player.id).get("victory_points").value,
      missionPoints: replayed.missionCategoryPoints.get(player.id),
    })),
    formations: [...replayed.formations.values()].map((formation) => ({
      id: formation.id,
      name: formation.name,
      playerId: formation.playerId,
      health: formation.health,
      destroyed: formation.segments.every(
        (segment) => formation.health[segment.id].modelsRemaining === 0,
      ),
      deploymentLocation: replayed.deploymentByFormation.get(formation.id)?.location ?? "",
      deployed: replayed.deployedFormationIds.has(formation.id),
      offBattlefield: replayed.offBattlefieldFormationIds.has(formation.id),
      reserveDestroyed: replayed.reserveDestroyedFormationIds.has(formation.id),
      setupDestroyed: replayed.setupDestroyedFormationIds.has(formation.id),
    })),
    scoringEventCount: replayed.scoringEvents.length,
    sourceLockIds: replayed.ruleCoverage.sourceLocks.map((lock) => lock.id).sort(),
  };
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 500;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Golden battle replay digest verification is unavailable");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateGoldenBattleReplay(candidate, sourceManifest) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Golden battle replay must be an object");
  }
  if (candidate.schema !== GOLDEN_BATTLE_REPLAY_SCHEMA) {
    throw new Error("Golden battle replay schema is invalid");
  }
  if (candidate.schemaVersion !== GOLDEN_BATTLE_REPLAY_SCHEMA_VERSION) {
    throw new Error("Golden battle replay schema version is unsupported");
  }
  if (!nonemptyString(candidate.scenarioId) || !nonemptyString(candidate.title)) {
    throw new Error("Golden battle replay identity is incomplete");
  }
  if (!Array.isArray(candidate.listPair) || candidate.listPair.length !== 2) {
    throw new Error("Golden battle replay must identify exactly two lists");
  }
  for (const entry of candidate.listPair) {
    if (
      !entry ||
      !nonemptyString(entry.playerId) ||
      !nonemptyString(entry.listId) ||
      !nonemptyString(entry.factionId) ||
      !nonemptyString(entry.savedUnitId) ||
      !nonemptyString(entry.datasheetId) ||
      !nonemptyString(entry.datasheetName)
    ) {
      throw new Error("Golden battle replay list identity is incomplete");
    }
  }
  if (new Set(candidate.listPair.map((entry) => entry.playerId)).size !== 2) {
    throw new Error("Golden battle replay players must be unique");
  }
  if (
    !sourceManifest ||
    !Number.isInteger(sourceManifest.version) ||
    !Array.isArray(sourceManifest.sources) ||
    candidate.sourceManifestVersion !== sourceManifest.version
  ) {
    throw new Error("Golden battle replay source manifest is unavailable or mismatched");
  }
  if (!/^[0-9a-f]{64}$/.test(candidate.stateDigest ?? "")) {
    throw new Error("Golden battle replay state digest is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(candidate.expectedDigest ?? "")) {
    throw new Error("Golden battle replay expected digest is invalid");
  }
  if ((await sha256(candidate.state)) !== candidate.stateDigest) {
    throw new Error("Golden battle replay state digest does not match its contents");
  }
  if ((await sha256(candidate.expected)) !== candidate.expectedDigest) {
    throw new Error("Golden battle replay expected digest does not match its contents");
  }
  const state = normalizeBattleState(candidate.state);
  if (state.version !== BATTLE_STATE_VERSION) {
    throw new Error("Golden battle replay must use the current battle-state version");
  }
  if (!state.rulesSnapshot.includes(`battle-state:${BATTLE_STATE_VERSION}`)) {
    throw new Error("Golden battle replay rules snapshot is not version-locked");
  }
  const replayed = replayBattleState(state);
  if (!replayed.ruleCoverage?.report?.permitted) {
    throw new Error("Golden battle replay rule coverage is not permitted");
  }
  if (
    replayed.ruleCoverage.sourceLocks.length < 1 ||
    replayed.ruleCoverage.sourceLocks.some(
      (lock) => !nonemptyString(lock.id) || !/^[0-9a-f]{64}$/.test(lock.sha256),
    )
  ) {
    throw new Error("Golden battle replay source locks are incomplete");
  }
  const manifestLocks = new Map(sourceManifest.sources.map((source) => [source.id, source.sha256]));
  if (
    replayed.ruleCoverage.sourceLocks.length !== manifestLocks.size ||
    replayed.ruleCoverage.sourceLocks.some((lock) => manifestLocks.get(lock.id) !== lock.sha256)
  ) {
    throw new Error("Golden battle replay source locks do not match the authoritative manifest");
  }
  const statePlayers = new Map(state.players.map((player) => [player.id, player]));
  for (const entry of candidate.listPair) {
    const player = statePlayers.get(entry.playerId);
    if (!player || player.listId !== entry.listId) {
      throw new Error("Golden battle replay list pair does not match canonical state");
    }
    const matchingRegistration = state.events.some(
      (event) =>
        event.type === "formation_registered" &&
        event.formation.playerId === entry.playerId &&
        event.formation.sourceFormationId === entry.savedUnitId,
    );
    if (!matchingRegistration) {
      throw new Error("Golden battle replay saved-unit identity is not registered");
    }
    const selected = replayed.ruleCoverage.plan.players.find(
      (selection) => selection.playerId === entry.playerId,
    );
    if (
      !selected?.datasheets.some(
        (datasheet) =>
          datasheet.savedUnitId === entry.savedUnitId &&
          datasheet.datasheetId === entry.datasheetId,
      )
    ) {
      throw new Error("Golden battle replay datasheet identity is not source-locked");
    }
  }
  const summary = goldenBattleReplaySummary(state);
  if (!sameJson(summary, candidate.expected)) {
    throw new Error("Golden battle replay expected summary does not match replayed state");
  }
  if (summary.finalClock.status !== "complete" || summary.phaseStepCoverage.length !== 170) {
    throw new Error("Golden battle replay does not cover a complete five-round battle clock");
  }
  return { state, replayed, summary };
}
