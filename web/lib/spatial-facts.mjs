export const SPATIAL_CONSTANTS = Object.freeze({
  coherencyHorizontalThousandths: 2_000,
  coherencyVerticalThousandths: 5_000,
  engagementHorizontalThousandths: 1_000,
  engagementVerticalThousandths: 5_000,
  objectiveHorizontalThousandths: 3_000,
  objectiveVerticalThousandths: 5_000,
  objectiveMarkerDiameterThousandths: 1_575,
});
export const SPATIAL_FACT_FLAGS_MASK = 7;

const EPSILON = 1e-7;

function rotate(x, y, cosine, sine) {
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function supportPoint(model, direction) {
  const angle = ((model.rotationMilliDegrees ?? 0) * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const local = rotate(direction.x, direction.y, cosine, -sine);
  const halfWidth = model.widthThousandths / 2;
  const halfDepth = model.depthThousandths / 2;
  let point;
  if (model.shape === "rectangle") {
    point = {
      x: local.x < 0 ? -halfWidth : halfWidth,
      y: local.y < 0 ? -halfDepth : halfDepth,
    };
  } else {
    const denominator = Math.hypot(halfWidth * local.x, halfDepth * local.y);
    point =
      denominator <= EPSILON
        ? { x: halfWidth, y: 0 }
        : {
            x: (halfWidth * halfWidth * local.x) / denominator,
            y: (halfDepth * halfDepth * local.y) / denominator,
          };
  }
  const world = rotate(point.x, point.y, cosine, sine);
  return {
    x: model.centerXThousandths + world.x,
    y: model.centerYThousandths + world.y,
  };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y;
}

function subtract(first, second) {
  return { x: first.x - second.x, y: first.y - second.y };
}

function triple(first, second, third) {
  const scale = dot(first, third);
  const otherScale = dot(second, third);
  return {
    x: second.x * scale - first.x * otherScale,
    y: second.y * scale - first.y * otherScale,
  };
}

function minkowskiSupport(first, second, distance, direction) {
  const length = Math.hypot(direction.x, direction.y);
  const unit =
    length <= EPSILON ? { x: 1, y: 0 } : { x: direction.x / length, y: direction.y / length };
  const firstPoint = supportPoint(first, direction);
  const secondPoint = supportPoint(second, { x: -direction.x, y: -direction.y });
  return {
    x: firstPoint.x - secondPoint.x + unit.x * distance,
    y: firstPoint.y - secondPoint.y + unit.y * distance,
  };
}

function nextSimplex(simplex) {
  const a = simplex.at(-1);
  const ao = { x: -a.x, y: -a.y };
  if (simplex.length === 2) {
    const b = simplex[0];
    const ab = subtract(b, a);
    if (dot(ab, ao) <= EPSILON) return { containsOrigin: false, simplex: [a], direction: ao };
    const direction = triple(ab, ao, ab);
    if (Math.hypot(direction.x, direction.y) <= EPSILON) {
      return { containsOrigin: true, simplex, direction: { x: 0, y: 0 } };
    }
    return { containsOrigin: false, simplex, direction };
  }
  const b = simplex[1];
  const c = simplex[0];
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const outsideAb = triple(ac, ab, ab);
  if (dot(outsideAb, ao) > EPSILON) {
    return { containsOrigin: false, simplex: [b, a], direction: outsideAb };
  }
  const outsideAc = triple(ab, ac, ac);
  if (dot(outsideAc, ao) > EPSILON) {
    return { containsOrigin: false, simplex: [c, a], direction: outsideAc };
  }
  return { containsOrigin: true, simplex, direction: { x: 0, y: 0 } };
}

export function horizontalBoundariesWithin(first, second, distanceThousandths) {
  if (!first || !second || !Number.isFinite(distanceThousandths) || distanceThousandths < 0) {
    return false;
  }
  let direction = {
    x: second.centerXThousandths - first.centerXThousandths,
    y: second.centerYThousandths - first.centerYThousandths,
  };
  if (Math.hypot(direction.x, direction.y) <= EPSILON) direction = { x: 1, y: 0 };
  let simplex = [minkowskiSupport(first, second, distanceThousandths, direction)];
  direction = { x: -simplex[0].x, y: -simplex[0].y };
  if (Math.hypot(direction.x, direction.y) <= EPSILON) return true;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const point = minkowskiSupport(first, second, distanceThousandths, direction);
    if (dot(point, direction) < -EPSILON) return false;
    simplex.push(point);
    const next = nextSimplex(simplex);
    if (next.containsOrigin) return true;
    simplex = next.simplex;
    direction = next.direction;
    if (Math.hypot(direction.x, direction.y) <= EPSILON) return true;
  }
  return false;
}

function verticalExtent(model) {
  return model.measurementBasis === "base" ? 0 : model.verticalExtentThousandths;
}

export function modelSpatialGeometryIsReady(model) {
  return Boolean(
    model &&
      Number.isSafeInteger(model.elevationThousandths) &&
      Number.isSafeInteger(model.verticalExtentThousandths) &&
      model.verticalExtentThousandths >= 0 &&
      (model.measurementBasis === "base" || model.verticalExtentThousandths > 0),
  );
}

export function verticalBoundariesWithin(first, second, distanceThousandths) {
  if (!modelSpatialGeometryIsReady(first) || !modelSpatialGeometryIsReady(second)) return false;
  const firstBottom = first.elevationThousandths;
  const firstTop = firstBottom + verticalExtent(first);
  const secondBottom = second.elevationThousandths;
  const secondTop = secondBottom + verticalExtent(second);
  const gap = Math.max(0, firstBottom - secondTop, secondBottom - firstTop);
  return gap <= distanceThousandths;
}

export function modelBoundariesWithin(first, second, horizontalThousandths, verticalThousandths) {
  return (
    verticalBoundariesWithin(first, second, verticalThousandths) &&
    horizontalBoundariesWithin(first, second, horizontalThousandths)
  );
}

function unavailableFact(formationId, reasons, modelCount) {
  return {
    formationId,
    executable: false,
    unavailableReasons: [...new Set(reasons)].sort(),
    modelCount,
    coherency: { status: "unknown", requiredNeighbours: null, models: [] },
    engagementRange: { status: "unknown", enemyFormationIds: [], modelPairs: [] },
    objectives: [],
  };
}

function objectiveMarker(objective) {
  return {
    measurementBasis: "base",
    shape: "circle",
    widthThousandths: SPATIAL_CONSTANTS.objectiveMarkerDiameterThousandths,
    depthThousandths: SPATIAL_CONSTANTS.objectiveMarkerDiameterThousandths,
    centerXThousandths: objective.xThousandths,
    centerYThousandths: objective.yThousandths,
    elevationThousandths: 0,
    verticalExtentThousandths: 0,
    rotationMilliDegrees: 0,
  };
}

export function deriveSpatialFacts({ formations, positions, staleFormationIds, objectives }) {
  const facts = new Map();
  const ready = new Map();
  for (const [formationId, position] of positions) {
    const formation = formations.get(formationId);
    const models = position?.models ?? [];
    const reasons = [];
    if (!formation) reasons.push("formation_missing");
    if (staleFormationIds.has(formationId)) reasons.push("geometry_stale");
    if (models.length === 0) reasons.push("positions_missing");
    if (models.some((model) => !modelSpatialGeometryIsReady(model))) {
      reasons.push("baseless_vertical_extent_missing");
    }
    if (reasons.length > 0) {
      facts.set(formationId, unavailableFact(formationId, reasons, models.length));
    } else {
      ready.set(formationId, { formation, models });
    }
  }
  for (const [formationId, entry] of ready) {
    const requiredNeighbours = entry.models.length <= 1 ? 0 : entry.models.length <= 6 ? 1 : 2;
    const coherencyModels = entry.models.map((model) => {
      const neighbourModelIds = entry.models
        .filter(
          (candidate) =>
            candidate.modelId !== model.modelId &&
            modelBoundariesWithin(
              model,
              candidate,
              SPATIAL_CONSTANTS.coherencyHorizontalThousandths,
              SPATIAL_CONSTANTS.coherencyVerticalThousandths,
            ),
        )
        .map((candidate) => candidate.modelId)
        .sort();
      return {
        modelId: model.modelId,
        neighbourModelIds,
        coherent: neighbourModelIds.length >= requiredNeighbours,
      };
    });
    const enemyPairs = [];
    for (const [enemyFormationId, enemy] of ready) {
      if (enemy.formation.playerId === entry.formation.playerId) continue;
      for (const model of entry.models) {
        for (const enemyModel of enemy.models) {
          if (
            modelBoundariesWithin(
              model,
              enemyModel,
              SPATIAL_CONSTANTS.engagementHorizontalThousandths,
              SPATIAL_CONSTANTS.engagementVerticalThousandths,
            )
          ) {
            enemyPairs.push({
              modelId: model.modelId,
              enemyFormationId,
              enemyModelId: enemyModel.modelId,
            });
          }
        }
      }
    }
    enemyPairs.sort((left, right) =>
      `${left.enemyFormationId}:${left.enemyModelId}:${left.modelId}`.localeCompare(
        `${right.enemyFormationId}:${right.enemyModelId}:${right.modelId}`,
      ),
    );
    const objectiveFacts = (objectives ?? []).map((objective) => {
      const marker = objectiveMarker(objective);
      const modelIds = entry.models
        .filter((model) =>
          modelBoundariesWithin(
            model,
            marker,
            SPATIAL_CONSTANTS.objectiveHorizontalThousandths,
            SPATIAL_CONSTANTS.objectiveVerticalThousandths,
          ),
        )
        .map((model) => model.modelId)
        .sort();
      return {
        objectiveId: objective.objectiveId,
        status: modelIds.length ? "in_range" : "out_of_range",
        modelIds,
      };
    });
    facts.set(formationId, {
      formationId,
      executable: true,
      unavailableReasons: [],
      modelCount: entry.models.length,
      coherency: {
        status: coherencyModels.every((model) => model.coherent) ? "coherent" : "incoherent",
        requiredNeighbours,
        models: coherencyModels,
      },
      engagementRange: {
        status: enemyPairs.length ? "engaged" : "clear",
        enemyFormationIds: [...new Set(enemyPairs.map((pair) => pair.enemyFormationId))].sort(),
        modelPairs: enemyPairs,
      },
      objectives: objectiveFacts,
    });
  }
  return facts;
}

export function spatialFactValues(fact) {
  const coherentModelCount = fact.coherency.models.filter((model) => model.coherent).length;
  const objectiveInRangeCount = fact.objectives.filter(
    (objective) => objective.status === "in_range",
  ).length;
  return [
    fact.modelCount,
    fact.executable ? fact.modelCount : 0,
    fact.coherency.requiredNeighbours ?? 0,
    coherentModelCount,
    fact.engagementRange.modelPairs.length,
    fact.objectives.length,
    objectiveInRangeCount,
    fact.executable ? SPATIAL_FACT_FLAGS_MASK : 0,
  ];
}

export function spatialFactValuesAreValid(
  modelCount,
  readyModelCount,
  requiredNeighbourCount,
  coherentModelCount,
  enemyModelPairCount,
  objectiveCount,
  objectiveInRangeCount,
  flags,
) {
  const expectedNeighbours = modelCount <= 1 ? 0 : modelCount <= 6 ? 1 : 2;
  return Boolean(
    modelCount > 0 &&
      modelCount <= 1000 &&
      readyModelCount === modelCount &&
      requiredNeighbourCount === expectedNeighbours &&
      coherentModelCount <= modelCount &&
      enemyModelPairCount <= 1_000_000 &&
      objectiveCount <= 12 &&
      objectiveInRangeCount <= objectiveCount &&
      flags === SPATIAL_FACT_FLAGS_MASK,
  );
}
