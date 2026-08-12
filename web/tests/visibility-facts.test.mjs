import assert from "node:assert/strict";
import test from "node:test";

import {
  convexTerrainSurfaceIsValid,
  convexSilhouetteIsValid,
  deriveVisibilityFacts,
  simpleTerrainSurfaceIsValid,
  terrainVisibilityGeometryIsValid,
  visibilityFactValues,
  visibilityFactValuesAreValid,
} from "../lib/visibility-facts.mjs";

const CONVEX_SQUARE = [
  { xOffsetThousandths: -500, yOffsetThousandths: -500 },
  { xOffsetThousandths: 500, yOffsetThousandths: -500 },
  { xOffsetThousandths: 500, yOffsetThousandths: 500 },
  { xOffsetThousandths: -500, yOffsetThousandths: 500 },
];

function formation(id, playerId, modelId, keywords = []) {
  return {
    id,
    playerId,
    keywords,
    deploymentTraits: { aircraft: keywords.includes("aircraft") },
    segments: [{ id: `${id}-segment`, modelIds: [modelId] }],
    health: { [`${id}-segment`]: { modelsRemaining: 1 } },
  };
}

function model(modelId, centerXThousandths, centerYThousandths, elevationThousandths = 0) {
  return {
    modelId,
    measurementBasis: "base",
    shape: "circle",
    widthThousandths: 1000,
    depthThousandths: 1000,
    verticalExtentThousandths: 0,
    centerXThousandths,
    centerYThousandths,
    elevationThousandths,
    rotationMilliDegrees: 0,
    silhouette: {
      shape: "rectangle",
      widthThousandths: 1000,
      depthThousandths: 1000,
      heightThousandths: 3000,
      bottomOffsetThousandths: 0,
      centerOffsetXThousandths: 0,
      centerOffsetYThousandths: 0,
      sightPoints: [{ xOffsetThousandths: 0, yOffsetThousandths: 0, heightThousandths: 2000 }],
      envelopeReviewed: true,
      sightPointsReviewed: true,
    },
  };
}

function withConvexSilhouette(candidate, convexVertices = CONVEX_SQUARE) {
  return {
    ...candidate,
    silhouette: {
      ...candidate.silhouette,
      geometryMode: "convex_prism",
      convexVertices,
      convexReviewed: true,
    },
  };
}

function footprint(
  centerXThousandths = 5000,
  centerYThousandths = 5000,
  widthThousandths = 2000,
  heightThousandths = 10_000,
) {
  return {
    id: "outline-1",
    areaTerrainSectionId: "section-1",
    centerXThousandths,
    centerYThousandths,
    widthThousandths,
    heightThousandths,
    rotationMilliDegrees: 0,
  };
}

function terrainFootprints(value = footprint()) {
  return { footprints: [value] };
}

function terrainVisibility(featureType = "other", panels = []) {
  return {
    sections: [
      {
        sectionId: "section-1",
        featureType,
        geometryComplete: true,
        panels,
      },
    ],
    allFeaturesRecorded: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Every physical wall and opening was measured",
  };
}

function panel(openings = []) {
  return {
    id: "wall-1",
    startXThousandths: 5000,
    startYThousandths: 0,
    endXThousandths: 5000,
    endYThousandths: 10_000,
    bottomZThousandths: 0,
    topZThousandths: 5000,
    openings,
  };
}

function facts({
  observer = model("observer-model", 2000, 5000),
  target = model("target-model", 8000, 5000),
  featureType = "other",
  panels = [],
  outline = footprint(),
  staleFormationIds = new Set(),
  observerKeywords = [],
} = {}) {
  const observerFormation = formation("observer", "player-1", "observer-model", observerKeywords);
  const targetFormation = formation("target", "player-2", "target-model");
  return deriveVisibilityFacts({
    formations: new Map([
      [observerFormation.id, observerFormation],
      [targetFormation.id, targetFormation],
    ]),
    positions: new Map([
      [observerFormation.id, { models: [observer] }],
      [targetFormation.id, { models: [target] }],
    ]),
    staleFormationIds,
    terrainFootprints: terrainFootprints(outline),
    terrainVisibility: terrainVisibility(featureType, panels),
  })
    .get("observer")
    .get("target");
}

