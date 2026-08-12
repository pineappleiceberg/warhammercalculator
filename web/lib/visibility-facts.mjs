const EPSILON = 0.001;

export const VISIBILITY_INSPECTION_SCHEMA_VERSION = 1;

export const TERRAIN_VISIBILITY_FEATURES = Object.freeze(["ruins", "woods", "other"]);
export const TERRAIN_VISIBILITY_METHODS = Object.freeze(["manual", "uwb", "camera", "imported"]);
export const TERRAIN_VISIBILITY_LIMITS = Object.freeze({
  maximumSections: 24,
  maximumPanels: 256,
  maximumOpeningsPerPanel: 32,
  maximumSurfaces: 256,
  maximumVerticesPerSurface: 32,
  maximumConvexVerticesPerSurface: 16,
  maximumSightPointsPerModel: 16,
  maximumConvexVerticesPerModel: 16,
  maximumCoordinateThousandths: 100_000,
  maximumHeightThousandths: 30_000,
});

export const TERRAIN_SURFACE_GEOMETRY_MODES = Object.freeze(["convex_polygon", "simple_polygon"]);

export const TERRAIN_MOVEMENT_TYPES = Object.freeze([
  "ruins",
  "woods",
  "normal",
  "no_end",
  "reviewed",
]);

export function convexSilhouetteIsValid(vertices, flags = 1) {
  if (
    flags !== 1 ||
    !Array.isArray(vertices) ||
    vertices.length < 3 ||
    vertices.length > TERRAIN_VISIBILITY_LIMITS.maximumConvexVerticesPerModel ||
    vertices.some(
      (vertex) =>
        !integerBetween(vertex?.xOffsetThousandths, -30_000, 30_000) ||
        !integerBetween(vertex?.yOffsetThousandths, -30_000, 30_000),
    )
  ) {
    return false;
  }
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
    const nextIndex = (edgeIndex + 1) % vertices.length;
    const start = vertices[edgeIndex];
    const end = vertices[nextIndex];
    const edgeX = end.xOffsetThousandths - start.xOffsetThousandths;
    const edgeY = end.yOffsetThousandths - start.yOffsetThousandths;
    for (let pointIndex = 0; pointIndex < vertices.length; pointIndex += 1) {
      if (pointIndex === edgeIndex || pointIndex === nextIndex) continue;
      const point = vertices[pointIndex];
      const pointX = point.xOffsetThousandths - start.xOffsetThousandths;
      const pointY = point.yOffsetThousandths - start.yOffsetThousandths;
      if (edgeX * pointY - edgeY * pointX <= 0) return false;
    }
  }
  return true;
}

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function convexTerrainSurfaceIsValid(vertices) {
  if (
    !Array.isArray(vertices) ||
    vertices.length < 3 ||
    vertices.length > TERRAIN_VISIBILITY_LIMITS.maximumConvexVerticesPerSurface ||
    vertices.some(
      (vertex) =>
        !integerBetween(vertex?.xThousandths, 0, 60_000) ||
        !integerBetween(vertex?.yThousandths, 0, 44_000),
    )
  ) {
    return false;
  }
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
    const nextIndex = (edgeIndex + 1) % vertices.length;
    const start = vertices[edgeIndex];
    const end = vertices[nextIndex];
    const edgeX = end.xThousandths - start.xThousandths;
    const edgeY = end.yThousandths - start.yThousandths;
    for (let pointIndex = 0; pointIndex < vertices.length; pointIndex += 1) {
      if (pointIndex === edgeIndex || pointIndex === nextIndex) continue;
      const point = vertices[pointIndex];
      const pointX = point.xThousandths - start.xThousandths;
      const pointY = point.yThousandths - start.yThousandths;
      if (edgeX * pointY - edgeY * pointX <= 0) return false;
    }
  }
  return true;
}

function terrainVertexCross(first, second, third) {
  return (
    (second.xThousandths - first.xThousandths) * (third.yThousandths - first.yThousandths) -
    (second.yThousandths - first.yThousandths) * (third.xThousandths - first.xThousandths)
  );
}

function terrainPointOnSegment(point, start, end) {
  return (
    terrainVertexCross(start, end, point) === 0 &&
    point.xThousandths >= Math.min(start.xThousandths, end.xThousandths) &&
    point.xThousandths <= Math.max(start.xThousandths, end.xThousandths) &&
    point.yThousandths >= Math.min(start.yThousandths, end.yThousandths) &&
    point.yThousandths <= Math.max(start.yThousandths, end.yThousandths)
  );
}

function terrainSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstSideStart = terrainVertexCross(firstStart, firstEnd, secondStart);
  const firstSideEnd = terrainVertexCross(firstStart, firstEnd, secondEnd);
  const secondSideStart = terrainVertexCross(secondStart, secondEnd, firstStart);
  const secondSideEnd = terrainVertexCross(secondStart, secondEnd, firstEnd);
  return (
    (firstSideStart === 0 && terrainPointOnSegment(secondStart, firstStart, firstEnd)) ||
    (firstSideEnd === 0 && terrainPointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (secondSideStart === 0 && terrainPointOnSegment(firstStart, secondStart, secondEnd)) ||
    (secondSideEnd === 0 && terrainPointOnSegment(firstEnd, secondStart, secondEnd)) ||
    (firstSideStart > 0 !== firstSideEnd > 0 && secondSideStart > 0 !== secondSideEnd > 0)
  );
}

export function simpleTerrainSurfaceIsValid(vertices) {
  if (
    !Array.isArray(vertices) ||
    vertices.length < 3 ||
    vertices.length > TERRAIN_VISIBILITY_LIMITS.maximumVerticesPerSurface ||
    vertices.some(
      (vertex) =>
        !integerBetween(vertex?.xThousandths, 0, 60_000) ||
        !integerBetween(vertex?.yThousandths, 0, 44_000),
    )
  ) {
    return false;
  }
  let doubledArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const afterNext = vertices[(index + 2) % vertices.length];
    if (
      (current.xThousandths === next.xThousandths && current.yThousandths === next.yThousandths) ||
      terrainVertexCross(current, next, afterNext) === 0
    ) {
      return false;
    }
    doubledArea +=
      current.xThousandths * next.yThousandths - next.xThousandths * current.yThousandths;
    for (let otherIndex = index + 1; otherIndex < vertices.length; otherIndex += 1) {
      const adjacent =
        otherIndex === index + 1 || (index === 0 && otherIndex === vertices.length - 1);
      if (adjacent) continue;
      if (
        terrainSegmentsIntersect(
          current,
          next,
          vertices[otherIndex],
          vertices[(otherIndex + 1) % vertices.length],
        )
      ) {
        return false;
      }
    }
  }
  return doubledArea > 0;
}

