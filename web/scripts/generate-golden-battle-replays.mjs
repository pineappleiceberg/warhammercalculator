import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

import {
  BATTLE_STATE_VERSION,
  TABLE_GEOMETRY_CONSTANTS,
  advanceBattleClock,
  appendResolvedAttack,
  closeRangedTargetDeclarations,
  completeFormationActivation,
  completeFormationMovement,
  configureBattleMission,
  configureBattleTableGeometry,
  configureBattleTerrainFootprints,
  configureBattleTerrainVisibility,
  configureBattleWeaponBearers,
  configureSecondaryMissionPlan,
  declareFormationCharge,
  declareFormationDeployment,
  deployFormation,
  drawSecondaryMissionCard,
  modelPositionContextUsesPath,
  passCounterOffensive,
  passFireOverwatch,
  passFightPriority,
  passHeroicIntervention,
  passRapidIngress,
  passSmokescreen,
  recordFightMove,
  recordFormationCharge,
  recordDeploymentModelPlacements,
  recordModelPositions,
  recordRangedTargetEligibility,
  replayBattleState,
  resolveGoToGround,
  resolveSecondaryTurnEnd,
  scoreMissionPoints,
  scoreSecondaryMissionCard,
  setBattleObjectiveControl,
  startBattle,
  startFireOverwatch,
  startFormationActivation,
  startFormationMovement,
} from "../lib/battle-state.mjs";
import { initializeBattleForLists } from "../lib/battle-setup.mjs";
import { goldenBattleReplaySummary } from "../lib/golden-battle-replay.mjs";
import { normalizeRuleCoverageMatrix } from "../lib/rule-coverage.mjs";

const fixtureUrl = new URL(
  "../tests/fixtures/golden-battle-necrons-vs-space-marines-v1.json",
  import.meta.url,
);
const actionFixtureUrl = new URL(
  "../tests/fixtures/golden-battle-action-necrons-vs-space-marines-v1.json",
  import.meta.url,
);
const catalogue = JSON.parse(
  await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
);
const coverageSource = JSON.parse(
  await readFile(new URL("../../data/battle-rule-coverage.json", import.meta.url), "utf8"),
);
const sourceManifest = JSON.parse(
  await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
);
const missionPackCatalogue = JSON.parse(
  await readFile(new URL("../../data/chapter-approved-2025-26-v1.4.json", import.meta.url), "utf8"),
);
const ruleCoverageMatrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);

function catalogueUnit(name) {
  const unit = catalogue.units.find((candidate) => candidate.name === name);
  assert.ok(unit, `Missing catalogue unit ${name}`);
  return unit;
}

function oneUnitList({
  id,
  updatedAt,
  name,
  unitName,
  savedUnitId,
  modelCount = 1,
  weaponName = "",
  weaponSelections = [],
}) {
  const source = catalogueUnit(unitName);
  const weapons = [];
  const selections = weaponName ? [{ name: weaponName, count: 1 }] : weaponSelections;
  for (const selection of selections) {
    const weapon = source.weapons.find((candidate) => candidate.name === selection.name);
    assert.ok(weapon, `Missing ${unitName} weapon ${selection.name}`);
    weapons.push({
      weaponId: weapon.id,
      groupId: weapon.groupId,
      name: weapon.groupName,
      count: selection.count,
    });
  }
  return {
    id,
    createdAt: 1,
    updatedAt,
    name,
    factionId: source.factionId,
    units: [
      {
        id: savedUnitId,
        unitId: source.id,
        name: source.name,
        modelCount,
        weapons,
      },
    ],
  };
}

const attackers = oneUnitList({
  id: "golden-necrons",
  updatedAt: 10,
  name: "Golden Necrons",
  unitName: "Doom Scythe",
  savedUnitId: "doom-scythe",
  weaponName: "Heavy death ray",
});
const defenders = oneUnitList({
  id: "golden-space-marines",
  updatedAt: 20,
  name: "Golden Space Marines",
  unitName: "Brutalis Dreadnought",
  savedUnitId: "brutalis",
});

const actionAttackers = oneUnitList({
  id: "golden-action-necrons",
  updatedAt: 30,
  name: "Golden Action Necrons",
  unitName: "Canoptek Doomstalker",
  savedUnitId: "doomstalker",
  weaponSelections: [
    { name: "Doomsday blaster", count: 1 },
    { name: "Doomstalker limbs", count: 1 },
  ],
});
const actionDefenders = oneUnitList({
  id: "golden-action-space-marines",
  updatedAt: 40,
  name: "Golden Action Space Marines",
  unitName: "Intercessor Squad",
  savedUnitId: "intercessors",
  modelCount: 5,
  weaponSelections: [
    { name: "Bolt rifle", count: 5 },
    { name: "Close combat weapon", count: 5 },
  ],
});

const exactMissionOverrides = {
  guidedReason: "Players reviewed every guided source rule for the golden replay",
  players: {
    "player-1": { detachmentSourceId: "000000818" },
    "player-2": { detachmentSourceId: "000000750" },
  },
  missionSourceId: "chapter-approved-2025-26-v1.4-a",
  terrainSourceId: "chapter-approved-2025-26-v1.4-layout-1",
};

