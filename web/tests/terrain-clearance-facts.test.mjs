import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveTerrainClearanceFacts,
  terrainClearanceFactValues,
  terrainClearanceFactValuesAreValid,
} from "../lib/terrain-clearance-facts.mjs";

function silhouette(heightThousandths = 2_000) {
  return {
    shape: "circle",
    widthThousandths: 1_000,
    depthThousandths: 1_000,
    heightThousandths,
    bottomOffsetThousandths: 0,
    centerOffsetXThousandths: 0,
    centerOffsetYThousandths: 0,
    sightPoints: [{ xOffsetThousandths: 0, yOffsetThousandths: 0, heightThousandths: 1_000 }],
    envelopeReviewed: true,
    sightPointsReviewed: true,
    geometryMode: "primitive",
    convexVertices: [],
    convexReviewed: false,
  };
}

function point(x, y, z = 0, rotation = 0) {
  return {
    centerXThousandths: x,
    centerYThousandths: y,
    elevationThousandths: z,
    rotationMilliDegrees: rotation,
  };
}

function model(path, overrides = {}) {
  return {
    modelId: "model-1",
    measurementBasis: "base",
    shape: "circle",
    widthThousandths: 1_000,
    depthThousandths: 1_000,
    verticalExtentThousandths: 0,
    ...path.at(-1),
    path,
    silhouette: silhouette(),
    ...overrides,
  };
}

function footprint() {
  return {
    areaTerrainSectionId: "section-1",
    centerXThousandths: 5_000,
    centerYThousandths: 10_000,
    widthThousandths: 10_000,
    heightThousandths: 20_000,
    rotationMilliDegrees: 0,
  };
}

function panel(overrides = {}) {
  return {
    id: "wall-1",
    startXThousandths: 5_000,
    startYThousandths: 0,
    endXThousandths: 5_000,
    endYThousandths: 20_000,
    bottomZThousandths: 0,
    topZThousandths: 5_000,
    openings: [],
    ...overrides,
  };
}

function surface(overrides = {}) {
  return {
    id: "floor-1",
    vertices: [
      { xThousandths: 4_000, yThousandths: 9_000 },
      { xThousandths: 6_000, yThousandths: 9_000 },
      { xThousandths: 6_000, yThousandths: 11_000 },
      { xThousandths: 4_000, yThousandths: 11_000 },
    ],
    bottomZThousandths: 3_000,
    topZThousandths: 3_500,
    supportsEnding: true,
    ...overrides,
  };
}

function facts(candidateModel, overrides = {}) {
  return deriveTerrainClearanceFacts({
    formation: { id: "formation-1", keywords: ["infantry"] },
    position: { models: [candidateModel] },
    terrainFootprints: { footprints: [footprint()] },
    terrainVisibility: {
      allMovementGeometryRecorded: true,
      sections: [
        {
          sectionId: "section-1",
          movementType: "normal",
          movementGeometryComplete: true,
          panels: [panel()],
          surfaces: [],
        },
      ],
    },
    ...overrides,
  });
}

test("rejects a whole model crossing a measured wall and accepts a fitting opening", () => {
  const blocked = facts(model([point(4_000, 10_000), point(6_000, 10_000)]));
  assert.equal(blocked.status, "collision");
  assert.equal(blocked.collisions[0].reason, "path_crosses_terrain_panel");

  const openingFacts = facts(model([point(4_000, 10_000), point(6_000, 10_000)]), {
    terrainVisibility: {
      allMovementGeometryRecorded: true,
      sections: [
        {
          sectionId: "section-1",
          movementType: "normal",
          movementGeometryComplete: true,
          panels: [
            panel({
              openings: [
                {
                  startOffsetThousandths: 9_000,
                  endOffsetThousandths: 11_000,
                  bottomZThousandths: 0,
                  topZThousandths: 4_000,
                },
              ],
            }),
          ],
          surfaces: [],
        },
      ],
    },
  });
  assert.equal(openingFacts.status, "clear");
  assert.equal(
    terrainClearanceFactValuesAreValid(...terrainClearanceFactValues(openingFacts)),
    true,
  );
});

test("accepts an explicit climb over a wall and rejects a path below its top", () => {
  const climb = facts(
    model([
      point(4_000, 10_000),
      point(4_500, 10_000),
      point(4_500, 10_000, 5_000),
      point(5_500, 10_000, 5_000),
      point(5_500, 10_000),
      point(6_000, 10_000),
    ]),
  );
  assert.equal(climb.status, "clear");

  const tooLow = facts(
    model([
      point(4_000, 10_000),
      point(4_500, 10_000),
      point(4_500, 10_000, 4_999),
      point(5_500, 10_000, 4_999),
      point(5_500, 10_000),
      point(6_000, 10_000),
    ]),
  );
  assert.equal(tooLow.status, "collision");
});