export function terrainSurfaceGeometryIsValid(surface) {
  const mode = surface?.geometryMode ?? "convex_polygon";
  return mode === "convex_polygon"
    ? convexTerrainSurfaceIsValid(surface?.vertices)
    : mode === "simple_polygon" && simpleTerrainSurfaceIsValid(surface?.vertices);
}

function rotate(x, y, milliDegrees) {
  const angle = (milliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function inverseRotate(x, y, milliDegrees) {
  return rotate(x, y, -milliDegrees);
}

function shapeSupport(shape, width, depth, angleMilliDegrees) {
  const angle = (angleMilliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  if (shape === "rectangle") {
    return {
      x: Math.abs(cosine) * halfWidth + Math.abs(sine) * halfDepth,
      y: Math.abs(sine) * halfWidth + Math.abs(cosine) * halfDepth,
    };
  }
  return {
    x: Math.hypot(cosine * halfWidth, sine * halfDepth),
    y: Math.hypot(sine * halfWidth, cosine * halfDepth),
  };
}

function silhouetteReady(model) {
  const silhouette = model?.silhouette;
  const geometryMode = silhouette?.geometryMode ?? "primitive";
  return Boolean(
    silhouette &&
      ["circle", "ellipse", "rectangle"].includes(silhouette.shape) &&
      integerBetween(silhouette.widthThousandths, 1, 30_000) &&
      integerBetween(silhouette.depthThousandths, 1, 30_000) &&
      integerBetween(silhouette.heightThousandths, 1, 30_000) &&
      integerBetween(silhouette.bottomOffsetThousandths, 0, 30_000) &&
      integerBetween(silhouette.centerOffsetXThousandths, -30_000, 30_000) &&
      integerBetween(silhouette.centerOffsetYThousandths, -30_000, 30_000) &&
      Array.isArray(silhouette.sightPoints) &&
      silhouette.sightPoints.length >= 1 &&
      silhouette.sightPoints.length <= TERRAIN_VISIBILITY_LIMITS.maximumSightPointsPerModel &&
      silhouette.sightPoints.every(
        (point) =>
          integerBetween(point.xOffsetThousandths, -30_000, 30_000) &&
          integerBetween(point.yOffsetThousandths, -30_000, 30_000) &&
          integerBetween(point.heightThousandths, 0, silhouette.heightThousandths),
      ) &&
      silhouette.envelopeReviewed === true &&
      silhouette.sightPointsReviewed === true &&
      ["primitive", "convex_prism"].includes(geometryMode) &&
      (geometryMode !== "convex_prism" ||
        (silhouette.convexReviewed === true &&
          convexSilhouetteIsValid(silhouette.convexVertices, 1))),
  );
}

function silhouetteCenter(model) {
  const offset = rotate(
    model.silhouette.centerOffsetXThousandths,
    model.silhouette.centerOffsetYThousandths,
    model.rotationMilliDegrees,
  );
  return {
    x: model.centerXThousandths + offset.x,
    y: model.centerYThousandths + offset.y,
  };
}

function silhouetteBox(model) {
  const center = silhouetteCenter(model);
  if (model.silhouette.geometryMode === "convex_prism") {
    const vertices = model.silhouette.convexVertices.map((vertex) => {
      const offset = rotate(
        vertex.xOffsetThousandths,
        vertex.yOffsetThousandths,
        model.rotationMilliDegrees,
      );
      return { x: center.x + offset.x, y: center.y + offset.y };
    });
    const minimumZ = model.elevationThousandths + model.silhouette.bottomOffsetThousandths;
    return {
      minimumX: Math.min(...vertices.map((vertex) => vertex.x)),
      maximumX: Math.max(...vertices.map((vertex) => vertex.x)),
      minimumY: Math.min(...vertices.map((vertex) => vertex.y)),
      maximumY: Math.max(...vertices.map((vertex) => vertex.y)),
      minimumZ,
      maximumZ: minimumZ + model.silhouette.heightThousandths,
    };
  }
  const support = shapeSupport(
    model.silhouette.shape,
    model.silhouette.widthThousandths,
    model.silhouette.depthThousandths,
    model.rotationMilliDegrees,
  );
  const minimumZ = model.elevationThousandths + model.silhouette.bottomOffsetThousandths;
  return {
    minimumX: center.x - support.x,
    maximumX: center.x + support.x,
    minimumY: center.y - support.y,
    maximumY: center.y + support.y,
    minimumZ,
    maximumZ: minimumZ + model.silhouette.heightThousandths,
  };
}

function silhouetteVertices(model) {
  const box = silhouetteBox(model);
  const planar =
    model.silhouette.geometryMode === "convex_prism"
      ? model.silhouette.convexVertices.map((vertex) => {
          const center = silhouetteCenter(model);
          const offset = rotate(
            vertex.xOffsetThousandths,
            vertex.yOffsetThousandths,
            model.rotationMilliDegrees,
          );
          return { x: center.x + offset.x, y: center.y + offset.y };
        })
      : [
          { x: box.minimumX, y: box.minimumY },
          { x: box.maximumX, y: box.minimumY },
          { x: box.maximumX, y: box.maximumY },
          { x: box.minimumX, y: box.maximumY },
        ];
  return planar.flatMap((vertex) => [
    { ...vertex, z: box.minimumZ },
    { ...vertex, z: box.maximumZ },
  ]);
}

function sightPoints(model) {
  const center = silhouetteCenter(model);
  const minimumZ = model.elevationThousandths + model.silhouette.bottomOffsetThousandths;
  return model.silhouette.sightPoints.map((point) => {
    const offset = rotate(
      point.xOffsetThousandths,
      point.yOffsetThousandths,
      model.rotationMilliDegrees,
    );
    return {
      x: center.x + offset.x,
      y: center.y + offset.y,
      z: minimumZ + point.heightThousandths,
    };
  });
}

function visibilityModelGeometry(model) {
  return {
    modelId: model.modelId,
    point: {
      centerXThousandths: model.centerXThousandths,
      centerYThousandths: model.centerYThousandths,
      elevationThousandths: model.elevationThousandths,
      rotationMilliDegrees: model.rotationMilliDegrees,
    },
    envelope: {
      geometryMode: model.silhouette.geometryMode ?? "primitive",
      shape: model.silhouette.shape,
      widthThousandths: model.silhouette.widthThousandths,
      depthThousandths: model.silhouette.depthThousandths,
      heightThousandths: model.silhouette.heightThousandths,
      bottomOffsetThousandths: model.silhouette.bottomOffsetThousandths,
      centerOffsetXThousandths: model.silhouette.centerOffsetXThousandths,
      centerOffsetYThousandths: model.silhouette.centerOffsetYThousandths,
      convexVertices: (model.silhouette.convexVertices ?? []).map((vertex) => ({ ...vertex })),
    },
  };
}

function pointInFootprint(point, footprint, strict = false) {
  const local = inverseRotate(
    point.x - footprint.centerXThousandths,
    point.y - footprint.centerYThousandths,
    footprint.rotationMilliDegrees,
  );
  const margin = strict ? EPSILON : -EPSILON;
  return (
    Math.abs(local.x) < footprint.widthThousandths / 2 - margin &&
    Math.abs(local.y) < footprint.heightThousandths / 2 - margin
  );
}

function modelWhollyWithinFootprint(model, footprint) {
  const localCenter = inverseRotate(
    model.centerXThousandths - footprint.centerXThousandths,
    model.centerYThousandths - footprint.centerYThousandths,
    footprint.rotationMilliDegrees,
  );
  const support = shapeSupport(
    model.shape,
    model.widthThousandths,
    model.depthThousandths,
    (model.rotationMilliDegrees - footprint.rotationMilliDegrees + 180_000) % 180_000,
  );
  return (
    Math.abs(localCenter.x) + support.x <= footprint.widthThousandths / 2 + EPSILON &&
    Math.abs(localCenter.y) + support.y <= footprint.heightThousandths / 2 + EPSILON
  );
}

function segmentIntersectsFootprintInterior(start, end, footprint) {
  const localStart = inverseRotate(
    start.x - footprint.centerXThousandths,
    start.y - footprint.centerYThousandths,
    footprint.rotationMilliDegrees,
  );
  const localEnd = inverseRotate(
    end.x - footprint.centerXThousandths,
    end.y - footprint.centerYThousandths,
    footprint.rotationMilliDegrees,
  );
  const minimumX = -footprint.widthThousandths / 2 + EPSILON;
  const maximumX = footprint.widthThousandths / 2 - EPSILON;
  const minimumY = -footprint.heightThousandths / 2 + EPSILON;
  const maximumY = footprint.heightThousandths / 2 - EPSILON;
  let lower = 0;
  let upper = 1;
  for (const [origin, delta, minimum, maximum] of [
    [localStart.x, localEnd.x - localStart.x, minimumX, maximumX],
    [localStart.y, localEnd.y - localStart.y, minimumY, maximumY],
  ]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin <= minimum || origin >= maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower >= upper - EPSILON) return false;
  }
  return upper > EPSILON && lower < 1 - EPSILON;
}

function panelIntersection(start, end, panel) {
  const rayX = end.x - start.x;
  const rayY = end.y - start.y;
  const panelX = panel.endXThousandths - panel.startXThousandths;
  const panelY = panel.endYThousandths - panel.startYThousandths;
  const denominator = rayX * panelY - rayY * panelX;
  const offsetX = panel.startXThousandths - start.x;
  const offsetY = panel.startYThousandths - start.y;
  if (Math.abs(denominator) <= EPSILON) {
    const collinear = Math.abs(offsetX * rayY - offsetY * rayX) <= EPSILON;
    return collinear ? "ambiguous" : "clear";
  }
  const rayParameter = (offsetX * panelY - offsetY * panelX) / denominator;
  const panelParameter = (offsetX * rayY - offsetY * rayX) / denominator;
  if (
    rayParameter <= EPSILON ||
    rayParameter >= 1 - EPSILON ||
    panelParameter <= EPSILON ||
    panelParameter >= 1 - EPSILON
  ) {
    if (
      rayParameter < -EPSILON ||
      rayParameter > 1 + EPSILON ||
      panelParameter < -EPSILON ||
      panelParameter > 1 + EPSILON
    ) {
      return "clear";
    }
    return "ambiguous";
  }
  const height = start.z + rayParameter * (end.z - start.z);
  if (height < panel.bottomZThousandths - EPSILON || height > panel.topZThousandths + EPSILON) {
    return "clear";
  }
  if (
    Math.abs(height - panel.bottomZThousandths) <= EPSILON ||
    Math.abs(height - panel.topZThousandths) <= EPSILON
  ) {
    return "ambiguous";
  }
  const panelLength = Math.hypot(panelX, panelY);
  const offset = panelParameter * panelLength;
  for (const opening of panel.openings) {
    if (
      offset > opening.startOffsetThousandths + EPSILON &&
      offset < opening.endOffsetThousandths - EPSILON &&
      height > opening.bottomZThousandths + EPSILON &&
      height < opening.topZThousandths - EPSILON
    ) {
      return "clear";
    }
    if (
      offset >= opening.startOffsetThousandths - EPSILON &&
      offset <= opening.endOffsetThousandths + EPSILON &&
      height >= opening.bottomZThousandths - EPSILON &&
      height <= opening.topZThousandths + EPSILON
    ) {
      return "ambiguous";
    }
  }
  return "blocked";
}

function segmentIntersectsBox(start, end, box) {
  let lower = 0;
  let upper = 1;
  for (const [origin, delta, minimum, maximum] of [
    [start.x, end.x - start.x, box.minimumX, box.maximumX],
    [start.y, end.y - start.y, box.minimumY, box.maximumY],
    [start.z, end.z - start.z, box.minimumZ, box.maximumZ],
  ]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin < minimum - EPSILON || origin > maximum + EPSILON) return false;
      continue;
    }
    const first = (minimum - EPSILON - origin) / delta;
    const second = (maximum + EPSILON - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower > upper + EPSILON) return false;
  }
  return upper >= EPSILON && lower <= 1 - EPSILON;
}

