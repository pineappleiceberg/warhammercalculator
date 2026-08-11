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
  battleUnusedWeaponCount,
  battleCanResolveAttack,
  battleCanStartFormationActivation,
  changeBattleResource,
  completeFormationMovement,
  completeFormationActivation,
  configureBattleMission,
  configureBattleWeaponBearers,
  createBattleState,
  declareFormationCharge,
  declareFormationDeployment,
  deployFormation,
  disembarkFormation,
  embarkFormation,
  normalizeBattleState,
  hazardousBearerOptions,
  passFireOverwatch,
  passGoToGround,
  passHeroicIntervention,
  passFightPriority,
  registerBattleFormation,
  recordFormationCharge,
  recordHazardousTests,
  recordFormationMovement,
  recordFightMove,
  recordRangedTargetEligibility,
  replayBattleState,
  resolveHazardousDamage,
  resolveGoToGround,
  resolveHeroicIntervention,
  resolveDestroyedTransport,
  revertLatestAttack,
  scoreBattlePoints,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
  startFireOverwatch,
  startFormationMovement,
  startFormationActivation,
} from "../lib/battle-state.mjs";
import { battleAttackWindow } from "../lib/battle-clock.mjs";
import { applyFireOverwatchAttackRules } from "../lib/fire-overwatch.mjs";
import { applyGoToGroundAttackEffects } from "../lib/go-to-ground.mjs";
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
      keywords: [],
      wounds: 3,
      startingModels: 2,
    },
    {
      id: "leader",
      savedUnitId: "unit-2",
      unitName: "Leader",
      modelName: "Leader",
      role: "leader",
      keywords: ["Character"],
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

function hazardousFormation(source, id = source.id) {
  return {
    ...source,
    id,
    weaponInventory: source.weaponInventory.map((group) => ({
      ...group,
      profiles: group.profiles.map((profile) => ({
        ...profile,
        hasHazardous: Boolean(profile.hasHazardous) || profile.weaponId === "test-ranged-weapon",
      })),
    })),
  };
}

function successfulChargeOptions(targetFormationId, overrides = {}) {
  return {
    successful: true,
    rolls: [3, 4],
    rollModifier: 0,
    chargeDistanceThousandths: 7000,
    targetFacts: [
      {
        formationId: targetFormationId,
        startDistanceThousandths: 8000,
        endsWithinEngagementRange: true,
      },
    ],
    phaseStartEligibilityConfirmed: true,
    phaseStartEligibilityReason: "Within 12 inches at the start of the Charge phase",
    startedOutsideEngagementRange: true,
    maximumModelMoveThousandths: 7000,
    unitCoherencyConfirmed: true,
    nonTargetEngagementRangeAvoided: true,
    allModelsCloserToTarget: true,
    baseContactMaximized: true,
    movementReviewedByPlayer: true,
    movementReviewReason: "Player reviewed every model endpoint",
    failureReason: "",
    ...overrides,
  };
}

function enemyFightMoveOptions(stage, overrides = {}) {
  return {
    destination: "enemy",
    maximumModelMoveThousandths: 3000,
    movementReviewedByPlayer: true,
    movementReviewReason: `Player reviewed the ${stage} endpoints`,
    baseContactModelsStationary: true,
    unitCoherencyConfirmed: true,
    endsWithinEngagementRange: true,
    allMovedModelsCloserToEnemy: true,
    baseContactMaximized: true,
    enemyDestinationImpossible: false,
    objectiveId: "",
    endsWithinObjectiveRange: false,
    allMovedModelsCloserToObjective: false,
    objectiveDestinationImpossible: false,
    outcomeReason: "",
    meleeAttacksCompleteConfirmed: stage === "consolidation",
    meleeAttacksCompletionReason:
      stage === "consolidation" ? "All eligible melee attacks were resolved" : "",
    ...overrides,
  };
}

function noFightMoveOptions(stage) {
  return {
    destination: "none",
    maximumModelMoveThousandths: 0,
    movementReviewedByPlayer: true,
    movementReviewReason: `Player reviewed the ${stage} endpoints`,
    baseContactModelsStationary: true,
    unitCoherencyConfirmed: false,
    endsWithinEngagementRange: false,
    allMovedModelsCloserToEnemy: false,
    baseContactMaximized: false,
    enemyDestinationImpossible: true,
    objectiveId: "",
    endsWithinObjectiveRange: false,
    allMovedModelsCloserToObjective: false,
    objectiveDestinationImpossible: stage === "consolidation",
    outcomeReason:
      stage === "pile_in"
        ? "No coherent endpoint within Engagement Range exists"
        : "No enemy or objective destination is possible",
    meleeAttacksCompleteConfirmed: stage === "consolidation",
    meleeAttacksCompletionReason:
      stage === "consolidation" ? "No eligible melee targets remained" : "",
  };
}

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

test("applies Go to Ground cover and a best-of 6+ invulnerable save to every model", () => {
  const profiles = [
    { targetCover: false, ignoresCover: false },
    { targetCover: false, ignoresCover: true },
  ];
  const targetProfiles = [
    { invulnerable: 0, modelCount: 2 },
    { invulnerable: 4, modelCount: 1 },
  ];
  const applied = applyGoToGroundAttackEffects(profiles, targetProfiles, true);
  assert.deepEqual(
    applied.attackProfiles.map((profile) => [profile.targetCover, profile.ignoresCover]),
    [
      [true, false],
      [true, true],
    ],
  );
  assert.deepEqual(
    applied.targets.map((target) => target.invulnerable),
    [6, 4],
  );
  assert.deepEqual(applyGoToGroundAttackEffects(profiles, targetProfiles, false), {
    attackProfiles: profiles,
    targets: targetProfiles,
  });
});

test("pins the official battle-state rules source", () => {
  assert.equal(battleRuleSources.version, 1);
  assert.deepEqual(
    battleRuleSources.sources[0].pages,
    [7, 8, 9, 16, 17, 18, 19, 23, 25, 26, 29, 32, 33, 34, 35, 39, 41, 42, 43, 44, 53, 57, 60],
  );
  assert.equal(
    battleRuleSources.sources[0].sha256,
    "4d0e8019cbfddd6f46781d5b4ed31d46fb21eb2d0d10a0f6fabefac0ce054364",
  );
  const updates = battleRuleSources.sources.find(
    (source) => source.id === "core-rules-updates-10e-2025-10",
  );
  assert.ok(updates);
  assert.deepEqual(updates.pages, [7, 8, 10, 18]);
  assert.equal(updates.sha256, "27960a4d4affecd450af69c54d7583bcc2941b00ba5845f5786a630bdec7f4ba");
  assert.equal(
    updates.usedFor.some((usage) => /Heroic Intervention/i.test(usage)),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /Go to Ground/i.test(usage) && /6\+ invulnerable/i.test(usage),
    ),
    true,
  );
  assert.equal(
    updates.usedFor.some(
      (usage) =>
        /Fire Overwatch/i.test(usage) && /unmodified 6/i.test(usage) && /Firing Deck/i.test(usage),
    ),
    true,
  );
  assert.equal(
    updates.usedFor.some(
      (usage) =>
        /Hazardous/i.test(usage) && /bearer priority/i.test(usage) && /spillover/i.test(usage),
    ),
    true,
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

test("requires exact optional bearers and reshapes casualties by reviewed loadout", () => {
  const optional = {
    id: "player-2:optional-bearers",
    playerId: "player-2",
    sourceFormationId: "optional-bearers",
    name: "Optional Bearers",
    weaponInventory: [
      {
        ...testWeaponInventory("optional-unit")[0],
        count: 1,
      },
    ],
    segments: [
      {
        id: "optional-models",
        savedUnitId: "optional-unit",
        unitName: "Optional Bearers",
        modelName: "Warrior",
        role: "standalone",
        wounds: 2,
        startingModels: 3,
      },
    ],
  };
  let state = registerBattleFormation(newBattle(), optional, "register-optional", 1);
  let replayed = replayBattleState(state);
  const initial = replayed.formations.get(optional.id);
  const group = initial.weaponInventory[0];
  assert.equal(group.bearerAssignmentsReviewed, false);
  assert.equal(initial.segments.length, 2);

  state = deployAllOnBattlefield(state);
  assert.throws(
    () => startBattle(state, "player-2", "blocked-start", 2),
    /confirm every optional weapon bearer/i,
  );

  const selectedBearer = initial.modelInstances[1].id;
  state = configureBattleWeaponBearers(
    state,
    optional.id,
    "optional-unit",
    "test-ranged-group",
    [selectedBearer],
    "confirm-bearer",
    3,
  );
  replayed = replayBattleState(state);
  const configured = replayed.formations.get(optional.id);
  assert.equal(configured.weaponInventory[0].bearerAssignmentsReviewed, true);
  assert.deepEqual(
    configured.segments.find((segment) => segment.weaponCopies.length > 0).modelIds,
    [selectedBearer],
  );
  assert.doesNotThrow(() => startBattle(state, "player-2", "start-exact", 4));
  assert.throws(
    () =>
      configureBattleWeaponBearers(
        state,
        optional.id,
        "optional-unit",
        "test-ranged-group",
        ["foreign-model"],
        "bad-bearer",
        5,
      ),
    /must belong to its source saved unit/i,
  );
});

test("removes exact weapon copies with their casualty loadout", () => {
  let state = registeredBattle();
  state = recordVisibleRangedTarget(state, attackerFormation.id, formation.id);
  state = appendResolvedAttack(state, {
    id: "destroy-one-bearer",
    at: state.events.length + 1,
    attackerFormationId: attackerFormation.id,
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 3, modelsDestroyed: 1 },
    summary: {
      attacker: attackerFormation.name,
      weapon: "Test ranged weapon",
      target: formation.name,
      damage: 3,
      successful: 1,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Reviewed structured target facts",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: attackerFormation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
  });
  assert.equal(battleUnusedWeaponCount(state, formation.id, "unit-1", "test-ranged-group"), 1);
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
  state = passFireOverwatch(
    state,
    "No eligible Overwatch response",
    "disembark-overwatch-pass",
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
  state = passFireOverwatch(
    state,
    "No eligible Overwatch response",
    "moved-disembark-overwatch-pass",
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
        successfulChargeOptions(formation.id),
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

test("resolves Go to Ground after target selection with atomic CP and phase effects", () => {
  const infantryTarget = { ...formation, keywords: ["Infantry"] };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "gtg-register-attacker", 1),
    infantryTarget,
    "gtg-register-target",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Go to Ground test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 2 },
      objectives: [],
    },
    "gtg-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "gtg-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "gtg-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "gtg-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "gtg-to-shooting");
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "gtg-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, attackerFormation.id, infantryTarget.id, {
    eligibleWeaponCount: 2,
  });
  let replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround.targetFormationId, infantryTarget.id);
  assert.equal(replayed.readyRangedAttack, null);
  assert.throws(() => appendZeroDamageRangedAttack(state), /Go to Ground window/i);

  state = resolveGoToGround(state, "gtg-resolve", state.events.length + 1);
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 1);
  assert.equal(replayed.pendingGoToGround, null);
  assert.equal(replayed.readyRangedAttack.triggerEventId, state.events.at(-2).id);
  assert.deepEqual(replayed.activeGoToGroundEffects[0], {
    id: "gtg-resolve",
    name: "Go to Ground",
    targetFormationId: infantryTarget.id,
    ownerPlayerId: "player-2",
    triggerEventId: state.events.at(-2).id,
    duration: "end_of_phase",
    appliedAt: replayed.clock,
    invulnerableSave: 6,
    benefitOfCover: true,
  });
  state = appendZeroDamageRangedAttack(state, {
    id: "gtg-first-attack",
    targetEligibilityEventId: replayed.readyRangedAttack.triggerEventId,
  });
  assert.equal(replayBattleState(state).readyRangedAttack, null);

  state = recordVisibleRangedTarget(state, attackerFormation.id, infantryTarget.id);
  replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround, null);
  assert.equal(replayed.readyRangedAttack.goToGroundEffectId, "gtg-resolve");
  state = appendZeroDamageRangedAttack(state, {
    id: "gtg-second-attack",
    targetEligibilityEventId: replayed.readyRangedAttack.triggerEventId,
  });
  state = completeFormationActivation(state, "gtg-complete", state.events.length + 1);
  state = advanceTo(state, (clock) => clock.phase !== "shooting", "gtg-expire");
  assert.equal(replayBattleState(state).activeGoToGroundEffects.length, 0);

  const tampered = structuredClone(state);
  const resolution = tampered.events.find((event) => event.type === "go_to_ground_resolved");
  resolution.allModelsHaveBenefitOfCover = false;
  assert.throws(() => normalizeBattleState(tampered), /Go to Ground facts/i);
});

