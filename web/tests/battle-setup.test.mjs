import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BATTLE_STATE_VERSION,
  TABLE_GEOMETRY_CONSTANTS,
  battleFormation,
  battleFormationHealth,
  configureBattleMission,
  configureBattleRuleCoverage,
  configureBattleTableGeometry,
  configureBattleTerrainFootprints,
  configureUnengagedBattleFormation,
  declareFormationDeployment,
  deployFormation,
  modelPlacementSetFacts,
  modelPlacementSetIsValid,
  normalizeBattleState,
  recordDeploymentModelPlacements,
  replayBattleState,
  startBattle,
  tableGeometryIsValid,
  terrainFootprintSetIsValid,
} from "../lib/battle-state.mjs";
import { battleRosterRevisionsMatch, initializeBattleForLists } from "../lib/battle-setup.mjs";
import { normalizeRuleCoverageMatrix } from "../lib/rule-coverage.mjs";
import {
  battleTargetSequence,
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationTargetSequence,
} from "../lib/formations.mjs";

test("fails closed before exact bearer loadouts exceed the native allocation limit", () => {
  const orderedSegments = Array.from({ length: 17 }, (_, index) => ({
    id: `base-${index}`,
    role: "standalone",
  }));
  const targets = orderedSegments.map(() => ({ modelCount: 1 }));
  assert.throws(
    () =>
      battleTargetSequence(
        {
          orderedSegments,
          segments: orderedSegments,
          allocationOptions: orderedSegments,
          targets,
          first: orderedSegments[0],
        },
        {
          weaponBearerTracking: "exact",
          segments: orderedSegments.map((segment) => ({
            id: `${segment.id}:loadout:1`,
            baseSegmentId: segment.id,
            startingModels: 1,
            weaponCopies: [],
          })),
        },
      ),
    /16-segment damage allocation limit/,
  );
});

const catalogue = JSON.parse(
  await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
);
const legacySetup = JSON.parse(
  await readFile(new URL("./fixtures/battle-setup-migration-v1.json", import.meta.url), "utf8"),
);
const coverageSource = JSON.parse(
  await readFile(new URL("../../data/battle-rule-coverage.json", import.meta.url), "utf8"),
);
const missionPackCatalogue = JSON.parse(
  await readFile(new URL("../../data/chapter-approved-2025-26-v1.4.json", import.meta.url), "utf8"),
);
for (const category of ["faction", "detachment", "datasheet", "mission", "terrain"]) {
  coverageSource.rules.push({
    id: `${category}.test`,
    category,
    name: `Test ${category}`,
    status: "irrelevant",
    introducedBattleStateVersion: 24,
    sources: [{ id: "core-rules-10e", pages: [7] }],
  });
}
const ruleCoverageMatrix = normalizeRuleCoverageMatrix(
  coverageSource,
  JSON.parse(
    await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
  ),
);

function coveredRuleSelectionOverrides(firstList, secondList) {
  return {
    guidedReason: "Players will review guided movement and placement at the table",
    players: Object.fromEntries(
      [firstList, secondList].map((savedList, index) => [
        `player-${index + 1}`,
        {
          factionRuleIds: ["faction.test"],
          detachmentSourceId: "test",
          detachmentRuleIds: ["detachment.test"],
          datasheetRuleIds: Object.fromEntries(
            savedList.units.map((unit) => [unit.id, ["datasheet.test"]]),
          ),
        },
      ]),
    ),
    missionSourceId: "test",
    missionRuleIds: ["mission.test"],
    terrainSourceId: "test",
    terrainRuleIds: ["terrain.test"],
  };
}

function catalogueUnit(name) {
  const unit = catalogue.units.find((candidate) => candidate.name === name);
  assert.ok(unit, `Missing catalogue unit ${name}`);
  return unit;
}

function list(id, updatedAt, name, unitName, savedUnitId) {
  const source = catalogueUnit(unitName);
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
        weapons: [],
      },
    ],
  };
}

const attackers = list("list-attackers", 10, "Necrons", "Doom Scythe", "doom-scythe");
const defenders = list("list-defenders", 20, "Space Marines", "Brutalis Dreadnought", "brutalis");
const heavyDeathRay = catalogueUnit("Doom Scythe").weapons.find(
  (weapon) => weapon.name === "Heavy death ray",
);
assert.ok(heavyDeathRay);
attackers.units[0].weapons = [
  {
    weaponId: heavyDeathRay.id,
    groupId: heavyDeathRay.groupId,
    name: heavyDeathRay.groupName,
    count: 1,
  },
];

const exactMissionOverrides = {
  guidedReason: "Players will resolve guided source rules at the physical table",
  players: {
    "player-1": { detachmentSourceId: "000000818" },
    "player-2": { detachmentSourceId: "000000750" },
  },
  missionSourceId: "chapter-approved-2025-26-v1.4-a",
  terrainSourceId: "chapter-approved-2025-26-v1.4-layout-1",
};

function exactMissionSetup(id = "source-locked-mission") {
  let state = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    id,
  });
  state = configureBattleMission(
    state,
    {
      name: "A · Take and Hold · Tipping Point",
      pointsLimit: 2000,
      deploymentFirstPlayerId: "player-1",
      commandPointsPerCommandPhase: 1,
      startingCommandPoints: { "player-1": 0, "player-2": 0 },
      objectives: Array.from({ length: 5 }, (_, index) => ({
        id: `objective-${index + 1}`,
        name: `Objective ${index + 1}`,
      })),
    },
    `${id}-mission`,
    state.events.length + 1,
  );
  return state;
}

function reviewedTableGeometry(state, overrides = {}) {
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
    reviewReason: "Mission card, zones, terrain placement, and objective centres checked",
    ...overrides,
  };
}

