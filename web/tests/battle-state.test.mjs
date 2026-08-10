import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { targetSequenceState } from "../lib/allocation.mjs";
import {
  activeBattleAttacks,
  advanceBattleClock,
  appendResolvedAttack,
  battleFormationHealth,
  changeBattleResource,
  configureBattleMission,
  createBattleState,
  normalizeBattleState,
  registerBattleFormation,
  replayBattleState,
  revertLatestAttack,
  scoreBattlePoints,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
} from "../lib/battle-state.mjs";
import { battleAttackWindow } from "../lib/battle-clock.mjs";
import { applyBattleHealthToTargetSequence } from "../lib/formations.mjs";

const targets = [
  { wounds: 3, modelCount: 2 },
  { wounds: 5, modelCount: 1 },
];

const formation = {
  id: "player-2:formation-1",
  playerId: "player-2",
  sourceFormationId: "formation-1",
  name: "Bodyguard + Leader",
  segments: [
    {
      id: "bodyguard",
      savedUnitId: "unit-1",
      unitName: "Bodyguard",
      modelName: "Guard",
      role: "bodyguard",
      wounds: 3,
      startingModels: 2,
    },
    {
      id: "leader",
      savedUnitId: "unit-2",
      unitName: "Leader",
      modelName: "Leader",
      role: "leader",
      wounds: 5,
      startingModels: 1,
    },
  ],
};

const attackerFormation = {
  ...formation,
  id: "player-1:formation-9",
  playerId: "player-1",
  sourceFormationId: "formation-9",
  name: "Tank",
};

const goldenReplay = JSON.parse(
  await readFile(new URL("./fixtures/battle-replay-v1.json", import.meta.url), "utf8"),
);

function newBattle() {
  return createBattleState({
    id: "battle-1",
    createdAt: 100,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", listUpdatedAt: 10, name: "Attackers" },
      { id: "player-2", listId: "list-2", listUpdatedAt: 20, name: "Defenders" },
    ],
  });
}

function registeredBattle() {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "event-register-attacker", 100),
    formation,
    "event-register",
    101,
  );
  state = startBattle(state, "player-1", "battle-start", 102);
  let advance = 0;
  while (!battleAttackWindow(replayBattleState(state).clock)) {
    advance += 1;
    state = advanceBattleClock(state, `clock-${advance}`, 102 + advance);
  }
  return state;
}

test("reports exact per-segment damage state across mixed profiles", () => {
  assert.deepEqual(targetSequenceState(8, targets), [
    { segmentIndex: 0, modelsDestroyed: 2, modelsRemaining: 0, woundsLost: 0 },
    { segmentIndex: 1, modelsDestroyed: 0, modelsRemaining: 1, woundsLost: 2 },
  ]);
  assert.deepEqual(targetSequenceState(11, targets), [
    { segmentIndex: 0, modelsDestroyed: 2, modelsRemaining: 0, woundsLost: 0 },
    { segmentIndex: 1, modelsDestroyed: 1, modelsRemaining: 0, woundsLost: 0 },
  ]);
  assert.throws(() => targetSequenceState(12, targets), /Invalid target sequence damage state/);
});

test("replays persistent mixed-profile casualties and compensating undo", () => {
  let state = registeredBattle();
  state = appendResolvedAttack(state, {
    id: "event-attack-1",
    at: 102,
    attackerFormationId: "player-1:formation-9",
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 8, modelsDestroyed: 2 },
    summary: {
      attacker: "Tank",
      weapon: "Cannon",
      target: formation.name,
      damage: 8,
      successful: 2,
    },
  });
  assert.deepEqual(battleFormationHealth(state, formation.id), {
    bodyguard: { modelsRemaining: 0, woundsLost: 0 },
    leader: { modelsRemaining: 1, woundsLost: 2 },
  });
  assert.deepEqual(
    activeBattleAttacks(state).map((event) => event.id),
    ["event-attack-1"],
  );
  assert.deepEqual(normalizeBattleState(JSON.parse(JSON.stringify(state))), state);

  state = revertLatestAttack(state, "event-revert-1", 103);
  assert.deepEqual(battleFormationHealth(state, formation.id), {
    bodyguard: { modelsRemaining: 2, woundsLost: 0 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.deepEqual(activeBattleAttacks(state), []);
  assert.equal(state.events.at(-1).revertsEventId, "event-attack-1");
  assert.equal(replayBattleState(state).activeAttackIds.length, 0);
});

test("replays mission, CP, VP, objectives, Battle-shock, and bounded resources", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 100),
    formation,
    "register-target",
    101,
  );
  state = configureBattleMission(
    state,
    {
      name: "Take and Hold",
      commandPointsPerCommandPhase: 1,
      startingCommandPoints: { "player-1": 2, "player-2": 1 },
      objectives: [
        { id: "home", name: "Home objective" },
        { id: "centre", name: "Centre objective" },
      ],
    },
    "mission",
    102,
  );
  state = changeBattleResource(
    state,
    {
      playerId: "player-1",
      resourceId: "yield_points",
      name: "Yield Points",
      delta: 3,
      maximum: 5,
      reason: "Army rule setup",
    },
    "yield",
    103,
  );
  state = startBattle(state, "player-1", "start", 104);
  let replayed = replayBattleState(state);
  assert.equal(replayed.mission.name, "Take and Hold");
  assert.equal(replayed.resources.get("player-1").get("command_points").value, 3);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 2);
  assert.equal(replayed.resources.get("player-1").get("yield_points").value, 3);

  state = changeBattleResource(
    state,
    {
      playerId: "player-1",
      resourceId: "command_points",
      name: "Command Points",
      delta: -1,
      reason: "Used a Stratagem",
    },
    "spend-cp",
    105,
  );
  state = scoreBattlePoints(state, "player-1", 5, "primary", "Held centre", "score", 106);
  state = setBattleObjectiveControl(state, "centre", "player-1", false, "control", 107);
  state = setFormationBattleShocked(state, formation.id, true, "Failed test", "shock", 108);
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-1").get("command_points").value, 2);
  assert.equal(replayed.resources.get("player-1").get("victory_points").value, 5);
  assert.equal(replayed.objectives.get("centre").controllerPlayerId, "player-1");
  assert.equal(replayed.battleShockedFormations.has(formation.id), true);

  while (
    !(
      replayBattleState(state).clock.activePlayerId === "player-2" &&
      replayBattleState(state).clock.phase === "command" &&
      replayBattleState(state).clock.step === "start"
    )
  ) {
    state = advanceBattleClock(state, `advance-${state.events.length}`, state.events.length + 1);
  }
  replayed = replayBattleState(state);
  assert.equal(replayed.battleShockedFormations.has(formation.id), false);
  assert.equal(replayed.resources.get("player-1").get("command_points").value, 3);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 3);
  assert.throws(
    () =>
      changeBattleResource(
        state,
        {
          playerId: "player-1",
          resourceId: "yield_points",
          name: "Yield Points",
          delta: 3,
          maximum: 5,
          reason: "Too many",
        },
        "overflow",
        109,
      ),
    /cannot exceed 5/,
  );
  assert.throws(
    () => configureBattleMission(state, replayed.mission, "late-mission", 110),
    /locked after the battle starts/,
  );
});