test("validated wall panels require measured endpoints, height, openings, and complete review", () => {
  const opening = {
    startOffsetThousandths: 4000,
    endOffsetThousandths: 6000,
    bottomZThousandths: 1000,
    topZThousandths: 3000,
  };
  const set = terrainVisibility("ruins", [panel([opening])]);
  assert.equal(terrainVisibilityGeometryIsValid(set, terrainFootprints()), true);
  assert.equal(
    terrainVisibilityGeometryIsValid(
      { ...set, sections: [{ ...set.sections[0], geometryComplete: false }] },
      terrainFootprints(),
    ),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(
      {
        ...set,
        sections: [
          {
            ...set.sections[0],
            panels: [panel([{ ...opening, endOffsetThousandths: 11_000 }])],
          },
        ],
      },
      terrainFootprints(),
    ),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(set, {
      footprints: [
        footprint(4000, 5000, 1000, 10_000),
        { ...footprint(6000, 5000, 1000, 10_000), id: "outline-2" },
      ],
    }),
    false,
  );
});

test("movement surfaces require reviewed convex solids wholly inside one terrain section", () => {
  const surface = {
    id: "floor-1",
    vertices: [
      { xThousandths: 4500, yThousandths: 4000 },
      { xThousandths: 5500, yThousandths: 4000 },
      { xThousandths: 5500, yThousandths: 6000 },
      { xThousandths: 4500, yThousandths: 6000 },
    ],
    bottomZThousandths: 3000,
    topZThousandths: 3500,
    supportsEnding: true,
  };
  const set = {
    ...terrainVisibility("ruins"),
    allMovementGeometryRecorded: true,
    sections: [
      {
        ...terrainVisibility("ruins").sections[0],
        movementType: "ruins",
        movementGeometryComplete: true,
        surfaces: [surface],
      },
    ],
  };
  assert.equal(convexTerrainSurfaceIsValid(surface.vertices), true);
  assert.equal(terrainVisibilityGeometryIsValid(set, terrainFootprints()), true);
  assert.equal(
    terrainVisibilityGeometryIsValid(set, {
      footprints: [
        footprint(4000, 5000, 1000, 10_000),
        { ...footprint(6000, 5000, 1000, 10_000), id: "outline-2" },
      ],
    }),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(
      {
        ...set,
        sections: [
          {
            ...set.sections[0],
            surfaces: [
              {
                ...surface,
                vertices: [
                  surface.vertices[0],
                  surface.vertices[1],
                  { xThousandths: 5000, yThousandths: 5000 },
                  surface.vertices[2],
                  surface.vertices[3],
                ],
              },
            ],
          },
        ],
      },
      terrainFootprints(),
    ),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(
      {
        ...set,
        sections: [
          {
            ...set.sections[0],
            surfaces: [
              {
                ...surface,
                vertices: surface.vertices.map((vertex, index) =>
                  index === 0 ? { ...vertex, xThousandths: 3000 } : vertex,
                ),
              },
            ],
          },
        ],
      },
      terrainFootprints(),
    ),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(
      {
        ...set,
        sections: [
          {
            ...set.sections[0],
            surfaces: [{ ...surface, topZThousandths: surface.bottomZThousandths }],
          },
        ],
      },
      terrainFootprints(),
    ),
    false,
  );
});

test("reviewed simple terrain surfaces accept concavity but reject winding and self-intersection", () => {
  const concave = [
    { xThousandths: 4500, yThousandths: 4000 },
    { xThousandths: 5500, yThousandths: 4000 },
    { xThousandths: 5500, yThousandths: 6000 },
    { xThousandths: 5000, yThousandths: 5000 },
    { xThousandths: 4500, yThousandths: 6000 },
  ];
  const surface = {
    id: "concave-floor",
    geometryMode: "simple_polygon",
    vertices: concave,
    bottomZThousandths: 3000,
    topZThousandths: 3500,
    supportsEnding: true,
  };
  const set = {
    ...terrainVisibility("ruins"),
    allMovementGeometryRecorded: true,
    sections: [
      {
        ...terrainVisibility("ruins").sections[0],
        movementType: "ruins",
        movementGeometryComplete: true,
        surfaces: [surface],
      },
    ],
  };
  assert.equal(convexTerrainSurfaceIsValid(concave), false);
  assert.equal(simpleTerrainSurfaceIsValid(concave), true);
  assert.equal(terrainVisibilityGeometryIsValid(set, terrainFootprints()), true);
  assert.equal(simpleTerrainSurfaceIsValid([...concave].reverse()), false);
  assert.equal(
    simpleTerrainSurfaceIsValid([concave[0], concave[2], concave[4], concave[1], concave[3]]),
    false,
  );
  assert.equal(
    terrainVisibilityGeometryIsValid(
      {
        ...set,
        sections: [
          {
            ...set.sections[0],
            surfaces: [{ ...surface, geometryMode: "curved_polygon" }],
          },
        ],
      },
      terrainFootprints(),
    ),
    false,
  );
});