function reviewedTerrainFootprints(state, overrides = {}) {
  const tableGeometry = replayBattleState(state).tableGeometry;
  assert.ok(tableGeometry);
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
    missionSourceId: tableGeometry.missionSourceId,
    terrainSourceId: tableGeometry.terrainSourceId,
    battlefieldWidthThousandths: tableGeometry.battlefieldWidthThousandths,
    battlefieldHeightThousandths: tableGeometry.battlefieldHeightThousandths,
    origin: tableGeometry.origin,
    sourcePage: tableGeometry.terrainProfile.sourcePage,
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
    reviewReason: "Players measured every outline and checked connected-section icons",
    ...overrides,
  };
}

function reviewedDeploymentModelPlacements(state, formationId, referenceEventId, overrides = {}) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(formationId);
  const tableGeometry = replayed.tableGeometry;
  assert.ok(formation);
  assert.ok(tableGeometry);
  const placement = {
    context: "deployment",
    referenceEventId,
    missionSourceId: tableGeometry.missionSourceId,
    terrainSourceId: tableGeometry.terrainSourceId,
    battlefieldWidthThousandths: tableGeometry.battlefieldWidthThousandths,
    battlefieldHeightThousandths: tableGeometry.battlefieldHeightThousandths,
    origin: tableGeometry.origin,
    models: formation.modelInstances.map((model, index) => ({
      modelId: model.id,
      measurementBasis: "base",
      shape: "circle",
      widthThousandths: 1_000,
      depthThousandths: 1_000,
      centerXThousandths: 5_000 + (index % 20) * 2_000,
      centerYThousandths: 5_000 + Math.floor(index / 20) * 2_000,
      elevationThousandths: 0,
      rotationMilliDegrees: 0,
    })),
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Every model footprint and position was checked on the physical battlefield",
    ...overrides,
  };
  return placement;
}

function setup(state = null) {
  return initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: coveredRuleSelectionOverrides(attackers, defenders),
    state,
    id: "battle-setup-test",
  });
}

test("canonical setup accepts only source-compatible mission and terrain selections", () => {
  const state = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    id: "source-locked-mission",
  });
  assert.equal(replayBattleState(state).ruleCoverage.report.permitted, true);

  assert.throws(
    () =>
      initializeBattleForLists({
        catalogue,
        firstList: attackers,
        secondList: defenders,
        rulesSnapshot: "catalogue:test",
        ruleCoverageMatrix,
        missionPackCatalogue,
        ruleSelectionOverrides: {
          ...exactMissionOverrides,
          terrainSourceId: "chapter-approved-2025-26-v1.4-layout-5",
        },
        id: "incompatible-mission-terrain",
      }),
    /not source-compatible/,
  );
});

test("requires reviewed table geometry and terrain footprints before exact deployment", () => {
  let state = exactMissionSetup("exact-geometry-required");
  assert.throws(() => deployAllOnBattlefield(state), /reviewed table geometry/i);

  const geometry = reviewedTableGeometry(state);
  assert.equal(tableGeometryIsValid(geometry), true);
  state = configureBattleTableGeometry(
    state,
    geometry,
    "record-table-geometry",
    state.events.length + 1,
  );
  const replayed = replayBattleState(state);
  assert.deepEqual(replayed.tableGeometry, geometry);
  assert.deepEqual(
    replayed.tableGeometry.objectivePositions.map((objective) => objective.objectiveId),
    replayed.mission.objectives.map((objective) => objective.id),
  );
  assert.throws(() => deployAllOnBattlefield(state), /reviewed terrain footprints/i);
  const terrain = reviewedTerrainFootprints(state);
  assert.equal(terrainFootprintSetIsValid(terrain), true);
  state = configureBattleTerrainFootprints(
    state,
    terrain,
    "record-terrain-footprints",
    state.events.length + 1,
  );
  assert.deepEqual(replayBattleState(state).terrainFootprints, terrain);
  assert.doesNotThrow(() => deployAllOnBattlefield(state));
  assert.throws(
    () =>
      configureBattleMission(
        state,
        replayed.mission,
        "late-mission-change",
        state.events.length + 1,
      ),
    /locked after table geometry/i,
  );
});

test("rejects overlapping, out-of-bounds, ungrouped, or source-mismatched terrain", () => {
  let state = exactMissionSetup("invalid-terrain-footprints");
  state = configureBattleTableGeometry(
    state,
    reviewedTableGeometry(state),
    "record-table-before-invalid-terrain",
    state.events.length + 1,
  );
  const valid = reviewedTerrainFootprints(state);
  const attempts = [
    [{ ...valid, terrainSourceId: "chapter-approved-2025-26-v1.4-layout-2" }, /do not match/],
    [
      {
        ...valid,
        footprints: valid.footprints.map((footprint, index) =>
          index === 1
            ? {
                ...footprint,
                centerXThousandths: valid.footprints[0].centerXThousandths,
                centerYThousandths: valid.footprints[0].centerYThousandths,
              }
            : footprint,
        ),
      },
      /do not match the source-locked tournament layout/,
    ],
    [
      {
        ...valid,
        footprints: valid.footprints.map((footprint, index) =>
          index === 0 ? { ...footprint, centerXThousandths: 0 } : footprint,
        ),
      },
      /do not match the source-locked tournament layout/,
    ],
    [
      {
        ...valid,
        footprints: valid.footprints.map((footprint, index) =>
          index === 0 ? { ...footprint, areaTerrainSectionId: "" } : footprint,
        ),
      },
      /non-empty string/,
    ],
    [{ ...valid, sectionGroupingReviewed: false }, /do not match/],
  ];
  for (const [terrain, expected] of attempts) {
    assert.throws(
      () =>
        configureBattleTerrainFootprints(
          state,
          terrain,
          `invalid-terrain-${String(expected)}`,
          state.events.length + 1,
        ),
      expected,
    );
  }
});

