import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { targetSequenceState } from "../lib/allocation.mjs";
import {
  activeBattleAttacks,
  advanceBattleClock,
  appendResolvedAttack,
  arriveFromReserves,
  battleFormationHealth,
  battleCanResolveAttack,
  changeBattleResource,
  completeFormationActivation,
  configureBattleMission,
  createBattleState,
  declareFormationDeployment,
  deployFormation,
  normalizeBattleState,
  passFightPriority,
  registerBattleFormation,
  recordFormationCharge,
  recordFormationMovement,
  replayBattleState,
  revertLatestAttack,
  scoreBattlePoints,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
  startFormationActivation,
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
const battleRuleSources = JSON.parse(
  await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
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

function deployAllOnBattlefield(state) {
  let next = state;
  for (const formation of replayBattleState(next).formations.values()) {
    next = declareFormationDeployment(
      next,
      formation.id,
      "battlefield",
      {},
      `declare-${formation.id}`,
      next.events.length + 1,
    );
  }
  while (!replayBattleState(next).deploymentComplete) {
    const replayed = replayBattleState(next);
    const formation = [...replayed.formations.values()].find(
      (candidate) =>
        candidate.playerId === replayed.deploymentPriorityPlayerId &&
        !replayed.deployedFormationIds.has(candidate.id),
    );
    assert.ok(formation, "Expected a formation for deployment priority");
    next = deployFormation(
      next,
      formation.id,
      { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
      `deploy-${formation.id}`,
      next.events.length + 1,
    );
  }
  return next;
}

function registeredBattle() {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "event-register-attacker", 100),
    formation,
    "event-register",
    101,
  );
  state = deployAllOnBattlefield(state);
  state = startBattle(state, "player-1", "battle-start", 102);
  let advance = 0;
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    advance += 1;
    state = advanceBattleClock(state, `clock-${advance}`, 102 + advance);
  }
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    `movement-${++advance}`,
    102 + advance,
  );
  while (!battleAttackWindow(replayBattleState(state).clock)) {
    advance += 1;
    state = advanceBattleClock(state, `clock-${advance}`, 102 + advance);
  }
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    `activation-${++advance}`,
    102 + advance,
  );
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

test("pins the official deployment and Reserves rules source", () => {
  assert.equal(battleRuleSources.version, 1);
  assert.deepEqual(battleRuleSources.sources[0].pages, [16, 39, 43, 57, 60]);
  assert.equal(
    battleRuleSources.sources[0].sha256,
    "4d0e8019cbfddd6f46781d5b4ed31d46fb21eb2d0d10a0f6fabefac0ce054364",
  );
});

test("replays movement and enforces one weapon-scoped Shooting activation", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
    formation,
    "register-target",
    2,
  );
  state = deployAllOnBattlefield(state);
  state = startBattle(state, "player-1", "start", 3);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(state, `to-move-${state.events.length}`, state.events.length + 1);
  }
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "advance",
    "advanced",
    state.events.length + 1,
  );
  while (!battleAttackWindow(replayBattleState(state).clock)) {
    state = advanceBattleClock(state, `to-shoot-${state.events.length}`, state.events.length + 1);
  }
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      weaponHasAssault: true,
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    true,
  );
  assert.throws(
    () =>
      startFormationActivation(
        state,
        attackerFormation.id,
        {},
        "illegal-start",
        state.events.length + 1,
      ),
    /Assault weapon/i,
  );
  state = startFormationActivation(
    state,
    attackerFormation.id,
    { weaponHasAssault: true },
    "shooting-start",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).activeActivation.weaponRestriction, "assault_only");
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      weaponHasAssault: true,
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    true,
  );
  assert.throws(
    () => advanceBattleClock(state, "advance-during-activation", state.events.length + 1),
    /finish its activation/i,
  );
  assert.throws(
    () =>
      appendResolvedAttack(state, {
        weaponType: "Ranged",
        id: "unconfirmed-target",
        at: state.events.length + 1,
        attackerFormationId: attackerFormation.id,
        targetFormationId: formation.id,
        segmentIds: ["bodyguard", "leader"],
        targets,
        initialWoundsLost: 0,
        result: { appliedDamage: 0, modelsDestroyed: 0 },
        weaponHasAssault: true,
        summary: {
          attacker: "Tank",
          weapon: "Assault cannon",
          target: formation.name,
          damage: 0,
          successful: 0,
        },
      }),
    /target eligibility requires explicit/i,
  );
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
    id: "assault-attack",
    at: state.events.length + 1,
    attackerFormationId: attackerFormation.id,
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: "Tank",
      weapon: "Assault cannon",
      target: formation.name,
      damage: 0,
      successful: 0,
    },
    weaponHasAssault: true,
  });
  state = completeFormationActivation(state, "shooting-complete", state.events.length + 1);
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      weaponHasAssault: true,
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.throws(
    () =>
      startFormationActivation(
        state,
        attackerFormation.id,
        { weaponHasAssault: true },
        "repeat-start",
        state.events.length + 1,
      ),
    /already completed/i,
  );
});