function addFixedSecondaryPlans(state) {
  let next = state;
  for (const playerId of ["player-1", "player-2"]) {
    next = configureSecondaryMissionPlan(
      next,
      {
        playerId,
        mode: "fixed",
        fixedCards: [
          { id: `${playerId}:fixed:1`, name: "Golden fixed card 1" },
          { id: `${playerId}:fixed:2`, name: "Golden fixed card 2" },
        ],
        tacticalDeckSize: 0,
        cardRulesAvailability: "player-supplied-physical-deck",
        reviewedByPlayer: true,
        reviewReason: "Physical Fixed Secondary cards reviewed for the golden replay",
      },
      `secondary-plan-${playerId}`,
      next.events.length + 1,
    );
  }
  return next;
}

function addActionSecondaryPlans(state) {
  let next = configureSecondaryMissionPlan(
    state,
    {
      playerId: "player-1",
      mode: "tactical",
      fixedCards: [],
      tacticalDeckSize: 2,
      cardRulesAvailability: "player-supplied-physical-deck",
      reviewedByPlayer: true,
      reviewReason: "The two-card physical Tactical deck is locked for the action replay",
    },
    "action-secondary-plan-player-1",
    state.events.length + 1,
  );
  next = configureSecondaryMissionPlan(
    next,
    {
      playerId: "player-2",
      mode: "fixed",
      fixedCards: [
        { id: "player-2:fixed:1", name: "Golden action fixed card 1" },
        { id: "player-2:fixed:2", name: "Golden action fixed card 2" },
      ],
      tacticalDeckSize: 0,
      cardRulesAvailability: "player-supplied-physical-deck",
      reviewedByPlayer: true,
      reviewReason: "The two physical Fixed Secondary cards are locked for the action replay",
    },
    "action-secondary-plan-player-2",
    next.events.length + 1,
  );
  return next;
}

function reviewedTableGeometry(state) {
  const objectivePositions = replayBattleState(state).mission.objectives.map(
    (objective, index) => ({
      objectiveId: objective.id,
      xThousandths: 10_000 + index * 8_000,
      yThousandths: 6_000 + index * 7_000,
    }),
  );
  return {
    missionSourceId: exactMissionOverrides.missionSourceId,
    terrainSourceId: exactMissionOverrides.terrainSourceId,
    deploymentName: "Tipping Point",
    battlefieldWidthThousandths: TABLE_GEOMETRY_CONSTANTS.widthThousandths,
    battlefieldHeightThousandths: TABLE_GEOMETRY_CONSTANTS.heightThousandths,
    origin: "attacker-left-near",
    objectivePositions,
    terrainProfile: {
      sectionCount: TABLE_GEOMETRY_CONSTANTS.terrainSectionCount,
      sixByFourCount: TABLE_GEOMETRY_CONSTANTS.sixByFourCount,
      tenByFiveCount: TABLE_GEOMETRY_CONSTANTS.tenByFiveCount,
      twelveBySixCount: TABLE_GEOMETRY_CONSTANTS.twelveBySixCount,
      sourcePage: 8,
    },
    terrainLayoutReviewed: true,
    deploymentZonesReviewed: true,
    objectivePositionsReviewed: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Golden replay tournament frame reviewed against the source card and layout",
  };
}

function reviewedTerrainFootprints(state) {
  const geometry = replayBattleState(state).tableGeometry;
  const dimensions = [
    ...Array.from({ length: 4 }, () => [6_000, 4_000]),
    ...Array.from({ length: 2 }, () => [10_000, 5_000]),
    ...Array.from({ length: 6 }, () => [12_000, 6_000]),
  ];
  const centres = [
    [4_000, 3_000],
    [12_000, 3_000],
    [20_000, 3_000],
    [28_000, 3_000],
    [5_000, 10_000],
    [17_000, 10_000],
    [6_000, 18_000],
    [20_000, 18_000],
    [34_000, 18_000],
    [48_000, 18_000],
    [6_000, 30_000],
    [20_000, 30_000],
  ];
  return {
    missionSourceId: geometry.missionSourceId,
    terrainSourceId: geometry.terrainSourceId,
    battlefieldWidthThousandths: geometry.battlefieldWidthThousandths,
    battlefieldHeightThousandths: geometry.battlefieldHeightThousandths,
    origin: geometry.origin,
    sourcePage: geometry.terrainProfile.sourcePage,
    footprints: dimensions.map(([widthThousandths, heightThousandths], index) => ({
      id: `outline-${index + 1}`,
      widthThousandths,
      heightThousandths,
      centerXThousandths: centres[index][0],
      centerYThousandths: centres[index][1],
      rotationMilliDegrees: 0,
      areaTerrainSectionId: `section-${index + 1}`,
    })),
    placementReviewed: true,
    sectionGroupingReviewed: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Golden replay terrain outlines and section grouping reviewed",
  };
}

function reviewedTerrainVisibility(state) {
  const terrain = replayBattleState(state).terrainFootprints;
  return {
    missionSourceId: terrain.missionSourceId,
    terrainSourceId: terrain.terrainSourceId,
    sections: terrain.footprints.map((footprint) => ({
      sectionId: footprint.areaTerrainSectionId,
      featureType: "ruins",
      geometryComplete: true,
      movementType: "ruins",
      movementGeometryComplete: true,
      panels: [],
      surfaces: [],
    })),
    allFeaturesRecorded: true,
    allMovementGeometryRecorded: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Golden replay terrain walls, openings, and movement solids reviewed",
  };
}

function reviewedSilhouette() {
  return {
    shape: "circle",
    widthThousandths: 1_000,
    depthThousandths: 1_000,
    heightThousandths: 2_000,
    bottomOffsetThousandths: 0,
    centerOffsetXThousandths: 0,
    centerOffsetYThousandths: 0,
    sightPoints: [{ xOffsetThousandths: 0, yOffsetThousandths: 0, heightThousandths: 1_000 }],
    envelopeReviewed: true,
    sightPointsReviewed: true,
  };
}