function segmentIntersectsConvexPrism(start, end, model) {
  const center = silhouetteCenter(model);
  const localStart = inverseRotate(
    start.x - center.x,
    start.y - center.y,
    model.rotationMilliDegrees,
  );
  const localEnd = inverseRotate(end.x - center.x, end.y - center.y, model.rotationMilliDegrees);
  const minimumZ = model.elevationThousandths + model.silhouette.bottomOffsetThousandths;
  const maximumZ = minimumZ + model.silhouette.heightThousandths;
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < model.silhouette.convexVertices.length; index += 1) {
    const first = model.silhouette.convexVertices[index];
    const second =
      model.silhouette.convexVertices[(index + 1) % model.silhouette.convexVertices.length];
    const edgeX = second.xOffsetThousandths - first.xOffsetThousandths;
    const edgeY = second.yOffsetThousandths - first.yOffsetThousandths;
    const startValue =
      edgeX * (localStart.y - first.yOffsetThousandths) -
      edgeY * (localStart.x - first.xOffsetThousandths);
    const endValue =
      edgeX * (localEnd.y - first.yOffsetThousandths) -
      edgeY * (localEnd.x - first.xOffsetThousandths);
    const delta = endValue - startValue;
    if (Math.abs(delta) <= EPSILON) {
      if (startValue < -EPSILON) return false;
      continue;
    }
    const boundary = -startValue / delta;
    if (delta > 0) lower = Math.max(lower, boundary);
    else upper = Math.min(upper, boundary);
    if (lower > upper + EPSILON) return false;
  }
  for (const [origin, delta, minimum, maximum] of [
    [start.z, end.z - start.z, minimumZ, maximumZ],
  ]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin < minimum - EPSILON || origin > maximum + EPSILON) return false;
      continue;
    }
    const first = (minimum - EPSILON - origin) / delta;
    const second = (maximum + EPSILON - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower > upper + EPSILON) return false;
  }
  return upper >= EPSILON && lower <= 1 - EPSILON;
}

