import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { targetSequenceState } from "../lib/allocation.mjs";
import {
  activeBattleAttacks,
  advanceBattleClock,
  appendResolvedAttack as appendResolvedAttackEvent,
  battleEmbarkationOptions,
  battleInitialDeploymentRules,
  battleFormationEmbarkedTransport,
  arriveFromReserves,
  battleFormationIsOnBattlefield,
  battleFormationHealth,
  battleTransportOccupancy,
  battleUnusedWeaponCount,
  battleCanDeclareRangedAttack,
  battleCanResolveAttack,
  battleCanStartFormationActivation,
  battleWaaaghState,
  battleGrimResolveFormationFacts,
  battleGrimResolveState,
  battleOathOfMomentAttackFacts,
  battleOathOfMomentState,
  battleReanimationProtocolsState,
  battleShadowInTheWarpState,
  callWaaagh,
  activateReanimationProtocols,
  changeBattleResource,
  clearBattleObjectiveControlOverride,
  closeRangedTargetDeclarations,
  completeFormationMovement,
  completeFormationActivation,
  configureSecondaryMissionPlan,
  configureBattleMission,
  configureBattleWeaponBearers,
  createBattleState,
  declareFormationCharge,
  declareFormationDeployment,
  deployFormation,
  disembarkFormation,
  drawSecondaryMissionCard,
  embarkFormation,
  normalizeBattleState,
  hazardousBearerOptions,
  passFireOverwatch,
  passGoToGround,
  passRapidIngress,
  passSmokescreen,
  passHeroicIntervention,
  passFightPriority,
  passCounterOffensive,
  registerBattleFormation,
  recordFormationCharge,
  recordHazardousTests,
  recordFormationMovement,
  recordFightMove,
  recordRangedTargetEligibility,
  retractRangedTargetDeclaration,
  replayBattleState,
  resolveNewOrders,
  resolveSecondaryTurnEnd,
  resolveHazardousDamage,
  resolveMissionAction,
  resolveGoToGround,
  resolveRapidIngress,
  resolveReanimationWound,
  resolveShadowInTheWarpTest,
  resolveSmokescreen,
  resolveHeroicIntervention,
  resolveCounterOffensive,
  resolveDestroyedTransport,
  revertLatestAttack,
  scoreBattlePoints,
  scoreMissionPoints,
  scoreSecondaryMissionCard,
  selectGrimResolveFormation,
  selectOathOfMomentTarget,
  unleashShadowInTheWarp,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
  startMissionAction,
  startFireOverwatch,
  startFormationMovement,
  startFormationActivation,
} from "../lib/battle-state.mjs";
import { battleAttackWindow } from "../lib/battle-clock.mjs";
import { applyFireOverwatchAttackRules } from "../lib/fire-overwatch.mjs";
import { applyGoToGroundAttackEffects } from "../lib/go-to-ground.mjs";
import { applySmokescreenAttackEffects } from "../lib/smokescreen.mjs";
import { applyBattleHealthToTargetSequence } from "../lib/formations.mjs";
import { coveredBattleRuleBinding } from "./rule-coverage-fixture.mjs";

const targets = [
  { wounds: 3, modelCount: 2 },
  { wounds: 5, modelCount: 1 },
];

function appendResolvedAttack(state, attack) {
  const replayed = replayBattleState(state);
  const next =
    replayed.rangedDeclarationDraft.length > 0
      ? closeRangedTargetDeclarations(
          state,
          `close-ranged-${state.events.length + 1}`,
          state.events.length + 1,
        )
      : state;
  return appendResolvedAttackEvent(next, attack);
}

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

function testTransportOption(transportFormationId, sourceSavedUnitIds, capacity = 12) {
  return {
    transportFormationId,
    assignments: sourceSavedUnitIds.map((sourceSavedUnitId) => ({
      sourceSavedUnitId,
      modelCost: 1,
      poolPosition: 0,
      poolKind: "primary",
      poolCapacity: capacity,
      poolLabel: "primary",
      sharedAllowancePosition: null,
      sharedAllowanceMaximumModels: null,
      sharedAllowancePrimaryCapacityWhileUsed: null,
      sharedAllowanceNestedPassengerPolicy: null,
    })),
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
  transportOptions: [testTransportOption(transportFormation.id, ["passengers"])],
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
  transportOptions: [
    testTransportOption(transportFormation.id, ["mixed-bodyguard", "mixed-leader"]),
  ],
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

function nestedTransportFixtures() {
  const outer = {
    ...transportFormation,
    id: "player-1:outer-transport",
    sourceFormationId: "outer-transport",
    name: "Outer Transport",
    weaponInventory: testWeaponInventory("outer-transport"),
    segments: [
      {
        ...transportFormation.segments[0],
        id: "outer-transport-model",
        savedUnitId: "outer-transport",
      },
    ],
  };
  const inner = {
    ...transportFormation,
    id: "player-1:inner-transport",
    sourceFormationId: "inner-transport",
    name: "Inner Transport",
    assignedTransportFormationId: outer.id,
    transportOptions: [testTransportOption(outer.id, ["inner-transport"], 1)],
    weaponInventory: testWeaponInventory("inner-transport"),
    segments: [
      {
        ...transportFormation.segments[0],
        id: "inner-transport-model",
        savedUnitId: "inner-transport",
      },
    ],
  };
  const passengers = {
    ...passengerFormation,
    id: "player-1:nested-passengers",
    sourceFormationId: "nested-passengers",
    name: "Nested Passengers",
    assignedTransportFormationId: inner.id,
    transportOptions: [testTransportOption(inner.id, ["nested-passengers"], 12)],
    weaponInventory: testWeaponInventory("nested-passengers"),
    segments: [
      {
        ...passengerFormation.segments[0],
        id: "nested-passenger-models",
        savedUnitId: "nested-passengers",
      },
    ],
  };
  return { outer, inner, passengers };
}

const goldenReplay = JSON.parse(
  await readFile(new URL("./fixtures/battle-replay-v1.json", import.meta.url), "utf8"),
);
const battleRuleSources = JSON.parse(
  await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
);

function newBattle() {
  const players = [
    { id: "player-1", listId: "list-1", listUpdatedAt: 10, name: "Attackers" },
    { id: "player-2", listId: "list-2", listUpdatedAt: 20, name: "Defenders" },
  ];
  return createBattleState({
    id: "battle-1",
    createdAt: 100,
    rulesSnapshot: "catalogue:test",
    players,
    ruleCoverage: coveredBattleRuleBinding(players),
  });
}

function newOrksBattle() {
  const state = newBattle();
  const coverage = structuredClone(state.events[0].coverage);
  coverage.plan.players[0].faction = {
    sourceId: "ORK",
    ruleIds: ["faction.catalogue-ork"],
  };
  const factionIndex = coverage.report.results.findIndex((result) => result.id === "faction.test");
  const factionResult = coverage.report.results[factionIndex];
  const detachmentResult = coverage.report.results.find(
    (result) => result.id === "detachment.test",
  );
  const datasheetResult = coverage.report.results.find((result) => result.id === "datasheet.test");
  coverage.report.results.splice(
    factionIndex,
    3,
    { ...factionResult, id: "faction.catalogue-ork", name: "Orks faction rules" },
    detachmentResult,
    datasheetResult,
    factionResult,
  );
  return normalizeBattleState({
    ...state,
    events: [{ ...state.events[0], coverage }],
  });
}

function newGrimResolveBattle() {
  const state = newBattle();
  const coverage = structuredClone(state.events[0].coverage);
  coverage.plan.players[0].detachment = {
    sourceId: "000000834",
    ruleIds: ["detachment.catalogue-000000834"],
  };
  const detachmentIndex = coverage.report.results.findIndex(
    (result) => result.id === "detachment.test",
  );
  const detachmentResult = coverage.report.results[detachmentIndex];
  const datasheetResult = coverage.report.results.find((result) => result.id === "datasheet.test");
  coverage.report.results.splice(
    detachmentIndex,
    2,
    {
      ...detachmentResult,
      id: "detachment.catalogue-000000834",
      name: "Unforgiven Task Force detachment rules",
    },
    datasheetResult,
    detachmentResult,
  );
  return normalizeBattleState({
    ...state,
    events: [{ ...state.events[0], coverage }],
  });
}

function newSpaceMarinesBattle() {
  const state = newBattle();
  const coverage = structuredClone(state.events[0].coverage);
  coverage.plan.players[0].faction = {
    sourceId: "SM",
    ruleIds: ["faction.oath-of-moment"],
  };
  const factionIndex = coverage.report.results.findIndex((result) => result.id === "faction.test");
  const factionResult = coverage.report.results[factionIndex];
  const detachmentResult = coverage.report.results.find(
    (result) => result.id === "detachment.test",
  );
  const datasheetResult = coverage.report.results.find((result) => result.id === "datasheet.test");
  coverage.report.results.splice(
    factionIndex,
    3,
    {
      ...factionResult,
      id: "faction.oath-of-moment",
      name: "Oath of Moment",
    },
    detachmentResult,
    datasheetResult,
    factionResult,
  );
  return normalizeBattleState({
    ...state,
    events: [{ ...state.events[0], coverage }],
  });
}

function newNecronsBattle() {
  const state = newBattle();
  const coverage = structuredClone(state.events[0].coverage);
  coverage.plan.players[1].faction = {
    sourceId: "NEC",
    ruleIds: ["faction.reanimation-protocols"],
  };
  const factionIndex = coverage.report.results.findIndex((result) => result.id === "faction.test");
  const factionResult = coverage.report.results[factionIndex];
  coverage.report.results.splice(
    coverage.report.results.findIndex((result) => result.id === "mission.test"),
    0,
    {
      ...factionResult,
      id: "faction.reanimation-protocols",
      name: "Reanimation Protocols",
    },
  );
  return normalizeBattleState({
    ...state,
    events: [{ ...state.events[0], coverage }],
  });
}

function newTyranidsBattle() {
  const state = newBattle();
  const coverage = structuredClone(state.events[0].coverage);
  coverage.plan.players[0].faction = {
    sourceId: "TYR",
    ruleIds: ["faction.shadow-in-the-warp", "faction.synapse-battle-shock"],
  };
  const factionResult = coverage.report.results.find((result) => result.id === "faction.test");
  const detachmentResult = coverage.report.results.find(
    (result) => result.id === "detachment.test",
  );
  const datasheetResult = coverage.report.results.find((result) => result.id === "datasheet.test");
  coverage.report.results.splice(
    coverage.report.results.findIndex((result) => result.id === "faction.test"),
    3,
    {
      ...factionResult,
      id: "faction.shadow-in-the-warp",
      name: "Shadow in the Warp",
    },
    {
      ...factionResult,
      id: "faction.synapse-battle-shock",
      name: "Synapse Battle-shock",
    },
    detachmentResult,
    datasheetResult,
    factionResult,
  );
  return normalizeBattleState({
    ...state,
    events: [{ ...state.events[0], coverage }],
  });
}

function sourceLockedMissionBattle() {
  const players = [
    { id: "player-1", listId: "list-1", listUpdatedAt: 10, name: "Attackers" },
    { id: "player-2", listId: "list-2", listUpdatedAt: 20, name: "Defenders" },
  ];
  const ruleCoverage = structuredClone(coveredBattleRuleBinding(players));
  ruleCoverage.plan.mission.sourceId = "chapter-approved-2025-26-v1.4-a";
  return createBattleState({
    id: "mission-battle-1",
    createdAt: 100,
    rulesSnapshot: "catalogue:test",
    players,
    ruleCoverage,
  });
}

function deployAllOnBattlefield(state) {
  let next = state;
  for (const formation of replayBattleState(next).formations.values()) {
    const aircraft = formation.deploymentTraits.aircraft;
    const hover = formation.deploymentTraits.hover;
    const location = aircraft && !hover ? "reserves" : "battlefield";
    next = declareFormationDeployment(
      next,
      formation.id,
      location,
      aircraft
        ? {
            aircraftMode: hover ? "hover" : "aircraft",
            eligibilityConfirmed: location === "reserves",
            eligibilityReason: location === "reserves" ? "Aircraft must start in Reserves" : "",
          }
        : {},
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

function setupTraitsFormation(id, keywords, hover = false) {
  return {
    ...attackerFormation,
    id: `player-1:${id}`,
    sourceFormationId: id,
    name: id,
    keywords,
    deploymentTraits: {
      dedicatedTransport: keywords.includes("Dedicated Transport"),
      aircraft: keywords.includes("Aircraft"),
      hover,
    },
  };
}

function deployConfirmed(state, formationId, id) {
  return deployFormation(
    state,
    formationId,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    id,
    state.events.length + 1,
  );
}

test("marks an empty Dedicated Transport not deployed and destroys it in round one", () => {
  const dedicated = setupTraitsFormation("empty-dedicated-transport", [
    "Dedicated Transport",
    "Transport",
    "Vehicle",
  ]);
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), dedicated, "register-dedicated", 1),
    formation,
    "register-target",
    2,
  );
  state = declareFormationDeployment(
    state,
    dedicated.id,
    "not_deployed",
    {},
    "declare-not-deployed",
    3,
  );
  state = declareFormationDeployment(state, formation.id, "battlefield", {}, "declare-target", 4);
  state = deployConfirmed(state, formation.id, "deploy-target");

  const report = battleInitialDeploymentRules(state).find(
    (candidate) => candidate.formationId === dedicated.id,
  );
  assert.deepEqual(report, {
    formationId: dedicated.id,
    dedicatedTransport: true,
    aircraft: false,
    hasHover: false,
    aircraftMode: "",
    startingPassengerCount: 0,
    rootFormationId: dedicated.id,
    rootLocation: "not_deployed",
    rootLocationCode: 0,
    complete: true,
    valid: true,
    reason: "Initial deployment follows the locked setup rules",
    values: [1, 0, 0, 0, 0, 0],
  });
  state = startBattle(state, "player-1", "start", 6);
  const replayed = replayBattleState(state);
  assert.deepEqual([...replayed.setupDestroyedFormationIds], [dedicated.id]);
  assert.deepEqual(battleFormationHealth(state, dedicated.id), {
    bodyguard: { modelsRemaining: 0, woundsLost: 0 },
    leader: { modelsRemaining: 0, woundsLost: 0 },
  });
});

test("requires an empty Dedicated Transport to be marked not deployed", () => {
  const dedicated = setupTraitsFormation("illegal-empty-dedicated", [
    "Dedicated Transport",
    "Transport",
    "Vehicle",
  ]);
  let state = registerBattleFormation(newBattle(), dedicated, "register-dedicated", 1);
  state = declareFormationDeployment(state, dedicated.id, "battlefield", {}, "declare", 2);
  state = deployConfirmed(state, dedicated.id, "deploy");
  assert.throws(
    () => startBattle(state, "player-1", "start", 4),
    /empty Dedicated Transport cannot be deployed/,
  );
});

test("allows an occupied Dedicated Transport to deploy normally", () => {
  const dedicated = {
    ...setupTraitsFormation("occupied-dedicated", ["Dedicated Transport", "Transport", "Vehicle"]),
  };
  const passengers = {
    ...passengerFormation,
    assignedTransportFormationId: dedicated.id,
    transportOptions: [testTransportOption(dedicated.id, ["passengers"])],
  };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), dedicated, "register-dedicated", 1),
    passengers,
    "register-passengers",
    2,
  );
  state = declareFormationDeployment(state, dedicated.id, "battlefield", {}, "declare-carrier", 3);
  state = declareFormationDeployment(
    state,
    passengers.id,
    "embarked",
    { transportFormationId: dedicated.id },
    "declare-passengers",
    4,
  );
  state = deployConfirmed(state, dedicated.id, "deploy-carrier");
  assert.doesNotThrow(() => startBattle(state, "player-1", "start", 6));
});