test("rejects ambiguous, incomplete, or mismatched table geometry", () => {
  const state = exactMissionSetup("invalid-exact-geometry");
  const valid = reviewedTableGeometry(state);
  const attempts = [
    [{ ...valid, missionSourceId: "chapter-approved-2025-26-v1.4-b" }, /does not match/],
    [{ ...valid, deploymentName: "Dawn of War" }, /source-locked deployment map/],
    [
      {
        ...valid,
        objectivePositions: valid.objectivePositions.map((objective, index) =>
          index === 1
            ? {
                ...objective,
                xThousandths: valid.objectivePositions[0].xThousandths,
                yThousandths: valid.objectivePositions[0].yThousandths,
              }
            : objective,
        ),
      },
      /does not match the source-locked tournament frame/,
    ],
    [
      {
        ...valid,
        objectivePositions: valid.objectivePositions.map((objective, index) =>
          index === 0 ? { ...objective, xThousandths: 60_001 } : objective,
        ),
      },
      /x-coordinate thousandths must be an integer from 0 to 60000/,
    ],
    [{ ...valid, terrainLayoutReviewed: false }, /does not match/],
    [{ ...valid, reviewReason: "" }, /must be a non-empty string/],
  ];
  for (const [geometry, expected] of attempts) {
    assert.throws(
      () =>
        configureBattleTableGeometry(
          state,
          geometry,
          `invalid-${String(expected)}`,
          state.events.length + 1,
        ),
      expected,
    );
  }
});

test("preserves the custom-mission deployment workflow without table geometry", () => {
  const state = setup();
  assert.equal(replayBattleState(state).tableGeometry, null);
  assert.doesNotThrow(() => deployAllOnBattlefield(state));
});

test("requires a reviewed exact-model placement snapshot after each battlefield deployment", () => {
  let state = exactMissionSetup("exact-model-placement-required");
  state = configureBattleTableGeometry(
    state,
    reviewedTableGeometry(state),
    "placement-table-geometry",
    state.events.length + 1,
  );
  state = configureBattleTerrainFootprints(
    state,
    reviewedTerrainFootprints(state),
    "placement-terrain-footprints",
    state.events.length + 1,
  );
  for (const formation of replayBattleState(state).formations.values()) {
    const mustStartInReserves =
      formation.deploymentTraits.aircraft && !formation.deploymentTraits.hover;
    state = declareFormationDeployment(
      state,
      formation.id,
      mustStartInReserves ? "reserves" : "battlefield",
      mustStartInReserves
        ? {
            aircraftMode: "aircraft",
            eligibilityConfirmed: true,
            eligibilityReason: "Aircraft must start in Reserves",
          }
        : {},
      `placement-declare-${formation.id}`,
      state.events.length + 1,
    );
  }
  const beforeDeployment = replayBattleState(state);
  const formation = [...beforeDeployment.formations.values()].find(
    (candidate) =>
      candidate.playerId === beforeDeployment.deploymentPriorityPlayerId &&
      beforeDeployment.deploymentByFormation.get(candidate.id)?.location === "battlefield",
  );
  assert.ok(formation);
  const deploymentEventId = `placement-deploy-${formation.id}`;
  state = deployFormation(
    state,
    formation.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    deploymentEventId,
    state.events.length + 1,
  );
  const pending = replayBattleState(state).pendingDeploymentPlacement;
  assert.deepEqual(pending, { formationId: formation.id, referenceEventId: deploymentEventId });
  assert.equal(replayBattleState(state).deploymentComplete, false);
  assert.throws(
    () => startBattle(state, "player-1", "start-before-model-placement", state.events.length + 1),
    /model placement/i,
  );

  const placement = reviewedDeploymentModelPlacements(state, formation.id, deploymentEventId);
  const expectedModelIds = formation.modelInstances.map((model) => model.id);
  assert.equal(modelPlacementSetIsValid(placement, expectedModelIds), true);
  assert.throws(
    () =>
      recordDeploymentModelPlacements(
        state,
        formation.id,
        { ...placement, terrainSourceId: "wrong-layout" },
        `placement-models-wrong-source-${formation.id}`,
        state.events.length + 1,
      ),
    /does not match the reviewed table geometry/i,
  );
  state = recordDeploymentModelPlacements(
    state,
    formation.id,
    placement,
    `placement-models-${formation.id}`,
    state.events.length + 1,
  );
  assert.equal(replayBattleState(state).pendingDeploymentPlacement, null);
  assert.equal(replayBattleState(state).deploymentComplete, true);
});

test("validates circular, elliptical, and rotated rectangular model footprints at table edges", () => {
  const reviewed = {
    reviewedByPlayer: true,
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    models: [
      {
        modelId: "circle",
        measurementBasis: "base",
        shape: "circle",
        widthThousandths: 2_000,
        depthThousandths: 2_000,
        centerXThousandths: 1_000,
        centerYThousandths: 1_000,
        elevationThousandths: 0,
        rotationMilliDegrees: 90_000,
      },
      {
        modelId: "ellipse",
        measurementBasis: "base",
        shape: "ellipse",
        widthThousandths: 4_000,
        depthThousandths: 2_000,
        centerXThousandths: 58_000,
        centerYThousandths: 22_000,
        elevationThousandths: 2_000,
        rotationMilliDegrees: 0,
      },
      {
        modelId: "hull",
        measurementBasis: "model",
        shape: "rectangle",
        widthThousandths: 2_000,
        depthThousandths: 2_000,
        centerXThousandths: 30_000,
        centerYThousandths: 42_585,
        elevationThousandths: 0,
        rotationMilliDegrees: 45_000,
      },
    ],
  };
  const expected = ["circle", "ellipse", "hull"];
  assert.equal(modelPlacementSetIsValid(reviewed, expected), true);
  assert.deepEqual(modelPlacementSetFacts(reviewed, expected), {
    expectedModelCount: 3,
    placementCount: 3,
    uniqueModelCount: 3,
    recognizedModelCount: 3,
    positionedModelCount: 3,
    inBoundsModelCount: 3,
    dimensionedModelCount: 3,
    supportedShapeCount: 3,
    basedModelCount: 2,
    baselessModelCount: 1,
  });
  assert.equal(
    modelPlacementSetIsValid(
      {
        ...reviewed,
        models: reviewed.models.map((model) =>
          model.modelId === "hull" ? { ...model, centerYThousandths: 42_586 } : model,
        ),
      },
      expected,
    ),
    false,
  );
  assert.equal(
    modelPlacementSetIsValid(
      {
        ...reviewed,
        models: reviewed.models.map((model) =>
          model.modelId === "circle" ? { ...model, depthThousandths: 1_999 } : model,
        ),
      },
      expected,
    ),
    false,
  );
  assert.equal(
    modelPlacementSetIsValid({ ...reviewed, noModelOverlapReviewed: false }, expected),
    false,
  );
});

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
    assert.ok(formation);
    next = deployFormation(
      next,
      formation.id,
      { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
      `deploy-${formation.id}`,
      next.events.length + 1,
    );
    const afterDeployment = replayBattleState(next);
    if (afterDeployment.pendingDeploymentPlacement) {
      const pending = afterDeployment.pendingDeploymentPlacement;
      next = recordDeploymentModelPlacements(
        next,
        pending.formationId,
        reviewedDeploymentModelPlacements(next, pending.formationId, pending.referenceEventId),
        `place-${pending.formationId}`,
        next.events.length + 1,
      );
    }
  }
  return next;
}

