import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

import {
  BATTLE_STATE_VERSION,
  TABLE_GEOMETRY_CONSTANTS,
  advanceBattleClock,
  configureBattleMission,
  configureBattleTableGeometry,
  configureBattleTerrainFootprints,
  configureBattleTerrainVisibility,
  configureSecondaryMissionPlan,
  declareFormationDeployment,
  deployFormation,
  passRapidIngress,
  recordDeploymentModelPlacements,
  replayBattleState,
  scoreMissionPoints,
  scoreSecondaryMissionCard,
  startBattle,
} from "../lib/battle-state.mjs";
import { initializeBattleForLists } from "../lib/battle-setup.mjs";
import { goldenBattleReplaySummary } from "../lib/golden-battle-replay.mjs";
import { normalizeRuleCoverageMatrix } from "../lib/rule-coverage.mjs";

const fixtureUrl = new URL(
  "../tests/fixtures/golden-battle-necrons-vs-space-marines-v1.json",
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

function oneUnitList({ id, updatedAt, name, unitName, savedUnitId, weaponName = "" }) {
  const source = catalogueUnit(unitName);
  const weapons = [];
  if (weaponName) {
    const weapon = source.weapons.find((candidate) => candidate.name === weaponName);
    assert.ok(weapon, `Missing ${unitName} weapon ${weaponName}`);
    weapons.push({
      weaponId: weapon.id,
      groupId: weapon.groupId,
      name: weapon.groupName,
      count: 1,
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
        modelCount: 1,
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

function reviewedDeploymentModelPlacements(state, formationId, referenceEventId) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(formationId);
  const geometry = replayed.tableGeometry;
  const slot = [...replayed.formations.keys()].indexOf(formationId);
  const baseX = slot % 2 === 0 ? 5_000 : 35_000;
  const baseY = 5_000 + Math.floor(slot / 2) * 10_000;
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

function deployAll(state) {
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
      reviewedDeploymentModelPlacements(next, formation.id, deploymentEventId),
      `place-${formation.id}`,
      next.events.length + 1,
    );
  }
  return next;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

const fixture = buildFixture();
const serialized = await format(JSON.stringify(fixture), {
  parser: "json",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
});
if (process.argv.includes("--check")) {
  const existing = await readFile(fixtureUrl, "utf8");
  if (existing !== serialized) {
    throw new Error("Golden battle replay fixture is stale; regenerate it before committing");
  }
} else {
  await writeFile(fixtureUrl, serialized);
}

console.log(
  `${fixture.scenarioId}: ${fixture.expected.eventCount} events, ${fixture.expected.phaseStepCoverage.length} active clock states, ${fixture.stateDigest}`,
);
