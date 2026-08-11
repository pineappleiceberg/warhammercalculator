import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { targetSequenceState } from "../lib/allocation.mjs";
import {
  activeBattleAttacks,
  advanceBattleClock,
  appendResolvedAttack,
  battleFormationEmbarkedTransport,
  arriveFromReserves,
  battleFormationIsOnBattlefield,
  battleFormationHealth,
  battleCanResolveAttack,
  changeBattleResource,
  completeFormationActivation,
  configureBattleMission,
  createBattleState,
  declareFormationDeployment,
  deployFormation,
  disembarkFormation,
  embarkFormation,
  normalizeBattleState,
  passFightPriority,
  registerBattleFormation,
  recordFormationCharge,
  recordFormationMovement,
  recordRangedTargetEligibility,
  replayBattleState,
  resolveDestroyedTransport,
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

function testWeaponInventory(sourceSavedUnitId) {
  return [
    {
      sourceSavedUnitId,
      groupId: "test-ranged-group",
      name: "Test ranged weapon",
      count: 2,
      profiles: [
        ["test-ranged-weapon", "Test ranged weapon", 24000, false, false],
        ["indirect-weapon", "Indirect weapon", 48000, false, true],
        ["short-weapon", "Short weapon", 12000, false, false],
        ["unreviewed-weapon", "Unreviewed weapon", 24000, false, false],
        ["override-weapon", "Override weapon", 24000, false, false],
        ["assault-cannon", "Test ranged weapon", 24000, true, false],
        ["cannon", "Test ranged weapon", 24000, false, false],
      ].map(([weaponId, name, publishedRangeThousandths, hasAssault, hasIndirect]) => ({
        weaponId,
        name,
        type: "Ranged",
        publishedRangeThousandths,
        hasAssault,
        hasIndirect,
      })),
    },
  ];
}

const formation = {
  id: "player-2:formation-1",
  playerId: "player-2",
  sourceFormationId: "formation-1",
  name: "Bodyguard + Leader",
  weaponInventory: testWeaponInventory("unit-1"),
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

const transportFormation = {
  id: "player-1:transport",
  playerId: "player-1",
  sourceFormationId: "transport",
  name: "Transport",
  weaponInventory: testWeaponInventory("transport"),
  keywords: ["Transport", "Vehicle"],
  segments: [
    {
      id: "transport-model",
      savedUnitId: "transport",
      unitName: "Transport",
      modelName: "Transport",
      role: "standalone",
      wounds: 3,
      startingModels: 1,
    },
  ],
};

const passengerFormation = {
  id: "player-1:passengers",
  playerId: "player-1",
  sourceFormationId: "passengers",
  name: "Passengers",
  weaponInventory: testWeaponInventory("passengers"),
  assignedTransportFormationId: transportFormation.id,
  keywords: ["Infantry"],
  segments: [
    {
      id: "passenger-models",
      savedUnitId: "passengers",
      unitName: "Passengers",
      modelName: "Passenger",
      role: "standalone",
      wounds: 2,
      feelNoPain: 5,
      startingModels: 2,
    },
  ],
};

const mixedPassengerFormation = {
  ...passengerFormation,
  id: "player-1:mixed-passengers",
  sourceFormationId: "mixed-passengers",
  name: "Mixed Passengers",
  weaponInventory: testWeaponInventory("mixed-bodyguard"),
  segments: [
    {
      ...passengerFormation.segments[0],
      id: "mixed-bodyguard",
      savedUnitId: "mixed-bodyguard",
      modelName: "Bodyguard",
      feelNoPain: 0,
      startingModels: 1,
    },
    {
      ...passengerFormation.segments[0],
      id: "mixed-leader",
      savedUnitId: "mixed-leader",
      modelName: "Leader",
      feelNoPain: 0,
      startingModels: 1,
    },
  ],
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

function transportBattle({
  startEmbarked = true,
  firstPlayerId = "player-1",
  passenger = passengerFormation,
} = {}) {
  let state = registerBattleFormation(
    registerBattleFormation(
      registerBattleFormation(newBattle(), transportFormation, "register-transport", 1),
      passenger,
      "register-passengers",
      2,
    ),
    formation,
    "register-enemy",
    3,
  );
  state = declareFormationDeployment(
    state,
    transportFormation.id,
    "battlefield",
    {},
    "declare-transport",
    4,
  );
  state = declareFormationDeployment(
    state,
    passenger.id,
    startEmbarked ? "embarked" : "battlefield",
    startEmbarked ? { transportFormationId: transportFormation.id } : {},
    "declare-passengers",
    5,
  );
  state = declareFormationDeployment(state, formation.id, "battlefield", {}, "declare-enemy", 6);
  state = deployFormation(
    state,
    transportFormation.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-transport",
    7,
  );
  if (!startEmbarked) {
    state = deployFormation(
      state,
      formation.id,
      { placementConfirmed: true, placementReason: "Deployment zone" },
      "deploy-enemy",
      8,
    );
    state = deployFormation(
      state,
      passenger.id,
      { placementConfirmed: true, placementReason: "Deployment zone" },
      "deploy-passengers",
      9,
    );
  } else {
    state = deployFormation(
      state,
      formation.id,
      { placementConfirmed: true, placementReason: "Deployment zone" },
      "deploy-enemy",
      8,
    );
  }
  return startBattle(state, firstPlayerId, "start-transport-battle", 10);
}

function advanceTo(state, predicate, prefix) {
  let next = state;
  while (!predicate(replayBattleState(next).clock)) {
    next = advanceBattleClock(next, `${prefix}-${next.events.length}`, next.events.length + 1);
  }
  return next;
}

function recordVisibleRangedTarget(
  state,
  attackerFormationId,
  targetFormationId,
  { weaponId = "test-ranged-weapon", eligibleWeaponCount = 1 } = {},
) {
  const attacker = replayBattleState(state).formations.get(attackerFormationId);
  const inventory = attacker.weaponInventory.find((group) =>
    group.profiles.some((profile) => profile.weaponId === weaponId),
  );
  assert.ok(inventory, `Missing test inventory for ${weaponId}`);
  return recordRangedTargetEligibility(
    state,
    {
      attackerFormationId,
      targetFormationId,
      weaponId,
      weaponName: "Test ranged weapon",
      weaponSourceFormationId: attackerFormationId,
      sourceSavedUnitId: inventory.sourceSavedUnitId,
      weaponGroupId: inventory.groupId,
      publishedRangeThousandths: 24000,
      effectiveRangeThousandths: 24000,
      measuredDistanceThousandths: 12000,
      visible: true,
      fullyVisible: true,
      indirectFire: false,
      weaponHasIndirect: false,
      eligibleWeaponCount,
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Closest base or hull points and line of sight checked",
    },
    `target-eligibility-${state.events.length + 1}`,
    state.events.length + 1,
  );
}

function appendZeroDamageRangedAttack(
  state,
  {
    id = "test-ranged-attack",
    weaponId = "test-ranged-weapon",
    targetEligibilityEventId = state.events.at(-1).id,
    declaredWeaponCount = 1,
    indirectFire = false,
  } = {},
) {
  const eligibility = replayBattleState(state).targetEligibilityFacts.get(targetEligibilityEventId);
  return appendResolvedAttack(state, {
    id,
    at: state.events.length + 1,
    attackerFormationId: attackerFormation.id,
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: attackerFormation.name,
      weapon: "Test ranged weapon",
      target: formation.name,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Reviewed structured target facts",
    targetEligibilityEventId,
    weaponId,
    declaredWeaponCount,
    indirectFire,
    weaponSourceFormationId: eligibility?.weaponSourceFormationId ?? attackerFormation.id,
    sourceSavedUnitId: eligibility?.sourceSavedUnitId ?? "unit-1",
    weaponGroupId: eligibility?.weaponGroupId ?? "test-ranged-group",
  });
}

function battleWithDestroyedOccupiedTransport(passenger = passengerFormation) {
  let state = transportBattle({ firstPlayerId: "player-2", passenger });
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "destroy-helper-movement",
  );
  state = recordFormationMovement(
    state,
    formation.id,
    "stationary",
    "destroy-helper-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, (clock) => battleAttackWindow(clock), "destroy-helper-shooting");
  state = startFormationActivation(
    state,
    formation.id,
    {},
    "destroy-helper-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, formation.id, transportFormation.id);
  return appendResolvedAttack(state, {
    id: "destroy-helper-transport",
    at: state.events.length + 1,
    attackerFormationId: formation.id,
    targetFormationId: transportFormation.id,
    segmentIds: ["transport-model"],
    targets: [{ wounds: 3, modelCount: 1 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 3, modelsDestroyed: 1 },
    summary: {
      attacker: formation.name,
      weapon: "Anti-tank weapon",
      target: transportFormation.name,
      damage: 3,
      successful: 1,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible and in range",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: formation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
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

test("pins the official battle-state rules source", () => {
  assert.equal(battleRuleSources.version, 1);
  assert.deepEqual(
    battleRuleSources.sources[0].pages,
    [7, 8, 16, 17, 18, 19, 23, 26, 39, 43, 53, 57, 60],
  );
  assert.equal(
    battleRuleSources.sources[0].sha256,
    "4d0e8019cbfddd6f46781d5b4ed31d46fb21eb2d0d10a0f6fabefac0ce054364",
  );
});

test("replays reviewed range, visibility, Indirect Fire, and eligible weapon counts", () => {
  let state = registeredBattle();
  state = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: attackerFormation.id,
      targetFormationId: formation.id,
      weaponId: "indirect-weapon",
      weaponName: "Indirect weapon",
      weaponSourceFormationId: attackerFormation.id,
      sourceSavedUnitId: "unit-1",
      weaponGroupId: "test-ranged-group",
      publishedRangeThousandths: 48000,
      effectiveRangeThousandths: 48000,
      measuredDistanceThousandths: 32000,
      visible: false,
      fullyVisible: false,
      indirectFire: true,
      weaponHasIndirect: true,
      eligibleWeaponCount: 2,
      method: "uwb",
      reviewedByPlayer: true,
      reviewReason: "UWB distance reviewed; target is not visible",
    },
    "indirect-eligibility",
    state.events.length + 1,
  );
  state = appendZeroDamageRangedAttack(state, {
    weaponId: "indirect-weapon",
    targetEligibilityEventId: "indirect-eligibility",
    declaredWeaponCount: 2,
    indirectFire: true,
  });
  const fact = replayBattleState(state).targetEligibilityFacts.get("indirect-eligibility");
  assert.equal(fact.method, "uwb");
  assert.equal(fact.measuredDistanceThousandths, 32000);

  const forgedAbility = structuredClone(state);
  forgedAbility.events.find((event) => event.id === "indirect-eligibility").weaponHasIndirect =
    false;
  assert.throws(
    () => normalizeBattleState(forgedAbility),
    /weapon facts differ from the locked inventory/i,
  );

  const forgedPhase = structuredClone(state);
  forgedPhase.events.find((event) => event.id === "test-ranged-attack").clock.battleRound = 2;
  assert.throws(
    () => normalizeBattleState(forgedPhase),
    /weapon declaration is outside its recorded phase/i,
  );

  let exhausted = recordVisibleRangedTarget(state, attackerFormation.id, formation.id);
  assert.throws(
    () => appendZeroDamageRangedAttack(exhausted, { id: "exhausted-weapon-attack" }),
    /exceeds its surviving unused weapon inventory/i,
  );

  assert.throws(
    () =>
      recordRangedTargetEligibility(
        registeredBattle(),
        {
          attackerFormationId: attackerFormation.id,
          targetFormationId: formation.id,
          weaponId: "invented-weapon",
          weaponName: "Invented weapon",
          weaponSourceFormationId: attackerFormation.id,
          sourceSavedUnitId: "unit-1",
          weaponGroupId: "test-ranged-group",
          publishedRangeThousandths: 24000,
          effectiveRangeThousandths: 24000,
          measuredDistanceThousandths: 12000,
          visible: true,
          eligibleWeaponCount: 1,
          method: "manual",
          reviewedByPlayer: true,
          reviewReason: "Closest points and line of sight checked",
        },
        "invented-eligibility",
        999,
      ),
    /absent from the locked ranged inventory/i,
  );

  let outsideRange = registeredBattle();
  outsideRange = recordRangedTargetEligibility(
    outsideRange,
    {
      attackerFormationId: attackerFormation.id,
      targetFormationId: formation.id,
      weaponId: "short-weapon",
      weaponName: "Short weapon",
      weaponSourceFormationId: attackerFormation.id,
      sourceSavedUnitId: "unit-1",
      weaponGroupId: "test-ranged-group",
      publishedRangeThousandths: 12000,
      effectiveRangeThousandths: 12000,
      measuredDistanceThousandths: 12001,
      visible: true,
      eligibleWeaponCount: 1,
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Closest points measured",
    },
    "outside-range",
    outsideRange.events.length + 1,
  );
  assert.throws(
    () =>
      appendZeroDamageRangedAttack(outsideRange, {
        weaponId: "short-weapon",
        targetEligibilityEventId: "outside-range",
      }),
    /does not satisfy.*target eligibility/i,
  );

  let countLimited = registeredBattle();
  countLimited = recordVisibleRangedTarget(countLimited, attackerFormation.id, formation.id, {
    eligibleWeaponCount: 1,
  });
  assert.throws(
    () => appendZeroDamageRangedAttack(countLimited, { declaredWeaponCount: 2 }),
    /does not satisfy.*target eligibility/i,
  );

  const unreviewed = registeredBattle();
  assert.throws(
    () =>
      recordRangedTargetEligibility(
        unreviewed,
        {
          attackerFormationId: attackerFormation.id,
          targetFormationId: formation.id,
          weaponId: "unreviewed-weapon",
          weaponName: "Unreviewed weapon",
          weaponSourceFormationId: attackerFormation.id,
          sourceSavedUnitId: "unit-1",
          weaponGroupId: "test-ranged-group",
          publishedRangeThousandths: 24000,
          effectiveRangeThousandths: 24000,
          measuredDistanceThousandths: 12000,
          visible: true,
          eligibleWeaponCount: 1,
          method: "manual",
          reviewedByPlayer: true,
          reviewReason: "   ",
        },
        "blank-review",
        unreviewed.events.length + 1,
      ),
    /review must explain/i,
  );
  assert.throws(
    () =>
      recordRangedTargetEligibility(
        unreviewed,
        {
          attackerFormationId: attackerFormation.id,
          targetFormationId: formation.id,
          weaponId: "override-weapon",
          weaponName: "Override weapon",
          weaponSourceFormationId: attackerFormation.id,
          sourceSavedUnitId: "unit-1",
          weaponGroupId: "test-ranged-group",
          publishedRangeThousandths: 24000,
          effectiveRangeThousandths: 30000,
          measuredDistanceThousandths: 25000,
          visible: true,
          eligibleWeaponCount: 1,
          method: "manual",
          reviewedByPlayer: true,
          reviewReason: "Closest points measured",
          rangeOverrideReason: "   ",
        },
        "blank-override",
        unreviewed.events.length + 1,
      ),
    /override must name/i,
  );
});

test("replays starting occupancy and normal embark and disembark timing", () => {
  let state = transportBattle();
  assert.equal(
    battleFormationEmbarkedTransport(state, passengerFormation.id),
    transportFormation.id,
  );
  assert.equal(battleFormationIsOnBattlefield(state, passengerFormation.id), false);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "to-movement",
  );
  state = disembarkFormation(
    state,
    passengerFormation.id,
    transportFormation.id,
    {
      placementConfirmed: true,
      placementReason: "Wholly within 3 inches and outside Engagement Range",
    },
    "disembark",
    state.events.length + 1,
  );
  assert.equal(battleFormationEmbarkedTransport(state, passengerFormation.id), "");
  assert.equal(battleFormationIsOnBattlefield(state, passengerFormation.id), true);
  assert.throws(
    () =>
      recordFormationMovement(
        state,
        passengerFormation.id,
        "stationary",
        "illegal-stationary",
        state.events.length + 1,
      ),
    /cannot Remain Stationary/,
  );
  state = recordFormationMovement(
    state,
    passengerFormation.id,
    "normal",
    "passenger-moves",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      embarkFormation(
        state,
        passengerFormation.id,
        transportFormation.id,
        { rangeConfirmed: true, rangeReason: "Every model ended within 3 inches" },
        "same-phase-embark",
        state.events.length + 1,
      ),
    /same phase/,
  );

  state = transportBattle({ startEmbarked: false });
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "to-embark",
  );
  state = recordFormationMovement(
    state,
    passengerFormation.id,
    "advance",
    "passenger-advances",
    state.events.length + 1,
  );
  state = embarkFormation(
    state,
    passengerFormation.id,
    transportFormation.id,
    { rangeConfirmed: true, rangeReason: "Every model ended within 3 inches" },
    "embark",
    state.events.length + 1,
  );
  assert.equal(
    battleFormationEmbarkedTransport(state, passengerFormation.id),
    transportFormation.id,
  );
  assert.throws(
    () =>
      disembarkFormation(
        state,
        passengerFormation.id,
        transportFormation.id,
        { placementConfirmed: true, placementReason: "Within 3 inches" },
        "same-phase-disembark",
        state.events.length + 1,
      ),
    /started the Movement phase embarked/,
  );
});

test("inherits Transport movement restrictions after disembarking", () => {
  let state = transportBattle();
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "transport-movement",
  );
  state = recordFormationMovement(
    state,
    transportFormation.id,
    "normal",
    "transport-normal",
    state.events.length + 1,
  );
  state = disembarkFormation(
    state,
    passengerFormation.id,
    transportFormation.id,
    { placementConfirmed: true, placementReason: "Wholly within 3 inches" },
    "after-normal-disembark",
    state.events.length + 1,
  );
  assert.equal(
    replayBattleState(state).movementByFormation.get(passengerFormation.id).fromMovedTransport,
    true,
  );
  assert.throws(
    () =>
      recordFormationMovement(
        state,
        passengerFormation.id,
        "normal",
        "move-again",
        state.events.length + 1,
      ),
    /already been recorded/,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "to-charge",
  );
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        passengerFormation.id,
        [formation.id],
        true,
        7,
        {
          targetEligibilityConfirmed: true,
          targetEligibilityReason: "Target in range",
        },
        "illegal-charge",
        state.events.length + 1,
      ),
    /disembarked after movement/,
  );

  state = transportBattle();
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "transport-advance",
  );
  state = recordFormationMovement(
    state,
    transportFormation.id,
    "advance",
    "transport-advanced",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      disembarkFormation(
        state,
        passengerFormation.id,
        transportFormation.id,
        { placementConfirmed: true, placementReason: "Wholly within 3 inches" },
        "after-advance-disembark",
        state.events.length + 1,
      ),
    /Advanced or Fell Back/,
  );
});

test("resolves Emergency Disembarkation thresholds and unplaceable models", () => {
  let state = battleWithDestroyedOccupiedTransport();
  const randomValues = [2, 0];
  state = resolveDestroyedTransport(
    state,
    transportFormation.id,
    [
      {
        formationId: passengerFormation.id,
        firstSegmentId: "passenger-models",
        emergency: true,
        unplacedModels: 1,
        placementConfirmed: true,
        placementReason: "Within 6 inches; one model could not be set up",
      },
    ],
    "emergency-disembark",
    state.events.length + 1,
    () => randomValues.shift(),
    {
      deadlyDemiseResolvedConfirmed: true,
      deadlyDemiseResolutionReason: "Transport has no Deadly Demise ability",
    },
  );
  const passenger = state.events.at(-1).passengers[0];
  assert.deepEqual(passenger.rolls, [3]);
  assert.deepEqual(passenger.feelNoPainRolls, [1]);
  assert.deepEqual(passenger.summary, { damage: 3, modelsDestroyed: 1 });
  assert.deepEqual(battleFormationHealth(state, passengerFormation.id), {
    "passenger-models": { modelsRemaining: 1, woundsLost: 1 },
  });

  const pending = battleWithDestroyedOccupiedTransport();
  assert.throws(
    () =>
      resolveDestroyedTransport(
        pending,
        transportFormation.id,
        [
          {
            formationId: passengerFormation.id,
            firstSegmentId: "passenger-models",
            emergency: false,
            unplacedModels: 1,
            placementConfirmed: true,
            placementReason: "Within 3 inches",
          },
        ],
        "invalid-normal-disembark",
        pending.events.length + 1,
        () => 0,
        {
          deadlyDemiseResolvedConfirmed: true,
          deadlyDemiseResolutionReason: "Transport has no Deadly Demise ability",
        },
      ),
    /require Emergency Disembarkation/,
  );
});

test("records mixed-unit casualty allocation and Deadly Demise ordering", () => {
  const pending = battleWithDestroyedOccupiedTransport(mixedPassengerFormation);
  assert.throws(
    () =>
      resolveDestroyedTransport(
        pending,
        transportFormation.id,
        [
          {
            formationId: mixedPassengerFormation.id,
            firstSegmentId: "mixed-leader",
            emergency: false,
            unplacedModels: 0,
            placementConfirmed: true,
            placementReason: "Wholly within 3 inches",
          },
        ],
        "missing-deadly-demise-confirmation",
        pending.events.length + 1,
        () => 0,
      ),
    /Deadly Demise was resolved first or does not apply/,
  );

  const randomValues = [0, 5];
  const state = resolveDestroyedTransport(
    pending,
    transportFormation.id,
    [
      {
        formationId: mixedPassengerFormation.id,
        firstSegmentId: "mixed-leader",
        emergency: false,
        unplacedModels: 0,
        placementConfirmed: true,
        placementReason: "Wholly within 3 inches",
      },
    ],
    "mixed-allocation",
    pending.events.length + 1,
    () => randomValues.shift(),
    {
      deadlyDemiseResolvedConfirmed: true,
      deadlyDemiseResolutionReason: "Resolved before disembarkation",
    },
  );
  assert.deepEqual(battleFormationHealth(state, mixedPassengerFormation.id), {
    "mixed-bodyguard": { modelsRemaining: 1, woundsLost: 0 },
    "mixed-leader": { modelsRemaining: 1, woundsLost: 1 },
  });
  assert.equal(state.events.at(-1).passengers[0].firstSegmentId, "mixed-leader");

  const emergencyPending = battleWithDestroyedOccupiedTransport(mixedPassengerFormation);
  const emergencyState = resolveDestroyedTransport(
    emergencyPending,
    transportFormation.id,
    [
      {
        formationId: mixedPassengerFormation.id,
        firstSegmentId: "mixed-leader",
        emergency: true,
        unplacedModels: 1,
        placementConfirmed: true,
        placementReason: "Within 6 inches; one model could not be set up",
      },
    ],
    "mixed-allocation-spill",
    emergencyPending.events.length + 1,
    () => 0,
    {
      deadlyDemiseResolvedConfirmed: true,
      deadlyDemiseResolutionReason: "Resolved before disembarkation",
    },
  );
  assert.deepEqual(battleFormationHealth(emergencyState, mixedPassengerFormation.id), {
    "mixed-bodyguard": { modelsRemaining: 1, woundsLost: 1 },
    "mixed-leader": { modelsRemaining: 0, woundsLost: 0 },
  });
});

test("forces and verifies destroyed Transport disembarkation rolls", () => {
  let state = transportBattle({ firstPlayerId: "player-2" });
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "enemy-movement",
  );
  state = recordFormationMovement(
    state,
    formation.id,
    "stationary",
    "enemy-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, (clock) => battleAttackWindow(clock), "enemy-shooting");
  state = startFormationActivation(
    state,
    formation.id,
    {},
    "enemy-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, formation.id, transportFormation.id);
  state = appendResolvedAttack(state, {
    id: "destroy-transport",
    at: state.events.length + 1,
    attackerFormationId: formation.id,
    targetFormationId: transportFormation.id,
    segmentIds: ["transport-model"],
    targets: [{ wounds: 3, modelCount: 1 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 3, modelsDestroyed: 1 },
    summary: {
      attacker: formation.name,
      weapon: "Anti-tank weapon",
      target: transportFormation.name,
      damage: 3,
      successful: 1,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible and in range",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: formation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
  });
  let replayed = replayBattleState(state);
  assert.deepEqual([...replayed.pendingTransportDestructions.keys()], [transportFormation.id]);
  assert.throws(
    () => completeFormationActivation(state, "blocked-completion", state.events.length + 1),
    /must disembark immediately/,
  );
  const randomValues = [0, 3, 4];
  state = resolveDestroyedTransport(
    state,
    transportFormation.id,
    [
      {
        formationId: passengerFormation.id,
        firstSegmentId: "passenger-models",
        emergency: false,
        unplacedModels: 0,
        placementConfirmed: true,
        placementReason: "Wholly within 3 inches and outside Engagement Range",
      },
    ],
    "resolve-destroyed-transport",
    state.events.length + 1,
    () => randomValues.shift(),
    {
      deadlyDemiseResolvedConfirmed: true,
      deadlyDemiseResolutionReason: "Resolved before disembarkation",
    },
  );
  replayed = replayBattleState(state);
  const resolution = state.events.at(-1).passengers[0];
  assert.deepEqual(resolution.rolls, [1, 4]);
  assert.deepEqual(resolution.feelNoPainRolls, [5]);
  assert.deepEqual(battleFormationHealth(state, passengerFormation.id), {
    "passenger-models": { modelsRemaining: 2, woundsLost: 0 },
  });
  assert.equal(replayed.battleShockedFormations.has(passengerFormation.id), true);
  assert.equal(
    replayed.movementByFormation.get(passengerFormation.id).fromDestroyedTransport,
    true,
  );
  assert.equal(replayed.pendingTransportDestructions.size, 0);
  assert.equal(battleFormationIsOnBattlefield(state, passengerFormation.id), true);
  assert.throws(() => revertLatestAttack(state, "undo-destruction", 99), /cannot be reverted/);

  const tampered = structuredClone(state);
  tampered.events.at(-1).passengers[0].rolls[0] = 6;
  assert.throws(
    () => normalizeBattleState(tampered),
    /Feel No Pain rolls must match|does not match its recorded rolls/,
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
    /requires a replayed target eligibility measurement/i,
  );
  state = recordVisibleRangedTarget(state, attackerFormation.id, formation.id, {
    weaponId: "assault-cannon",
  });
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
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "assault-cannon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: attackerFormation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
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
  state = recordVisibleRangedTarget(state, "player-1:formation-9", formation.id, {
    weaponId: "cannon",
  });
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "cannon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: attackerFormation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
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

test("counts embarked passengers toward their Transport's Strategic Reserves limit", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), transportFormation, "register-cap-transport", 1),
    passengerFormation,
    "register-cap-passenger",
    2,
  );
  state = configureBattleMission(
    state,
    { ...replayBattleState(state).mission, pointsLimit: 1000 },
    "configure-cap-mission",
    3,
  );
  state = declareFormationDeployment(
    state,
    transportFormation.id,
    "strategic_reserves",
    {
      points: 200,
      earliestBattleRound: 2,
      eligibilityConfirmed: true,
      eligibilityReason: "Strategic Reserves",
    },
    "declare-cap-transport",
    4,
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        passengerFormation.id,
        "embarked",
        {
          points: 51,
          transportFormationId: transportFormation.id,
          eligibilityConfirmed: true,
          eligibilityReason: "Embarked in a Strategic Reserves Transport",
        },
        "declare-over-cap-passenger",
        5,
      ),
    /250 point limit/,
  );
  state = declareFormationDeployment(
    state,
    passengerFormation.id,
    "embarked",
    {
      points: 50,
      transportFormationId: transportFormation.id,
      eligibilityConfirmed: true,
      eligibilityReason: "Embarked in a Strategic Reserves Transport",
    },
    "declare-cap-passenger",
    5,
  );
  assert.equal(replayBattleState(state).deploymentByFormation.size, 2);
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
  state = recordVisibleRangedTarget(state, "player-1:formation-9", formation.id, {
    weaponId: "cannon",
  });
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "cannon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: attackerFormation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
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