function segmentIntersectsSilhouette(start, end, model) {
  return model.silhouette.geometryMode === "convex_prism"
    ? segmentIntersectsConvexPrism(start, end, model)
    : segmentIntersectsBox(start, end, silhouetteBox(model));
}

function silhouetteBoundingSphere(model) {
  const box = silhouetteBox(model);
  const center = {
    x: (box.minimumX + box.maximumX) / 2,
    y: (box.minimumY + box.maximumY) / 2,
    z: (box.minimumZ + box.maximumZ) / 2,
  };
  const radius = Math.max(
    ...silhouetteVertices(model).map((vertex) =>
      Math.hypot(vertex.x - center.x, vertex.y - center.y, vertex.z - center.z),
    ),
  );
  return { center, radius };
}

function minimumDistanceToBox(point, box) {
  return Math.hypot(
    Math.max(box.minimumX - point.x, 0, point.x - box.maximumX),
    Math.max(box.minimumY - point.y, 0, point.y - box.maximumY),
    Math.max(box.minimumZ - point.z, 0, point.z - box.maximumZ),
  );
}

function maximumDistanceToBox(point, box) {
  return Math.hypot(
    Math.max(Math.abs(box.minimumX - point.x), Math.abs(box.maximumX - point.x)),
    Math.max(Math.abs(box.minimumY - point.y), Math.abs(box.maximumY - point.y)),
    Math.max(Math.abs(box.minimumZ - point.z), Math.abs(box.maximumZ - point.z)),
  );
}

function modelCouldOccludeFromPoint(observerPoint, target, blocker) {
  if (
    minimumDistanceToBox(observerPoint, silhouetteBox(blocker)) >=
    maximumDistanceToBox(observerPoint, silhouetteBox(target)) - EPSILON
  ) {
    return false;
  }
  const targetSphere = silhouetteBoundingSphere(target);
  const blockerSphere = silhouetteBoundingSphere(blocker);
  const targetVector = {
    x: targetSphere.center.x - observerPoint.x,
    y: targetSphere.center.y - observerPoint.y,
    z: targetSphere.center.z - observerPoint.z,
  };
  const blockerVector = {
    x: blockerSphere.center.x - observerPoint.x,
    y: blockerSphere.center.y - observerPoint.y,
    z: blockerSphere.center.z - observerPoint.z,
  };
  const targetDistance = Math.hypot(targetVector.x, targetVector.y, targetVector.z);
  const blockerDistance = Math.hypot(blockerVector.x, blockerVector.y, blockerVector.z);
  if (blockerDistance - blockerSphere.radius >= targetDistance + targetSphere.radius - EPSILON) {
    return false;
  }
  if (targetDistance <= targetSphere.radius + EPSILON || blockerDistance <= blockerSphere.radius) {
    return true;
  }
  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (targetVector.x * blockerVector.x +
        targetVector.y * blockerVector.y +
        targetVector.z * blockerVector.z) /
        (targetDistance * blockerDistance),
    ),
  );
  const separation = Math.acos(cosine);
  const targetAngle = Math.asin(Math.min(1, targetSphere.radius / targetDistance));
  const blockerAngle = Math.asin(Math.min(1, blockerSphere.radius / blockerDistance));
  return separation <= targetAngle + blockerAngle + EPSILON;
}

function boxesOverlap(first, second) {
  return (
    first.maximumX >= second.minimumX - EPSILON &&
    second.maximumX >= first.minimumX - EPSILON &&
    first.maximumY >= second.minimumY - EPSILON &&
    second.maximumY >= first.minimumY - EPSILON &&
    first.maximumZ >= second.minimumZ - EPSILON &&
    second.maximumZ >= first.minimumZ - EPSILON
  );
}

function corridorBox(first, second) {
  return {
    minimumX: Math.min(first.minimumX, second.minimumX),
    maximumX: Math.max(first.maximumX, second.maximumX),
    minimumY: Math.min(first.minimumY, second.minimumY),
    maximumY: Math.max(first.maximumY, second.maximumY),
    minimumZ: Math.min(first.minimumZ, second.minimumZ),
    maximumZ: Math.max(first.maximumZ, second.maximumZ),
  };
}

function footprintBox(footprint, minimumZ = 0, maximumZ = 30_000) {
  const support = shapeSupport(
    "rectangle",
    footprint.widthThousandths,
    footprint.heightThousandths,
    footprint.rotationMilliDegrees,
  );
  return {
    minimumX: footprint.centerXThousandths - support.x,
    maximumX: footprint.centerXThousandths + support.x,
    minimumY: footprint.centerYThousandths - support.y,
    maximumY: footprint.centerYThousandths + support.y,
    minimumZ,
    maximumZ,
  };
}

function panelBox(panel) {
  return {
    minimumX: Math.min(panel.startXThousandths, panel.endXThousandths),
    maximumX: Math.max(panel.startXThousandths, panel.endXThousandths),
    minimumY: Math.min(panel.startYThousandths, panel.endYThousandths),
    maximumY: Math.max(panel.startYThousandths, panel.endYThousandths),
    minimumZ: panel.bottomZThousandths,
    maximumZ: panel.topZThousandths,
  };
}

function sectionFootprints(section, terrainFootprints) {
  return terrainFootprints.footprints.filter(
    (footprint) => footprint.areaTerrainSectionId === section.sectionId,
  );
}

function pointInsideSection(point, section, terrainFootprints) {
  return sectionFootprints(section, terrainFootprints).some((footprint) =>
    pointInFootprint(point, footprint),
  );
}

function modelInsideSection(model, section, terrainFootprints) {
  return sectionFootprints(section, terrainFootprints).some((footprint) =>
    modelWhollyWithinFootprint(model, footprint),
  );
}

