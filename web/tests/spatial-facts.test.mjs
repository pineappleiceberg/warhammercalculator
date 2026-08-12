import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveEndpointClearanceFacts,
  deriveSpatialFacts,
  endpointClearanceFactValues,
  endpointClearanceFactValuesAreValid,
  horizontalBoundariesWithin,
  horizontalFootprintsOverlap,
  formationBoundariesWithinDistance,
  modelBoundariesWithin,
  modelBoundariesWithinDistance,
  spatialFactValues,
  spatialFactValuesAreValid,
} from "../lib/spatial-facts.mjs";

function model(
  modelId,
  x,
  y,
  elevation = 0,
  { basis = "base", shape = "circle", width = 1_000, depth = width, height = 0, rotation = 0 } = {},
) {
  return {
    modelId,
    measurementBasis: basis,
    shape,
    widthThousandths: width,
    depthThousandths: depth,
    verticalExtentThousandths: height,
    centerXThousandths: x,
    centerYThousandths: y,
    elevationThousandths: elevation,
    rotationMilliDegrees: rotation,
  };
}

test("closest-boundary geometry includes exact threshold contact", () => {
  const first = model("first", 5_000, 5_000);
  assert.equal(horizontalBoundariesWithin(first, model("touch", 7_000, 5_000), 1_000), true);
  assert.equal(horizontalBoundariesWithin(first, model("gap", 7_001, 5_000), 1_000), false);
  assert.equal(
    horizontalBoundariesWithin(
      model("rectangle", 10_000, 10_000, 0, {
        shape: "rectangle",
        width: 4_000,
        depth: 2_000,
        rotation: 45_000,
      }),
      model("ellipse", 13_000, 10_000, 0, { shape: "ellipse", width: 2_000, depth: 1_000 }),
      1_000,
    ),
    true,
  );
});

test("strict footprint overlap distinguishes collision from legal edge contact", () => {
  const first = model("first", 5_000, 5_000);
  assert.equal(horizontalFootprintsOverlap(first, model("overlap", 5_999, 5_000)), true);
  assert.equal(horizontalFootprintsOverlap(first, model("touch", 6_000, 5_000)), false);
  assert.equal(horizontalFootprintsOverlap(first, model("gap", 6_001, 5_000)), false);
  assert.equal(
    horizontalFootprintsOverlap(
      model("rectangle", 10_000, 10_000, 0, {
        shape: "rectangle",
        width: 4_000,
        depth: 2_000,
        rotation: 45_000,
      }),
      model("ellipse", 10_000, 10_000, 0, {
        shape: "ellipse",
        width: 2_000,
        depth: 1_000,
      }),
    ),
    true,
  );
});

test("endpoint clearance derives model and objective collisions in three dimensions", () => {
  const positions = new Map([
    [
      "alpha",
      {
        models: [
          model("a1", 10_000, 10_000),
          model("a2", 12_000, 10_000),
          model("a3", 20_000, 20_000, 2_000),
        ],
      },
    ],
    ["beta", { models: [model("b1", 10_999, 10_000)] }],
  ]);
  const facts = deriveEndpointClearanceFacts({
    positions,
    objectives: [{ objectiveId: "centre", xThousandths: 12_000, yThousandths: 10_000 }],
  });
  assert.equal(facts.executable, true);
  assert.equal(facts.status, "collision");
  assert.deepEqual(facts.modelPairs, [
    {
      firstFormationId: "alpha",
      firstModelId: "a1",
      secondFormationId: "beta",
      secondModelId: "b1",
    },
  ]);
  assert.deepEqual(facts.objectivePairs, [
    { formationId: "alpha", modelId: "a2", objectiveId: "centre" },
    { formationId: "beta", modelId: "b1", objectiveId: "centre" },
  ]);
  assert.equal(endpointClearanceFactValuesAreValid(...endpointClearanceFactValues(facts)), true);

  const verticallySeparated = deriveEndpointClearanceFacts({
    positions: new Map([
      ["alpha", { models: [model("a1", 10_000, 10_000)] }],
      ["beta", { models: [model("b1", 10_000, 10_000, 1_000)] }],
    ]),
    objectives: [],
  });
  assert.equal(verticallySeparated.status, "clear");
});

test("endpoint clearance fails closed for stale or incomplete model geometry", () => {
  const facts = deriveEndpointClearanceFacts({
    positions: new Map([
      ["stale", { models: [model("s1", 5_000, 5_000)] }],
      [
        "legacy",
        {
          models: [
            model("l1", 7_000, 5_000, 0, {
              basis: "model",
              shape: "rectangle",
              height: 0,
            }),
          ],
        },
      ],
    ]),
    unavailableFormationIds: new Set(["stale"]),
    objectives: [{ objectiveId: "near", xThousandths: 6_000, yThousandths: 5_000 }],
  });
  assert.equal(facts.executable, false);
  assert.equal(facts.status, "unknown");
  assert.equal(facts.readyModelCount, 0);
  assert.ok(facts.unavailableReasons.some((reason) => reason.includes("stale")));
  assert.equal(endpointClearanceFactValuesAreValid(...endpointClearanceFactValues(facts)), true);
});