function reviewedDeploymentModelPlacements(
  state,
  formationId,
  referenceEventId,
  { baseX: requestedBaseX = null, baseY: requestedBaseY = null } = {},
) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(formationId);
  const geometry = replayed.tableGeometry;
  const slot = [...replayed.formations.keys()].indexOf(formationId);
  const baseX = requestedBaseX ?? (slot % 2 === 0 ? 5_000 : 35_000);
  const baseY = requestedBaseY ?? 5_000 + Math.floor(slot / 2) * 10_000;
  return {
    context: "deployment",
    referenceEventId,
    missionSourceId: geometry.missionSourceId,
    terrainSourceId: geometry.terrainSourceId,
    battlefieldWidthThousandths: geometry.battlefieldWidthThousandths,
    battlefieldHeightThousandths: geometry.battlefieldHeightThousandths,
    origin: geometry.origin,
    models: formation.modelInstances.map((model, index) => ({
      modelId: model.id,
      measurementBasis: "base",
      shape: "circle",
      widthThousandths: 1_000,
      depthThousandths: 1_000,
      centerXThousandths: baseX + index * 2_000,
      centerYThousandths: baseY,
      elevationThousandths: 0,
      rotationMilliDegrees: 0,
      silhouette: reviewedSilhouette(),
    })),
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Golden replay model envelopes and deployment coordinates reviewed",
  };
}

function deployAll(state, placementByFormationId = {}) {
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
        replayed.deploymentByFormation.get(candidate.id)?.location === "battlefield" &&
        !replayed.deployedFormationIds.has(candidate.id),
    );
    assert.ok(formation, "Expected a formation for alternating deployment");
    const deploymentEventId = `deploy-${formation.id}`;
    next = deployFormation(
      next,
      formation.id,
      { placementConfirmed: true, placementReason: "Reviewed legal deployment-zone position" },
      deploymentEventId,
      next.events.length + 1,
    );
    next = recordDeploymentModelPlacements(
      next,
      formation.id,
      reviewedDeploymentModelPlacements(
        next,
        formation.id,
        deploymentEventId,
        placementByFormationId[formation.id],
      ),
      `place-${formation.id}`,
      next.events.length + 1,
    );
  }
  return next;
}

function reviewedModelPositions(
  state,
  formationId,
  context,
  referenceEventId,
  { deltaXThousandths = 0 } = {},
) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(formationId);
  const geometry = replayed.tableGeometry;
  const previous = replayed.currentModelPositionsByFormation.get(formationId);
  const pending = replayed.pendingModelPosition;
  assert.ok(formation);
  assert.ok(geometry);
  assert.ok(previous);
  const survivingIds = formation.segments.flatMap((segment) =>
    segment.modelIds.slice(0, formation.health[segment.id].modelsRemaining),
  );
  const usesPath = modelPositionContextUsesPath(context);
  const point = (model) => ({
    centerXThousandths: model.centerXThousandths,
    centerYThousandths: model.centerYThousandths,
    elevationThousandths: model.elevationThousandths,
    rotationMilliDegrees: model.rotationMilliDegrees,
  });
  return {
    context,
    referenceEventId,
    missionSourceId: geometry.missionSourceId,
    terrainSourceId: geometry.terrainSourceId,
    battlefieldWidthThousandths: geometry.battlefieldWidthThousandths,
    battlefieldHeightThousandths: geometry.battlefieldHeightThousandths,
    origin: geometry.origin,
    models: survivingIds.map((modelId) => {
      const start = previous.models.find((model) => model.modelId === modelId);
      assert.ok(start);
      const endpoint = {
        ...start,
        centerXThousandths: start.centerXThousandths + deltaXThousandths,
      };
      return {
        ...endpoint,
        path: usesPath ? [point(start), point(endpoint)] : [point(endpoint)],
        distanceMovedThousandths: usesPath ? Math.abs(deltaXThousandths) : 0,
        maximumDistanceThousandths: usesPath
          ? (pending?.maximumDistanceThousandths ?? Math.abs(deltaXThousandths))
          : 0,
      };
    }),
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    pathsReviewed: true,
    terrainClearanceReviewed: true,
    coherencyReviewed: true,
    engagementRangeReviewed: true,
    reconcilesStaleStart: Boolean(pending?.reconcilesStaleStart),
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Every live model path, endpoint, clearance, coherency, and range was checked",
  };
}

function attackTargets(state, formationId) {
  const formation = replayBattleState(state).formations.get(formationId);
  assert.ok(formation);
  return {
    segmentIds: formation.segments.map((segment) => segment.id),
    targets: formation.segments.map((segment) => ({
      wounds: segment.wounds,
      modelCount: formation.health[segment.id].modelsRemaining,
    })),
    initialWoundsLost: formation.health[formation.segments[0].id].woundsLost,
  };
}