test("requires Aircraft to start in Reserves unless Hover was declared", () => {
  const aircraft = setupTraitsFormation("aircraft", ["Aircraft", "Vehicle"]);
  let invalid = registerBattleFormation(newBattle(), aircraft, "register-aircraft", 1);
  invalid = declareFormationDeployment(
    invalid,
    aircraft.id,
    "battlefield",
    { aircraftMode: "aircraft" },
    "declare-aircraft",
    2,
  );
  invalid = deployConfirmed(invalid, aircraft.id, "deploy-aircraft");
  assert.throws(
    () => startBattle(invalid, "player-1", "start-invalid", 4),
    /must start in Reserves/,
  );

  let valid = registerBattleFormation(newBattle(), aircraft, "register-aircraft", 1);
  valid = declareFormationDeployment(
    valid,
    aircraft.id,
    "reserves",
    {
      aircraftMode: "aircraft",
      eligibilityConfirmed: true,
      eligibilityReason: "Aircraft must start in Reserves",
    },
    "declare-aircraft",
    2,
  );
  assert.doesNotThrow(() => startBattle(valid, "player-1", "start-valid", 3));
});

test("allows a Hover Aircraft on the battlefield or in Strategic Reserves", () => {
  const hoverAircraft = setupTraitsFormation("hover-aircraft", ["Aircraft", "Vehicle"], true);
  let battlefield = registerBattleFormation(newBattle(), hoverAircraft, "register-hover", 1);
  battlefield = declareFormationDeployment(
    battlefield,
    hoverAircraft.id,
    "battlefield",
    { aircraftMode: "hover" },
    "declare-hover",
    2,
  );
  battlefield = deployConfirmed(battlefield, hoverAircraft.id, "deploy-hover");
  assert.doesNotThrow(() => startBattle(battlefield, "player-1", "start-hover", 4));

  let strategic = registerBattleFormation(newBattle(), hoverAircraft, "register-hover", 1);
  strategic = declareFormationDeployment(
    strategic,
    hoverAircraft.id,
    "strategic_reserves",
    {
      aircraftMode: "hover",
      points: 100,
      earliestBattleRound: 2,
      eligibilityConfirmed: true,
      eligibilityReason: "Hover model selected for Strategic Reserves",
    },
    "declare-hover",
    2,
  );
  assert.doesNotThrow(() => startBattle(strategic, "player-1", "start-strategic", 3));

  let invalid = registerBattleFormation(newBattle(), hoverAircraft, "register-hover", 1);
  invalid = declareFormationDeployment(
    invalid,
    hoverAircraft.id,
    "reserves",
    {
      aircraftMode: "hover",
      eligibilityConfirmed: true,
      eligibilityReason: "Incorrect generic Reserves placement",
    },
    "declare-hover",
    2,
  );
  assert.throws(
    () => startBattle(invalid, "player-1", "start-invalid", 3),
    /battlefield or in Strategic Reserves/,
  );
});

function registeredBattle(initialState = newBattle(), targetFormation = formation) {
  let state = registerBattleFormation(
    registerBattleFormation(initialState, attackerFormation, "event-register-attacker", 100),
    targetFormation,
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
  {
    weaponId = "test-ranged-weapon",
    eligibleWeaponCount = 1,
    declaredWeaponCount = eligibleWeaponCount,
    close = false,
    measuredDistanceThousandths = 12000,
    visible = true,
    fullyVisible = visible,
    indirectFire = !visible,
    method = "manual",
  } = {},
) {
  const replayed = replayBattleState(state);
  const attacker = replayed.formations.get(attackerFormationId);
  const target = replayed.formations.get(targetFormationId);
  const inventory = attacker.weaponInventory.find((group) =>
    group.profiles.some((profile) => profile.weaponId === weaponId),
  );
  assert.ok(inventory, `Missing test inventory for ${weaponId}`);
  const inventoryProfile = inventory.profiles.find((profile) => profile.weaponId === weaponId);
  assert.ok(inventoryProfile, `Missing test profile for ${weaponId}`);
  assert.ok(target, `Missing test target ${targetFormationId}`);
  const segmentIds = target.segments.map((segment) => segment.id);
  const snapshotTargets = target.segments.map((segment) => ({
    wounds: segment.wounds,
    modelCount: target.health[segment.id].modelsRemaining,
  }));
  let next = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId,
      targetFormationId,
      weaponId,
      weaponName: inventoryProfile.name,
      weaponSourceFormationId: attackerFormationId,
      sourceSavedUnitId: inventory.sourceSavedUnitId,
      weaponGroupId: inventory.groupId,
      publishedRangeThousandths: inventoryProfile.publishedRangeThousandths,
      effectiveRangeThousandths: inventoryProfile.publishedRangeThousandths,
      measuredDistanceThousandths,
      visible,
      fullyVisible,
      indirectFire,
      weaponHasIndirect: inventoryProfile.hasIndirect,
      eligibleWeaponCount,
      declaredWeaponCount,
      attackSnapshot: {
        attackProfiles: [{ weaponCount: declaredWeaponCount }],
        targets: snapshotTargets,
        segmentIds,
        initialWoundsLost: target.health[segmentIds[0]].woundsLost,
        weaponHasAssault: inventoryProfile.hasAssault,
        summary: {
          attacker: attacker.name,
          weapon: inventoryProfile.name,
          target: target.name,
        },
      },
      method,
      reviewedByPlayer: true,
      reviewReason: "Closest base or hull points and line of sight checked",
    },
    `target-eligibility-${state.events.length + 1}`,
    state.events.length + 1,
  );
  if (close) {
    next = closeRangedTargetDeclarations(
      next,
      `close-ranged-${next.events.length + 1}`,
      next.events.length + 1,
    );
  }
  return next;
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
  const replayedBeforeClose = replayBattleState(state);
  if (replayedBeforeClose.rangedDeclarationDraft.length > 0) {
    state = closeRangedTargetDeclarations(
      state,
      `close-ranged-${state.events.length + 1}`,
      state.events.length + 1,
    );
  }
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