test("vertical proximity uses base planes and baseless hull intervals", () => {
  const groundBase = model("base", 5_000, 5_000);
  const highBase = model("high", 5_000, 5_000, 5_000);
  const tooHighBase = model("too-high", 5_000, 5_000, 5_001);
  assert.equal(modelBoundariesWithin(groundBase, highBase, 1_000, 5_000), true);
  assert.equal(modelBoundariesWithin(groundBase, tooHighBase, 1_000, 5_000), false);
  const hull = model("hull", 5_000, 5_000, 4_000, {
    basis: "model",
    shape: "rectangle",
    width: 2_000,
    depth: 3_000,
    height: 3_000,
  });
  assert.equal(
    modelBoundariesWithin(hull, model("upper", 5_000, 5_000, 12_000), 1_000, 5_000),
    true,
  );
});

test("straight-line boundary distance combines horizontal and vertical separation", () => {
  const first = model("first", 5_000, 5_000);
  const exact = model("exact", 10_800, 5_000, 3_600);
  const beyond = model("beyond", 10_800, 5_000, 3_601);
  assert.equal(modelBoundariesWithinDistance(first, exact, 6_000), true);
  assert.equal(modelBoundariesWithinDistance(first, beyond, 6_000), false);
  assert.equal(
    formationBoundariesWithinDistance({ models: [first] }, { models: [exact] }, 6_000),
    true,
  );
  assert.equal(formationBoundariesWithinDistance({ models: [] }, { models: [exact] }, 6_000), null);
});

test("derived facts execute coherency, Engagement Range, and objective proximity", () => {
  const formations = new Map([
    ["alpha", { id: "alpha", playerId: "one" }],
    ["beta", { id: "beta", playerId: "two" }],
  ]);
  const positions = new Map([
    [
      "alpha",
      {
        models: [
          model("a1", 10_000, 10_000),
          model("a2", 12_000, 10_000),
          model("a3", 30_000, 30_000),
        ],
      },
    ],
    ["beta", { models: [model("b1", 13_500, 10_000)] }],
  ]);
  const facts = deriveSpatialFacts({
    formations,
    positions,
    staleFormationIds: new Set(),
    objectives: [
      { objectiveId: "near", xThousandths: 6_000, yThousandths: 10_000 },
      { objectiveId: "far", xThousandths: 50_000, yThousandths: 40_000 },
    ],
  });
  const alpha = facts.get("alpha");
  assert.equal(alpha.executable, true);
  assert.equal(alpha.coherency.status, "incoherent");
  assert.deepEqual(alpha.coherency.models[0].neighbourModelIds, ["a2"]);
  assert.deepEqual(alpha.coherency.models[2].neighbourModelIds, []);
  assert.equal(alpha.engagementRange.status, "engaged");
  assert.deepEqual(alpha.engagementRange.enemyFormationIds, ["beta"]);
  assert.deepEqual(
    alpha.objectives.map(({ objectiveId, status }) => [objectiveId, status]),
    [
      ["near", "in_range"],
      ["far", "out_of_range"],
    ],
  );
  const values = spatialFactValues(alpha);
  assert.equal(spatialFactValuesAreValid(...values), true);
});

test("stale geometry and legacy baseless hulls fail closed", () => {
  const formations = new Map([
    ["stale", { id: "stale", playerId: "one" }],
    ["legacy", { id: "legacy", playerId: "two" }],
  ]);
  const facts = deriveSpatialFacts({
    formations,
    positions: new Map([
      ["stale", { models: [model("s1", 1_000, 1_000)] }],
      [
        "legacy",
        {
          models: [
            model("l1", 2_000, 2_000, 0, {
              basis: "model",
              shape: "rectangle",
              height: 0,
            }),
          ],
        },
      ],
    ]),
    staleFormationIds: new Set(["stale"]),
    objectives: [],
  });
  assert.deepEqual(facts.get("stale").unavailableReasons, ["geometry_stale"]);
  assert.deepEqual(facts.get("legacy").unavailableReasons, ["baseless_vertical_extent_missing"]);
});

test("seven-model units require two coherent neighbours per model", () => {
  const models = Array.from({ length: 7 }, (_, index) =>
    model(`m${index + 1}`, 10_000 + index * 1_000, 10_000),
  );
  const facts = deriveSpatialFacts({
    formations: new Map([["large", { id: "large", playerId: "one" }]]),
    positions: new Map([["large", { models }]]),
    staleFormationIds: new Set(),
    objectives: [],
  }).get("large");
  assert.equal(facts.coherency.requiredNeighbours, 2);
  assert.equal(facts.coherency.status, "coherent");
});
