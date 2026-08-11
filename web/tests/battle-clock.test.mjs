import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceBattleClock,
  appendResolvedAttack,
  applyBattleEffect,
  battleCanResolveAttack,
  createBattleState,
  declareFormationDeployment,
  deployFormation,
  normalizeBattleState,
  openBattleChoice,
  recordFormationMovement,
  recordRangedTargetEligibility,
  registerBattleFormation,
  replayBattleState,
  resolveBattleChoice,
  startBattle,
  startFormationActivation,
} from "../lib/battle-state.mjs";

function formation(id, playerId) {
  return {
    id,
    playerId,
    sourceFormationId: `source-${id}`,
    name: id,
    defensiveEquipmentCounts: {},
    segments: [
      {
        id: `${id}-model`,
        savedUnitId: `saved-${id}`,
        unitName: id,
        modelName: id,
        role: "standalone",
        wounds: 10,
        startingModels: 1,
      },
    ],
  };
}

function setupBattle() {
  let state = createBattleState({
    id: "clock-battle",
    createdAt: 0,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", listUpdatedAt: 10, name: "First" },
      { id: "player-2", listId: "list-2", listUpdatedAt: 20, name: "Second" },
    ],
  });
  state = registerBattleFormation(state, formation("unit-1", "player-1"), "register-1", 1);
  state = registerBattleFormation(state, formation("unit-2", "player-2"), "register-2", 2);
  state = declareFormationDeployment(state, "unit-1", "battlefield", {}, "declare-1", 3);
  state = declareFormationDeployment(state, "unit-2", "battlefield", {}, "declare-2", 4);
  state = deployFormation(
    state,
    "unit-1",
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-1",
    5,
  );
  state = deployFormation(
    state,
    "unit-2",
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-2",
    6,
  );
  return state;
}

function advanceUntil(state, predicate, prefix = "advance") {
  let next = state;
  let count = 0;
  while (!predicate(replayBattleState(next).clock)) {
    count += 1;
    next = advanceBattleClock(next, `${prefix}-${next.events.length + 1}`, next.events.length + 1);
    assert.ok(count < 200, "Battle clock did not reach the expected state");
  }
  return next;
}

function readyToShoot(state) {
  let next = advanceUntil(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "to-move",
  );
  next = recordFormationMovement(
    next,
    "unit-1",
    "stationary",
    `stationary-${next.events.length + 1}`,
    next.events.length + 1,
  );
  return advanceUntil(
    next,
    (clock) => clock.phase === "shooting" && clock.step === "resolve_attacks",
    "to-shoot",
  );
}

test("advances the canonical five-round two-turn phase and step topology", () => {
  let state = startBattle(setupBattle(), "player-1", "start", 3);
  const seenTurns = [];
  let previous = "";
  let advances = 0;
  while (replayBattleState(state).clock.status !== "complete") {
    const clock = replayBattleState(state).clock;
    const key = `${clock.battleRound}:${clock.turn}:${clock.activePlayerId}`;
    if (key !== previous) seenTurns.push(key);
    previous = key;
    advances += 1;
    state = advanceBattleClock(state, `advance-${advances}`, state.events.length + 1);
  }
  assert.equal(advances, 170);
  assert.deepEqual(seenTurns, [
    "1:1:player-1",
    "1:2:player-2",
    "2:1:player-1",
    "2:2:player-2",
    "3:1:player-1",
    "3:2:player-2",
    "4:1:player-1",
    "4:2:player-2",
    "5:1:player-1",
    "5:2:player-2",
  ]);
  const complete = replayBattleState(state).clock;
  assert.equal(complete.battleRound, 5);
  assert.equal(complete.turn, 2);
  assert.equal(complete.phase, "complete");
});