test("proves clearance beneath an overhang only when the whole model fits", () => {
  const terrainVisibility = {
    allMovementGeometryRecorded: true,
    sections: [
      {
        sectionId: "section-1",
        movementType: "normal",
        movementGeometryComplete: true,
        panels: [panel({ bottomZThousandths: 3_000, topZThousandths: 6_000 })],
        surfaces: [],
      },
    ],
  };
  assert.equal(
    facts(model([point(4_000, 10_000), point(6_000, 10_000)]), { terrainVisibility }).status,
    "clear",
  );
  assert.equal(
    facts(model([point(4_000, 10_000), point(6_000, 10_000)], { silhouette: silhouette(4_000) }), {
      terrainVisibility,
    }).status,
    "collision",
  );
});

test("checks convex floor solids, support, overhang, and Ruins endpoint keywords", () => {
  const terrainVisibility = {
    allMovementGeometryRecorded: true,
    sections: [
      {
        sectionId: "section-1",
        movementType: "ruins",
        movementGeometryComplete: true,
        panels: [],
        surfaces: [surface()],
      },
    ],
  };
  const supported = facts(model([point(5_000, 10_000, 3_500)]), { terrainVisibility });
  assert.equal(supported.status, "clear");

  const overhang = facts(model([point(5_800, 10_000, 3_500)]), { terrainVisibility });
  assert.equal(overhang.status, "collision");
  assert.equal(
    overhang.collisions.some((entry) => entry.reason === "unsupported_elevated_endpoint"),
    true,
  );

  const vehicle = facts(model([point(5_000, 10_000, 3_500)]), {
    formation: { id: "formation-1", keywords: ["vehicle"] },
    terrainVisibility,
  });
  assert.equal(vehicle.status, "collision");
  assert.equal(
    vehicle.collisions.some((entry) => entry.reason === "ruins_upper_floor_keyword_required"),
    true,
  );
});

test("checks concave solids without filling their cut-outs and requires whole-base support", () => {
  const concaveSurface = surface({
    id: "l-floor",
    geometryMode: "simple_polygon",
    bottomZThousandths: 1_000,
    vertices: [
      { xThousandths: 4_000, yThousandths: 9_000 },
      { xThousandths: 6_000, yThousandths: 9_000 },
      { xThousandths: 6_000, yThousandths: 10_000 },
      { xThousandths: 5_000, yThousandths: 10_000 },
      { xThousandths: 5_000, yThousandths: 11_000 },
      { xThousandths: 4_000, yThousandths: 11_000 },
    ],
  });
  const terrainVisibility = {
    allMovementGeometryRecorded: true,
    sections: [
      {
        sectionId: "section-1",
        movementType: "normal",
        movementGeometryComplete: true,
        panels: [],
        surfaces: [concaveSurface],
      },
    ],
  };
  const throughCutOut = facts(model([point(5_500, 10_500)]), {
    terrainVisibility,
  });
  assert.equal(throughCutOut.status, "clear");

  const throughSolid = facts(model([point(4_500, 10_500)]), {
    terrainVisibility,
  });
  assert.equal(throughSolid.status, "collision");
  assert.equal(throughSolid.collisions[0].obstacleId, "l-floor");

  const supported = facts(model([point(4_500, 10_500, 3_500)]), { terrainVisibility });
  assert.equal(supported.status, "clear");
  const overCutOut = facts(model([point(5_500, 10_500, 3_500)]), { terrainVisibility });
  assert.equal(overCutOut.status, "collision");
  assert.equal(
    overCutOut.collisions.some((entry) => entry.reason === "unsupported_elevated_endpoint"),
    true,
  );
});

test("fails closed for incomplete movement geometry, reviewed semantics, legacy paths, and pivots", () => {
  const incomplete = facts(model([point(4_000, 8_000), point(6_000, 8_000)]), {
    terrainVisibility: {
      allMovementGeometryRecorded: false,
      sections: [
        {
          sectionId: "section-1",
          movementType: "reviewed",
          movementGeometryComplete: false,
          panels: [panel()],
          surfaces: [],
        },
      ],
    },
  });
  assert.equal(incomplete.status, "unknown");
  assert.equal(incomplete.executable, false);
  assert.deepEqual(incomplete.collisions, []);

  const legacy = facts(model([point(4_000, 8_000), point(6_000, 8_000)]), { legacy: true });
  assert.equal(legacy.status, "unknown");
  assert.match(legacy.unavailableReasons.join(" "), /legacy/);

  const pivot = facts(model([point(4_000, 8_000, 0, 0), point(6_000, 8_000, 0, 90_000)]));
  assert.equal(pivot.status, "unknown");
  assert.match(pivot.unavailableReasons.join(" "), /rotation/);
});