function ruinRayBlocker(start, end, observer, sections, terrainFootprints, exempt) {
  if (exempt) return null;
  for (const section of sections) {
    if (section.featureType !== "ruins") continue;
    if (
      pointInsideSection(end, section, terrainFootprints) ||
      modelInsideSection(observer, section, terrainFootprints)
    ) {
      continue;
    }
    const footprint = sectionFootprints(section, terrainFootprints).find((candidate) =>
      segmentIntersectsFootprintInterior(start, end, candidate),
    );
    if (footprint) {
      return {
        sectionId: section.sectionId,
        obstacleType: "area_terrain",
        obstacleId: section.sectionId,
        reason: "ruins_footprint_blocks_ray",
      };
    }
  }
  return null;
}

function rayClearance(
  start,
  end,
  observer,
  sections,
  terrainFootprints,
  blockingModels,
  exemptFromAreaTerrain,
) {
  const ruinBlocker = ruinRayBlocker(
    start,
    end,
    observer,
    sections,
    terrainFootprints,
    exemptFromAreaTerrain,
  );
  if (ruinBlocker) return { clear: false, status: "blocked", ...ruinBlocker };
  for (const section of sections) {
    for (const panel of section.panels) {
      const intersection = panelIntersection(start, end, panel);
      if (intersection !== "clear") {
        return {
          clear: false,
          status: intersection,
          sectionId: section.sectionId,
          obstacleType: "panel",
          obstacleId: panel.id,
          reason:
            intersection === "blocked" ? "terrain_panel_blocks_ray" : "terrain_panel_ray_ambiguous",
        };
      }
    }
  }
  const blockingModel = blockingModels.find((model) =>
    segmentIntersectsSilhouette(start, end, model),
  );
  if (blockingModel) {
    return {
      clear: false,
      status: "ambiguous",
      sectionId: "",
      obstacleType: "model",
      obstacleId: blockingModel.modelId,
      reason: "model_could_occlude_ray",
    };
  }
  return {
    clear: true,
    status: "clear",
    sectionId: "",
    obstacleType: "none",
    obstacleId: "",
    reason: "sampled_ray_clear",
  };
}

function modelPairFullyVisible(
  observer,
  target,
  sections,
  terrainFootprints,
  blockingModels,
  exemptFromAreaTerrain,
) {
  const containingWoods = sections.find(
    (section) =>
      section.featureType === "woods" && modelInsideSection(target, section, terrainFootprints),
  );
  if (containingWoods) {
    return {
      status: "not_fully_visible",
      reason: "target_inside_woods",
      sectionId: containingWoods.sectionId,
      obstacleType: "area_terrain",
      obstacleId: containingWoods.sectionId,
      observerPoint: null,
      corridor: null,
    };
  }
  const targetBox = silhouetteBox(target);
  let representative = null;
  for (const observerPoint of sightPoints(observer)) {
    const blockingModel = blockingModels.find((model) =>
      modelCouldOccludeFromPoint(observerPoint, target, model),
    );
    if (blockingModel) {
      representative ??= {
        status: "unknown",
        reason: "model_could_occlude_full_visibility",
        sectionId: "",
        obstacleType: "model",
        obstacleId: blockingModel.modelId,
        observerPoint,
        corridor: null,
      };
      continue;
    }
    const pointBox = {
      minimumX: observerPoint.x,
      maximumX: observerPoint.x,
      minimumY: observerPoint.y,
      maximumY: observerPoint.y,
      minimumZ: observerPoint.z,
      maximumZ: observerPoint.z,
    };
    const corridor = corridorBox(pointBox, targetBox);
    let terrainBlocker = null;
    for (const section of sections) {
      const panel = section.panels.find((candidate) => boxesOverlap(corridor, panelBox(candidate)));
      if (panel) {
        terrainBlocker = {
          sectionId: section.sectionId,
          obstacleType: "panel",
          obstacleId: panel.id,
          reason: "terrain_panel_could_obscure_target",
        };
        break;
      }
      if (exemptFromAreaTerrain) continue;
      const observerInside = modelInsideSection(observer, section, terrainFootprints);
      const targetInside = modelInsideSection(target, section, terrainFootprints);
      const relevantAreaTerrain =
        (section.featureType === "ruins" && !observerInside && !targetInside) ||
        section.featureType === "woods";
      if (
        relevantAreaTerrain &&
        sectionFootprints(section, terrainFootprints).some((footprint) =>
          boxesOverlap(corridor, footprintBox(footprint)),
        )
      ) {
        terrainBlocker = {
          sectionId: section.sectionId,
          obstacleType: "area_terrain",
          obstacleId: section.sectionId,
          reason: "area_terrain_could_obscure_target",
        };
        break;
      }
    }
    if (!terrainBlocker) {
      return {
        status: "fully_visible",
        reason: "target_corridor_clear",
        sectionId: "",
        obstacleType: "none",
        obstacleId: "",
        observerPoint,
        corridor,
      };
    }
    representative ??= {
      status: "unknown",
      ...terrainBlocker,
      observerPoint,
      corridor,
    };
  }
  return (
    representative ?? {
      status: "unknown",
      reason: "full_visibility_witness_unavailable",
      sectionId: "",
      obstacleType: "unknown",
      obstacleId: "",
      observerPoint: null,
      corridor: null,
    }
  );
}

function liveModels(formation, position) {
  if (!formation || !position) return [];
  const liveIds = new Set(
    formation.segments.flatMap((segment) =>
      segment.modelIds.slice(0, formation.health[segment.id].modelsRemaining),
    ),
  );
  return position.models.filter((model) => liveIds.has(model.modelId));
}

function formationAreaTerrainExempt(formation) {
  return Boolean(
    formation?.keywords?.includes("towering") || formation?.deploymentTraits?.aircraft,
  );
}

function unavailableFact(observerFormationId, targetFormationId, reasons) {
  return {
    observerFormationId,
    targetFormationId,
    executable: false,
    unavailableReasons: [...new Set(reasons)],
    modelPairCount: 0,
    readyModelPairCount: 0,
    visibleModelPairCount: 0,
    fullyVisibleModelPairCount: 0,
    notFullyVisibleModelPairCount: 0,
    unknownModelPairCount: 0,
    visibility: { status: "unknown" },
    fullVisibility: { status: "unknown" },
    cover: { status: "unknown", yesModelIds: [], noModelIds: [], unknownModelIds: [] },
  };
}