test("reviewed convex silhouette vertices must be strictly convex and counter-clockwise", () => {
  assert.equal(convexSilhouetteIsValid(CONVEX_SQUARE), true);
  assert.equal(convexSilhouetteIsValid([...CONVEX_SQUARE].reverse()), false);
  assert.equal(
    convexSilhouetteIsValid([
      CONVEX_SQUARE[0],
      CONVEX_SQUARE[1],
      { xOffsetThousandths: 0, yOffsetThousandths: 0 },
      CONVEX_SQUARE[2],
      CONVEX_SQUARE[3],
    ]),
    false,
  );
});

test("a reviewed convex prism avoids false line-of-sight blocking by its coarse envelope", () => {
  const observerFormation = formation("observer", "player-1", "observer-model");
  const targetFormation = formation("target", "player-2", "target-model");
  const blockerFormation = formation("blocker", "player-1", "blocker-model");
  const blocker = withConvexSilhouette(model("blocker-model", 5000, 2000));
  blocker.silhouette.widthThousandths = 4000;
  blocker.silhouette.depthThousandths = 4000;
  blocker.silhouette.heightThousandths = 500;
  blocker.silhouette.sightPoints = [
    { xOffsetThousandths: 0, yOffsetThousandths: 750, heightThousandths: 250 },
  ];
  blocker.silhouette.convexVertices = [
    { xOffsetThousandths: -500, yOffsetThousandths: 500 },
    { xOffsetThousandths: 500, yOffsetThousandths: 500 },
    { xOffsetThousandths: 0, yOffsetThousandths: 1000 },
  ];
  const result = deriveVisibilityFacts({
    formations: new Map([
      [observerFormation.id, observerFormation],
      [targetFormation.id, targetFormation],
      [blockerFormation.id, blockerFormation],
    ]),
    positions: new Map([
      [observerFormation.id, { models: [model("observer-model", 1000, 0)] }],
      [targetFormation.id, { models: [model("target-model", 9000, 0)] }],
      [blockerFormation.id, { models: [blocker] }],
    ]),
    terrainFootprints: terrainFootprints(footprint(20_000, 20_000)),
    terrainVisibility: terrainVisibility(),
  })
    .get("observer")
    .get("target");
  assert.equal(result.visibility.status, "visible");
  assert.equal(result.fullVisibility.status, "fully_visible");
});

test("an asymmetric convex prism rotates in the same frame as its model", () => {
  const observerFormation = formation("observer", "player-1", "observer-model");
  const targetFormation = formation("target", "player-2", "target-model");
  const blockerFormation = formation("blocker", "player-2", "blocker-model");
  const blocker = withConvexSilhouette(model("blocker-model", 5000, 1500), [
    { xOffsetThousandths: 1000, yOffsetThousandths: -500 },
    { xOffsetThousandths: 2000, yOffsetThousandths: 0 },
    { xOffsetThousandths: 1000, yOffsetThousandths: 500 },
  ]);
  blocker.rotationMilliDegrees = 90_000;
  blocker.silhouette.shape = "rectangle";
  blocker.silhouette.widthThousandths = 4000;
  const result = deriveVisibilityFacts({
    formations: new Map([
      [observerFormation.id, observerFormation],
      [targetFormation.id, targetFormation],
      [blockerFormation.id, blockerFormation],
    ]),
    positions: new Map([
      [observerFormation.id, { models: [model("observer-model", 1000, 3000)] }],
      [targetFormation.id, { models: [model("target-model", 9000, 3000)] }],
      [blockerFormation.id, { models: [blocker] }],
    ]),
    terrainFootprints: terrainFootprints(footprint(20_000, 20_000)),
    terrainVisibility: terrainVisibility(),
  })
    .get("observer")
    .get("target");
  assert.equal(result.visibility.status, "unknown");
  assert.equal(result.visibleModelPairCount, 0);
});

test("a reviewed sight ray through an exact wall opening proves model visibility", () => {
  const result = facts({
    panels: [
      panel([
        {
          startOffsetThousandths: 4000,
          endOffsetThousandths: 6000,
          bottomZThousandths: 1000,
          topZThousandths: 3000,
        },
      ]),
    ],
  });
  assert.equal(result.executable, true);
  assert.equal(result.visibility.status, "visible");
  assert.equal(result.fullVisibility.status, "unknown");
  assert.equal(result.cover.status, "mixed_or_unknown");
});