function withoutRuleCoverageEvent(state) {
  return {
    ...structuredClone(state),
    events: state.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event, index) => ({ ...event, sequence: index + 1 })),
  };
}

test("records exact battle rule identities and blocks absent coverage before battle start", () => {
  let state = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    id: "battle-rule-coverage-blocked",
  });
  const coverage = replayBattleState(state).ruleCoverage;
  assert.equal(coverage.snapshotId, ruleCoverageMatrix.snapshotId);
  assert.equal(coverage.report.permitted, false);
  assert.deepEqual(
    coverage.plan.players.map((player) => ({
      playerId: player.playerId,
      factionId: player.faction.sourceId,
      datasheets: player.datasheets.map((datasheet) => datasheet.datasheetId),
    })),
    [
      {
        playerId: "player-1",
        factionId: attackers.factionId,
        datasheets: [attackers.units[0].unitId],
      },
      {
        playerId: "player-2",
        factionId: defenders.factionId,
        datasheets: [defenders.units[0].unitId],
      },
    ],
  );
  assert.ok(
    coverage.report.results.some(
      (result) =>
        result.category === "faction" && result.sourceLocked && result.status === "guided",
    ),
  );
  assert.ok(
    coverage.report.results.some((result) => result.category === "mission" && !result.sourceLocked),
  );
  state = deployAllOnBattlefield(state);
  assert.throws(
    () =>
      configureBattleRuleCoverage(state, coverage, "late-rule-selection", state.events.length + 1),
    /deployment declarations/,
  );
  assert.throws(
    () => startBattle(state, "player-1", "blocked-start", state.events.length + 1),
    /source-locked coverage/,
  );
});

test("locks source detachment and enhancement identities to faction and eligible bearers", () => {
  const overlordList = list("list-overlord", 21, "Hypercrypt", "Overlord", "overlord");
  const validOverrides = {
    guidedReason: "Players will resolve source-locked guided rules at the table",
    players: {
      "player-1": {
        detachmentSourceId: "000000818",
        enhancementSourceIds: ["000008554003"],
      },
      "player-2": { detachmentSourceId: "000000750" },
    },
  };
  const state = initializeBattleForLists({
    catalogue,
    firstList: overlordList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: validOverrides,
    id: "battle-army-rule-identities",
  });
  const selected = replayBattleState(state).ruleCoverage.plan.players[0];
  assert.equal(selected.detachment.sourceId, "000000818");
  assert.deepEqual(selected.detachment.ruleIds, ["detachment.catalogue-000000818"]);
  assert.deepEqual(selected.enhancements.sourceIds, ["000008554003"]);
  assert.deepEqual(selected.enhancements.ruleIds, ["enhancement.catalogue-000008554003"]);

  const initializeWithPlayerOne = (selection, firstList = overlordList) =>
    initializeBattleForLists({
      catalogue,
      firstList,
      secondList: defenders,
      rulesSnapshot: "catalogue:test",
      ruleCoverageMatrix,
      ruleSelectionOverrides: {
        ...validOverrides,
        players: { ...validOverrides.players, "player-1": selection },
      },
      id: "battle-invalid-army-rule-identities",
    });
  assert.throws(
    () => initializeWithPlayerOne({ detachmentSourceId: "000000750" }),
    /outside its source faction/,
  );
  const otherNecronEnhancement = catalogue.enhancements.find(
    (enhancement) =>
      enhancement.detachmentId !== "000000818" &&
      catalogue.detachments.some(
        (detachment) =>
          detachment.id === enhancement.detachmentId && detachment.factionId === "NEC",
      ),
  );
  assert.ok(otherNecronEnhancement);
  assert.throws(
    () =>
      initializeWithPlayerOne({
        detachmentSourceId: "000000818",
        enhancementSourceIds: [otherNecronEnhancement.id],
      }),
    /outside its detachment/,
  );
  assert.throws(
    () =>
      initializeWithPlayerOne(
        { detachmentSourceId: "000000818", enhancementSourceIds: ["000008554003"] },
        attackers,
      ),
    /no source-eligible bearer/,
  );
  assert.throws(
    () => initializeWithPlayerOne({ enhancementSourceIds: ["000008554003"] }),
    /without a detachment/,
  );
  assert.throws(
    () =>
      initializeWithPlayerOne({
        detachmentSourceId: "000000818",
        enhancementSourceIds: ["000008554003", "000008554003"],
      }),
    /must be unique/,
  );
});