function appendReadyZeroDamageAttack(state, id) {
  const replayed = replayBattleState(state);
  const declaration = replayed.readyRangedAttacks[0];
  assert.ok(declaration, "Expected an activation-wide ranged declaration");
  const target = replayed.formations.get(declaration.targetFormationId);
  const liveModelIds = new Set(
    target.segments.flatMap((segment) =>
      segment.modelIds.slice(0, target.health[segment.id].modelsRemaining),
    ),
  );
  const current = declaration.attackSnapshot.segmentIds
    .map((segmentId, index) => ({
      segmentId,
      targetModelId: declaration.attackSnapshot.targetModelIds?.[index] ?? "",
      target: declaration.attackSnapshot.targets[index],
    }))
    .filter(
      (entry) =>
        target.health[entry.segmentId].modelsRemaining > 0 &&
        (!declaration.attackSnapshot.targetModelIds || liveModelIds.has(entry.targetModelId)),
    );
  const segmentIds = current.map((entry) => entry.segmentId);
  const currentTargets = current.map((entry) => ({
    ...entry.target,
    modelCount: declaration.attackSnapshot.targetModelIds
      ? 1
      : target.health[entry.segmentId].modelsRemaining,
  }));
  return appendResolvedAttackEvent(state, {
    id,
    at: state.events.length + 1,
    attackerFormationId: declaration.attackerFormationId,
    targetFormationId: declaration.targetFormationId,
    segmentIds,
    targets: currentTargets,
    initialWoundsLost: target.health[segmentIds[0]].woundsLost,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      ...declaration.attackSnapshot.summary,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    weaponHasAssault: declaration.attackSnapshot.weaponHasAssault,
    targetEligibilityConfirmed: true,
    targetEligibilityReason: declaration.reviewReason,
    targetEligibilityEventId: declaration.id,
    weaponId: declaration.weaponId,
    declaredWeaponCount: declaration.declaredWeaponCount,
    indirectFire: declaration.indirectFire,
    weaponSourceFormationId: declaration.weaponSourceFormationId,
    sourceSavedUnitId: declaration.sourceSavedUnitId,
    weaponGroupId: declaration.weaponGroupId,
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
    [
      7, 8, 9, 13, 15, 16, 17, 18, 19, 20, 23, 25, 26, 29, 32, 33, 34, 35, 39, 41, 42, 43, 44, 45,
      46, 47, 48, 53, 56, 57, 58, 60,
    ],
  );
  assert.equal(
    battleRuleSources.sources[0].sha256,
    "4d0e8019cbfddd6f46781d5b4ed31d46fb21eb2d0d10a0f6fabefac0ce054364",
  );
  const updates = battleRuleSources.sources.find(
    (source) => source.id === "core-rules-updates-10e-2025-10",
  );
  assert.ok(updates);
  assert.deepEqual(updates.pages, [7, 8, 10, 12, 14, 18, 21, 22, 25, 26]);
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
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /true line of sight/i.test(usage) && /physical part/i.test(usage),
    ),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /Ruin outside-to-outside/i.test(usage) && /Towering/i.test(usage),
    ),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) =>
        /Smokescreen/i.test(usage) && /Smoke target/i.test(usage) && /Stealth/i.test(usage),
    ),
    true,
  );
  assert.equal(
    updates.usedFor.some(
      (usage) => /duplicated Stealth/i.test(usage) && /not cumulative/i.test(usage),
    ),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /Rapid Ingress/i.test(usage) && /opponent's Movement phase/i.test(usage),
    ),
    true,
  );
  assert.equal(
    updates.usedFor.some((usage) => /Rapid Ingress/i.test(usage) && /Deep Strike/i.test(usage)),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /Dedicated Transport/i.test(usage) && /first-round destruction/i.test(usage),
    ),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) => /Aircraft mandatory Reserve setup/i.test(usage) && /Hover/i.test(usage),
    ),
    true,
  );
  assert.equal(
    battleRuleSources.sources[0].usedFor.some(
      (usage) =>
        /activation-wide/i.test(usage) && /split fire/i.test(usage) && /contiguous/i.test(usage),
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
  state = recordVisibleRangedTarget(state, attackerFormation.id, formation.id, {
    weaponId: "indirect-weapon",
    eligibleWeaponCount: 2,
    declaredWeaponCount: 2,
    measuredDistanceThousandths: 32000,
    visible: false,
    fullyVisible: false,
    indirectFire: true,
    method: "uwb",
  });
  const indirectEligibilityId = replayBattleState(state).rangedDeclarationDraft[0].id;
  state = appendZeroDamageRangedAttack(state, {
    weaponId: "indirect-weapon",
    targetEligibilityEventId: indirectEligibilityId,
    declaredWeaponCount: 2,
    indirectFire: true,
  });
  const fact = replayBattleState(state).targetEligibilityFacts.get(indirectEligibilityId);
  assert.equal(fact.method, "uwb");
  assert.equal(fact.measuredDistanceThousandths, 32000);
  assert.equal(fact.geometryDecision.visibilityResolution, "indirect_fire");
  assert.equal(fact.geometryDecision.targetModelIds.length, 3);
  assert.equal(fact.attackSnapshot.targetModelIds.length, 3);
  assert.ok(fact.attackSnapshot.targets.every((target) => target.modelCount === 1));

  const forgedGeometry = structuredClone(state);
  const forgedDecision = forgedGeometry.events.find(
    (event) => event.id === indirectEligibilityId,
  ).geometryDecision;
  forgedDecision.cover[0].benefitOfCover = !forgedDecision.cover[0].benefitOfCover;
  assert.throws(() => normalizeBattleState(forgedGeometry), /geometry decision|cover sequence/i);

  const forgedAbility = structuredClone(state);
  forgedAbility.events.find((event) => event.id === indirectEligibilityId).weaponHasIndirect =
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

  let exhausted = registeredBattle();
  exhausted = recordVisibleRangedTarget(exhausted, attackerFormation.id, formation.id, {
    eligibleWeaponCount: 2,
    declaredWeaponCount: 2,
    close: false,
  });
  assert.throws(
    () =>
      recordVisibleRangedTarget(exhausted, attackerFormation.id, formation.id, {
        weaponId: "short-weapon",
        eligibleWeaponCount: 1,
        declaredWeaponCount: 1,
        close: false,
      }),
    /declarations exceed surviving weapon copies/i,
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

  assert.throws(
    () =>
      recordVisibleRangedTarget(registeredBattle(), attackerFormation.id, formation.id, {
        weaponId: "short-weapon",
        measuredDistanceThousandths: 12001,
      }),
    /must be declared exactly/i,
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

test("deploys and disembarks a source-compatible nested Transport chain", () => {
  const { outer, inner, passengers } = nestedTransportFixtures();
  let state = newBattle();
  for (const [registered, id] of [
    [outer, "register-outer"],
    [inner, "register-inner"],
    [passengers, "register-nested-passengers"],
    [formation, "register-nested-enemy"],
  ]) {
    state = registerBattleFormation(state, registered, id, state.events.length + 1);
  }
  state = declareFormationDeployment(
    state,
    passengers.id,
    "embarked",
    { transportFormationId: inner.id },
    "declare-nested-passengers",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    inner.id,
    "embarked",
    { transportFormationId: outer.id },
    "declare-inner",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    outer.id,
    "battlefield",
    {},
    "declare-outer",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    formation.id,
    "battlefield",
    {},
    "declare-nested-enemy",
    state.events.length + 1,
  );
  state = deployFormation(
    state,
    outer.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-outer",
    state.events.length + 1,
  );
  state = deployFormation(
    state,
    formation.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-nested-enemy",
    state.events.length + 1,
  );
  let replayed = replayBattleState(state);
  assert.equal(replayed.deploymentComplete, true);
  assert.equal(replayed.deployedFormationIds.has(inner.id), true);
  assert.equal(replayed.deployedFormationIds.has(passengers.id), true);
  state = startBattle(state, "player-1", "start-nested-battle", state.events.length + 1);
  assert.equal(battleFormationEmbarkedTransport(state, inner.id), outer.id);
  assert.equal(battleFormationEmbarkedTransport(state, passengers.id), inner.id);
  assert.equal(battleFormationIsOnBattlefield(state, outer.id), true);
  assert.equal(battleFormationIsOnBattlefield(state, inner.id), false);
  assert.equal(battleFormationIsOnBattlefield(state, passengers.id), false);

  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "nested-to-movement",
  );
  state = disembarkFormation(
    state,
    inner.id,
    outer.id,
    { placementConfirmed: true, placementReason: "Wholly within 3 inches" },
    "disembark-inner",
    state.events.length + 1,
  );
  state = passFireOverwatch(
    state,
    "No eligible response",
    "pass-inner-overwatch",
    state.events.length + 1,
  );
  state = disembarkFormation(
    state,
    passengers.id,
    inner.id,
    { placementConfirmed: true, placementReason: "Wholly within 3 inches" },
    "disembark-nested-passengers",
    state.events.length + 1,
  );
  state = passFireOverwatch(
    state,
    "No eligible response",
    "pass-nested-passenger-overwatch",
    state.events.length + 1,
  );
  assert.equal(battleFormationIsOnBattlefield(state, inner.id), true);
  assert.equal(battleFormationIsOnBattlefield(state, passengers.id), true);
});

test("follows nested Transport ancestry for Reserves limits and arrival", () => {
  const { outer, inner, passengers } = nestedTransportFixtures();
  let state = newBattle();
  for (const [registered, id] of [
    [outer, "register-reserve-outer"],
    [inner, "register-reserve-inner"],
    [passengers, "register-reserve-passengers"],
    [formation, "register-reserve-enemy"],
  ]) {
    state = registerBattleFormation(state, registered, id, state.events.length + 1);
  }
  state = configureBattleMission(
    state,
    { ...replayBattleState(state).mission, pointsLimit: 1000 },
    "configure-nested-reserve-mission",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    passengers.id,
    "embarked",
    {
      points: 51,
      transportFormationId: inner.id,
      eligibilityConfirmed: true,
      eligibilityReason: "Embarked in a Reserve Transport chain",
    },
    "declare-reserve-passengers",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    inner.id,
    "embarked",
    {
      points: 50,
      transportFormationId: outer.id,
      eligibilityConfirmed: true,
      eligibilityReason: "Embarked in a Reserve Transport chain",
    },
    "declare-reserve-inner",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        outer.id,
        "strategic_reserves",
        {
          points: 150,
          earliestBattleRound: 2,
          eligibilityConfirmed: true,
          eligibilityReason: "Strategic Reserves",
        },
        "declare-over-limit-outer",
        state.events.length + 1,
      ),
    /250 point limit/,
  );
  state = declareFormationDeployment(
    state,
    outer.id,
    "strategic_reserves",
    {
      points: 149,
      earliestBattleRound: 2,
      eligibilityConfirmed: true,
      eligibilityReason: "Strategic Reserves",
    },
    "declare-reserve-outer",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    formation.id,
    "battlefield",
    {},
    "declare-reserve-enemy",
    state.events.length + 1,
  );
  state = deployFormation(
    state,
    formation.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-reserve-enemy",
    state.events.length + 1,
  );
  state = startBattle(state, "player-1", "start-nested-reserves", state.events.length + 1);
  let replayed = replayBattleState(state);
  assert.equal(replayed.offBattlefieldFormationIds.has(outer.id), true);
  assert.equal(replayed.offBattlefieldFormationIds.has(inner.id), true);
  assert.equal(replayed.offBattlefieldFormationIds.has(passengers.id), true);
  state = advanceTo(
    state,
    (clock) =>
      clock.battleRound === 2 &&
      clock.activePlayerId === "player-1" &&
      clock.phase === "movement" &&
      clock.step === "reinforcements",
    "nested-reserves-arrival",
  );
  state = arriveFromReserves(
    state,
    outer.id,
    { placementConfirmed: true, placementReason: "Legal Strategic Reserves position" },
    "arrive-reserve-outer",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.deployedFormationIds.has(outer.id), true);
  assert.equal(replayed.deployedFormationIds.has(inner.id), true);
  assert.equal(replayed.deployedFormationIds.has(passengers.id), true);
  assert.equal(battleFormationIsOnBattlefield(state, outer.id), true);
  assert.equal(battleFormationIsOnBattlefield(state, inner.id), false);
  assert.equal(battleFormationIsOnBattlefield(state, passengers.id), false);
});

test("rejects cyclic nested Transport deployment assignments", () => {
  const { outer, inner } = nestedTransportFixtures();
  const cyclicOuter = {
    ...outer,
    assignedTransportFormationId: inner.id,
    transportOptions: [testTransportOption(inner.id, ["outer-transport"], 1)],
  };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), cyclicOuter, "register-cycle-outer", 1),
    inner,
    "register-cycle-inner",
    2,
  );
  state = declareFormationDeployment(
    state,
    inner.id,
    "embarked",
    { transportFormationId: cyclicOuter.id },
    "declare-cycle-inner",
    3,
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        cyclicOuter.id,
        "embarked",
        { transportFormationId: inner.id },
        "declare-cycle-outer",
        4,
      ),
    /cannot contain a cycle/,
  );
});