test("pending choices block time and attacks until a bounded selection resolves", () => {
  let state = startBattle(setupBattle(), "player-1", "start", 3);
  state = readyToShoot(state);
  state = openBattleChoice(
    state,
    {
      id: "choose-target",
      kind: "target",
      ownerPlayerId: "player-1",
      prompt: "Choose one target",
      minimumSelections: 1,
      maximumSelections: 1,
      options: [
        { id: "unit-2", label: "Unit 2" },
        { id: "none", label: "No target" },
      ],
    },
    "open-choice",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingChoices.size, 1);
  assert.equal(battleCanResolveAttack(state, "unit-1"), false);
  assert.throws(() => advanceBattleClock(state, "blocked-advance", 20), /pending choices/i);
  assert.throws(
    () => resolveBattleChoice(state, "choose-target", [], "bad-choice", 20),
    /selections are invalid/i,
  );
  state = resolveBattleChoice(
    state,
    "choose-target",
    ["unit-2"],
    "resolve-choice",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingChoices.size, 0);
  assert.equal(
    battleCanResolveAttack(state, "unit-1", {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    true,
  );
});

test("expires effects exactly at step, phase, turn, round, and battle boundaries", () => {
  let state = startBattle(setupBattle(), "player-1", "start", 3);
  for (const duration of [
    "end_of_step",
    "end_of_phase",
    "end_of_turn",
    "end_of_round",
    "end_of_battle",
  ]) {
    state = applyBattleEffect(
      state,
      {
        id: duration,
        name: duration,
        ownerPlayerId: "player-1",
        sourceFormationId: "unit-1",
        duration,
      },
      `apply-${duration}`,
      state.events.length + 1,
    );
  }
  state = advanceBattleClock(state, "leave-step", state.events.length + 1);
  assert.deepEqual([...replayBattleState(state).effects.keys()].sort(), [
    "end_of_battle",
    "end_of_phase",
    "end_of_round",
    "end_of_turn",
  ]);
  const tampered = structuredClone(state);
  tampered.events.at(-1).expiredEffectIds = [];
  assert.throws(() => normalizeBattleState(tampered), /effect-expiry set/i);

  state = advanceUntil(state, (clock) => clock.phase === "movement", "to-movement");
  assert.equal(replayBattleState(state).effects.has("end_of_phase"), false);
  state = advanceUntil(state, (clock) => clock.turn === 2, "to-turn-2");
  assert.equal(replayBattleState(state).effects.has("end_of_turn"), false);
  state = advanceUntil(state, (clock) => clock.battleRound === 2, "to-round-2");
  assert.equal(replayBattleState(state).effects.has("end_of_round"), false);
  state = advanceUntil(state, (clock) => clock.status === "complete", "to-complete");
  assert.equal(replayBattleState(state).effects.size, 0);
});

test("allows attacks only for the active player in Shooting or Fight attack steps", () => {
  let state = startBattle(setupBattle(), "player-1", "start", 3);
  assert.equal(battleCanResolveAttack(state, "unit-1"), false);
  state = readyToShoot(state);
  assert.equal(
    battleCanResolveAttack(state, "unit-1", {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    true,
  );
  assert.equal(battleCanResolveAttack(state, "unit-2"), false);
  state = startFormationActivation(state, "unit-1", {}, "start-shooting", state.events.length + 1);
  state = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: "unit-1",
      targetFormationId: "unit-2",
      weaponId: "test-weapon",
      weaponName: "Test weapon",
      publishedRangeThousandths: 24000,
      effectiveRangeThousandths: 24000,
      measuredDistanceThousandths: 12000,
      visible: true,
      fullyVisible: true,
      eligibleWeaponCount: 1,
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Range and line of sight checked",
    },
    "target-eligibility",
    state.events.length + 1,
  );
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
    targetEligibilityEventId: "target-eligibility",
    weaponId: "test-weapon",
    declaredWeaponCount: 1,
    id: "attack-1",
    at: state.events.length + 1,
    attackerFormationId: "unit-1",
    targetFormationId: "unit-2",
    segmentIds: ["unit-2-model"],
    targets: [{ wounds: 10, modelCount: 1 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 1, modelsDestroyed: 0 },
    summary: {
      attacker: "Unit 1",
      weapon: "Weapon",
      target: "Unit 2",
      damage: 1,
      successful: 1,
    },
  });
  assert.equal(
    replayBattleState(state).formations.get("unit-2").health["unit-2-model"].woundsLost,
    1,
  );
  const wrongPlayer = {
    ...state,
    events: state.events.map((event) =>
      event.id === "attack-1" ? { ...event, attackerFormationId: "unit-2" } : event,
    ),
  };
  assert.throws(
    () => normalizeBattleState(wrongPlayer),
    /active player's formation|active formation/i,
  );
});