function enemyFightMoveOptions(stage) {
  return {
    destination: "enemy",
    maximumModelMoveThousandths: 3_000,
    movementReviewedByPlayer: true,
    movementReviewReason: `Every ${stage} endpoint was reviewed`,
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
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function formationBySource(state, sourceFormationId) {
  const formation = [...replayBattleState(state).formations.values()].find(
    (candidate) => candidate.sourceFormationId === sourceFormationId,
  );
  assert.ok(formation, `Missing formation ${sourceFormationId}`);
  return formation;
}

function advanceToClock(state, predicate, prefix) {
  let next = state;
  while (!predicate(replayBattleState(next).clock)) {
    next = advanceBattleClock(next, `${prefix}-${next.events.length + 1}`, next.events.length + 1);
  }
  return next;
}

function recordReviewedRangedTarget(
  state,
  { attacker, target, sourceSavedUnitId, weaponName, measuredDistanceThousandths, declaredCount },
  id,
) {
  const group = attacker.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId &&
      candidate.profiles.some((profile) => profile.name === weaponName),
  );
  assert.ok(group, `Missing ranged weapon group ${weaponName}`);
  const profile = group.profiles.find((candidate) => candidate.name === weaponName);
  const snapshot = attackTargets(state, target.id);
  return recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: attacker.id,
      targetFormationId: target.id,
      weaponId: profile.weaponId,
      weaponName: profile.name,
      weaponSourceFormationId: attacker.id,
      sourceSavedUnitId,
      weaponGroupId: group.groupId,
      publishedRangeThousandths: profile.publishedRangeThousandths,
      effectiveRangeThousandths: profile.publishedRangeThousandths,
      measuredDistanceThousandths,
      visible: true,
      fullyVisible: true,
      indirectFire: false,
      weaponHasIndirect: false,
      eligibleWeaponCount: declaredCount,
      declaredWeaponCount: declaredCount,
      attackSnapshot: {
        attackProfiles: [{ weaponCount: declaredCount }],
        ...snapshot,
        weaponHasAssault: profile.hasAssault,
        summary: { attacker: attacker.name, weapon: profile.name, target: target.name },
      },
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Range, visibility, target models, and terrain were checked on the table",
    },
    id,
    state.events.length + 1,
  );
}

function appendReviewedAttack(
  state,
  {
    attacker,
    target,
    sourceSavedUnitId,
    weaponName,
    weaponType,
    declaredWeaponCount,
    appliedDamage,
    modelsDestroyed,
    successful,
    targetEligibilityEventId = "",
    id,
  },
) {
  const group = attacker.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId &&
      candidate.profiles.some((profile) => profile.name === weaponName),
  );
  assert.ok(group, `Missing attack weapon group ${weaponName}`);
  const profile = group.profiles.find((candidate) => candidate.name === weaponName);
  return appendResolvedAttack(state, {
    id,
    at: state.events.length + 1,
    attackerFormationId: attacker.id,
    targetFormationId: target.id,
    ...attackTargets(state, target.id),
    result: { appliedDamage, modelsDestroyed },
    summary: {
      attacker: attacker.name,
      weapon: weaponName,
      target: target.name,
      damage: appliedDamage,
      successful,
    },
    weaponType,
    targetEligibilityConfirmed: true,
    targetEligibilityReason:
      weaponType === "Ranged"
        ? "The declared target was visible and within range"
        : "The target was within Engagement Range for the activation",
    targetEligibilityEventId,
    weaponId: profile.weaponId,
    declaredWeaponCount,
    indirectFire: false,
    weaponSourceFormationId: attacker.id,
    sourceSavedUnitId,
    weaponGroupId: group.groupId,
  });
}

function buildFixture() {
  let state = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: `profile-data:${catalogue.sourceUpdatedAt}|battle-state:${BATTLE_STATE_VERSION}`,
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    id: "golden-necrons-vs-space-marines-v1",
  });
  state = configureBattleMission(
    state,
    {
      name: "A · Take and Hold · Tipping Point",
      pointsLimit: 2_000,
      deploymentFirstPlayerId: "player-1",
      commandPointsPerCommandPhase: 1,
      startingCommandPoints: { "player-1": 0, "player-2": 0 },
      objectives: Array.from({ length: 5 }, (_, index) => ({
        id: `objective-${index + 1}`,
        name: `Objective ${index + 1}`,
      })),
    },
    "mission-configured",
    state.events.length + 1,
  );
  state = addFixedSecondaryPlans(state);
  state = configureBattleTableGeometry(
    state,
    reviewedTableGeometry(state),
    "table-geometry-recorded",
    state.events.length + 1,
  );
  state = configureBattleTerrainFootprints(
    state,
    reviewedTerrainFootprints(state),
    "terrain-footprints-recorded",
    state.events.length + 1,
  );
  state = configureBattleTerrainVisibility(
    state,
    reviewedTerrainVisibility(state),
    "terrain-visibility-recorded",
    state.events.length + 1,
  );
  state = deployAll(state);
  state = startBattle(state, "player-1", "battle-started", state.events.length + 1);

  const scoredPrimaryTurns = new Set();
  const scoredSecondaryTurns = new Set();
  while (replayBattleState(state).clock.status !== "complete") {
    let replayed = replayBattleState(state);
    if (replayed.pendingRapidIngress) {
      state = passRapidIngress(
        state,
        "Golden replay keeps the Doom Scythe in Reserves",
        `rapid-ingress-pass-${state.events.length + 1}`,
        state.events.length + 1,
      );
      replayed = replayBattleState(state);
    }
    const clock = replayed.clock;
    const turnKey = `${clock.battleRound}:${clock.turn}:${clock.activePlayerId}`;
    if (clock.phase === "command" && clock.step === "end" && clock.battleRound >= 2) {
      if (!scoredPrimaryTurns.has(turnKey)) {
        state = scoreMissionPoints(
          state,
          clock.activePlayerId,
          "primary",
          5,
          "Golden replay reviewed primary condition",
          `primary-${turnKey}`,
          state.events.length + 1,
        );
        scoredPrimaryTurns.add(turnKey);
      }
    }
    if (clock.phase === "fight" && clock.step === "end") {
      if (!scoredSecondaryTurns.has(turnKey)) {
        state = scoreSecondaryMissionCard(
          state,
          clock.activePlayerId,
          `${clock.activePlayerId}:fixed:1`,
          2,
          "Golden replay reviewed fixed Secondary condition",
          `secondary-${turnKey}`,
          state.events.length + 1,
        );
        scoredSecondaryTurns.add(turnKey);
      }
      if (clock.battleRound === 5 && clock.turn === 2) {
        for (const playerId of ["player-1", "player-2"]) {
          state = scoreMissionPoints(
            state,
            playerId,
            "battle_ready",
            10,
            "Golden replay Battle Ready review",
            `battle-ready-${playerId}`,
            state.events.length + 1,
          );
        }
      }
    }
    state = advanceBattleClock(state, `clock-${state.events.length + 1}`, state.events.length + 1);
  }

  const expected = goldenBattleReplaySummary(state);
  assert.equal(expected.finalClock.status, "complete");
  assert.equal(expected.phaseStepCoverage.length, 170);
  return {
    schema: "whc-golden-battle-replay",
    schemaVersion: 1,
    scenarioId: "necrons-doom-scythe-vs-space-marines-brutalis",
    title: "Doom Scythe vs Brutalis Dreadnought · complete guided clock and scoring",
    description:
      "A source-locked Chapter Approved five-round replay with real catalogue identities, reviewed geometry, deployment and Reserve decisions, every phase step, capped mission scoring, and a final canonical state.",
    listPair: [
      {
        playerId: "player-1",
        listId: attackers.id,
        factionId: attackers.factionId,
        savedUnitId: attackers.units[0].id,
        datasheetId: attackers.units[0].unitId,
        datasheetName: attackers.units[0].name,
      },
      {
        playerId: "player-2",
        listId: defenders.id,
        factionId: defenders.factionId,
        savedUnitId: defenders.units[0].id,
        datasheetId: defenders.units[0].unitId,
        datasheetName: defenders.units[0].name,
      },
    ],
    sourceManifestVersion: sourceManifest.version,
    stateDigest: digest(state),
    expectedDigest: digest(expected),
    expected,
    state,
  };
}