test("allows compatible unassigned Transport changes and enforces live capacity", () => {
  const alternateTransport = {
    ...transportFormation,
    id: "player-1:alternate-transport",
    sourceFormationId: "alternate-transport",
    name: "Alternate Transport",
    segments: [
      {
        ...transportFormation.segments[0],
        id: "alternate-transport-model",
        savedUnitId: "alternate-transport",
      },
    ],
    weaponInventory: testWeaponInventory("alternate-transport"),
  };
  const flexiblePassenger = {
    ...passengerFormation,
    assignedTransportFormationId: transportFormation.id,
    transportOptions: [
      testTransportOption(transportFormation.id, ["passengers"], 2),
      testTransportOption(alternateTransport.id, ["passengers"], 2),
    ],
  };
  const extraPassenger = {
    ...passengerFormation,
    id: "player-1:extra-passenger",
    sourceFormationId: "extra-passenger",
    name: "Extra Passenger",
    assignedTransportFormationId: "",
    transportOptions: [testTransportOption(alternateTransport.id, ["extra-passenger"], 2)],
    weaponInventory: testWeaponInventory("extra-passenger"),
    segments: [
      {
        ...passengerFormation.segments[0],
        id: "extra-passenger-model",
        savedUnitId: "extra-passenger",
        startingModels: 1,
      },
    ],
  };
  let state = newBattle();
  for (const [registered, id] of [
    [transportFormation, "register-original-transport"],
    [alternateTransport, "register-alternate-transport"],
    [flexiblePassenger, "register-flexible-passenger"],
    [extraPassenger, "register-extra-passenger"],
    [formation, "register-capacity-enemy"],
  ]) {
    state = registerBattleFormation(state, registered, id, state.events.length + 1);
  }
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-transport-change", 20);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "transport-change-movement",
  );
  state = recordFormationMovement(
    state,
    flexiblePassenger.id,
    "normal",
    "flexible-passenger-moved",
    state.events.length + 1,
  );
  assert.deepEqual(
    battleEmbarkationOptions(state, flexiblePassenger.id).map((option) => [
      option.transportFormationId,
      option.assigned,
      option.available,
    ]),
    [
      [transportFormation.id, true, true],
      [alternateTransport.id, false, true],
    ],
  );
  state = embarkFormation(
    state,
    flexiblePassenger.id,
    alternateTransport.id,
    { rangeConfirmed: true, rangeReason: "Every model ended within 3 inches" },
    "embark-unassigned-transport",
    state.events.length + 1,
  );
  assert.equal(
    battleFormationEmbarkedTransport(state, flexiblePassenger.id),
    alternateTransport.id,
  );
  assert.deepEqual(battleTransportOccupancy(state, alternateTransport.id).poolLoads, [
    { position: 0, kind: "primary", label: "primary", capacity: 2, used: 2 },
  ]);
  state = recordFormationMovement(
    state,
    extraPassenger.id,
    "normal",
    "extra-passenger-moved",
    state.events.length + 1,
  );
  const blocked = battleEmbarkationOptions(state, extraPassenger.id)[0];
  assert.equal(blocked.available, false);
  assert.match(blocked.reason, /use 3 of 2 spaces/i);
  assert.throws(
    () =>
      embarkFormation(
        state,
        extraPassenger.id,
        alternateTransport.id,
        { rangeConfirmed: true, rangeReason: "Every model ended within 3 inches" },
        "over-capacity-embarkation",
        state.events.length + 1,
      ),
    /use 3 of 2 spaces/i,
  );
});