test("passes Go to Ground and binds the attack to the reviewed target declaration", () => {
  const infantryTarget = { ...formation, keywords: ["Infantry"] };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "gtg-pass-attacker", 1),
    infantryTarget,
    "gtg-pass-target",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Go to Ground pass test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "gtg-pass-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "gtg-pass-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "gtg-pass-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "gtg-pass-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "gtg-pass-to-shooting");
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "gtg-pass-activation",
    state.events.length + 1,
  );
  const battleShocked = setFormationBattleShocked(
    state,
    infantryTarget.id,
    true,
    "Failed Battle-shock test",
    "gtg-battle-shocked",
    state.events.length + 1,
  );
  const battleShockedTargeted = recordVisibleRangedTarget(
    battleShocked,
    attackerFormation.id,
    infantryTarget.id,
  );
  assert.equal(replayBattleState(battleShockedTargeted).pendingGoToGround, null);
  state = recordVisibleRangedTarget(state, attackerFormation.id, infantryTarget.id);
  const triggerEventId = state.events.at(-1).id;
  state = passGoToGround(
    state,
    "Defending player declined the Stratagem",
    "gtg-pass",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).readyRangedAttack.triggerEventId, triggerEventId);
  assert.throws(
    () =>
      appendZeroDamageRangedAttack(state, {
        id: "gtg-wrong-declaration",
        targetEligibilityEventId: "not-the-trigger",
      }),
    /target eligibility|reaction window/i,
  );
  state = appendZeroDamageRangedAttack(state, {
    id: "gtg-passed-attack",
    targetEligibilityEventId: triggerEventId,
  });
  assert.equal(replayBattleState(state).goToGroundPasses.length, 1);
  state = recordVisibleRangedTarget(state, attackerFormation.id, infantryTarget.id);
  assert.equal(replayBattleState(state).pendingGoToGround, null);
  assert.equal(replayBattleState(state).readyRangedAttack.triggerEventId, state.events.at(-1).id);
});