test("registers every formation on both rosters before combat with stable ids", () => {
  const state = setup();
  assert.equal(state.version, BATTLE_STATE_VERSION);
  assert.deepEqual(
    state.players.map((player) => [player.listId, player.listUpdatedAt]),
    [
      [attackers.id, attackers.updatedAt],
      [defenders.id, defenders.updatedAt],
    ],
  );
  assert.deepEqual(
    state.events.map((event) => [event.type, event.formation?.id]),
    [
      ["formation_registered", "player-1:doom-scythe"],
      ["formation_registered", "player-2:brutalis"],
      ["rule_coverage_configured", undefined],
    ],
  );
  assert.equal(setup(state), state);
  assert.equal(battleRosterRevisionsMatch(state, attackers, defenders), true);
  assert.equal(
    battleRosterRevisionsMatch(state, { ...attackers, updatedAt: 11 }, defenders),
    false,
  );
  assert.equal(
    savedFormationGroups(catalogue, {
      ...attackers,
      units: [{ ...attackers.units[0], modelCount: 2 }],
    })[0].id,
    "doom-scythe",
  );
  assert.throws(
    () =>
      initializeBattleForLists({
        catalogue,
        firstList: { ...attackers, updatedAt: 11 },
        secondList: defenders,
        rulesSnapshot: "catalogue:test",
        ruleCoverageMatrix,
        ruleSelectionOverrides: coveredRuleSelectionOverrides(
          { ...attackers, updatedAt: 11 },
          defenders,
        ),
        state,
      }),
    /roster changed/i,
  );
});

test("locks saved Transport assignments into exact battle formations", () => {
  const trukk = catalogueUnit("Trukk");
  const boyz = catalogueUnit("Boyz");
  const transportList = {
    id: "list-transports",
    createdAt: 1,
    updatedAt: 30,
    name: "Transport test",
    factionId: trukk.factionId,
    units: [
      {
        id: "trukk",
        unitId: trukk.id,
        name: trukk.name,
        modelCount: 1,
        weapons: [],
      },
      {
        id: "boyz",
        unitId: boyz.id,
        name: boyz.name,
        modelCount: 10,
        weapons: [],
        transportId: "trukk",
      },
    ],
  };
  const state = initializeBattleForLists({
    catalogue,
    firstList: transportList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: coveredRuleSelectionOverrides(transportList, defenders),
    id: "battle-transport-setup",
  });
  assert.equal(
    battleFormation(state, "player-1:boyz").assignedTransportFormationId,
    "player-1:trukk",
  );
  assert.equal(battleFormation(state, "player-1:trukk").assignedTransportFormationId, "");
  const versionSix = withoutRuleCoverageEvent(state);
  versionSix.version = 6;
  delete versionSix.migration;
  const migrated = initializeBattleForLists({
    catalogue,
    firstList: transportList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: coveredRuleSelectionOverrides(transportList, defenders),
    state: normalizeBattleState(versionSix),
    id: "battle-transport-setup",
  });
  assert.equal(
    battleFormation(migrated, "player-1:boyz").assignedTransportFormationId,
    "player-1:trukk",
  );
});

test("locks every source-compatible friendly Transport option independently of the roster preset", () => {
  const trukk = catalogueUnit("Trukk");
  const boyz = catalogueUnit("Boyz");
  const list = {
    id: "list-transport-options",
    createdAt: 1,
    updatedAt: 31,
    name: "Transport options",
    factionId: trukk.factionId,
    units: [
      ...["trukk-a", "trukk-b"].map((id) => ({
        id,
        unitId: trukk.id,
        name: trukk.name,
        modelCount: 1,
        weapons: [],
      })),
      {
        id: "boyz",
        unitId: boyz.id,
        name: boyz.name,
        modelCount: 10,
        weapons: [],
        transportId: "trukk-a",
      },
    ],
  };
  const state = initializeBattleForLists({
    catalogue,
    firstList: list,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: coveredRuleSelectionOverrides(list, defenders),
    id: "battle-transport-options",
  });
  const formation = battleFormation(state, "player-1:boyz");
  assert.equal(formation.assignedTransportFormationId, "player-1:trukk-a");
  assert.deepEqual(
    formation.transportOptions.map((option) => option.transportFormationId),
    ["player-1:trukk-a", "player-1:trukk-b"],
  );
  assert.deepEqual(
    formation.transportOptions.map((option) => option.assignments[0].poolCapacity),
    [12, 12],
  );

  const oversizedList = {
    ...list,
    id: "list-oversized-transport-options",
    units: list.units.map((unit) =>
      unit.id === "boyz" ? { ...unit, modelCount: 20, transportId: "" } : unit,
    ),
  };
  const oversizedState = initializeBattleForLists({
    catalogue,
    firstList: oversizedList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    ruleSelectionOverrides: coveredRuleSelectionOverrides(oversizedList, defenders),
    id: "battle-oversized-transport-options",
  });
  const oversizedFormation = battleFormation(oversizedState, "player-1:boyz");
  assert.equal(oversizedFormation.assignedTransportFormationId, "");
  assert.deepEqual(
    oversizedFormation.transportOptions.map((option) => option.transportFormationId),
    ["player-1:trukk-a", "player-1:trukk-b"],
  );
});

test("allows equipment correction during setup, then freezes it when battle starts", () => {
  let state = setup();
  const targetId = "player-2:brutalis";
  const registration = battleFormation(state, targetId);
  const configured = {
    ...registration,
    health: undefined,
    defensiveEquipmentCounts: { "brutalis::unit::narrative": 1 },
  };
  delete configured.health;
  state = configureUnengagedBattleFormation(state, configured, "configure-1", 3);
  assert.equal(state.events.at(-1).type, "formation_configured");
  assert.deepEqual(battleFormation(state, targetId).defensiveEquipmentCounts, {
    "brutalis::unit::narrative": 1,
  });
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-battle", 4);
  assert.equal(
    initializeBattleForLists({
      catalogue,
      firstList: attackers,
      secondList: defenders,
      rulesSnapshot: "catalogue:test",
      ruleCoverageMatrix,
      state,
    }),
    state,
  );
  assert.throws(
    () => configureUnengagedBattleFormation(state, registration, "configure-after-start", 5),
    /locked after the battle starts/i,
  );
});