test("recomputes Transport capacity from surviving models before embarkation", () => {
  const casualtyTransport = {
    ...transportFormation,
    id: "player-1:casualty-transport",
    sourceFormationId: "casualty-transport",
    name: "Casualty Transport",
    segments: [
      {
        ...transportFormation.segments[0],
        id: "casualty-transport-model",
        savedUnitId: "casualty-transport",
      },
    ],
    weaponInventory: testWeaponInventory("casualty-transport"),
  };
  const casualtyPassenger = {
    ...passengerFormation,
    assignedTransportFormationId: "",
    transportOptions: [testTransportOption(casualtyTransport.id, ["passengers"], 2)],
  };
  const occupyingPassenger = {
    ...passengerFormation,
    id: "player-1:occupying-passenger",
    sourceFormationId: "occupying-passenger",
    name: "Occupying Passenger",
    assignedTransportFormationId: casualtyTransport.id,
    transportOptions: [testTransportOption(casualtyTransport.id, ["occupying-passenger"], 2)],
    weaponInventory: testWeaponInventory("occupying-passenger"),
    segments: [
      {
        ...passengerFormation.segments[0],
        id: "occupying-passenger-model",
        savedUnitId: "occupying-passenger",
        startingModels: 1,
      },
    ],
  };
  let state = newBattle();
  for (const [registered, id] of [
    [casualtyTransport, "register-casualty-transport"],
    [casualtyPassenger, "register-casualty-passenger"],
    [occupyingPassenger, "register-occupying-passenger"],
    [formation, "register-casualty-attacker"],
  ]) {
    state = registerBattleFormation(state, registered, id, state.events.length + 1);
  }
  for (const registered of replayBattleState(state).formations.values()) {
    const embarked = registered.id === occupyingPassenger.id;
    state = declareFormationDeployment(
      state,
      registered.id,
      embarked ? "embarked" : "battlefield",
      embarked ? { transportFormationId: casualtyTransport.id } : {},
      `declare-casualty-${registered.id}`,
      state.events.length + 1,
    );
  }
  while (!replayBattleState(state).deploymentComplete) {
    const replayed = replayBattleState(state);
    const next = [...replayed.formations.values()].find(
      (registered) =>
        registered.playerId === replayed.deploymentPriorityPlayerId &&
        replayed.deploymentByFormation.get(registered.id)?.location === "battlefield" &&
        !replayed.deployedFormationIds.has(registered.id),
    );
    assert.ok(next);
    state = deployFormation(
      state,
      next.id,
      { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
      `deploy-casualty-${next.id}`,
      state.events.length + 1,
    );
  }
  state = startBattle(state, "player-2", "start-casualty-capacity", state.events.length + 1);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "casualty-attacker-movement",
  );
  state = recordFormationMovement(
    state,
    formation.id,
    "stationary",
    "casualty-attacker-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "casualty-attacker-shooting");
  state = startFormationActivation(
    state,
    formation.id,
    {},
    "casualty-attacker-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, formation.id, casualtyPassenger.id);
  const declarationEventId = state.events.at(-1).id;
  state = closeRangedTargetDeclarations(
    state,
    "casualty-targets-declared",
    state.events.length + 1,
  );
  state = passGoToGround(
    state,
    "Defending player declined the Stratagem",
    "casualty-go-to-ground-pass",
    state.events.length + 1,
  );
  state = appendResolvedAttackEvent(state, {
    id: "destroy-one-passenger",
    at: state.events.length + 1,
    attackerFormationId: formation.id,
    targetFormationId: casualtyPassenger.id,
    segmentIds: ["passenger-models"],
    targets: [{ wounds: 2, modelCount: 2 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 2, modelsDestroyed: 1 },
    summary: {
      attacker: formation.name,
      weapon: "Test ranged weapon",
      target: casualtyPassenger.name,
      damage: 2,
      successful: 1,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible and in range",
    targetEligibilityEventId: declarationEventId,
    weaponId: "test-ranged-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: formation.id,
    sourceSavedUnitId: "unit-1",
    weaponGroupId: "test-ranged-group",
  });
  state = completeFormationActivation(state, "complete-casualty-attack", state.events.length + 1);
  assert.equal(
    battleFormationHealth(state, casualtyPassenger.id)["passenger-models"].modelsRemaining,
    1,
  );
  state = advanceTo(
    state,
    (clock) =>
      clock.activePlayerId === "player-1" &&
      clock.phase === "movement" &&
      clock.step === "move_units",
    "casualty-passenger-movement",
  );
  state = recordFormationMovement(
    state,
    casualtyPassenger.id,
    "normal",
    "casualty-passenger-moved",
    state.events.length + 1,
  );
  assert.equal(battleEmbarkationOptions(state, casualtyPassenger.id)[0].available, true);
  state = embarkFormation(
    state,
    casualtyPassenger.id,
    casualtyTransport.id,
    { rangeConfirmed: true, rangeReason: "Surviving model ended within 3 inches" },
    "embark-after-casualty",
    state.events.length + 1,
  );
  assert.equal(battleTransportOccupancy(state, casualtyTransport.id).poolLoads[0].used, 2);
});

test("enforces independent pools, alternative modes, and shared-capacity reductions", () => {
  const pooledTransport = {
    ...transportFormation,
    id: "player-1:pooled-transport",
    sourceFormationId: "pooled-transport",
    name: "Pooled Transport",
    segments: [
      {
        ...transportFormation.segments[0],
        id: "pooled-transport-model",
        savedUnitId: "pooled-transport",
      },
    ],
    weaponInventory: testWeaponInventory("pooled-transport"),
  };
  const makePassenger = (id, models, assignment) => ({
    ...passengerFormation,
    id: `player-1:${id}`,
    sourceFormationId: id,
    name: id,
    assignedTransportFormationId: "",
    weaponInventory: testWeaponInventory(id),
    transportOptions: [
      {
        transportFormationId: pooledTransport.id,
        assignments: [{ ...assignment, sourceSavedUnitId: id }],
      },
    ],
    segments: [
      {
        ...passengerFormation.segments[0],
        id: `${id}-models`,
        savedUnitId: id,
        startingModels: models,
      },
    ],
  });
  const baseAssignment = {
    modelCost: 1,
    poolPosition: 0,
    poolKind: "primary",
    poolCapacity: 6,
    poolLabel: "Infantry",
    sharedAllowancePosition: null,
    sharedAllowanceMaximumModels: null,
    sharedAllowancePrimaryCapacityWhileUsed: null,
    sharedAllowanceNestedPassengerPolicy: null,
  };
  const primary = makePassenger("primary-passengers", 4, baseAssignment);
  const additional = makePassenger("additional-passenger", 1, {
    ...baseAssignment,
    poolPosition: 1,
    poolKind: "additional",
    poolCapacity: 1,
    poolLabel: "Dreadnought",
  });
  const alternative = makePassenger("alternative-passenger", 1, {
    ...baseAssignment,
    poolPosition: 2,
    poolKind: "alternative",
    poolCapacity: 1,
    poolLabel: "Vehicle mode",
  });
  const shared = makePassenger("shared-passenger", 1, {
    ...baseAssignment,
    sharedAllowancePosition: 1,
    sharedAllowanceMaximumModels: 1,
    sharedAllowancePrimaryCapacityWhileUsed: 3,
  });
  let state = newBattle();
  for (const [registered, id] of [
    [pooledTransport, "register-pooled-transport"],
    [primary, "register-primary-passengers"],
    [additional, "register-additional-passenger"],
    [alternative, "register-alternative-passenger"],
    [shared, "register-shared-passenger"],
  ]) {
    state = registerBattleFormation(state, registered, id, state.events.length + 1);
  }
  state = declareFormationDeployment(
    state,
    pooledTransport.id,
    "battlefield",
    {},
    "declare-pooled-transport",
    state.events.length + 1,
  );
  for (const passenger of [primary, additional]) {
    state = declareFormationDeployment(
      state,
      passenger.id,
      "embarked",
      { transportFormationId: pooledTransport.id },
      `declare-${passenger.sourceFormationId}`,
      state.events.length + 1,
    );
  }
  assert.deepEqual(
    battleTransportOccupancy(state, pooledTransport.id).poolLoads.map((pool) => [
      pool.kind,
      pool.used,
      pool.capacity,
    ]),
    [
      ["primary", 4, 6],
      ["additional", 1, 1],
    ],
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        alternative.id,
        "embarked",
        { transportFormationId: pooledTransport.id },
        "declare-alternative-passenger",
        state.events.length + 1,
      ),
    /mutually exclusive Transport modes/i,
  );
  assert.throws(
    () =>
      declareFormationDeployment(
        state,
        shared.id,
        "embarked",
        { transportFormationId: pooledTransport.id },
        "declare-shared-passenger",
        state.events.length + 1,
      ),
    /use 5 of 3 spaces/i,
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

test("replays movement and enforces one activation-wide Shooting declaration", () => {
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
    battleCanDeclareRangedAttack(state, attackerFormation.id, {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.equal(
    battleCanDeclareRangedAttack(state, attackerFormation.id, {
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
    battleCanDeclareRangedAttack(state, attackerFormation.id, {
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  assert.equal(
    battleCanDeclareRangedAttack(state, attackerFormation.id, {
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
    declaredWeaponCount: 2,
  });
  state = closeRangedTargetDeclarations(state, "gtg-targets-declared", state.events.length + 1);
  let replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround.targetFormationId, infantryTarget.id);
  assert.equal(replayed.readyRangedAttack, null);
  assert.throws(() => appendZeroDamageRangedAttack(state), /Go to Ground window/i);

  const declarationEventId = replayed.activeRangedDeclarationSet.declarations[0].id;
  state = resolveGoToGround(state, infantryTarget.id, "gtg-resolve", state.events.length + 1);
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 1);
  assert.equal(replayed.pendingGoToGround, null);
  assert.equal(replayed.readyRangedAttack.triggerEventId, declarationEventId);
  assert.deepEqual(replayed.activeGoToGroundEffects[0], {
    id: "gtg-resolve",
    name: "Go to Ground",
    targetFormationId: infantryTarget.id,
    ownerPlayerId: "player-2",
    triggerEventId: "gtg-targets-declared",
    duration: "end_of_phase",
    appliedAt: replayed.clock,
    invulnerableSave: 6,
    benefitOfCover: true,
  });
  state = appendZeroDamageRangedAttack(state, {
    id: "gtg-first-attack",
    targetEligibilityEventId: replayed.readyRangedAttack.triggerEventId,
    declaredWeaponCount: 2,
  });
  assert.equal(replayBattleState(state).readyRangedAttack, null);

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
  state = closeRangedTargetDeclarations(
    state,
    "gtg-pass-targets-declared",
    state.events.length + 1,
  );
  const triggerEventId = replayBattleState(state).activeRangedDeclarationSet.declarations[0].id;
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
});

test("offers Smokescreen after Go to Ground and applies its phase effects atomically", () => {
  const smokeInfantryTarget = { ...formation, keywords: ["Infantry", "Smoke"] };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "smoke-register-attacker", 1),
    smokeInfantryTarget,
    "smoke-register-target",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Smokescreen test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 2 },
      objectives: [],
    },
    "smoke-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "smoke-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "smoke-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "smoke-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "smoke-to-shooting");
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "smoke-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, attackerFormation.id, smokeInfantryTarget.id);
  assert.throws(
    () =>
      closeRangedTargetDeclarations(state, "smoke-targets-without-order", state.events.length + 1),
    /active player must choose/i,
  );
  state = closeRangedTargetDeclarations(
    state,
    "smoke-targets-declared",
    state.events.length + 1,
    "go_to_ground_first",
  );
  let replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround.targetFormationId, smokeInfantryTarget.id);
  assert.equal(replayed.pendingSmokescreen, null);

  state = passGoToGround(
    state,
    "Defending player saved CP for Smokescreen",
    "smoke-pass-gtg",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround, null);
  assert.equal(replayed.pendingSmokescreen.targetFormationId, smokeInfantryTarget.id);
  assert.throws(() => appendZeroDamageRangedAttack(state), /Smokescreen window/i);

  state = resolveSmokescreen(
    state,
    smokeInfantryTarget.id,
    "smoke-resolve",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 1);
  assert.equal(replayed.pendingSmokescreen, null);
  assert.equal(replayed.readyRangedAttack.smokescreenEffectId, "smoke-resolve");
  assert.deepEqual(replayed.activeSmokescreenEffects[0], {
    id: "smoke-resolve",
    name: "Smokescreen",
    targetFormationId: smokeInfantryTarget.id,
    ownerPlayerId: "player-2",
    triggerEventId: "smoke-targets-declared",
    duration: "end_of_phase",
    appliedAt: replayed.clock,
    benefitOfCover: true,
    stealth: true,
  });
  assert.deepEqual(
    applySmokescreenAttackEffects(
      [
        { targetCover: false, hitModifier: 0 },
        { targetCover: false, hitModifier: -1 },
      ],
      true,
    ),
    [
      { targetCover: true, hitModifier: -1 },
      { targetCover: true, hitModifier: -1 },
    ],
  );

  state = appendZeroDamageRangedAttack(state, {
    id: "smoke-attack",
    targetEligibilityEventId: replayed.readyRangedAttack.triggerEventId,
  });
  state = completeFormationActivation(state, "smoke-complete", state.events.length + 1);
  state = advanceTo(state, (clock) => clock.phase !== "shooting", "smoke-expire");
  assert.equal(replayBattleState(state).activeSmokescreenEffects.length, 0);

  const tampered = structuredClone(state);
  const resolution = tampered.events.find((event) => event.type === "smokescreen_resolved");
  resolution.allModelsHaveStealth = false;
  assert.throws(() => normalizeBattleState(tampered), /Smokescreen facts/i);
});

test("lets the active player sequence Smokescreen before Go to Ground", () => {
  const smokeTarget = { ...formation, keywords: ["Infantry", "Smoke"] };
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "smoke-pass-attacker", 1),
    smokeTarget,
    "smoke-pass-target",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Smokescreen pass test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 2 },
      objectives: [],
    },
    "smoke-pass-mission",
    3,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "smoke-pass-start", 4);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "smoke-pass-to-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "smoke-pass-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "smoke-pass-to-shooting");
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "smoke-pass-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, attackerFormation.id, smokeTarget.id);
  state = closeRangedTargetDeclarations(
    state,
    "smoke-pass-targets-declared",
    state.events.length + 1,
    "smokescreen_first",
  );
  assert.equal(replayBattleState(state).pendingGoToGround, null);
  assert.equal(replayBattleState(state).pendingSmokescreen.targetFormationId, smokeTarget.id);
  state = passSmokescreen(
    state,
    "Defending player declined the Stratagem",
    "smoke-pass",
    state.events.length + 1,
  );
  let replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 2);
  assert.equal(replayed.pendingSmokescreen, null);
  assert.equal(replayed.pendingGoToGround.targetFormationId, smokeTarget.id);
  assert.equal(replayed.smokescreenPasses.length, 1);
  state = passGoToGround(
    state,
    "Defending player declined the second Stratagem",
    "smoke-pass-gtg-second",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.pendingGoToGround, null);
  assert.equal(replayed.goToGroundPasses.length, 1);
  assert.ok(replayed.readyRangedAttack);
});

test("locks split fire activation-wide and resolves targets and profiles contiguously", () => {
  const splitAttacker = {
    ...attackerFormation,
    weaponInventory: attackerFormation.weaponInventory.map((group) => ({ ...group, count: 3 })),
    segments: attackerFormation.segments.map((segment, index) =>
      index === 0 ? { ...segment, startingModels: 3 } : segment,
    ),
  };
  const targetA = {
    ...formation,
    id: "player-2:target-a",
    name: "Target A",
    keywords: ["Infantry"],
  };
  const targetB = {
    ...formation,
    id: "player-2:target-b",
    name: "Target B",
    keywords: ["Infantry"],
  };
  let state = registerBattleFormation(newBattle(), splitAttacker, "split-attacker", 1);
  state = registerBattleFormation(state, targetA, "split-target-a", 2);
  state = registerBattleFormation(state, targetB, "split-target-b", 3);
  state = configureBattleMission(
    state,
    {
      name: "Split fire",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "split-mission",
    4,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "split-start", 5);
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "split-movement",
  );
  state = recordFormationMovement(
    state,
    splitAttacker.id,
    "stationary",
    "split-stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, battleAttackWindow, "split-shooting");
  state = startFormationActivation(
    state,
    splitAttacker.id,
    {},
    "split-activation",
    state.events.length + 1,
  );
  state = recordVisibleRangedTarget(state, splitAttacker.id, targetA.id, {
    weaponId: "test-ranged-weapon",
    eligibleWeaponCount: 3,
    declaredWeaponCount: 1,
  });
  state = recordVisibleRangedTarget(state, splitAttacker.id, targetB.id, {
    weaponId: "short-weapon",
    eligibleWeaponCount: 2,
    declaredWeaponCount: 1,
  });
  const retractedDeclarationId = state.events.at(-1).id;
  state = retractRangedTargetDeclaration(
    state,
    retractedDeclarationId,
    "Player changed the split-fire declaration",
    "split-retract-target-b",
    state.events.length + 1,
  );
  assert.deepEqual(
    replayBattleState(state).rangedDeclarationDraft.map((entry) => entry.targetFormationId),
    [targetA.id],
  );
  assert.equal(battleUnusedWeaponCount(state, splitAttacker.id, "unit-1", "test-ranged-group"), 2);
  state = recordVisibleRangedTarget(state, splitAttacker.id, targetB.id, {
    weaponId: "short-weapon",
    eligibleWeaponCount: 2,
    declaredWeaponCount: 1,
  });
  state = recordVisibleRangedTarget(state, splitAttacker.id, targetA.id, {
    weaponId: "assault-cannon",
    eligibleWeaponCount: 1,
    declaredWeaponCount: 1,
  });
  assert.equal(
    battleCanResolveAttack(state, splitAttacker.id, {
      targetFormationId: targetA.id,
      weaponId: "test-ranged-weapon",
      weaponSourceFormationId: splitAttacker.id,
      sourceSavedUnitId: "unit-1",
      weaponGroupId: "test-ranged-group",
      weaponType: "Ranged",
      targetEligibilityConfirmed: true,
    }),
    false,
  );
  state = closeRangedTargetDeclarations(state, "split-targets-declared", state.events.length + 1);
  let replayed = replayBattleState(state);
  assert.deepEqual(replayed.pendingGoToGround.candidateTargetFormationIds, [
    targetA.id,
    targetB.id,
  ]);
  assert.deepEqual(
    replayed.activeRangedDeclarationSet.declarations.map((entry) => [
      entry.targetFormationId,
      entry.weaponId,
    ]),
    [
      [targetA.id, "test-ranged-weapon"],
      [targetA.id, "assault-cannon"],
      [targetB.id, "short-weapon"],
    ],
  );
  assert.equal(replayed.readyRangedAttacks.length, 0);
  state = resolveGoToGround(state, targetB.id, "split-go-to-ground", state.events.length + 1);
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 0);
  assert.equal(replayed.activeGoToGroundEffects[0].targetFormationId, targetB.id);
  assert.deepEqual(
    replayed.readyRangedAttacks.map((entry) => [entry.targetFormationId, entry.weaponId]),
    [
      [targetA.id, "test-ranged-weapon"],
      [targetA.id, "assault-cannon"],
      [targetB.id, "short-weapon"],
    ],
  );
  state = appendReadyZeroDamageAttack(state, "split-attack-a-1");
  state = appendReadyZeroDamageAttack(state, "split-attack-a-2");
  state = appendReadyZeroDamageAttack(state, "split-attack-b-1");
  assert.equal(replayBattleState(state).readyRangedAttacks.length, 0);
  assert.doesNotThrow(() =>
    completeFormationActivation(state, "split-complete", state.events.length + 1),
  );
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

test("executes the source-locked Waaagh! timing, duration, and Advance charge rule", () => {
  const orks = { ...attackerFormation, hasWaaaghAbility: true };
  let state = registerBattleFormation(
    registerBattleFormation(newOrksBattle(), orks, "register-orks", 1),
    formation,
    "register-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-waaagh", 3);
  state = callWaaagh(state, "player-1", "call-waaagh", state.events.length + 1);
  assert.deepEqual(
    {
      available: battleWaaaghState(state, "player-1").available,
      active: battleWaaaghState(state, "player-1").active,
    },
    { available: false, active: true },
  );
  assert.throws(
    () => callWaaagh(state, "player-1", "call-waaagh-again", state.events.length + 1),
    /once per battle/i,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(
      state,
      `waaagh-to-move-${state.events.length}`,
      state.events.length + 1,
    );
  }
  state = recordFormationMovement(
    state,
    orks.id,
    "advance",
    "waaagh-advance",
    state.events.length + 1,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "charge" &&
      replayBattleState(state).clock.step === "charge_moves"
    )
  ) {
    state = advanceBattleClock(
      state,
      `waaagh-to-charge-${state.events.length}`,
      state.events.length + 1,
    );
  }
  assert.doesNotThrow(() =>
    recordFormationCharge(
      state,
      orks.id,
      [formation.id],
      successfulChargeOptions(formation.id),
      "waaagh-charge",
      state.events.length + 1,
    ),
  );
});

test("rejects Waaagh! without its source, outside its timing, and after expiry", () => {
  let nonOrks = registerBattleFormation(newBattle(), attackerFormation, "register-non-orks", 1);
  nonOrks = registerBattleFormation(nonOrks, formation, "register-non-orks-target", 2);
  nonOrks = startBattle(deployAllOnBattlefield(nonOrks), "player-1", "start-non-orks", 3);
  assert.throws(
    () => callWaaagh(nonOrks, "player-1", "invalid-faction-waaagh", 4),
    /source-locked Orks/i,
  );

  let state = registerBattleFormation(newOrksBattle(), attackerFormation, "register-orks", 1);
  state = registerBattleFormation(state, formation, "register-orks-target", 2);
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-orks", 3);
  state = callWaaagh(state, "player-1", "valid-waaagh", 4);
  do {
    state = advanceBattleClock(
      state,
      `waaagh-expiry-${state.events.length}`,
      state.events.length + 1,
    );
  } while (
    !(
      replayBattleState(state).clock.activePlayerId === "player-1" &&
      replayBattleState(state).clock.battleRound === 2 &&
      replayBattleState(state).clock.phase === "command" &&
      replayBattleState(state).clock.step === "start"
    )
  );
  assert.equal(battleWaaaghState(state, "player-1").active, false);
  assert.equal(battleWaaaghState(state, "player-1").available, false);
  assert.throws(
    () => callWaaagh(state, "player-1", "expired-second-waaagh", state.events.length + 1),
    /once per battle/i,
  );
});

test("executes Grim Resolve selection, expiry, and replacement-then-addition OC", () => {
  const astartes = {
    ...attackerFormation,
    keywords: ["Adeptus Astartes", "Infantry"],
    segments: attackerFormation.segments.map((segment) => ({
      ...segment,
      keywords: ["Adeptus Astartes", ...segment.keywords],
      objectiveControl: 2,
    })),
  };
  let state = registerBattleFormation(
    registerBattleFormation(newGrimResolveBattle(), astartes, "register-astartes", 1),
    formation,
    "register-grim-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-grim", 3);
  assert.equal(battleGrimResolveState(state, "player-1").available, true);
  state = selectGrimResolveFormation(
    state,
    "player-1",
    astartes.id,
    "select-grim",
    state.events.length + 1,
  );
  assert.equal(battleGrimResolveState(state, "player-1").activeFormationId, astartes.id);
  assert.equal(
    battleGrimResolveFormationFacts(state, astartes.id).models[0].resolvedObjectiveControl,
    3,
  );
  state = setFormationBattleShocked(
    state,
    astartes.id,
    true,
    "grim-battle-shocked",
    "shock-grim",
    state.events.length + 1,
  );
  const shocked = battleGrimResolveFormationFacts(state, astartes.id);
  assert.equal(shocked.valid, true);
  assert.equal(shocked.models[0].resolvedObjectiveControl, 2);
  assert.throws(
    () =>
      selectGrimResolveFormation(
        state,
        "player-1",
        astartes.id,
        "duplicate-grim",
        state.events.length + 1,
      ),
    /only one unit/i,
  );
});

test("requires Grim Resolve before leaving Command and rejects wrong sources and units", () => {
  const astartes = {
    ...attackerFormation,
    keywords: ["Adeptus Astartes", "Infantry"],
    segments: attackerFormation.segments.map((segment) => ({
      ...segment,
      objectiveControl: 2,
    })),
  };
  let state = registerBattleFormation(
    registerBattleFormation(newGrimResolveBattle(), astartes, "register-grim", 1),
    formation,
    "register-ineligible",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-grim-required", 3);
  assert.throws(
    () =>
      selectGrimResolveFormation(
        state,
        "player-1",
        formation.id,
        "select-ineligible",
        state.events.length + 1,
      ),
    /surviving Adeptus Astartes/i,
  );
  while (replayBattleState(state).clock.step !== "end") {
    state = advanceBattleClock(
      state,
      `grim-command-${state.events.length}`,
      state.events.length + 1,
    );
  }
  assert.throws(
    () => advanceBattleClock(state, "leave-command-without-grim", state.events.length + 1),
    /Select one surviving Adeptus Astartes/i,
  );

  let wrongSource = registerBattleFormation(newBattle(), astartes, "register-wrong-source", 1);
  wrongSource = registerBattleFormation(wrongSource, formation, "register-wrong-source-target", 2);
  wrongSource = startBattle(
    deployAllOnBattlefield(wrongSource),
    "player-1",
    "start-wrong-source",
    3,
  );
  assert.throws(
    () =>
      selectGrimResolveFormation(
        wrongSource,
        "player-1",
        astartes.id,
        "wrong-source-grim",
        wrongSource.events.length + 1,
      ),
    /source-locked Unforgiven/i,
  );
});

test("executes source-locked Oath of Moment selection, attack facts, and expiry", () => {
  const astartes = { ...attackerFormation, hasOathOfMomentAbility: true };
  let state = registerBattleFormation(
    registerBattleFormation(newSpaceMarinesBattle(), astartes, "register-oath-attacker", 1),
    formation,
    "register-oath-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-oath", 3);
  assert.equal(battleOathOfMomentState(state, "player-1").available, true);
  state = selectOathOfMomentTarget(
    state,
    "player-1",
    formation.id,
    "select-oath",
    state.events.length + 1,
  );
  const active = battleOathOfMomentState(state, "player-1");
  assert.equal(active.activeTargetFormationId, formation.id);
  assert.equal(active.available, false);
  const facts = battleOathOfMomentAttackFacts(state, astartes.id);
  assert.equal(facts.valid, true);
  assert.equal(facts.hitReroll, true);
  assert.equal(facts.activeTargetFormationId, formation.id);
  assert.throws(
    () =>
      selectOathOfMomentTarget(
        state,
        "player-1",
        formation.id,
        "duplicate-oath",
        state.events.length + 1,
      ),
    /only one target/i,
  );
  state = advanceBattleClock(state, "oath-to-battleshock", state.events.length + 1);
  assert.equal(battleOathOfMomentState(state, "player-1").activeTargetFormationId, formation.id);
  do {
    state = advanceBattleClock(
      state,
      `oath-expiry-${state.events.length}`,
      state.events.length + 1,
    );
  } while (
    !(
      replayBattleState(state).clock.activePlayerId === "player-1" &&
      replayBattleState(state).clock.battleRound === 2 &&
      replayBattleState(state).clock.phase === "command" &&
      replayBattleState(state).clock.step === "start"
    )
  );
  assert.equal(battleOathOfMomentState(state, "player-1").activeTargetFormationId, "");
  assert.equal(battleOathOfMomentState(state, "player-1").available, true);
});

test("requires Oath of Moment at Command start and rejects friendly or unsourced targets", () => {
  const astartes = { ...attackerFormation, hasOathOfMomentAbility: true };
  let state = registerBattleFormation(
    registerBattleFormation(newSpaceMarinesBattle(), astartes, "register-required-oath", 1),
    formation,
    "register-required-oath-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-required-oath", 3);
  assert.throws(
    () => advanceBattleClock(state, "leave-oath-start", state.events.length + 1),
    /Select one enemy unit for Oath of Moment/i,
  );
  assert.throws(
    () =>
      selectOathOfMomentTarget(
        state,
        "player-1",
        astartes.id,
        "friendly-oath",
        state.events.length + 1,
      ),
    /opponent's army/i,
  );

  let wrongSource = registerBattleFormation(newBattle(), astartes, "wrong-oath-source", 1);
  wrongSource = registerBattleFormation(wrongSource, formation, "wrong-oath-target", 2);
  wrongSource = startBattle(deployAllOnBattlefield(wrongSource), "player-1", "start-wrong-oath", 3);
  assert.throws(
    () =>
      selectOathOfMomentTarget(
        wrongSource,
        "player-1",
        formation.id,
        "unsourced-oath",
        wrongSource.events.length + 1,
      ),
    /source-locked Adeptus Astartes/i,
  );
});

test("unleashes source-locked Shadow in the Warp in either Command phase with auditable tests", () => {
  const tyranids = {
    ...attackerFormation,
    keywords: ["Tyranids", "Synapse", "Monster"],
    hasShadowInTheWarpAbility: true,
    segments: attackerFormation.segments.map((segment) => ({ ...segment, leadership: 7 })),
  };
  const target = {
    ...formation,
    segments: formation.segments.map((segment) => ({ ...segment, leadership: 7 })),
  };
  let state = registerBattleFormation(
    registerBattleFormation(newTyranidsBattle(), tyranids, "register-shadow-source", 1),
    target,
    "register-shadow-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-2", "start-shadow", 3);
  assert.equal(battleShadowInTheWarpState(state, "player-1").available, true);
  state = unleashShadowInTheWarp(
    state,
    "player-1",
    tyranids.id,
    "unleash-shadow",
    state.events.length + 1,
  );
  let shadow = battleShadowInTheWarpState(state, "player-1");
  assert.equal(shadow.used, true);
  assert.equal(shadow.pending.targets[0].leadership, 7);
  assert.equal(shadow.pending.targets[0].shadowSynapseWithin, null);
  assert.throws(
    () => advanceBattleClock(state, "skip-shadow-test", state.events.length + 1),
    /pending Shadow in the Warp|Resolve every pending Shadow/i,
  );
  const random = [5, 4];
  state = resolveShadowInTheWarpTest(
    state,
    target.id,
    {
      shadowSynapseWithin: true,
      ownSynapseWithin: false,
      reason: "Players measured the closest model boundaries on the table",
    },
    "resolve-shadow-test",
    state.events.length + 1,
    () => random.shift(),
  );
  const replayed = replayBattleState(state);
  const resolution = replayed.shadowInTheWarpResolutions[0];
  assert.deepEqual(resolution.dice, [6, 5]);
  assert.equal(resolution.failed, true);
  assert.equal(resolution.battleShockedBefore, false);
  assert.equal(replayed.battleShockedFormations.has(target.id), true);
  assert.equal(battleShadowInTheWarpState(state, "player-1").pending, null);
  assert.throws(
    () =>
      unleashShadowInTheWarp(
        state,
        "player-1",
        tyranids.id,
        "repeat-shadow",
        state.events.length + 1,
      ),
    /once per battle/i,
  );
  const tampered = structuredClone(state);
  tampered.events.find((event) => event.id === "resolve-shadow-test").failed = false;
  assert.throws(() => replayBattleState(tampered), /not canonical/i);
});

test("resolves Counter-offensive atomically and forces its formation to fight next", () => {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "register-attacker", 1),
    formation,
    "register-target",
    2,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start", 3);
  state = changeBattleResource(
    state,
    {
      playerId: "player-2",
      resourceId: "command_points",
      name: "Command Points",
      delta: 1,
      reason: "Test setup",
    },
    "grant-cp",
    state.events.length + 1,
  );
  state = advanceTo(state, (clock) => clock.phase === "movement" && clock.step === "move_units");
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "stationary",
    state.events.length + 1,
  );
  state = advanceTo(state, (clock) => clock.phase === "charge" && clock.step === "charge_moves");
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id),
    "charge",
    state.events.length + 1,
  );
  state = passHeroicIntervention(
    state,
    "The defending player declines Heroic Intervention",
    "pass-heroic",
    state.events.length + 1,
  );
  state = advanceTo(state, (clock) => clock.phase === "fight" && clock.step === "fights_first");
  state = passFightPriority(
    state,
    "No defending Fights First unit",
    "pass-priority",
    state.events.length + 1,
  );
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "fight-start",
    state.events.length + 1,
  );
  state = recordFightMove(
    state,
    "pile_in",
    enemyFightMoveOptions("pile_in"),
    "pile-in",
    state.events.length + 1,
  );
  state = recordFightMove(
    state,
    "consolidation",
    enemyFightMoveOptions("consolidation"),
    "consolidation",
    state.events.length + 1,
  );
  state = completeFormationActivation(state, "fight-complete", state.events.length + 1);
  let replayed = replayBattleState(state);
  assert.deepEqual(replayed.pendingCounterOffensive.candidateFormationIds, [formation.id]);
  assert.throws(
    () => passFightPriority(state, "Cannot pass", "illegal-pass", state.events.length + 1),
    /Counter-offensive window/i,
  );
  const declined = passCounterOffensive(
    state,
    "The responding player saves their CP",
    "decline-counter-offensive",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(declined).pendingCounterOffensive, null);
  assert.equal(replayBattleState(declined).counterOffensivePasses.length, 1);
  assert.equal(
    replayBattleState(declined).resources.get("player-2").get("command_points").value,
    2,
  );
  state = resolveCounterOffensive(
    state,
    formation.id,
    "The formation is within Engagement Range of the enemy",
    "counter-offensive",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 0);
  assert.equal(replayed.forcedFightFormationId, formation.id);
  assert.equal(replayed.counterOffensives.length, 1);
  assert.equal(
    battleCanStartFormationActivation(state, attackerFormation.id, { weaponType: "Melee" }),
    false,
  );
  assert.equal(
    battleCanStartFormationActivation(state, formation.id, {
      weaponType: "Melee",
      eligibilityOverride: true,
    }),
    true,
  );
  state = startFormationActivation(
    state,
    formation.id,
    { eligibilityOverride: true, overrideReason: "Confirmed within Engagement Range" },
    "counter-fight-start",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).forcedFightFormationId, "");
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
  const aircraft = {
    ...attackerFormation,
    keywords: ["Aircraft", "Vehicle"],
    deploymentTraits: { dedicatedTransport: false, aircraft: true, hover: true },
  };
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