test("records charge eligibility and alternates replayed Fight priority", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
    formation,
    "register-target",
    2,
  );
  state = deployAllOnBattlefield(state);
  state = startBattle(state, "player-1", "start", 3);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(state, `to-move-${state.events.length}`, state.events.length + 1);
  }
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "advance",
    "advanced",
    state.events.length + 1,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "charge" &&
      replayBattleState(state).clock.step === "charge_moves"
    )
  ) {
    state = advanceBattleClock(state, `to-charge-${state.events.length}`, state.events.length + 1);
  }
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        attackerFormation.id,
        [formation.id],
        true,
        8,
        {},
        "illegal-charge",
        state.events.length + 1,
      ),
    /explicit confirmation/i,
  );
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    true,
    8,
    {
      targetEligibilityConfirmed: true,
      targetEligibilityReason: "Target is visible and within charge range",
      eligibilityOverride: true,
      overrideReason: "Army rule permits charging after Advance",
    },
    "charge",
    state.events.length + 1,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "fight" &&
      replayBattleState(state).clock.step === "fights_first"
    )
  ) {
    state = advanceBattleClock(state, `to-fight-${state.events.length}`, state.events.length + 1);
  }
  assert.equal(replayBattleState(state).clock.priorityPlayerId, "player-2");
  state = passFightPriority(
    state,
    "No eligible Fights First formation",
    "pass-priority",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).clock.priorityPlayerId, "player-1");
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "fight-start",
    state.events.length + 1,
  );
  state = completeFormationActivation(state, "fight-complete", state.events.length + 1);
  assert.equal(replayBattleState(state).clock.priorityPlayerId, "player-2");
});