test("migrates a version-2 roster battle with explicit untimed provenance", () => {
  const versionTwo = structuredClone(legacySetup);
  versionTwo.version = 2;
  versionTwo.players[0].listUpdatedAt = attackers.updatedAt;
  versionTwo.players[1].listUpdatedAt = defenders.updatedAt;
  const migrated = setup(normalizeBattleState(versionTwo));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 2,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTransportCompatibilityThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
    legacyHeroicInterventionThroughSequence: 3,
    legacyFireOverwatchThroughSequence: 3,
    legacyHazardousThroughSequence: 3,
    legacyGoToGroundThroughSequence: 3,
    legacyRangedDeclarationsThroughSequence: 3,
    legacySetupRulesThroughSequence: 3,
    legacyCounterOffensiveThroughSequence: 3,
    legacySmokescreenThroughSequence: 3,
    legacyRapidIngressThroughSequence: 3,
    legacyRuleCoverageThroughSequence: 3,
    legacyTableGeometryThroughSequence: 3,
    legacyTerrainFootprintsThroughSequence: 3,
    legacyModelPlacementsThroughSequence: 3,
  });
  assert.ok(migrated.events.some((event) => event.id === "legacy-attack"));
});

test("migrates a partial version-1 log without changing attack ids or health", () => {
  const defenderFormation = savedFormationGroups(catalogue, defenders)[0];
  const equipment = savedFormationDefensiveEquipmentDefaults(defenderFormation);
  const sequence = savedFormationTargetSequence(defenderFormation, "", equipment);
  const legacy = normalizeBattleState(legacySetup);

  const migrated = setup(legacy);
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 1,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTransportCompatibilityThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
    legacyHeroicInterventionThroughSequence: 3,
    legacyFireOverwatchThroughSequence: 3,
    legacyHazardousThroughSequence: 3,
    legacyGoToGroundThroughSequence: 3,
    legacyRangedDeclarationsThroughSequence: 3,
    legacySetupRulesThroughSequence: 3,
    legacyCounterOffensiveThroughSequence: 3,
    legacySmokescreenThroughSequence: 3,
    legacyRapidIngressThroughSequence: 3,
    legacyRuleCoverageThroughSequence: 3,
    legacyTableGeometryThroughSequence: 3,
    legacyTerrainFootprintsThroughSequence: 3,
    legacyModelPlacementsThroughSequence: 3,
  });
  assert.deepEqual(
    migrated.events.map((event) => event.type),
    ["formation_registered", "formation_registered", "attack_resolved", "rule_coverage_configured"],
  );
  assert.ok(migrated.events.some((event) => event.id === "legacy-attack"));
  assert.deepEqual(battleFormationHealth(migrated, "player-2:brutalis"), {
    [sequence.orderedSegments[0].id]: { modelsRemaining: 1, woundsLost: 1 },
  });
});

test("migrates a version-3 guided battle without reclassifying timed events", () => {
  const versionThree = withoutRuleCoverageEvent(setup());
  versionThree.version = 3;
  delete versionThree.migration;
  const migrated = setup(normalizeBattleState(versionThree));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 3,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).mission.name, "Custom mission");
});

test("migrates a version-4 tracker battle with explicit unactioned provenance", () => {
  const versionFour = withoutRuleCoverageEvent(setup());
  versionFour.version = 4;
  delete versionFour.migration;
  const migrated = setup(normalizeBattleState(versionFour));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 4,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
});

test("migrates a version-5 action battle as already deployed without rewriting its log", () => {
  const versionFive = withoutRuleCoverageEvent(setup());
  versionFive.version = 5;
  delete versionFive.migration;
  let migrated = setup(normalizeBattleState(versionFive));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 5,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
  assert.equal(migrated.events.length, 3);
  migrated = startBattle(migrated, "player-1", "start-migrated", 3);
  const replayed = replayBattleState(migrated);
  assert.equal(replayed.deploymentComplete, true);
  assert.deepEqual([...replayed.offBattlefieldFormationIds], []);
  assert.equal(replayed.deploymentByFormation.get("player-1:doom-scythe").legacyAssumed, true);
});

test("migrates a version-6 deployment battle with explicit unembarked provenance", () => {
  const versionSix = withoutRuleCoverageEvent(setup());
  versionSix.version = 6;
  delete versionSix.migration;
  const migrated = setup(normalizeBattleState(versionSix));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 6,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).embarkedByFormation.size, 0);
});

test("migrates a version-7 Transport battle with explicit legacy target provenance", () => {
  const versionSeven = withoutRuleCoverageEvent(setup());
  versionSeven.version = 7;
  delete versionSeven.migration;
  const migrated = setup(normalizeBattleState(versionSeven));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 7,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
});

test("migrates a version-8 target-eligibility battle with locked weapon provenance", () => {
  const versionEight = withoutRuleCoverageEvent(setup());
  versionEight.version = 8;
  delete versionEight.migration;
  const migrated = setup(normalizeBattleState(versionEight));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 8,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 0,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
    legacySmokescreenThroughSequence: 2,
    legacyRapidIngressThroughSequence: 2,
    legacyRuleCoverageThroughSequence: 2,
    legacyTableGeometryThroughSequence: 2,
    legacyTerrainFootprintsThroughSequence: 2,
    legacyModelPlacementsThroughSequence: 2,
  });
  assert.ok(battleFormation(migrated, "player-1:doom-scythe").weaponInventory.length > 0);
});