export function deriveVisibilityFacts({
  formations,
  positions,
  staleFormationIds = new Set(),
  terrainFootprints,
  terrainVisibility,
}) {
  const result = new Map();
  const sections = terrainVisibility?.sections ?? [];
  const completeTerrain = Boolean(
    terrainFootprints &&
      terrainVisibility?.allFeaturesRecorded &&
      terrainVisibility?.reviewedByPlayer &&
      sections.length > 0 &&
      sections.every((section) => section.geometryComplete),
  );
  const allModels = [...formations.values()].flatMap((formation) =>
    liveModels(formation, positions.get(formation.id)).map((model) => ({
      formationId: formation.id,
      playerId: formation.playerId,
      model,
    })),
  );
  for (const observerFormation of formations.values()) {
    const targetMap = new Map();
    result.set(observerFormation.id, targetMap);
    for (const targetFormation of formations.values()) {
      if (
        observerFormation.id === targetFormation.id ||
        observerFormation.playerId === targetFormation.playerId
      ) {
        continue;
      }
      const reasons = [];
      const observerPosition = positions.get(observerFormation.id);
      const targetPosition = positions.get(targetFormation.id);
      if (!terrainFootprints) reasons.push("terrain footprints are unavailable");
      if (!terrainVisibility) reasons.push("3D terrain visibility geometry is unavailable");
      if (!completeTerrain && terrainVisibility)
        reasons.push("3D terrain visibility geometry is incomplete");
      if (!observerPosition) reasons.push("observer model positions are unavailable");
      if (!targetPosition) reasons.push("target model positions are unavailable");
      if (staleFormationIds.has(observerFormation.id)) reasons.push("observer geometry is stale");
      if (staleFormationIds.has(targetFormation.id)) reasons.push("target geometry is stale");
      const observers = liveModels(observerFormation, observerPosition);
      const targets = liveModels(targetFormation, targetPosition);
      if (observerPosition && observers.length === 0) reasons.push("observer has no live models");
      if (targetPosition && targets.length === 0) reasons.push("target has no live models");
      if (observers.some((model) => !silhouetteReady(model))) {
        reasons.push("observer 3D silhouettes or sight points are incomplete");
      }
      if (targets.some((model) => !silhouetteReady(model))) {
        reasons.push("target 3D silhouettes or sight points are incomplete");
      }
      if (reasons.length > 0) {
        targetMap.set(
          targetFormation.id,
          unavailableFact(observerFormation.id, targetFormation.id, reasons),
        );
        continue;
      }
      const exempt =
        formationAreaTerrainExempt(observerFormation) ||
        formationAreaTerrainExempt(targetFormation);
      const pairFacts = [];
      for (const observer of observers) {
        for (const target of targets) {
          const blockingModels = allModels
            .filter(
              (entry) =>
                entry.formationId !== observerFormation.id &&
                !(
                  entry.formationId === targetFormation.id && entry.model.modelId === target.modelId
                ),
            )
            .map((entry) => entry.model);
          let testedRayCount = 0;
          let clearRay = null;
          let representativeBlockedRay = null;
          const blockerCounts = new Map();
          raySearch: for (const start of sightPoints(observer)) {
            for (const end of sightPoints(target)) {
              testedRayCount += 1;
              const clearance = rayClearance(
                start,
                end,
                observer,
                sections,
                terrainFootprints,
                blockingModels,
                exempt,
              );
              const ray = { start, end, ...clearance };
              if (clearance.clear) {
                clearRay = ray;
                break raySearch;
              }
              representativeBlockedRay ??= ray;
              const blockerKey = [
                clearance.reason,
                clearance.sectionId,
                clearance.obstacleType,
                clearance.obstacleId,
              ].join(":");
              blockerCounts.set(blockerKey, {
                reason: clearance.reason,
                sectionId: clearance.sectionId,
                obstacleType: clearance.obstacleType,
                obstacleId: clearance.obstacleId,
                count: (blockerCounts.get(blockerKey)?.count ?? 0) + 1,
              });
            }
          }
          const visible = Boolean(clearRay);
          const fullVisibilityInspection = modelPairFullyVisible(
            observer,
            target,
            sections,
            terrainFootprints,
            blockingModels,
            exempt,
          );
          pairFacts.push({
            observerModelId: observer.modelId,
            targetModelId: target.modelId,
            visible,
            fullVisibility: fullVisibilityInspection.status,
            inspection: {
              schemaVersion: VISIBILITY_INSPECTION_SCHEMA_VERSION,
              observer: visibilityModelGeometry(observer),
              target: visibilityModelGeometry(target),
              visibility: {
                status: visible ? "visible" : "unknown",
                testedRayCount,
                witnessRay: clearRay ?? representativeBlockedRay,
                blockerSummary: [...blockerCounts.values()].sort((left, right) =>
                  [left.reason, left.sectionId, left.obstacleType, left.obstacleId]
                    .join(":")
                    .localeCompare(
                      [right.reason, right.sectionId, right.obstacleType, right.obstacleId].join(
                        ":",
                      ),
                    ),
                ),
              },
              fullVisibility: fullVisibilityInspection,
            },
          });
        }
      }
      const visibleModelPairCount = pairFacts.filter((fact) => fact.visible).length;
      const fullyVisibleModelPairCount = pairFacts.filter(
        (fact) => fact.fullVisibility === "fully_visible",
      ).length;
      const notFullyVisibleModelPairCount = pairFacts.filter(
        (fact) => fact.fullVisibility === "not_fully_visible",
      ).length;
      const coverYes = [];
      const coverNo = [];
      const coverUnknown = [];
      for (const target of targets) {
        const insideCoverTerrain = sections.some(
          (section) =>
            ["ruins", "woods"].includes(section.featureType) &&
            modelInsideSection(target, section, terrainFootprints),
        );
        if (insideCoverTerrain) {
          coverYes.push(target.modelId);
          continue;
        }
        const relevant = pairFacts.filter((fact) => fact.targetModelId === target.modelId);
        if (
          relevant.length === observers.length &&
          relevant.every((fact) => fact.fullVisibility === "fully_visible")
        ) {
          coverNo.push(target.modelId);
        } else {
          coverUnknown.push(target.modelId);
        }
      }
      const modelPairCount = observers.length * targets.length;
      targetMap.set(targetFormation.id, {
        observerFormationId: observerFormation.id,
        targetFormationId: targetFormation.id,
        executable: true,
        unavailableReasons: [],
        modelPairCount,
        readyModelPairCount: modelPairCount,
        visibleModelPairCount,
        fullyVisibleModelPairCount,
        notFullyVisibleModelPairCount,
        unknownModelPairCount:
          modelPairCount - fullyVisibleModelPairCount - notFullyVisibleModelPairCount,
        visibility: { status: visibleModelPairCount > 0 ? "visible" : "unknown" },
        fullVisibility: {
          status:
            pairFacts.length > 0 &&
            pairFacts.every((fact) => fact.fullVisibility === "fully_visible")
              ? "fully_visible"
              : pairFacts.some((fact) => fact.fullVisibility === "not_fully_visible")
                ? "not_fully_visible"
                : "unknown",
        },
        cover: {
          status:
            coverYes.length === targets.length
              ? "benefit_of_cover"
              : coverNo.length === targets.length
                ? "no_benefit_of_cover"
                : "mixed_or_unknown",
          yesModelIds: coverYes,
          noModelIds: coverNo,
          unknownModelIds: coverUnknown,
        },
        modelPairs: pairFacts,
      });
    }
  }
  return result;
}