test("replays persistent mixed-profile casualties and compensating undo", () => {
  let state = registeredBattle();
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
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
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start", 104);
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
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
    formation,
    "register-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start", 100);
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

test("replays alternating deployment and Strategic Reserves arrival", () => {
  const reserveFormation = {
    ...attackerFormation,
    id: "player-1:formation-reserve",
    sourceFormationId: "formation-reserve",
    name: "Reserve Tank",
  };
  let state = registerBattleFormation(
    registerBattleFormation(
      registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
      reserveFormation,
      "register-reserve",
      2,
    ),
    formation,
    "register-target",
    3,
  );
  const mission = replayBattleState(state).mission;
  state = configureBattleMission(
    state,
    { ...mission, pointsLimit: 1000, deploymentFirstPlayerId: "player-1" },
    "mission",
    4,
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        reserveFormation.id,
        "strategic_reserves",
        {
          points: 251,
          earliestBattleRound: 2,
          eligibilityConfirmed: true,
          eligibilityReason: "Strategic Reserves",
        },
        "over-cap",
        5,
      ),
    /250 point limit/,
  );
  state = declareFormationDeployment(
    state,
    attackerFormation.id,
    "battlefield",
    {},
    "declare-attacker",
    5,
  );
  state = declareFormationDeployment(
    state,
    reserveFormation.id,
    "strategic_reserves",
    {
      points: 250,
      earliestBattleRound: 2,
      eligibilityConfirmed: true,
      eligibilityReason: "Strategic Reserves",
    },
    "declare-reserve",
    6,
  );
  state = declareFormationDeployment(state, formation.id, "battlefield", {}, "declare-target", 7);
  assert.equal(replayBattleState(state).deploymentPriorityPlayerId, "player-1");
  assert.throws(
    () =>
      deployFormation(
        state,
        formation.id,
        { placementConfirmed: true, placementReason: "Deployment zone" },
        "wrong-order",
        8,
      ),
    /alternating player order/,
  );
  state = deployFormation(
    state,
    attackerFormation.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-attacker",
    8,
  );
  assert.equal(replayBattleState(state).deploymentPriorityPlayerId, "player-2");
  assert.throws(() => startBattle(state, "player-1", "early-start", 9), /must be deployed/);
  state = deployFormation(
    state,
    formation.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-target",
    9,
  );
  assert.equal(replayBattleState(state).deploymentComplete, true);
  state = startBattle(state, "player-1", "start", 10);
  let replayed = replayBattleState(state);
  assert.equal(replayed.offBattlefieldFormationIds.has(reserveFormation.id), true);
  assert.equal(
    battleCanResolveAttack(state, reserveFormation.id, {
      targetFormationId: formation.id,
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.equal(
    battleCanResolveAttack(state, attackerFormation.id, {
      targetFormationId: reserveFormation.id,
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  while (
    !(
      replayed.clock.battleRound === 1 &&
      replayed.clock.activePlayerId === "player-1" &&
      replayed.clock.phase === "movement" &&
      replayed.clock.step === "reinforcements"
    )
  ) {
    state = advanceBattleClock(
      state,
      `to-round-one-${state.events.length}`,
      state.events.length + 1,
    );
    replayed = replayBattleState(state);
  }
  assert.throws(
    () =>
      arriveFromReserves(
        state,
        reserveFormation.id,
        { placementConfirmed: true, placementReason: "Legal board-edge position" },
        "too-early",
        state.events.length + 1,
      ),
    /before battle round 2/,
  );
  while (
    !(
      replayed.clock.battleRound === 2 &&
      replayed.clock.activePlayerId === "player-1" &&
      replayed.clock.phase === "movement" &&
      replayed.clock.step === "reinforcements"
    )
  ) {
    state = advanceBattleClock(
      state,
      `to-round-two-${state.events.length}`,
      state.events.length + 1,
    );
    replayed = replayBattleState(state);
  }
  state = arriveFromReserves(
    state,
    reserveFormation.id,
    { placementConfirmed: true, placementReason: "Legal board-edge position outside 9 inches" },
    "reserve-arrives",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.offBattlefieldFormationIds.has(reserveFormation.id), false);
  assert.equal(replayed.reserveArrivals.has(reserveFormation.id), true);
  assert.deepEqual(replayed.movementByFormation.get(reserveFormation.id), {
    formationId: reserveFormation.id,
    movement: "normal",
    clock: replayed.clock,
    fromReserves: true,
  });
});

test("reports a Reserve formation destroyed when the battle ends off battlefield", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-reserve", 1),
    formation,
    "register-target",
    2,
  );
  state = declareFormationDeployment(
    state,
    attackerFormation.id,
    "reserves",
    {
      earliestBattleRound: 1,
      eligibilityConfirmed: true,
      eligibilityReason: "Source rule permits Reserves",
    },
    "declare-reserve",
    3,
  );
  state = declareFormationDeployment(state, formation.id, "battlefield", {}, "declare-target", 4);
  assert.throws(
    () => deployFormation(state, formation.id, {}, "unconfirmed-deploy", 5),
    /explicit deployment-zone/,
  );
  state = deployFormation(
    state,
    formation.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-target",
    5,
  );
  state = startBattle(state, "player-1", "start", 6);
  while (replayBattleState(state).clock.status !== "complete") {
    state = advanceBattleClock(state, `complete-${state.events.length}`, state.events.length + 1);
  }
  const replayed = replayBattleState(state);
  assert.deepEqual([...replayed.reserveDestroyedFormationIds], [attackerFormation.id]);
  assert.equal(replayed.offBattlefieldFormationIds.has(attackerFormation.id), true);
});

test("rejects Fortifications in Strategic Reserves", () => {
  const fortification = {
    ...attackerFormation,
    id: "player-1:fortification",
    sourceFormationId: "fortification",
    name: "Fortification",
    keywords: ["Fortification"],
  };
  const state = registerBattleFormation(newBattle(), fortification, "register-fortification", 1);
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        fortification.id,
        "strategic_reserves",
        {
          points: 100,
          earliestBattleRound: 2,
          eligibilityConfirmed: true,
          eligibilityReason: "Strategic Reserves",
        },
        "illegal-fortification",
        2,
      ),
    /Fortifications cannot/,
  );
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
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
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
  assert.throws(() => normalizeBattleState(missingAttacker), /formation is not registered/);
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