test("resolves Fire Overwatch at a move trigger with atomic CP and target locking", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "overwatch-register-mover", 1),
    formation,
    "overwatch-register-shooter",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Fire Overwatch test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 2 },
      objectives: [],
    },
    "overwatch-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "overwatch-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "overwatch-to-movement",
  );
  state = startFormationMovement(
    state,
    attackerFormation.id,
    "normal",
    "overwatch-move-start",
    state.events.length + 1,
  );
  let replayed = replayBattleState(state);
  assert.deepEqual(
    {
      trigger: replayed.pendingFireOverwatch.trigger,
      targetFormationId: replayed.pendingFireOverwatch.targetFormationId,
      responderPlayerId: replayed.pendingFireOverwatch.responderPlayerId,
    },
    {
      trigger: "normal_move_start",
      targetFormationId: attackerFormation.id,
      responderPlayerId: "player-2",
    },
  );
  assert.throws(
    () =>
      completeFormationMovement(
        state,
        attackerFormation.id,
        "normal",
        "overwatch-move-too-early",
        state.events.length + 1,
      ),
    /Fire Overwatch (response|window)/i,
  );
  assert.throws(
    () =>
      startFireOverwatch(
        state,
        formation.id,
        {
          distanceThousandths: 12000,
          targetVisible: false,
          shootingEligibilityConfirmed: true,
          shootingEligibilityReason: "Eligible to shoot in the Shooting phase",
          outOfPhaseRestrictionsConfirmed: true,
          outOfPhaseRestrictionsReason: "Shooting-phase-only rules and Firing Deck excluded",
        },
        "overwatch-hidden",
        state.events.length + 1,
      ),
    /legal reviewed reaction/i,
  );
  state = startFireOverwatch(
    state,
    formation.id,
    {
      distanceThousandths: 12000,
      targetVisible: true,
      shootingEligibilityConfirmed: true,
      shootingEligibilityReason: "Eligible to shoot in the Shooting phase",
      outOfPhaseRestrictionsConfirmed: true,
      outOfPhaseRestrictionsReason: "Shooting-phase-only rules and Firing Deck excluded",
    },
    "overwatch-activation",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 1);
  assert.equal(replayed.activeActivation.source, "fire_overwatch");
  assert.equal(replayed.activeActivation.targetFormationId, attackerFormation.id);
  assert.equal(
    battleCanResolveAttack(state, formation.id, {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
      targetFormationId: attackerFormation.id,
    }),
    true,
  );
  state = recordVisibleRangedTarget(state, formation.id, attackerFormation.id);
  const eligibilityId = state.events.at(-1).id;
  state = appendResolvedAttack(state, {
    id: "overwatch-attack",
    at: state.events.length + 1,
    attackerFormationId: formation.id,
    targetFormationId: attackerFormation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: formation.name,
      weapon: "Test ranged weapon",
      target: attackerFormation.name,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible triggering unit within 24 inches",
    targetEligibilityEventId: eligibilityId,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: formation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
  });
  assert.equal(replayBattleState(state).activeActivation.attackCount, 1);
  state = completeFormationActivation(state, "overwatch-complete", state.events.length + 1);
  state = completeFormationMovement(
    state,
    attackerFormation.id,
    "normal",
    "overwatch-move-end",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingFireOverwatch.trigger, "normal_move_end");
  assert.throws(
    () =>
      startFireOverwatch(
        state,
        formation.id,
        {
          distanceThousandths: 10000,
          targetVisible: true,
          shootingEligibilityConfirmed: true,
          shootingEligibilityReason: "Eligible to shoot in the Shooting phase",
          outOfPhaseRestrictionsConfirmed: true,
          outOfPhaseRestrictionsReason: "Out-of-phase restrictions reviewed",
        },
        "overwatch-repeat",
        state.events.length + 1,
      ),
    /already been used this turn/i,
  );
  state = passFireOverwatch(
    state,
    "Fire Overwatch was already used this turn",
    "overwatch-end-pass",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingFireOverwatch, null);
});