test("rejects tampered resource and scoring totals", () => {
  let state = startBattle(newBattle(), "player-1", "start", 100);
  state = changeBattleResource(
    state,
    {
      playerId: "player-1",
      resourceId: "command_points",
      name: "Command Points",
      delta: -1,
      reason: "Stratagem",
    },
    "spend",
    101,
  );
  state = scoreBattlePoints(state, "player-1", 5, "primary", "Objective", "score", 102);
  const resource = structuredClone(state);
  resource.events.find((event) => event.id === "spend").before = 0;
  assert.throws(() => normalizeBattleState(resource), /replayed value/);
  const score = structuredClone(state);
  score.events.find((event) => event.id === "score").after = 7;
  assert.throws(() => normalizeBattleState(score), /replayed Victory Points/);
});

test("replays the versioned cross-surface golden battle", () => {
  const state = normalizeBattleState(goldenReplay);
  assert.deepEqual(battleFormationHealth(state, "target"), {
    bodyguard: { modelsRemaining: 1, woundsLost: 1 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.deepEqual(replayBattleState(state).activeAttackIds, ["final-attack"]);
});

test("rejects divergent replay state and non-latest undo", () => {
  let state = registeredBattle();
  state = appendResolvedAttack(state, {
    id: "event-attack-1",
    at: 102,
    attackerFormationId: "player-1:formation-9",
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 1, modelsDestroyed: 0 },
    summary: {
      attacker: "Tank",
      weapon: "Cannon",
      target: formation.name,
      damage: 1,
      successful: 1,
    },
  });
  const corrupt = JSON.parse(JSON.stringify(state));
  corrupt.events.find((event) => event.id === "event-attack-1").allocations[0].before.woundsLost =
    1;
  assert.throws(() => normalizeBattleState(corrupt), /does not match replayed target health/);
  const falseSummary = JSON.parse(JSON.stringify(state));
  falseSummary.events.find((event) => event.id === "event-attack-1").summary.damage = 2;
  assert.throws(() => normalizeBattleState(falseSummary), /summary damage/);
  const missingAttacker = JSON.parse(JSON.stringify(state));
  missingAttacker.events = missingAttacker.events.slice(1).map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
  assert.throws(
    () => normalizeBattleState(missingAttacker),
    /attacker formation is not registered/,
  );
  const invalidUndo = {
    ...state,
    events: [
      ...state.events,
      {
        version: 1,
        id: "bad-undo",
        sequence: state.events.length + 1,
        at: 103,
        type: "attack_reverted",
        revertsEventId: "missing",
      },
    ],
  };
  assert.throws(() => normalizeBattleState(invalidUndo), /latest unreverted attack/);
});

test("forces an already-wounded survivor to the front of allocation", () => {
  const sequence = {
    orderedSegments: [
      { id: "bodyguard", role: "bodyguard", modelCount: 2 },
      { id: "leader", role: "leader", modelCount: 1 },
    ],
    targets,
    allocationOptions: [],
  };
  const current = applyBattleHealthToTargetSequence(sequence, {
    bodyguard: { modelsRemaining: 0, woundsLost: 0 },
    leader: { modelsRemaining: 1, woundsLost: 2 },
  });
  assert.deepEqual(
    current.orderedSegments.map((segment) => segment.id),
    ["leader"],
  );
  assert.equal(current.targets[0].modelCount, 1);
  assert.equal(current.initialWoundsLost, 2);
  assert.equal(current.destroyed, false);

  const destroyed = applyBattleHealthToTargetSequence(sequence, {
    bodyguard: { modelsRemaining: 0, woundsLost: 0 },
    leader: { modelsRemaining: 0, woundsLost: 0 },
  });
  assert.equal(destroyed.destroyed, true);
  assert.deepEqual(destroyed.targets, []);
});