test("activates source-locked Reanimation Protocols one wound at a time", () => {
  const necrons = {
    ...formation,
    reanimationProtocolSavedUnitIds: ["unit-1", "unit-2"],
  };
  let state = registeredBattle(newNecronsBattle(), necrons);
  state = recordVisibleRangedTarget(state, attackerFormation.id, necrons.id, {
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
    id: "reanimation-damage",
    at: state.events.length + 1,
    attackerFormationId: attackerFormation.id,
    targetFormationId: necrons.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 4, modelsDestroyed: 1 },
    summary: {
      attacker: attackerFormation.name,
      weapon: "Cannon",
      target: necrons.name,
      damage: 4,
      successful: 1,
    },
  });
  state = completeFormationActivation(
    state,
    "complete-reanimation-attacker",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) =>
      clock.activePlayerId === "player-2" && clock.phase === "command" && clock.step === "end",
    "to-reanimation",
  );
  const available = battleReanimationProtocolsState(state, "player-2");
  assert.equal(available.sourceLocked, true);
  assert.equal(available.eligibleUnits.length, 1);
  assert.equal(available.eligibleUnits[0].activated, false);

  state = activateReanimationProtocols(
    state,
    "player-2",
    necrons.id,
    available.eligibleUnits[0].unitKey,
    "activate-reanimation",
    state.events.length + 1,
    () => 2,
  );
  assert.equal(replayBattleState(state).pendingReanimationProtocols.roll, 3);
  assert.deepEqual(replayBattleState(state).pendingReanimationProtocols.options, [
    { segmentId: "bodyguard", action: "heal" },
  ]);
  state = resolveReanimationWound(
    state,
    "bodyguard",
    "heal",
    "heal-reanimation",
    state.events.length + 1,
  );
  assert.deepEqual(replayBattleState(state).pendingReanimationProtocols.options, [
    { segmentId: "bodyguard", action: "return" },
  ]);
  state = resolveReanimationWound(
    state,
    "bodyguard",
    "return",
    "return-reanimation",
    state.events.length + 1,
  );
  state = resolveReanimationWound(
    state,
    "bodyguard",
    "heal",
    "heal-returned-model",
    state.events.length + 1,
  );
  assert.deepEqual(battleFormationHealth(state, necrons.id), {
    bodyguard: { modelsRemaining: 2, woundsLost: 1 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.equal(replayBattleState(state).pendingReanimationProtocols, null);
  assert.doesNotThrow(() =>
    advanceBattleClock(state, "leave-reanimation-command", state.events.length + 1),
  );

  const tampered = structuredClone(state);
  tampered.events.find((event) => event.id === "return-reanimation").after.woundsLost = 0;
  assert.throws(() => normalizeBattleState(tampered), /not canonical/);
});

test("does not return a destroyed Bodyguard unit solely because its Leader survives", () => {
  const necrons = {
    ...formation,
    reanimationProtocolSavedUnitIds: ["unit-1", "unit-2"],
  };
  let state = registeredBattle(newNecronsBattle(), necrons);
  state = recordVisibleRangedTarget(state, attackerFormation.id, necrons.id, {
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
    id: "destroy-bodyguard",
    at: state.events.length + 1,
    attackerFormationId: attackerFormation.id,
    targetFormationId: necrons.id,
    segmentIds: ["bodyguard", "leader"],
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 6, modelsDestroyed: 2 },
    summary: {
      attacker: attackerFormation.name,
      weapon: "Cannon",
      target: necrons.name,
      damage: 6,
      successful: 2,
    },
  });
  state = completeFormationActivation(state, "complete-bodyguard-attack", state.events.length + 1);
  state = advanceTo(
    state,
    (clock) =>
      clock.activePlayerId === "player-2" && clock.phase === "command" && clock.step === "end",
    "to-destroyed-bodyguard-reanimation",
  );

  const available = battleReanimationProtocolsState(state, "player-2");
  assert.equal(available.eligibleUnits.length, 1);
  assert.deepEqual(available.eligibleUnits[0].segmentIds, ["leader"]);
  assert.match(available.eligibleUnits[0].unitKey, /:leader:unit-2$/);
  state = activateReanimationProtocols(
    state,
    "player-2",
    necrons.id,
    available.eligibleUnits[0].unitKey,
    "activate-surviving-leader",
    state.events.length + 1,
    () => 2,
  );
  assert.equal(replayBattleState(state).pendingReanimationProtocols, null);
  assert.deepEqual(battleFormationHealth(state, necrons.id), {
    bodyguard: { modelsRemaining: 0, woundsLost: 0 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
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
  assert.equal(replayed.objectives.get("centre").controlSource, "player_recorded");
  assert.equal(replayed.battleShockedFormations.has(formation.id), true);
  state = clearBattleObjectiveControlOverride(
    state,
    "centre",
    "clear-control",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.objectives.get("centre").controlSource, "unknown");

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

test("replays source-locked Chapter Approved scoring, cards, New Orders, and Actions", () => {
  let state = registerBattleFormation(
    registerBattleFormation(sourceLockedMissionBattle(), attackerFormation, "mission-attacker", 1),
    formation,
    "mission-target",
    2,
  );
  state = configureSecondaryMissionPlan(
    state,
    {
      playerId: "player-1",
      mode: "tactical",
      fixedCards: [],
      tacticalDeckSize: 18,
      cardRulesAvailability: "player-supplied-physical-deck",
      reviewedByPlayer: true,
      reviewReason: "Tactical deck selected and physical cards available",
    },
    "mission-plan-1",
    3,
  );
  state = configureSecondaryMissionPlan(
    state,
    {
      playerId: "player-2",
      mode: "fixed",
      fixedCards: [
        { id: "fixed-a", name: "Player supplied fixed card A" },
        { id: "fixed-b", name: "Player supplied fixed card B" },
      ],
      tacticalDeckSize: 0,
      cardRulesAvailability: "player-supplied-physical-deck",
      reviewedByPlayer: true,
      reviewReason: "Two physical Fixed Secondary cards selected",
    },
    "mission-plan-2",
    4,
  );
  state = startBattle(deployAllOnBattlefield(state), "player-1", "mission-start", 5);
  state = drawSecondaryMissionCard(
    state,
    "player-1",
    { id: "tactical-a", name: "Player supplied card A" },
    "draw-a",
    6,
  );
  state = drawSecondaryMissionCard(
    state,
    "player-1",
    { id: "tactical-b", name: "Player supplied card B" },
    "draw-b",
    7,
  );
  state = scoreMissionPoints(
    state,
    "player-1",
    "primary",
    60,
    "Reviewed the physical Primary Mission condition",
    "primary-cap",
    8,
  );
  state = scoreSecondaryMissionCard(
    state,
    "player-1",
    "tactical-a",
    45,
    "Reviewed the physical Secondary Mission condition",
    "secondary-cap",
    9,
  );
  let replayed = replayBattleState(state);
  assert.deepEqual(replayed.missionCategoryPoints.get("player-1"), {
    primary: 50,
    secondary: 40,
    battle_ready: 0,
    total: 90,
  });
  assert.equal(replayed.resources.get("player-1").get("victory_points").value, 90);
  assert.throws(
    () => scoreBattlePoints(state, "player-1", 1, "primary", "Manual VP", "manual-vp", 10),
    /must use capped Primary, Secondary, or Battle Ready events/,
  );
  assert.throws(
    () =>
      scoreMissionPoints(
        state,
        "player-1",
        "battle_ready",
        10,
        "Army appearance reviewed",
        "battle-ready-early",
        11,
      ),
    /end of the fifth battle round/,
  );

  state = advanceTo(
    state,
    (clock) => clock.phase === "command" && clock.step === "end",
    "mission-command-end",
  );
  state = changeBattleResource(
    state,
    {
      playerId: "player-1",
      resourceId: "command_points",
      name: "Command Points",
      delta: 1,
      reason: "Test fixture CP",
    },
    "mission-extra-cp",
    state.events.length + 1,
  );
  state = resolveNewOrders(
    state,
    "player-1",
    "tactical-b",
    { id: "tactical-c", name: "Player supplied card C" },
    "new-orders",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      resolveNewOrders(
        state,
        "player-1",
        "tactical-c",
        { id: "tactical-d", name: "Player supplied card D" },
        "new-orders-twice",
        state.events.length + 1,
      ),
    /more than once in the same Command phase/,
  );
  state = startMissionAction(
    state,
    {
      playerId: "player-1",
      formationId: attackerFormation.id,
      cardId: "tactical-a",
      actionKey: "physical-card-action",
      actionName: "Player supplied Action",
      simultaneousUnitLimit: 1,
      facts: {
        aircraft: false,
        battleShocked: false,
        objectiveControl: 3,
        withinEngagementRange: true,
        titanicCharacter: true,
        advancedOrFellBack: false,
        eligibleToShoot: true,
        alreadyShot: false,
        timingReviewed: true,
        cardRulesReviewed: true,
        unitLimitAvailable: true,
        reviewReason: "Physical card timing and Action conditions reviewed",
      },
    },
    "start-titanic-action",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "mission-movement",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "mission-stationary",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "shooting" && clock.step === "resolve_attacks",
    "mission-shooting",
  );
  state = startFormationActivation(
    state,
    attackerFormation.id,
    {},
    "mission-shooting-activation",
    state.events.length + 1,
  );
  state = completeFormationActivation(state, "mission-shooting-complete", state.events.length + 1);
  state = resolveMissionAction(
    state,
    attackerFormation.id,
    true,
    "Physical card completion condition reviewed",
    "mission-action-complete",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "fight" && clock.step === "end",
    "mission-turn-end",
  );
  state = resolveSecondaryTurnEnd(
    state,
    "player-1",
    { achievedCardIds: ["tactical-a"], voluntaryCardIds: ["tactical-c"] },
    "mission-secondary-turn-end",
    state.events.length + 1,
  );
  assert.doesNotThrow(() =>
    advanceBattleClock(state, "mission-next-turn", state.events.length + 1),
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.completedMissionActions.length, 1);
  assert.equal(replayed.secondaryDiscardedCardIds.get("player-1").size, 3);
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
    state = replayBattleState(state).pendingRapidIngress
      ? passRapidIngress(
          state,
          "Keep the formation off the battlefield",
          `complete-rapid-pass-${state.events.length}`,
          state.events.length + 1,
        )
      : advanceBattleClock(state, `complete-${state.events.length}`, state.events.length + 1);
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

function rapidIngressBattle(location = "strategic_reserves", earliestBattleRound = 2) {
  let state = registerBattleFormation(
    registerBattleFormation(newBattle(), attackerFormation, "rapid-register-active", 1),
    formation,
    "rapid-register-reserve",
    2,
  );
  state = configureBattleMission(
    state,
    {
      name: "Rapid Ingress test",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "rapid-mission",
    3,
  );
  state = declareFormationDeployment(
    state,
    attackerFormation.id,
    "battlefield",
    {},
    "rapid-declare-active",
    4,
  );
  state = declareFormationDeployment(
    state,
    formation.id,
    location,
    {
      points: location === "strategic_reserves" ? 100 : 0,
      earliestBattleRound,
      eligibilityConfirmed: true,
      eligibilityReason:
        location === "strategic_reserves" ? "Core Strategic Reserves" : "Source Reserve rule",
    },
    "rapid-declare-reserve",
    5,
  );
  state = deployFormation(
    state,
    attackerFormation.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "rapid-deploy-active",
    6,
  );
  return startBattle(state, "player-1", "rapid-start", 7);
}

test("opens and resolves canonical Rapid Ingress at the opponent Movement phase end", () => {
  let state = rapidIngressBattle();
  state = advanceTo(
    state,
    (clock) =>
      clock.battleRound === 2 &&
      clock.activePlayerId === "player-1" &&
      clock.phase === "movement" &&
      clock.step === "end",
    "rapid-to-round-two-end",
  );
  let replayed = replayBattleState(state);
  assert.deepEqual(replayed.pendingRapidIngress.candidateFormationIds, [formation.id]);
  assert.equal(replayed.pendingRapidIngress.responderPlayerId, "player-2");
  assert.throws(
    () => advanceBattleClock(state, "rapid-blocked", state.events.length + 1),
    /Rapid Ingress window/,
  );

  const declined = passRapidIngress(
    state,
    "Keep the formation in Reserves",
    "rapid-pass",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(declined).pendingRapidIngress, null);
  assert.equal(replayBattleState(declined).rapidIngressPasses.length, 1);

  state = resolveRapidIngress(
    state,
    formation.id,
    {
      placementMethod: "strategic_reserves",
      placementConfirmed: true,
      placementReason: "Wholly within 6 inches of the side edge and outside 9 inches",
      whollyWithinSixOfBattlefieldEdge: true,
      outsideEnemyDeploymentZone: true,
      moreThanNineFromEnemyModels: true,
    },
    "rapid-resolve",
    state.events.length + 1,
  );
  replayed = replayBattleState(state);
  assert.equal(replayed.pendingRapidIngress, null);
  assert.equal(replayed.deployedFormationIds.has(formation.id), true);
  assert.equal(replayed.offBattlefieldFormationIds.has(formation.id), false);
  assert.equal(replayed.resources.get("player-2").get("command_points").value, 0);
  assert.equal(replayed.reserveArrivals.get(formation.id).type, "rapid_ingress_resolved");
  assert.deepEqual(replayed.movementByFormation.get(formation.id), {
    formationId: formation.id,
    movement: "normal",
    clock: replayed.clock,
    fromReserves: true,
    rapidIngress: true,
  });
  assert.equal(replayed.rapidIngresses[0].passengersCannotDisembarkThisPhase, true);

  const tampered = structuredClone(state);
  tampered.events.find((event) => event.id === "rapid-resolve").outsideEnemyDeploymentZone = false;
  assert.throws(() => normalizeBattleState(tampered), /Rapid Ingress facts/i);
});

test("enforces the first-round out-of-phase rule and complete Deep Strike formation", () => {
  let state = rapidIngressBattle("reserves", 1);
  state = advanceTo(
    state,
    (clock) =>
      clock.battleRound === 1 &&
      clock.activePlayerId === "player-1" &&
      clock.phase === "movement" &&
      clock.step === "end",
    "rapid-to-round-one-end",
  );
  assert.ok(replayBattleState(state).pendingRapidIngress);
  assert.throws(
    () =>
      resolveRapidIngress(
        state,
        formation.id,
        {
          placementMethod: "deep_strike",
          placementConfirmed: true,
          placementReason: "Outside 9 inches",
          allModelsHaveDeepStrike: true,
          moreThanNineFromEnemyModels: true,
        },
        "rapid-round-one-without-source",
        state.events.length + 1,
      ),
    /Rapid Ingress facts/i,
  );
  state = resolveRapidIngress(
    state,
    formation.id,
    {
      placementMethod: "deep_strike",
      placementConfirmed: true,
      placementReason: "Every model Deep Strikes outside 9 inches",
      allModelsHaveDeepStrike: true,
      moreThanNineFromEnemyModels: true,
      firstRoundOutOfPhaseAllowed: true,
      firstRoundOutOfPhaseReason: "Source rule permits a first-round Reserve setup in any turn",
    },
    "rapid-round-one",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).rapidIngresses[0].placementMethod, "deep_strike");

  const partialDeepStrike = structuredClone(state);
  partialDeepStrike.events.find((event) => event.id === "rapid-round-one").allModelsHaveDeepStrike =
    false;
  assert.throws(() => normalizeBattleState(partialDeepStrike), /Rapid Ingress facts/i);
});

test("enforces the large-model Rapid Ingress action restriction without suppressing melee attacks", () => {
  let state = rapidIngressBattle();
  state = advanceTo(
    state,
    (clock) =>
      clock.battleRound === 2 &&
      clock.activePlayerId === "player-1" &&
      clock.phase === "movement" &&
      clock.step === "move_units",
    "large-rapid-to-move-units",
  );
  state = recordFormationMovement(
    state,
    attackerFormation.id,
    "stationary",
    "large-rapid-attacker-stationary",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "movement" && clock.step === "end",
    "large-rapid-to-movement-end",
  );
  state = resolveRapidIngress(
    state,
    formation.id,
    {
      placementMethod: "strategic_reserves",
      placementConfirmed: true,
      placementReason: "Large model touches its own battlefield edge outside 9 inches",
      moreThanNineFromEnemyModels: true,
      largeModelEdgeException: true,
      touchingOwnBattlefieldEdge: true,
    },
    "large-rapid-resolve",
    state.events.length + 1,
  );
  assert.equal(
    replayBattleState(state).largeModelRapidIngressRestrictedFormationIds.has(formation.id),
    true,
  );
  state = changeBattleResource(
    state,
    {
      playerId: "player-2",
      resourceId: "command_points",
      name: "Command Points",
      delta: 2,
      reason: "Test reaction restrictions",
    },
    "large-rapid-grant-cp",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "large-rapid-to-charge",
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
    "large-rapid-charge-declared",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      startFireOverwatch(
        state,
        formation.id,
        {
          distanceThousandths: 8000,
          targetVisible: true,
          shootingEligibilityConfirmed: true,
          shootingEligibilityReason: "Otherwise eligible to shoot",
          outOfPhaseRestrictionsConfirmed: true,
          outOfPhaseRestrictionsReason: "Out-of-phase rules reviewed",
        },
        "large-rapid-overwatch",
        state.events.length + 1,
      ),
    /cannot shoot this turn/i,
  );
  state = passFireOverwatch(
    state,
    "Large-model Rapid Ingress restriction prevents shooting",
    "large-rapid-pass-overwatch",
    state.events.length + 1,
  );
  state = recordFormationCharge(
    state,
    attackerFormation.id,
    [formation.id],
    successfulChargeOptions(formation.id),
    "large-rapid-charge-resolved",
    state.events.length + 1,
  );
  assert.throws(
    () =>
      resolveHeroicIntervention(
        state,
        formation.id,
        {
          successful: true,
          rolls: [3, 4],
          chargeDistanceThousandths: 7000,
          startDistanceThousandths: 6000,
          targetEligibilityConfirmed: true,
          targetEligibilityReason: "Within 6 inches of the triggering charger",
          startedOutsideEngagementRange: true,
          maximumModelMoveThousandths: 5000,
          endsWithinEngagementRange: true,
          unitCoherencyConfirmed: true,
          nonTargetEngagementRangeAvoided: true,
          allModelsCloserToTarget: true,
          baseContactMaximized: true,
          movementReviewedByPlayer: true,
          movementReviewReason: "Player reviewed every endpoint",
        },
        "large-rapid-heroic",
        state.events.length + 1,
      ),
    /prevents this formation from charging/i,
  );
  state = passHeroicIntervention(
    state,
    "Large-model Rapid Ingress restriction prevents charging",
    "large-rapid-pass-heroic",
    state.events.length + 1,
  );
  state = advanceTo(
    state,
    (clock) => clock.phase === "fight" && clock.step === "fights_first",
    "large-rapid-to-fight",
  );
  state = advanceBattleClock(state, "large-rapid-to-remaining", state.events.length + 1);
  assert.equal(
    battleCanStartFormationActivation(state, formation.id, {
      weaponType: "Melee",
      eligibilityOverride: true,
    }),
    true,
  );
  state = startFormationActivation(
    state,
    formation.id,
    { eligibilityOverride: true, overrideReason: "The enemy charged this formation" },
    "large-rapid-fight-start",
    state.events.length + 1,
  );
  state = recordFightMove(
    state,
    "pile_in",
    enemyFightMoveOptions("pile_in"),
    "large-rapid-pile-in",
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).activeActivation.pileIn.destination, "none");
  assert.equal(replayBattleState(state).activeActivation.pileIn.movementRuleRestricted, true);
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
  missingAttacker.events = missingAttacker.events
    .filter((event) => event.id !== "event-register-attacker")
    .map((event, index) => ({
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