test("records exact Hazardous tests and applies non-spilling bearer damage", () => {
  const shooter = hazardousFormation({
    ...attackerFormation,
    weaponInventory: [
      {
        ...attackerFormation.weaponInventory[0],
        sourceSavedUnitId: "unit-2",
        count: 1,
      },
      {
        sourceSavedUnitId: "unit-1",
        groupId: "unused-hazardous-group",
        name: "Unused hazardous weapon",
        count: 2,
        profiles: [
          {
            weaponId: "unused-hazardous-weapon",
            name: "Unused hazardous weapon",
            type: "Ranged",
            publishedRangeThousandths: 24000,
            hasAssault: false,
            hasIndirect: false,
            hasHazardous: true,
          },
        ],
      },
    ],
  });
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), shooter, "hazard-register-shooter", 1),
    formation,
    "hazard-register-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "hazard-start", 3);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "hazard-to-movement",
  );
  state = recordFormationMovement(
    state,
    shooter.id,
    "stationary",
    "hazard-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "hazard-to-shooting");
  state = startFormationActivation(
    state,
    shooter.id,
    {},
    "hazard-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, shooter.id, formation.id);
  state = appendResolvedAttack(state, {
    id: "hazard-attack",
    at: state.events.length + 1,
    attackerFormationId: shooter.id,
    targetFormationId: formation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: shooter.name,
      weapon: "Test ranged weapon",
      target: formation.name,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible and in Range",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: shooter.id,
    sourceSavedUnitId: "unit-2",
    weaponGroupId: "test-ranged-group",
  });
  assert.equal(replayBattleState(state).activeActivation.hazardousTestCount, 1);
  assert.throws(
    () => completeFormationActivation(state, "hazard-too-early", state.events.length + 1),
    /Hazardous test/i,
  );
  state = recordHazardousTests(
    state,
    [{ initialRoll: 1, reroll: 0, rerollReason: "" }],
    "hazard-tests",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingHazardous.due, true);
  assert.deepEqual(
    hazardousBearerOptions(state).map((candidate) => candidate.id),
    ["bodyguard"],
  );
  state = resolveHazardousDamage(
    state,
    {
      selectedSegmentId: "bodyguard",
      feelNoPainRolls: [],
      selectionReason: "Controlling player selected an eligible non-Character bearer",
    },
    "hazard-damage",
    state.events.length + 1,
  );
  assert.deepEqual(battleFormationHealth(state, shooter.id).bodyguard, {
    modelsRemaining: 1,
    woundsLost: 0,
  });
  assert.equal(replayBattleState(state).pendingHazardous, null);
  state = completeFormationActivation(state, "hazard-complete", state.events.length + 1);
  assert.equal(replayBattleState(state).activeActivation, null);

  const tampered = structuredClone(state);
  tampered.events.find((event) => event.id === "hazard-damage").summary.damage = 2;
  assert.throws(() => normalizeBattleState(tampered), /Hazardous mortal wounds/i);
});

