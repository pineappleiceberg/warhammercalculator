import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { targetSequenceState } from "../lib/allocation.mjs";
import {
  activeBattleAttacks,
  appendResolvedAttack,
  battleFormationHealth,
  createBattleState,
  normalizeBattleState,
  registerBattleFormation,
  replayBattleState,
  revertLatestAttack,
} from "../lib/battle-state.mjs";
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

const goldenReplay = JSON.parse(
  await readFile(new URL("./fixtures/battle-replay-v1.json", import.meta.url), "utf8"),
);

function newBattle() {
  return createBattleState({
    id: "battle-1",
    createdAt: 100,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", name: "Attackers" },
      { id: "player-2", listId: "list-2", name: "Defenders" },
    ],
  });
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
  let state = registerBattleFormation(newBattle(), formation, "event-register", 101);
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

test("replays the versioned cross-surface golden battle", () => {
  const state = normalizeBattleState(goldenReplay);
  assert.deepEqual(battleFormationHealth(state, "target"), {
    bodyguard: { modelsRemaining: 1, woundsLost: 1 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.deepEqual(replayBattleState(state).activeAttackIds, ["final-attack"]);
});

test("rejects divergent replay state and non-latest undo", () => {
  let state = registerBattleFormation(newBattle(), formation, "event-register", 101);
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
  corrupt.events[1].allocations[0].before.woundsLost = 1;
  assert.throws(() => normalizeBattleState(corrupt), /does not match replayed target health/);
  const falseSummary = JSON.parse(JSON.stringify(state));
  falseSummary.events[1].summary.damage = 2;
  assert.throws(() => normalizeBattleState(falseSummary), /summary damage/);
  const invalidUndo = {
    ...state,
    events: [
      ...state.events,
      {
        version: 1,
        id: "bad-undo",
        sequence: 3,
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