function buildActionFixture() {
  let state = initializeBattleForLists({
    catalogue,
    firstList: actionAttackers,
    secondList: actionDefenders,
    rulesSnapshot: `profile-data:${catalogue.sourceUpdatedAt}|battle-state:${BATTLE_STATE_VERSION}`,
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    id: "golden-action-necrons-vs-space-marines-v1",
  });
  state = configureBattleMission(
    state,
    {
      name: "A · Take and Hold · Tipping Point",
      pointsLimit: 2_000,
      deploymentFirstPlayerId: "player-1",
      commandPointsPerCommandPhase: 1,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: Array.from({ length: 5 }, (_, index) => ({
        id: `objective-${index + 1}`,
        name: `Objective ${index + 1}`,
      })),
    },
    "action-mission-configured",
    state.events.length + 1,
  );
  state = addActionSecondaryPlans(state);
  state = configureBattleTableGeometry(
    state,
    reviewedTableGeometry(state),
    "action-table-geometry-recorded",
    state.events.length + 1,
  );
  state = configureBattleTerrainFootprints(
    state,
    reviewedTerrainFootprints(state),
    "action-terrain-footprints-recorded",
    state.events.length + 1,
  );
  state = configureBattleTerrainVisibility(
    state,
    reviewedTerrainVisibility(state),
    "action-terrain-visibility-recorded",
    state.events.length + 1,
  );

  let intercessors = formationBySource(state, "intercessors");
  for (const group of intercessors.weaponInventory) {
    state = configureBattleWeaponBearers(
      state,
      intercessors.id,
      "intercessors",
      group.groupId,
      intercessors.modelInstances.map((model) => model.id),
      `action-bearers-${group.groupId}`,
      state.events.length + 1,
    );
    intercessors = formationBySource(state, "intercessors");
  }
  const doomstalker = formationBySource(state, "doomstalker");
  state = deployAll(state, {
    [doomstalker.id]: { baseX: 20_000, baseY: 24_000 },
    [intercessors.id]: { baseX: 28_000, baseY: 24_000 },
  });
  state = startBattle(state, "player-1", "action-battle-started", state.events.length + 1);
  state = drawSecondaryMissionCard(
    state,
    "player-1",
    { id: "player-1:tactical:hold", name: "Golden action Tactical hold" },
    "action-tactical-hold-drawn",
    state.events.length + 1,
  );
  state = drawSecondaryMissionCard(
    state,
    "player-1",
    { id: "player-1:tactical:pressure", name: "Golden action Tactical pressure" },
    "action-tactical-pressure-drawn",
    state.events.length + 1,
  );
  state = setBattleObjectiveControl(
    state,
    "objective-3",
    "player-1",
    false,
    "action-objective-taken",
    state.events.length + 1,
  );

  state = advanceToClock(
    state,
    (clock) => clock.phase === "movement" && clock.step === "move_units",
    "action-to-movement",
  );
  state = startFormationMovement(
    state,
    doomstalker.id,
    "normal",
    "action-doomstalker-movement-started",
    state.events.length + 1,
  );
  state = startFireOverwatch(
    state,
    intercessors.id,
    {
      distanceThousandths: 8_000,
      targetVisible: true,
      shootingEligibilityConfirmed: true,
      shootingEligibilityReason: "The Intercessors were eligible to shoot before the move",
      outOfPhaseRestrictionsConfirmed: true,
      outOfPhaseRestrictionsReason: "Shooting-phase-only rules were excluded from Fire Overwatch",
    },
    "action-fire-overwatch-started",
    state.events.length + 1,
  );
  state = recordReviewedRangedTarget(
    state,
    {
      attacker: intercessors,
      target: doomstalker,
      sourceSavedUnitId: "intercessors",
      weaponName: "Bolt rifle",
      measuredDistanceThousandths: 8_000,
      declaredCount: 5,
    },
    "action-overwatch-target-recorded",
  );
  state = appendReviewedAttack(state, {
    attacker: intercessors,
    target: doomstalker,
    sourceSavedUnitId: "intercessors",
    weaponName: "Bolt rifle",
    weaponType: "Ranged",
    declaredWeaponCount: 5,
    appliedDamage: 0,
    modelsDestroyed: 0,
    successful: 0,
    targetEligibilityEventId: "action-overwatch-target-recorded",
    id: "action-overwatch-attack-resolved",
  });
  state = completeFormationActivation(
    state,
    "action-fire-overwatch-completed",
    state.events.length + 1,
  );
  state = completeFormationMovement(
    state,
    doomstalker.id,
    "normal",
    "action-doomstalker-movement-completed",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    doomstalker.id,
    reviewedModelPositions(
      state,
      doomstalker.id,
      "movement",
      "action-doomstalker-movement-completed",
      { deltaXThousandths: 1_000 },
    ),
    "action-doomstalker-movement-positioned",
    state.events.length + 1,
  );
  state = passFireOverwatch(
    state,
    "Fire Overwatch had already been used this turn",
    "action-movement-end-overwatch-passed",
    state.events.length + 1,
  );

  state = advanceToClock(
    state,
    (clock) => clock.phase === "shooting" && clock.step === "resolve_attacks",
    "action-to-shooting",
  );
  state = startFormationActivation(
    state,
    doomstalker.id,
    {},
    "action-doomstalker-shooting-started",
    state.events.length + 1,
  );
  state = recordReviewedRangedTarget(
    state,
    {
      attacker: doomstalker,
      target: intercessors,
      sourceSavedUnitId: "doomstalker",
      weaponName: "Doomsday blaster",
      measuredDistanceThousandths: 7_000,
      declaredCount: 1,
    },
    "action-doomsday-target-recorded",
  );
  state = closeRangedTargetDeclarations(
    state,
    "action-doomsday-targets-closed",
    state.events.length + 1,
    "go_to_ground_first",
  );
  state = resolveGoToGround(
    state,
    intercessors.id,
    "action-go-to-ground-resolved",
    state.events.length + 1,
  );
  if (replayBattleState(state).pendingSmokescreen) {
    state = passSmokescreen(
      state,
      "The target did not use Smokescreen",
      "action-smokescreen-passed",
      state.events.length + 1,
    );
  }
  state = appendReviewedAttack(state, {
    attacker: doomstalker,
    target: intercessors,
    sourceSavedUnitId: "doomstalker",
    weaponName: "Doomsday blaster",
    weaponType: "Ranged",
    declaredWeaponCount: 1,
    appliedDamage: 4,
    modelsDestroyed: 2,
    successful: 2,
    targetEligibilityEventId: "action-doomsday-target-recorded",
    id: "action-doomsday-attack-resolved",
  });
  state = completeFormationActivation(
    state,
    "action-doomstalker-shooting-completed",
    state.events.length + 1,
  );

  state = advanceToClock(
    state,
    (clock) => clock.phase === "charge" && clock.step === "charge_moves",
    "action-to-charge",
  );
  state = declareFormationCharge(
    state,
    doomstalker.id,
    [intercessors.id],
    {
      targetFacts: [{ formationId: intercessors.id, startDistanceThousandths: 6_000 }],
      phaseStartEligibilityConfirmed: true,
      phaseStartEligibilityReason: "The Doomstalker was eligible at the start of the Charge phase",
      startedOutsideEngagementRange: true,
    },
    "action-charge-declared",
    state.events.length + 1,
  );
  state = passFireOverwatch(
    state,
    "Fire Overwatch had already been used this turn",
    "action-charge-overwatch-passed",
    state.events.length + 1,
  );
  state = recordFormationCharge(
    state,
    doomstalker.id,
    [intercessors.id],
    {
      successful: true,
      rolls: [3, 4],
      rollModifier: 0,
      chargeDistanceThousandths: 7_000,
      targetFacts: [
        {
          formationId: intercessors.id,
          startDistanceThousandths: 6_000,
          endsWithinEngagementRange: true,
        },
      ],
      phaseStartEligibilityConfirmed: true,
      phaseStartEligibilityReason: "The Doomstalker was eligible at the start of the Charge phase",
      startedOutsideEngagementRange: true,
      maximumModelMoveThousandths: 6_000,
      unitCoherencyConfirmed: true,
      nonTargetEngagementRangeAvoided: true,
      allModelsCloserToTarget: true,
      baseContactMaximized: true,
      movementReviewedByPlayer: true,
      movementReviewReason: "The charge roll, path, endpoint, and base contact were reviewed",
      targetEligibilityConfirmed: true,
      targetEligibilityReason: "The declared Intercessors remained an eligible target",
    },
    "action-charge-resolved",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    doomstalker.id,
    reviewedModelPositions(state, doomstalker.id, "charge", "action-charge-resolved", {
      deltaXThousandths: 6_000,
    }),
    "action-charge-positioned",
    state.events.length + 1,
  );
  state = passHeroicIntervention(
    state,
    "No eligible Heroic Intervention was used",
    "action-heroic-intervention-passed",
    state.events.length + 1,
  );

  state = advanceToClock(
    state,
    (clock) => clock.phase === "fight" && clock.step === "fights_first",
    "action-to-fight",
  );
  if (replayBattleState(state).clock.priorityPlayerId !== "player-1") {
    state = passFightPriority(
      state,
      "No defending Fights First formation was eligible",
      "action-defender-fights-first-passed",
      state.events.length + 1,
    );
  }
  state = startFormationActivation(
    state,
    doomstalker.id,
    {},
    "action-doomstalker-fight-started",
    state.events.length + 1,
  );
  state = recordFightMove(
    state,
    "pile_in",
    enemyFightMoveOptions("pile in"),
    "action-doomstalker-pile-in",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    doomstalker.id,
    reviewedModelPositions(state, doomstalker.id, "pile_in", "action-doomstalker-pile-in"),
    "action-doomstalker-pile-in-positioned",
    state.events.length + 1,
  );
  state = appendReviewedAttack(state, {
    attacker: doomstalker,
    target: intercessors,
    sourceSavedUnitId: "doomstalker",
    weaponName: "Doomstalker limbs",
    weaponType: "Melee",
    declaredWeaponCount: 1,
    appliedDamage: 2,
    modelsDestroyed: 1,
    successful: 2,
    id: "action-doomstalker-melee-resolved",
  });
  state = recordFightMove(
    state,
    "consolidation",
    enemyFightMoveOptions("consolidation"),
    "action-doomstalker-consolidation",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    doomstalker.id,
    reviewedModelPositions(
      state,
      doomstalker.id,
      "consolidation",
      "action-doomstalker-consolidation",
    ),
    "action-doomstalker-consolidation-positioned",
    state.events.length + 1,
  );
  state = completeFormationActivation(
    state,
    "action-doomstalker-fight-completed",
    state.events.length + 1,
  );
  if (replayBattleState(state).pendingCounterOffensive) {
    state = passCounterOffensive(
      state,
      "The Intercessors had no Command Points remaining",
      "action-counter-offensive-passed",
      state.events.length + 1,
    );
  }
  state = passFightPriority(
    state,
    "No remaining defending Fights First formation",
    "action-fights-first-pass-1",
    state.events.length + 1,
  );
  state = passFightPriority(
    state,
    "The charging Doomstalker had already fought",
    "action-fights-first-pass-2",
    state.events.length + 1,
  );
  state = advanceBattleClock(state, "action-to-remaining-combatants", state.events.length + 1);
  state = startFormationActivation(
    state,
    intercessors.id,
    { eligibilityOverride: true, overrideReason: "The survivors were within Engagement Range" },
    "action-intercessors-fight-started",
    state.events.length + 1,
  );
  state = recordFightMove(
    state,
    "pile_in",
    enemyFightMoveOptions("pile in"),
    "action-intercessors-pile-in",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    intercessors.id,
    reviewedModelPositions(state, intercessors.id, "pile_in", "action-intercessors-pile-in"),
    "action-intercessors-pile-in-positioned",
    state.events.length + 1,
  );
  state = appendReviewedAttack(state, {
    attacker: intercessors,
    target: doomstalker,
    sourceSavedUnitId: "intercessors",
    weaponName: "Close combat weapon",
    weaponType: "Melee",
    declaredWeaponCount: 2,
    appliedDamage: 1,
    modelsDestroyed: 0,
    successful: 1,
    id: "action-intercessors-melee-resolved",
  });
  state = recordFightMove(
    state,
    "consolidation",
    enemyFightMoveOptions("consolidation"),
    "action-intercessors-consolidation",
    state.events.length + 1,
  );
  state = recordModelPositions(
    state,
    intercessors.id,
    reviewedModelPositions(
      state,
      intercessors.id,
      "consolidation",
      "action-intercessors-consolidation",
    ),
    "action-intercessors-consolidation-positioned",
    state.events.length + 1,
  );
  state = completeFormationActivation(
    state,
    "action-intercessors-fight-completed",
    state.events.length + 1,
  );
  if (replayBattleState(state).pendingCounterOffensive) {
    state = passCounterOffensive(
      state,
      "The Doomstalker did not use Counter-offensive",
      "action-second-counter-offensive-passed",
      state.events.length + 1,
    );
  }
  state = passFightPriority(
    state,
    "The Doomstalker had already fought",
    "action-remaining-pass-1",
    state.events.length + 1,
  );
  state = passFightPriority(
    state,
    "The Intercessors had already fought",
    "action-remaining-pass-2",
    state.events.length + 1,
  );
  state = advanceBattleClock(state, "action-to-fight-end", state.events.length + 1);
  state = scoreSecondaryMissionCard(
    state,
    "player-1",
    "player-1:tactical:hold",
    5,
    "The physical Tactical card condition was reviewed after the objective changed hands",
    "action-tactical-scored",
    state.events.length + 1,
  );
  state = resolveSecondaryTurnEnd(
    state,
    "player-1",
    {
      achievedCardIds: ["player-1:tactical:hold"],
      voluntaryCardIds: ["player-1:tactical:pressure"],
    },
    "action-tactical-turn-ended",
    state.events.length + 1,
  );

  let objectiveTransferred = false;
  let battleReadyScored = false;
  const resolvedTacticalTurns = new Set(["1:1:player-1"]);
  while (replayBattleState(state).clock.status !== "complete") {
    const clock = replayBattleState(state).clock;
    const turnKey = `${clock.battleRound}:${clock.turn}:${clock.activePlayerId}`;
    if (
      !objectiveTransferred &&
      clock.battleRound === 1 &&
      clock.turn === 2 &&
      clock.phase === "movement" &&
      clock.step === "move_units"
    ) {
      state = setBattleObjectiveControl(
        state,
        "objective-3",
        null,
        true,
        "action-objective-contested",
        state.events.length + 1,
      );
      state = setBattleObjectiveControl(
        state,
        "objective-3",
        "player-2",
        false,
        "action-objective-transferred",
        state.events.length + 1,
      );
      objectiveTransferred = true;
    }
    if (
      !battleReadyScored &&
      clock.battleRound === 5 &&
      clock.turn === 2 &&
      clock.phase === "fight" &&
      clock.step === "end"
    ) {
      for (const playerId of ["player-1", "player-2"]) {
        state = scoreMissionPoints(
          state,
          playerId,
          "battle_ready",
          10,
          "Golden action replay Battle Ready review",
          `action-battle-ready-${playerId}`,
          state.events.length + 1,
        );
      }
      battleReadyScored = true;
    }
    if (clock.phase === "fight" && clock.step === "end" && !resolvedTacticalTurns.has(turnKey)) {
      state = resolveSecondaryTurnEnd(
        state,
        "player-1",
        {},
        `action-tactical-turn-ended-${turnKey}`,
        state.events.length + 1,
      );
      resolvedTacticalTurns.add(turnKey);
    }
    state = advanceBattleClock(
      state,
      `action-clock-${state.events.length + 1}`,
      state.events.length + 1,
    );
  }

  const expected = goldenBattleReplaySummary(state);
  assert.equal(expected.finalClock.status, "complete");
  assert.equal(expected.phaseStepCoverage.length, 170);
  assert.deepEqual(
    {
      movementStarted: expected.eventTypeCounts.movement_started,
      positionsRecorded: expected.eventTypeCounts.model_positions_recorded,
      overwatchStarted: expected.eventTypeCounts.fire_overwatch_started,
      goToGround: expected.eventTypeCounts.go_to_ground_resolved,
      attacks: expected.eventTypeCounts.attack_resolved,
      charges: expected.eventTypeCounts.charge_recorded,
      fightMoves: expected.eventTypeCounts.fight_move_recorded,
      objectiveChanges: expected.eventTypeCounts.objective_control_changed,
      tacticalDraws: expected.eventTypeCounts.secondary_card_drawn,
      tacticalScores: expected.eventTypeCounts.secondary_card_scored,
    },
    {
      movementStarted: 1,
      positionsRecorded: 6,
      overwatchStarted: 1,
      goToGround: 1,
      attacks: 4,
      charges: 1,
      fightMoves: 4,
      objectiveChanges: 3,
      tacticalDraws: 2,
      tacticalScores: 1,
    },
  );
  return {
    schema: "whc-golden-battle-replay",
    schemaVersion: 1,
    scenarioId: "necrons-doomstalker-vs-space-marines-intercessors-action",
    title: "Canoptek Doomstalker vs Intercessor Squad · action-heavy guided battle",
    description:
      "A source-locked Chapter Approved replay with exact movement, Fire Overwatch, Go to Ground, ranged and melee casualties, a successful Charge, both Fight activations, objective transfer, Tactical Secondary lifecycle, every phase step, and a final canonical state.",
    listPair: [
      {
        playerId: "player-1",
        listId: actionAttackers.id,
        factionId: actionAttackers.factionId,
        savedUnitId: actionAttackers.units[0].id,
        datasheetId: actionAttackers.units[0].unitId,
        datasheetName: actionAttackers.units[0].name,
      },
      {
        playerId: "player-2",
        listId: actionDefenders.id,
        factionId: actionDefenders.factionId,
        savedUnitId: actionDefenders.units[0].id,
        datasheetId: actionDefenders.units[0].unitId,
        datasheetName: actionDefenders.units[0].name,
      },
    ],
    sourceManifestVersion: sourceManifest.version,
    stateDigest: digest(state),
    expectedDigest: digest(expected),
    expected,
    state,
  };
}

const fixture = buildFixture();
const actionFixture = buildActionFixture();
const formatFixture = (value) =>
  format(JSON.stringify(value), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
  });
const serialized = await formatFixture(fixture);
const actionSerialized = await formatFixture(actionFixture);
if (process.argv.includes("--check")) {
  const existing = await readFile(fixtureUrl, "utf8");
  const existingAction = await readFile(actionFixtureUrl, "utf8");
  if (existing !== serialized) {
    throw new Error("Golden battle replay fixture is stale; regenerate it before committing");
  }
  if (existingAction !== actionSerialized) {
    throw new Error(
      "Action-heavy golden battle replay fixture is stale; regenerate it before committing",
    );
  }
} else {
  await writeFile(fixtureUrl, serialized);
  await writeFile(actionFixtureUrl, actionSerialized);
}

console.log(
  `${fixture.scenarioId}: ${fixture.expected.eventCount} events, ${fixture.expected.phaseStepCoverage.length} active clock states, ${fixture.stateDigest}`,
);
console.log(
  `${actionFixture.scenarioId}: ${actionFixture.expected.eventCount} events, ${actionFixture.expected.phaseStepCoverage.length} active clock states, ${actionFixture.stateDigest}`,
);