test("rejects Fire Overwatch when the selected unit has no surviving ranged weapon", () => {
  const unarmed = {
    ...formation,
    id: "player-2:unarmed",
    sourceFormationId: "unarmed",
    name: "Unarmed formation",
    weaponInventory: [],
  };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "unarmed-register-mover", 1),
    unarmed,
    "unarmed-register-responder",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Unarmed Overwatch test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "unarmed-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "unarmed-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "unarmed-to-movement",
  );
  state = startFormationMovement(
    state,
    attackerFormation.id,
    "normal",
    "unarmed-move-start",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      startFireOverwatch(
        state,
        unarmed.id,
        {
          distanceThousandths: 12000,
          targetVisible: true,
          shootingEligibilityConfirmed: true,
          shootingEligibilityReason: "Claimed eligibility",
          outOfPhaseRestrictionsConfirmed: true,
          outOfPhaseRestrictionsReason: "Restrictions reviewed",
        },
        "unarmed-overwatch",
        state.events.length + 1,
      ),
    /surviving ranged weapon/i,
  );
});

test("opens Fire Overwatch immediately after a reviewed charge declaration", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "charge-window-attacker", 1),
    formation,
    "charge-window-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "charge-window-start", 3);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "charge-window-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "charge-window-stationary",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "charge-window-to-charge",
  );
  state = declareFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    {
      targetFacts: [{ formationId: formation.id, startDistanceThousandths: 8000 }],
      phaseStartEligibilityConfirmed: true,
      phaseStartEligibilityReason: "Eligible at the start of the Charge phase",
      startedOutsideEngagementRange: true,
    },
    "charge-window-declared",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingFireOverwatch.trigger, "charge_declared");
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        attackerFormation.id,
        [formation.id],
        successfulChargeOptions(formation.id),
        "charge-window-premature-roll",
        state.events.length + 1,
      ),
    /Fire Overwatch (response|window)/i,
  );
  state = passFireOverwatch(
    state,
    "The responding player declined Fire Overwatch",
    "charge-window-pass",
    state.events.length + 1,
  );
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id),
    "charge-window-resolved",
    state.events.length + 1,
  );
  assert.equal(
    replayBattleState(state).chargeByFormation.get(attackerFormation.id).successful,
    true,
  );
});