function visibilityInspectionPointIsValid(point) {
  return Boolean(
    point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
  );
}

function visibilityInspectionIdentityIsValid(value) {
  return typeof value === "string" && value.length <= 500;
}

function visibilityInspectionCorridorIsValid(corridor) {
  return Boolean(
    corridor &&
      Number.isFinite(corridor.minimumX) &&
      Number.isFinite(corridor.maximumX) &&
      Number.isFinite(corridor.minimumY) &&
      Number.isFinite(corridor.maximumY) &&
      Number.isFinite(corridor.minimumZ) &&
      Number.isFinite(corridor.maximumZ) &&
      corridor.minimumX <= corridor.maximumX &&
      corridor.minimumY <= corridor.maximumY &&
      corridor.minimumZ <= corridor.maximumZ,
  );
}

function visibilityModelGeometryIsValid(geometry) {
  return Boolean(
    geometry &&
      visibilityInspectionIdentityIsValid(geometry.modelId) &&
      geometry.point &&
      Number.isInteger(geometry.point.centerXThousandths) &&
      Number.isInteger(geometry.point.centerYThousandths) &&
      Number.isInteger(geometry.point.elevationThousandths) &&
      Number.isInteger(geometry.point.rotationMilliDegrees) &&
      geometry.envelope &&
      visibilityInspectionIdentityIsValid(geometry.envelope.geometryMode) &&
      visibilityInspectionIdentityIsValid(geometry.envelope.shape) &&
      Number.isInteger(geometry.envelope.widthThousandths) &&
      Number.isInteger(geometry.envelope.depthThousandths) &&
      Number.isInteger(geometry.envelope.heightThousandths) &&
      Array.isArray(geometry.envelope.convexVertices) &&
      geometry.envelope.convexVertices.length <= 16,
  );
}

export function visibilityInspectionIsValid(inspection) {
  const visibility = inspection?.visibility;
  const ray = visibility?.witnessRay;
  const fullVisibility = inspection?.fullVisibility;
  return Boolean(
    inspection?.schemaVersion === VISIBILITY_INSPECTION_SCHEMA_VERSION &&
      visibilityModelGeometryIsValid(inspection.observer) &&
      visibilityModelGeometryIsValid(inspection.target) &&
      visibility &&
      ["visible", "unknown"].includes(visibility.status) &&
      Number.isInteger(visibility.testedRayCount) &&
      visibility.testedRayCount >= 1 &&
      visibility.testedRayCount <= TERRAIN_VISIBILITY_LIMITS.maximumSightPointsPerModel ** 2 &&
      ray &&
      visibilityInspectionPointIsValid(ray.start) &&
      visibilityInspectionPointIsValid(ray.end) &&
      typeof ray.clear === "boolean" &&
      ["clear", "blocked", "ambiguous"].includes(ray.status) &&
      ray.clear === (ray.status === "clear") &&
      visibility.status === (ray.clear ? "visible" : "unknown") &&
      visibilityInspectionIdentityIsValid(ray.sectionId) &&
      visibilityInspectionIdentityIsValid(ray.obstacleType) &&
      visibilityInspectionIdentityIsValid(ray.obstacleId) &&
      visibilityInspectionIdentityIsValid(ray.reason) &&
      Array.isArray(visibility.blockerSummary) &&
      visibility.blockerSummary.length <=
        TERRAIN_VISIBILITY_LIMITS.maximumSightPointsPerModel ** 2 &&
      visibility.blockerSummary.every(
        (blocker) =>
          visibilityInspectionIdentityIsValid(blocker?.reason) &&
          visibilityInspectionIdentityIsValid(blocker?.sectionId) &&
          visibilityInspectionIdentityIsValid(blocker?.obstacleType) &&
          visibilityInspectionIdentityIsValid(blocker?.obstacleId) &&
          Number.isInteger(blocker?.count) &&
          blocker.count > 0 &&
          blocker.count <= visibility.testedRayCount,
      ) &&
      fullVisibility &&
      ["fully_visible", "not_fully_visible", "unknown"].includes(fullVisibility.status) &&
      visibilityInspectionIdentityIsValid(fullVisibility.reason) &&
      visibilityInspectionIdentityIsValid(fullVisibility.sectionId) &&
      visibilityInspectionIdentityIsValid(fullVisibility.obstacleType) &&
      visibilityInspectionIdentityIsValid(fullVisibility.obstacleId) &&
      (fullVisibility.observerPoint === null ||
        visibilityInspectionPointIsValid(fullVisibility.observerPoint)) &&
      (fullVisibility.corridor === null ||
        visibilityInspectionCorridorIsValid(fullVisibility.corridor)),
  );
}

export function visibilityInspectionExport({
  observerFormationName,
  targetFormationName,
  pair,
  terrainFootprints,
  terrainVisibility,
}) {
  if (!visibilityInspectionIsValid(pair?.inspection)) {
    throw new Error("Visibility inspection is structurally invalid");
  }
  return {
    schema: "whc-visibility-inspection",
    schemaVersion: VISIBILITY_INSPECTION_SCHEMA_VERSION,
    observerFormationName: String(observerFormationName ?? "").slice(0, 200),
    targetFormationName: String(targetFormationName ?? "").slice(0, 200),
    observerModelId: pair.observerModelId,
    targetModelId: pair.targetModelId,
    visible: pair.visible,
    fullVisibility: pair.fullVisibility,
    inspection: pair.inspection,
    terrainFootprints,
    terrainVisibility,
  };
}

export function visibilityFactValues(fact) {
  const targetModelCount =
    fact.cover.yesModelIds.length +
    fact.cover.noModelIds.length +
    fact.cover.unknownModelIds.length;
  return [
    fact.modelPairCount,
    fact.readyModelPairCount,
    fact.visibleModelPairCount,
    fact.fullyVisibleModelPairCount,
    fact.notFullyVisibleModelPairCount,
    fact.unknownModelPairCount,
    targetModelCount,
    fact.cover.yesModelIds.length,
    fact.cover.noModelIds.length,
    fact.cover.unknownModelIds.length,
    fact.executable ? 3 : 0,
  ];
}