test("migrates version-9 weapon inventory with explicit aggregate-bearer provenance", () => {
  const versionNine = withoutRuleCoverageEvent(setup());
  versionNine.version = 9;
  delete versionNine.migration;
  for (const event of versionNine.events) {
    if (!event.formation) continue;
    delete event.formation.weaponBearerTracking;
    delete event.formation.modelInstances;
    event.formation.weaponInventory = event.formation.weaponInventory.map((group) => {
      const legacy = { ...group };
      delete legacy.bearerModelIds;
      delete legacy.bearerAssignmentsReviewed;
      delete legacy.bearerAssignmentSource;
      return legacy;
    });
    event.formation.segments = event.formation.segments.map((segment) => {
      const legacy = { ...segment, id: segment.baseSegmentId ?? segment.id };
      delete legacy.baseSegmentId;
      delete legacy.modelIds;
      delete legacy.weaponCopies;
      return legacy;
    });
  }
  const migrated = setup(normalizeBattleState(versionNine));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 9);
  assert.equal(migrated.migration.legacyWeaponInventoryThroughSequence, 0);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 2);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
  assert.equal(
    battleFormation(migrated, "player-1:doom-scythe").weaponBearerTracking,
    "legacy_aggregate",
  );

  const tampered = structuredClone(versionNine);
  tampered.events[0].formation.weaponInventory[0].name = "Changed after registration";
  assert.throws(
    () => setup(normalizeBattleState(tampered)),
    /weapon inventory no longer matches its locked battle formation/,
  );
});

test("migrates version-10 exact bearers with an explicit legacy charge boundary", () => {
  const versionTen = withoutRuleCoverageEvent(setup());
  versionTen.version = 10;
  delete versionTen.migration;
  const migrated = setup(normalizeBattleState(versionTen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 10);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 0);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
  assert.equal(battleFormation(migrated, "player-1:doom-scythe").weaponBearerTracking, "exact");
});

test("migrates version-11 charge movement with explicit Fight and reaction boundaries", () => {
  const versionEleven = withoutRuleCoverageEvent(setup());
  versionEleven.version = 11;
  delete versionEleven.migration;
  const migrated = setup(normalizeBattleState(versionEleven));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 11);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 0);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-12 Fight movement with an explicit Heroic Intervention boundary", () => {
  const versionTwelve = withoutRuleCoverageEvent(setup());
  versionTwelve.version = 12;
  delete versionTwelve.migration;
  const migrated = setup(normalizeBattleState(versionTwelve));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 12);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 0);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-13 reactions with an explicit Fire Overwatch boundary", () => {
  const versionThirteen = withoutRuleCoverageEvent(setup());
  versionThirteen.version = 13;
  delete versionThirteen.migration;
  const migrated = setup(normalizeBattleState(versionThirteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 13);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 0);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-14 Fire Overwatch with an explicit Hazardous boundary", () => {
  const versionFourteen = withoutRuleCoverageEvent(setup());
  versionFourteen.version = 14;
  delete versionFourteen.migration;
  const migrated = setup(normalizeBattleState(versionFourteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 14);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 0);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-15 Hazardous state with an explicit Go to Ground boundary", () => {
  const versionFifteen = withoutRuleCoverageEvent(setup());
  versionFifteen.version = 15;
  const migrated = setup(normalizeBattleState(versionFifteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 15);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 0);
  assert.equal(migrated.migration.legacyGoToGroundThroughSequence, 2);
});

test("migrates version-16 Go to Ground state with an explicit ranged declaration boundary", () => {
  const versionSixteen = withoutRuleCoverageEvent(setup());
  versionSixteen.version = 16;
  delete versionSixteen.migration;
  const migrated = setup(normalizeBattleState(versionSixteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 16);
  assert.equal(migrated.migration.legacyGoToGroundThroughSequence, 0);
  assert.equal(migrated.migration.legacyRangedDeclarationsThroughSequence, 2);
});

test("migrates version-17 declarations with an explicit Transport compatibility boundary", () => {
  const versionSeventeen = withoutRuleCoverageEvent(setup());
  versionSeventeen.version = 17;
  delete versionSeventeen.migration;
  const migrated = setup(normalizeBattleState(versionSeventeen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 17);
  assert.equal(migrated.migration.legacyRangedDeclarationsThroughSequence, 0);
  assert.equal(migrated.migration.legacyTransportCompatibilityThroughSequence, 2);
  assert.ok(
    migrated.events
      .filter((event) => event.type === "formation_registered")
      .every((event) => Array.isArray(event.formation.transportOptions)),
  );
});

test("migrates version-18 Transport compatibility state to nested deployment semantics", () => {
  const versionEighteen = withoutRuleCoverageEvent(setup());
  versionEighteen.version = 18;
  delete versionEighteen.migration;
  const eventIds = versionEighteen.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionEighteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 18);
  assert.equal(migrated.migration.legacyTransportCompatibilityThroughSequence, 0);
  assert.deepEqual(
    migrated.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event) => event.id),
    eventIds,
  );
});

test("migrates version-19 nested Transport state across the setup-rules boundary", () => {
  const versionNineteen = withoutRuleCoverageEvent(setup());
  versionNineteen.version = 19;
  delete versionNineteen.migration;
  const eventIds = versionNineteen.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionNineteen));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 19);
  assert.equal(migrated.migration.legacySetupRulesThroughSequence, 2);
  assert.deepEqual(
    migrated.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event) => event.id),
    eventIds,
  );
});

test("migrates version-20 setup state across the Counter-offensive boundary", () => {
  const versionTwenty = withoutRuleCoverageEvent(setup());
  versionTwenty.version = 20;
  delete versionTwenty.migration;
  const eventIds = versionTwenty.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionTwenty));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 20);
  assert.equal(migrated.migration.legacyCounterOffensiveThroughSequence, 2);
  assert.deepEqual(
    migrated.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event) => event.id),
    eventIds,
  );
});

test("migrates version-21 state across the Smokescreen boundary", () => {
  const versionTwentyOne = withoutRuleCoverageEvent(setup());
  versionTwentyOne.version = 21;
  delete versionTwentyOne.migration;
  const eventIds = versionTwentyOne.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionTwentyOne));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 21);
  assert.equal(migrated.migration.legacySmokescreenThroughSequence, 2);
  assert.deepEqual(
    migrated.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event) => event.id),
    eventIds,
  );
});

test("migrates version-22 state without retroactively opening Rapid Ingress", () => {
  const versionTwentyTwo = withoutRuleCoverageEvent(setup());
  versionTwentyTwo.version = 22;
  delete versionTwentyTwo.migration;
  const eventIds = versionTwentyTwo.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionTwentyTwo));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 22);
  assert.equal(migrated.migration.legacyRapidIngressThroughSequence, 2);
  assert.equal(replayBattleState(migrated).pendingRapidIngress, null);
  assert.deepEqual(
    migrated.events
      .filter((event) => event.type !== "rule_coverage_configured")
      .map((event) => event.id),
    eventIds,
  );
});