test("defers Fire Overwatch Hazardous damage until the charging unit ends its Charge move", () => {
  const shooter = hazardousFormation(formation);
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "deferred-register-charger", 1),
    shooter,
    "deferred-register-shooter",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Deferred Hazardous test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "deferred-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "deferred-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "deferred-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "deferred-stationary",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "deferred-to-charge",
  );
  state = declareFormationCharge(
    state,
    attackerFormation.id,
    [shooter.id],
    {
      targetFacts: [{ formationId: shooter.id, startDistanceThousandths: 8000 }],
      phaseStartEligibilityConfirmed: true,
      phaseStartEligibilityReason: "Eligible at the start of the Charge phase",
      startedOutsideEngagementRange: true,
    },
    "deferred-charge-declared",
    state.events.length + 1,
  );
  state = startFireOverwatch(
    state,
    shooter.id,
    {
      distanceThousandths: 8000,
      targetVisible: true,
      shootingEligibilityConfirmed: true,
      shootingEligibilityReason: "Eligible to shoot if it were the Shooting phase",
      outOfPhaseRestrictionsConfirmed: true,
      outOfPhaseRestrictionsReason: "Shooting-phase-only rules and Firing Deck excluded",
    },
    "deferred-overwatch",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, shooter.id, attackerFormation.id);
  state = appendResolvedAttack(state, {
    id: "deferred-overwatch-attack",
    at: state.events.length + 1,
    attackerFormationId: shooter.id,
    targetFormationId: attackerFormation.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: shooter.name,
      weapon: "Test ranged weapon",
      target: attackerFormation.name,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible triggering charger within 24 inches",
    targetEligibilityEventId: state.events.at(-1).id,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: shooter.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
  });
  state = recordHazardousTests(
    state,
    [{ initialRoll: 1, reroll: 0, rerollReason: "" }],
    "deferred-tests",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingHazardous.due, false);
  assert.throws(
    () =>
      resolveHazardousDamage(
        state,
        { selectedSegmentId: "bodyguard", selectionReason: "Too early" },
        "deferred-too-early",
        state.events.length + 1,
      ),
    /ready to resolve/i,
  );
  state = completeFormationActivation(
    state,
    "deferred-overwatch-complete",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingHazardous.due, false);
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [shooter.id],
    successfulChargeOptions(shooter.id),
    "deferred-charge-resolved",
    state.events.length + 1,
  );
  let replayed = replayBattleState(state);
  assert.equal(replayed.pendingHazardous.due, true);
  assert.equal(replayed.pendingHeroicIntervention.triggerChargeEventId, "deferred-charge-resolved");
  const heroicFirst = passHeroicIntervention(
    state,
    "Active player chose to resolve Heroic Intervention before Hazardous damage",
    "deferred-heroic-first",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(heroicFirst).pendingHeroicIntervention, null);
  assert.equal(replayBattleState(heroicFirst).pendingHazardous.due, true);
  state = resolveHazardousDamage(
    state,
    {
      selectedSegmentId: "bodyguard",
      feelNoPainRolls: [],
      selectionReason: "Controlling player selected an eligible non-Character bearer",
    },
    "deferred-damage",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.pendingHazardous, null);
  assert.equal(replayed.pendingHeroicIntervention.triggerChargeEventId, "deferred-charge-resolved");
  assert.equal(battleFormationHealth(state, shooter.id).bodyguard.modelsRemaining, 1);
});