test("an opaque panel withholds a visibility claim instead of declaring a model invisible", () => {
  const result = facts({ panels: [panel()] });
  assert.equal(result.visibility.status, "unknown");
  assert.equal(result.visibleModelPairCount, 0);
  assert.equal(result.unknownModelPairCount, 1);
});

test("clear complete 3D space proves visibility, full visibility, and no terrain cover", () => {
  const result = facts({
    observer: model("observer-model", 1000, 1000),
    target: model("target-model", 2000, 1000),
    outline: footprint(20_000, 20_000),
  });
  assert.equal(result.visibility.status, "visible");
  assert.equal(result.fullVisibility.status, "fully_visible");
  assert.equal(result.cover.status, "no_benefit_of_cover");
  assert.deepEqual(result.cover.noModelIds, ["target-model"]);
  assert.equal(visibilityFactValuesAreValid(...visibilityFactValues(result)), true);
});

test("other target-unit models remain conservative line-of-sight blockers", () => {
  const observerFormation = formation("observer", "player-1", "observer-model");
  const targetFormation = {
    ...formation("target", "player-2", "target-front"),
    segments: [{ id: "target-segment", modelIds: ["target-front", "target-rear"] }],
    health: { "target-segment": { modelsRemaining: 2 } },
  };
  const result = deriveVisibilityFacts({
    formations: new Map([
      [observerFormation.id, observerFormation],
      [targetFormation.id, targetFormation],
    ]),
    positions: new Map([
      [observerFormation.id, { models: [model("observer-model", 1000, 1000)] }],
      [
        targetFormation.id,
        {
          models: [model("target-front", 3000, 1500), model("target-rear", 5000, 1000)],
        },
      ],
    ]),
    terrainFootprints: terrainFootprints(footprint(20_000, 20_000)),
    terrainVisibility: terrainVisibility(),
  })
    .get("observer")
    .get("target");
  assert.equal(result.visibleModelPairCount, 1);
  assert.equal(
    result.modelPairs.find((pair) => pair.targetModelId === "target-rear").visible,
    false,
  );
  assert.deepEqual(result.cover.unknownModelIds, ["target-rear"]);
});

test("a target wholly within a Ruin gets cover while visibility into it remains normal", () => {
  const result = facts({
    target: model("target-model", 5000, 5000),
    featureType: "ruins",
  });
  assert.equal(result.visibility.status, "visible");
  assert.equal(result.cover.status, "benefit_of_cover");
  assert.deepEqual(result.cover.yesModelIds, ["target-model"]);
});

test("an outside-to-outside Ruin crossing cannot produce a false clear-ray proof", () => {
  const result = facts({ featureType: "ruins" });
  assert.equal(result.visibility.status, "unknown");
  assert.equal(result.fullVisibility.status, "unknown");
});

test("only a model wholly within a Ruin can use its normal see-out rule", () => {
  const partiallyWithin = facts({
    observer: model("observer-model", 5900, 5000),
    target: model("target-model", 8000, 5000),
    featureType: "ruins",
  });
  const whollyWithin = facts({
    observer: model("observer-model", 5000, 5000),
    target: model("target-model", 8000, 5000),
    featureType: "ruins",
  });
  assert.equal(partiallyWithin.visibility.status, "unknown");
  assert.equal(whollyWithin.visibility.status, "visible");
});

test("Aircraft and Towering models use normal wall geometry instead of the Ruin footprint abstraction", () => {
  const aircraft = facts({ featureType: "ruins", observerKeywords: ["aircraft"] });
  const towering = facts({ featureType: "ruins", observerKeywords: ["towering"] });
  assert.equal(aircraft.visibility.status, "visible");
  assert.equal(towering.visibility.status, "visible");
});

test("stale geometry and incomplete silhouettes fail closed with readable reasons", () => {
  const stale = facts({ staleFormationIds: new Set(["observer"]) });
  assert.equal(stale.executable, false);
  assert.match(stale.unavailableReasons.join(" "), /stale/);
  const incomplete = facts({
    target: { ...model("target-model", 8000, 5000), silhouette: null },
  });
  assert.equal(incomplete.executable, false);
  assert.match(incomplete.unavailableReasons.join(" "), /silhouettes/);
});

test("C summary values reject inconsistent visibility and cover partitions", () => {
  const result = facts({
    observer: model("observer-model", 1000, 1000),
    target: model("target-model", 2000, 1000),
    outline: footprint(20_000, 20_000),
  });
  const values = visibilityFactValues(result);
  assert.equal(visibilityFactValuesAreValid(...values), true);
  values[9] += 1;
  assert.equal(visibilityFactValuesAreValid(...values), false);
});