test("migrates version-23 state with an explicit source-locked rule boundary", () => {
  const versionTwentyThree = withoutRuleCoverageEvent(deployAllOnBattlefield(setup()));
  versionTwentyThree.version = 23;
  delete versionTwentyThree.migration;
  const migrated = setup(normalizeBattleState(versionTwentyThree));
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 23);
  assert.equal(
    migrated.migration.legacyRuleCoverageThroughSequence,
    versionTwentyThree.events.length,
  );
  assert.equal(replayBattleState(migrated).ruleCoverage.report.permitted, true);
  assert.ok(replayBattleState(migrated).deploymentByFormation.size > 0);
});

test("migrates version-24 exact games without inventing geometry and permits one reviewed binding", () => {
  let versionTwentyFour = exactMissionSetup("version-24-table-geometry");
  versionTwentyFour.version = 24;
  delete versionTwentyFour.migration;
  versionTwentyFour = deployAllOnBattlefield(versionTwentyFour);
  const legacyEventCount = versionTwentyFour.events.length;
  let migrated = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    state: normalizeBattleState(versionTwentyFour),
    id: versionTwentyFour.id,
  });
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 24);
  assert.equal(migrated.migration.legacyTableGeometryThroughSequence, legacyEventCount);
  assert.equal(replayBattleState(migrated).tableGeometry, null);

  const geometry = reviewedTableGeometry(migrated, { method: "imported" });
  migrated = configureBattleTableGeometry(
    migrated,
    geometry,
    "migrated-table-geometry",
    migrated.events.length + 1,
  );
  assert.deepEqual(replayBattleState(migrated).tableGeometry, geometry);
  const terrain = reviewedTerrainFootprints(migrated, { method: "imported" });
  migrated = configureBattleTerrainFootprints(
    migrated,
    terrain,
    "migrated-terrain-footprints",
    migrated.events.length + 1,
  );
  assert.deepEqual(replayBattleState(migrated).terrainFootprints, terrain);
  assert.throws(
    () =>
      configureBattleTableGeometry(
        migrated,
        geometry,
        "duplicate-migrated-table-geometry",
        migrated.events.length + 1,
      ),
    /already been recorded/,
  );
});

test("migrates version-25 exact games without inventing terrain footprints", () => {
  let versionTwentyFive = exactMissionSetup("version-25-terrain-footprints");
  versionTwentyFive = configureBattleTableGeometry(
    versionTwentyFive,
    reviewedTableGeometry(versionTwentyFive),
    "version-25-table-geometry",
    versionTwentyFive.events.length + 1,
  );
  versionTwentyFive.version = 25;
  delete versionTwentyFive.migration;
  versionTwentyFive = deployAllOnBattlefield(versionTwentyFive);
  const legacyEventCount = versionTwentyFive.events.length;
  let migrated = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    state: normalizeBattleState(versionTwentyFive),
    id: versionTwentyFive.id,
  });
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 25);
  assert.equal(migrated.migration.legacyTerrainFootprintsThroughSequence, legacyEventCount);
  assert.equal(replayBattleState(migrated).terrainFootprints, null);
  const terrain = reviewedTerrainFootprints(migrated, { method: "imported" });
  migrated = configureBattleTerrainFootprints(
    migrated,
    terrain,
    "migrated-version-25-terrain",
    migrated.events.length + 1,
  );
  assert.deepEqual(replayBattleState(migrated).terrainFootprints, terrain);
});

test("migrates version-26 exact games without inventing model placements", () => {
  let versionTwentySix = exactMissionSetup("version-26-model-placements");
  versionTwentySix = configureBattleTableGeometry(
    versionTwentySix,
    reviewedTableGeometry(versionTwentySix),
    "version-26-table-geometry",
    versionTwentySix.events.length + 1,
  );
  versionTwentySix = configureBattleTerrainFootprints(
    versionTwentySix,
    reviewedTerrainFootprints(versionTwentySix),
    "version-26-terrain-footprints",
    versionTwentySix.events.length + 1,
  );
  versionTwentySix.version = 26;
  delete versionTwentySix.migration;
  versionTwentySix = deployAllOnBattlefield(versionTwentySix);
  const legacyEventCount = versionTwentySix.events.length;
  let migrated = initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    ruleCoverageMatrix,
    missionPackCatalogue,
    ruleSelectionOverrides: exactMissionOverrides,
    state: normalizeBattleState(versionTwentySix),
    id: versionTwentySix.id,
  });
  let replayed = replayBattleState(migrated);
  assert.equal(migrated.version, BATTLE_STATE_VERSION);
  assert.equal(migrated.migration.sourceVersion, 26);
  assert.equal(migrated.migration.legacyModelPlacementsThroughSequence, legacyEventCount);
  assert.equal(replayed.modelPlacementsByFormation.size, 0);
  assert.equal(replayed.pendingDeploymentPlacement, null);
  assert.equal(replayed.deploymentComplete, false);

  for (const deployment of replayed.deploymentByFormation.values()) {
    if (deployment.location !== "battlefield") continue;
    const reference = migrated.events.find(
      (event) =>
        event.type === "formation_deployed" && event.formationId === deployment.formationId,
    );
    assert.ok(reference);
    migrated = recordDeploymentModelPlacements(
      migrated,
      deployment.formationId,
      reviewedDeploymentModelPlacements(migrated, deployment.formationId, reference.id, {
        method: "imported",
      }),
      `migrated-model-placements-${deployment.formationId}`,
      migrated.events.length + 1,
    );
  }
  replayed = replayBattleState(migrated);
  assert.equal(replayed.modelPlacementsByFormation.size, 1);
  assert.equal(replayed.deploymentComplete, true);
});