test("forces Fire Overwatch hit and critical thresholds without discarding weapon rules", () => {
  const profile = applyFireOverwatchAttackRules({
    hitOn: 2,
    hitModifier: 1,
    heavyActive: true,
    indirect: true,
    criticalHits: 5,
    sustainedHits: 2,
    lethalHits: true,
    rerollHits: "ones",
    torrent: false,
  });
  assert.deepEqual(profile, {
    hitOn: 6,
    hitModifier: 0,
    heavyActive: false,
    indirect: false,
    criticalHits: 6,
    sustainedHits: 2,
    lethalHits: true,
    rerollHits: "ones",
    torrent: false,
  });
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
        {},
        "illegal-charge",
        state.events.length + 1,
      ),
    /two D6 rolls/i,
  );
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        attackerFormation.id,
        [formation.id],
        successfulChargeOptions(formation.id, {
          maximumModelMoveThousandths: 8000,
          eligibilityOverride: true,
          overrideReason: "Army rule permits charging after Advance",
        }),
        "overlong-charge",
        state.events.length + 1,
      ),
    /legal resolution/i,
  );
  const failedCharge = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id, {
      successful: false,
      targetFacts: [
        {
          formationId: formation.id,
          startDistanceThousandths: 8000,
          endsWithinEngagementRange: false,
        },
      ],
      maximumModelMoveThousandths: 0,
      unitCoherencyConfirmed: false,
      nonTargetEngagementRangeAvoided: false,
      allModelsCloserToTarget: false,
      baseContactMaximized: false,
      failureReason: "The rolled distance could not produce a coherent endpoint",
      eligibilityOverride: true,
      overrideReason: "Army rule permits charging after Advance",
    }),
    "failed-charge",
    state.events.length + 1,
  );
  assert.equal(
    replayBattleState(failedCharge).chargeByFormation.get(attackerFormation.id).successful,
    false,
  );
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id, {
      eligibilityOverride: true,
      overrideReason: "Army rule permits charging after Advance",
    }),
    "charge",
    state.events.length + 1,
  );
  state = passHeroicIntervention(
    state,
    "The defending player declines Heroic Intervention",
    "pass-heroic-intervention",
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
  let strandedState = recordFightMove(
    state,
    "pile_in",
    noFightMoveOptions("pile_in"),
    "stranded-pile-in",
    state.events.length + 1,
  );
  assert.equal(
    battleCanResolveAttack(strandedState, attackerFormation.id, { weaponType: "Melee" }),
    false,
  );
  strandedState = recordFightMove(
    strandedState,
    "consolidation",
    noFightMoveOptions("consolidation"),
    "stranded-consolidation",
    strandedState.events.length + 1,
  );
  assert.doesNotThrow(() =>
    completeFormationActivation(
      strandedState,
      "stranded-fight-complete",
      strandedState.events.length + 1,
    ),
  );
  assert.throws(
    () => completeFormationActivation(state, "early-fight-complete", state.events.length + 1),
    /Pile In and Consolidation/i,
  );
  assert.throws(
    () =>
      recordFightMove(
        state,
        "consolidation",
        enemyFightMoveOptions("consolidation"),
        "early-consolidation",
        state.events.length + 1,
      ),
    /Pile In first/i,
  );
  state = recordFightMove(
    state,
    "pile_in",
    enemyFightMoveOptions("pile_in"),
    "pile-in",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).activeActivation.pileIn.destination, "enemy");
  state = recordFightMove(
    state,
    "consolidation",
    enemyFightMoveOptions("consolidation"),
    "consolidation",
    state.events.length + 1,
  );
  state = completeFormationActivation(state, "fight-complete", state.events.length + 1);
  assert.equal(replayBattleState(state).clock.priorityPlayerId, "player-2");
});