export function visibilityFactValuesAreValid(
  modelPairCount,
  readyModelPairCount,
  visibleModelPairCount,
  fullyVisibleModelPairCount,
  notFullyVisibleModelPairCount,
  unknownModelPairCount,
  targetModelCount,
  coverYesCount,
  coverNoCount,
  coverUnknownCount,
  flags,
) {
  return Boolean(
    modelPairCount > 0 &&
      modelPairCount <= 1_000_000 &&
      readyModelPairCount === modelPairCount &&
      visibleModelPairCount <= modelPairCount &&
      fullyVisibleModelPairCount <= modelPairCount &&
      notFullyVisibleModelPairCount <= modelPairCount &&
      unknownModelPairCount <= modelPairCount &&
      fullyVisibleModelPairCount + notFullyVisibleModelPairCount + unknownModelPairCount ===
        modelPairCount &&
      targetModelCount > 0 &&
      targetModelCount <= 1000 &&
      coverYesCount <= targetModelCount &&
      coverNoCount <= targetModelCount &&
      coverUnknownCount <= targetModelCount &&
      coverYesCount + coverNoCount + coverUnknownCount === targetModelCount &&
      flags === 3,
  );
}

export function terrainVisibilityGeometryIsValid(set, terrainFootprints) {
  if (
    !set ||
    !terrainFootprints ||
    !Array.isArray(set.sections) ||
    set.sections.length < 1 ||
    set.sections.length > TERRAIN_VISIBILITY_LIMITS.maximumSections ||
    !TERRAIN_VISIBILITY_METHODS.includes(set.method) ||
    !set.reviewedByPlayer ||
    typeof set.allFeaturesRecorded !== "boolean" ||
    typeof set.reviewReason !== "string" ||
    !set.reviewReason.trim()
  ) {
    return false;
  }
  const expectedSectionIds = [
    ...new Set(terrainFootprints.footprints.map((footprint) => footprint.areaTerrainSectionId)),
  ].sort();
  if (
    JSON.stringify(set.sections.map((section) => section.sectionId).sort()) !==
    JSON.stringify(expectedSectionIds)
  ) {
    return false;
  }
  let panelCount = 0;
  let surfaceCount = 0;
  const panelIds = new Set();
  const surfaceIds = new Set();
  const movementSchemaPresent =
    set.allMovementGeometryRecorded !== undefined ||
    set.sections.some(
      (section) =>
        section.movementType !== undefined ||
        section.movementGeometryComplete !== undefined ||
        section.surfaces !== undefined,
    );
  if (
    movementSchemaPresent &&
    (typeof set.allMovementGeometryRecorded !== "boolean" ||
      set.sections.some(
        (section) =>
          !TERRAIN_MOVEMENT_TYPES.includes(section.movementType) ||
          typeof section.movementGeometryComplete !== "boolean" ||
          !Array.isArray(section.surfaces),
      ))
  ) {
    return false;
  }
  for (const section of set.sections) {
    if (
      !TERRAIN_VISIBILITY_FEATURES.includes(section.featureType) ||
      typeof section.geometryComplete !== "boolean" ||
      !Array.isArray(section.panels)
    ) {
      return false;
    }
    const footprints = sectionFootprints(section, terrainFootprints);
    for (const panel of section.panels) {
      panelCount += 1;
      if (
        panelIds.has(panel.id) ||
        typeof panel.id !== "string" ||
        !panel.id ||
        !integerBetween(panel.startXThousandths, 0, 60_000) ||
        !integerBetween(panel.startYThousandths, 0, 44_000) ||
        !integerBetween(panel.endXThousandths, 0, 60_000) ||
        !integerBetween(panel.endYThousandths, 0, 44_000) ||
        !integerBetween(panel.bottomZThousandths, 0, 30_000) ||
        !integerBetween(panel.topZThousandths, 1, 30_000) ||
        panel.topZThousandths <= panel.bottomZThousandths ||
        !Array.isArray(panel.openings) ||
        panel.openings.length > TERRAIN_VISIBILITY_LIMITS.maximumOpeningsPerPanel
      ) {
        return false;
      }
      panelIds.add(panel.id);
      const sameFootprint = footprints.some(
        (footprint) =>
          pointInFootprint({ x: panel.startXThousandths, y: panel.startYThousandths }, footprint) &&
          pointInFootprint({ x: panel.endXThousandths, y: panel.endYThousandths }, footprint),
      );
      const length = Math.hypot(
        panel.endXThousandths - panel.startXThousandths,
        panel.endYThousandths - panel.startYThousandths,
      );
      if (!sameFootprint || length <= EPSILON) return false;
      for (const opening of panel.openings) {
        if (
          !integerBetween(opening.startOffsetThousandths, 0, Math.floor(length + EPSILON)) ||
          !integerBetween(opening.endOffsetThousandths, 0, Math.floor(length + EPSILON)) ||
          opening.endOffsetThousandths <= opening.startOffsetThousandths ||
          !integerBetween(
            opening.bottomZThousandths,
            panel.bottomZThousandths,
            panel.topZThousandths,
          ) ||
          !integerBetween(
            opening.topZThousandths,
            panel.bottomZThousandths,
            panel.topZThousandths,
          ) ||
          opening.topZThousandths <= opening.bottomZThousandths
        ) {
          return false;
        }
      }
    }
    for (const surface of section.surfaces ?? []) {
      surfaceCount += 1;
      if (
        surfaceIds.has(surface.id) ||
        typeof surface.id !== "string" ||
        !surface.id ||
        !integerBetween(surface.bottomZThousandths, 0, 30_000) ||
        !integerBetween(surface.topZThousandths, 1, 30_000) ||
        surface.topZThousandths <= surface.bottomZThousandths ||
        typeof surface.supportsEnding !== "boolean" ||
        !TERRAIN_SURFACE_GEOMETRY_MODES.includes(surface.geometryMode ?? "convex_polygon") ||
        !terrainSurfaceGeometryIsValid(surface) ||
        !footprints.some((footprint) =>
          surface.vertices.every((vertex) =>
            pointInFootprint({ x: vertex.xThousandths, y: vertex.yThousandths }, footprint),
          ),
        )
      ) {
        return false;
      }
      surfaceIds.add(surface.id);
    }
  }
  return (
    panelCount <= TERRAIN_VISIBILITY_LIMITS.maximumPanels &&
    surfaceCount <= TERRAIN_VISIBILITY_LIMITS.maximumSurfaces &&
    (!set.allFeaturesRecorded || set.sections.every((section) => section.geometryComplete)) &&
    (!movementSchemaPresent ||
      !set.allMovementGeometryRecorded ||
      set.sections.every((section) => section.movementGeometryComplete))
  );
}

export { silhouetteReady };