test("resolves the immediate Heroic Intervention window without granting Charge Bonus", () => {
  const intervenor = {
    ...formation,
    id: "player-2:intervenor",
    sourceFormationId: "intervenor",
    name: "Intervening unit",
    keywords: ["Infantry"],
  };
  const nonWalkerVehicle = {
    ...intervenor,
    id: "player-2:non-walker-vehicle",
    sourceFormationId: "non-walker-vehicle",
    name: "Non-Walker Vehicle",
    keywords: ["Vehicle"],
  };
  let state = registerBattleFormation(
    registerBattleFormation(
      registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
      formation,
      "register-target",
      2,
    ),
    intervenor,
    "register-intervenor",
    3,
  );
  state = registerBattleFormation(state, nonWalkerVehicle, "register-non-walker", 4);
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "to-heroic-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "heroic-trigger-stationary",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "to-heroic-window",
  );
  state = setFormationBattleShocked(
    state,
    intervenor.id,
    true,
    "Failed Battle-shock test",
    "battle-shock-intervenor",
    state.events.length + 1,
  );
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id),
    "trigger-charge",
    state.events.length + 1,
  );
  const pending = replayBattleState(state).pendingHeroicIntervention;
  assert.equal(pending.triggerChargeEventId, "trigger-charge");
  assert.equal(pending.chargingFormationId, attackerFormation.id);
  assert.equal(pending.responderPlayerId, "player-2");
  assert.throws(
    () => advanceBattleClock(state, "blocked-clock", state.events.length + 1),
    /Heroic Intervention window/i,
  );
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        intervenor.id,
        [attackerFormation.id],
        successfulChargeOptions(attackerFormation.id),
        "ordinary-charge-during-window",
        state.events.length + 1,
      ),
    /Heroic Intervention/i,
  );
  const heroicOptions = {
    successful: true,
    rolls: [3, 4],
    rollModifier: 0,
    chargeDistanceThousandths: 7000,
    startDistanceThousandths: 6000,
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Within 6 inches and eligible to charge the triggering unit",
    startedOutsideEngagementRange: true,
    maximumModelMoveThousandths: 5000,
    endsWithinEngagementRange: true,
    unitCoherencyConfirmed: true,
    nonTargetEngagementRangeAvoided: true,
    allModelsCloserToTarget: true,
    baseContactMaximized: true,
    movementReviewedByPlayer: true,
    movementReviewReason: "Player reviewed every model endpoint",
  };
  assert.throws(
    () =>
      resolveHeroicIntervention(
        state,
        nonWalkerVehicle.id,
        heroicOptions,
        "non-walker-intervention",
        state.events.length + 1,
      ),
    /Walker Vehicle/i,
  );
  assert.throws(
    () =>
      resolveHeroicIntervention(
        state,
        intervenor.id,
        heroicOptions,
        "battle-shocked-without-override",
        state.events.length + 1,
      ),
    /source-rule override/i,
  );
  state = resolveHeroicIntervention(
    state,
    intervenor.id,
    {
      ...heroicOptions,
      stratagemEligibilityOverrideReason: "Source rule permits this Battle-shocked unit to use it",
    },
    "resolve-heroic-intervention",
    state.events.length + 1,
  );
  let replayed = replayBattleState(state);
  assert.equal(replayed.pendingHeroicIntervention, null);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 0);
  assert.equal(replayed.heroicInterventions.length, 1);
  assert.equal(replayed.heroicInterventions[0].source, "heroic_intervention");
  assert.equal(replayed.heroicInterventions[0].receivesChargeBonus, false);
  assert.equal(replayed.chargeByFormation.get(intervenor.id).successful, true);
  state = advanceTo(
    state,
    (clock) => clock.phase === "fight" && clock.step === "fights_first",
    "to-heroic-fight",
  );
  assert.equal(
    battleCanStartFormationActivation(state, intervenor.id, { weaponType: "Melee" }),
    false,
  );
  state = advanceBattleClock(state, "to-remaining-combat", state.events.length + 1);
  assert.equal(replayBattleState(state).clock.step, "remaining_combats");
  assert.equal(
    battleCanStartFormationActivation(state, intervenor.id, { weaponType: "Melee" }),
    true,
  );
});

test("rejects an Aircraft charge without an explicit rules override", () => {
  const aircraft = { ...attackerFormation, keywords: ["Aircraft", "Vehicle"] };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), aircraft, "register-aircraft", 1),
    formation,
    "register-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start", 3);
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "to-aircraft-charge",
  );
  assert.throws(
    () =>
      recordFormationCharge(
        state,
        aircraft.id,
        [formation.id],
        successfulChargeOptions(formation.id),
        "aircraft-charge",
        state.events.length + 1,
      ),
    /Aircraft formation requires an explicit rule override/i,
  );
  state = recordFormationCharge(
    state,
    aircraft.id,
    [formation.id],
    successfulChargeOptions(formation.id, {
      eligibilityOverride: true,
      overrideReason: "Specific source rule overrides Aircraft charge eligibility",
    }),
    "overridden-aircraft-charge",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).chargeByFormation.get(aircraft.id).successful, true);
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
