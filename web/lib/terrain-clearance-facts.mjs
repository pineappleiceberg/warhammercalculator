import { TERRAIN_MOVEMENT_TYPES, silhouetteReady } from "./visibility-facts.mjs";

export { TERRAIN_MOVEMENT_TYPES };

export const TERRAIN_CLEARANCE_FLAGS = Object.freeze({
  modelsComplete: 1,
  terrainComplete: 2,
  rulesComplete: 4,
  mask: 7,
});

export const TERRAIN_CLEARANCE_INSPECTION_SCHEMA_VERSION = 1;

const EPSILON = 1e-7;
const FREE_TERRAIN_HEIGHT_THOUSANDTHS = 2_000;
const MAX_INSPECTION_CHECKS = 100_000;
const MAX_INSPECTION_CHECKS_PER_MODEL = 5_000;

function rotate(x, y, milliDegrees) {
  const angle = (milliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function subtract(first, second) {
  return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y;
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function interpolate(first, second, parameter) {
  return {
    x: first.x + (second.x - first.x) * parameter,
    y: first.y + (second.y - first.y) * parameter,
  };
}

function convexHull(points) {
  const ordered = [...points]
    .sort((left, right) => left.x - right.x || left.y - right.y)
    .filter(
      (point, index, values) =>
        index === 0 ||
        Math.abs(point.x - values[index - 1].x) > EPSILON ||
        Math.abs(point.y - values[index - 1].y) > EPSILON,
    );
  if (ordered.length <= 2) return ordered;
  const half = (values) => {
    const result = [];
    for (const point of values) {
      while (
        result.length >= 2 &&
        cross(subtract(result.at(-1), result.at(-2)), subtract(point, result.at(-1))) <= EPSILON
      ) {
        result.pop();
      }
      result.push(point);
    }
    return result;
  };
  return [...half(ordered).slice(0, -1), ...half([...ordered].reverse()).slice(0, -1)];
}

function pointInsideConvex(point, vertices) {
  return (
    vertices.length >= 3 &&
    vertices.every(
      (vertex, index) =>
        cross(subtract(vertices[(index + 1) % vertices.length], vertex), subtract(point, vertex)) >=
        -EPSILON,
    )
  );
}

function pointOnSegment(point, start, end) {
  return (
    Math.abs(cross(subtract(end, start), subtract(point, start))) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

function pointInsideSimple(point, vertices) {
  let inside = false;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (pointOnSegment(point, start, end)) return true;
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentBoundaryParameters(start, end, vertices) {
  const direction = subtract(end, start);
  const parameters = [0, 1];
  for (let index = 0; index < vertices.length; index += 1) {
    const boundaryStart = vertices[index];
    const boundaryDirection = subtract(vertices[(index + 1) % vertices.length], boundaryStart);
    const denominator = cross(direction, boundaryDirection);
    if (Math.abs(denominator) <= EPSILON) continue;
    const offset = subtract(boundaryStart, start);
    const parameter = cross(offset, boundaryDirection) / denominator;
    const boundaryParameter = cross(offset, direction) / denominator;
    if (
      parameter > EPSILON &&
      parameter < 1 - EPSILON &&
      boundaryParameter >= -EPSILON &&
      boundaryParameter <= 1 + EPSILON
    ) {
      parameters.push(parameter);
    }
  }
  return [...new Set(parameters)].sort((left, right) => left - right);
}

function triangulateSimplePolygon(vertices) {
  if (vertices.length === 3) return [[...vertices]];
  const remaining = vertices.map((_, index) => index);
  const triangles = [];
  while (remaining.length > 3) {
    let earIndex = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index + remaining.length - 1) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      const triangle = [vertices[previous], vertices[current], vertices[next]];
      if (
        cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[1])) <= EPSILON
      ) {
        continue;
      }
      if (
        remaining.some(
          (candidate) =>
            candidate !== previous &&
            candidate !== current &&
            candidate !== next &&
            pointInsideConvex(vertices[candidate], triangle),
        )
      ) {
        continue;
      }
      earIndex = index;
      triangles.push(triangle);
      break;
    }
    if (earIndex < 0) return [];
    remaining.splice(earIndex, 1);
  }
  triangles.push(remaining.map((index) => vertices[index]));
  return triangles;
}

function pointSegmentDistance(point, start, end) {
  const direction = subtract(end, start);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const parameter = Math.max(
    0,
    Math.min(1, dot(subtract(point, start), direction) / lengthSquared),
  );
  const closest = interpolate(start, end, parameter);
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function pointConvexDistance(point, vertices) {
  if (pointInsideConvex(point, vertices)) return 0;
  if (vertices.length === 1) return Math.hypot(point.x - vertices[0].x, point.y - vertices[0].y);
  let distance = Number.POSITIVE_INFINITY;
  const edgeCount = vertices.length === 2 ? 1 : vertices.length;
  for (let index = 0; index < edgeCount; index += 1) {
    distance = Math.min(
      distance,
      pointSegmentDistance(point, vertices[index], vertices[(index + 1) % vertices.length]),
    );
  }
  return distance;
}

function roundedObstacleInterval(start, end, vertices, radius = 1) {
  const threshold = radius - EPSILON;
  const distanceAt = (parameter) =>
    pointConvexDistance(interpolate(start, end, parameter), vertices);
  let minimumParameter = 0.5;
  if (Math.hypot(end.x - start.x, end.y - start.y) > EPSILON) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const first = low + (high - low) / 3;
      const second = high - (high - low) / 3;
      if (distanceAt(first) <= distanceAt(second)) high = second;
      else low = first;
    }
    minimumParameter = (low + high) / 2;
  }
  if (distanceAt(minimumParameter) >= threshold) return null;
  let first = 0;
  if (distanceAt(0) >= threshold) {
    let low = 0;
    let high = minimumParameter;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2;
      if (distanceAt(middle) < threshold) high = middle;
      else low = middle;
    }
    first = high;
  }
  let last = 1;
  if (distanceAt(1) >= threshold) {
    let low = minimumParameter;
    let high = 1;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2;
      if (distanceAt(middle) < threshold) low = middle;
      else high = middle;
    }
    last = low;
  }
  return last - first > EPSILON ? { first, last } : null;
}

function polygonObstacleInterval(start, end, vertices) {
  if (vertices.length < 3) return null;
  const direction = subtract(end, start);
  let first = 0;
  let last = 1;
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    const edge = subtract(vertices[(index + 1) % vertices.length], vertex);
    const initial = cross(edge, subtract(start, vertex));
    const rate = cross(edge, direction);
    if (Math.abs(rate) <= EPSILON) {
      if (initial <= EPSILON) return null;
      continue;
    }
    const boundary = (EPSILON - initial) / rate;
    if (rate > 0) first = Math.max(first, boundary);
    else last = Math.min(last, boundary);
    if (last - first <= EPSILON) return null;
  }
  return { first: Math.max(0, first), last: Math.min(1, last) };
}

function silhouetteGeometry(model, rotationMilliDegrees) {
  const silhouette = model.silhouette;
  const centerOffset = rotate(
    silhouette.centerOffsetXThousandths,
    silhouette.centerOffsetYThousandths,
    rotationMilliDegrees,
  );
  if (silhouette.geometryMode === "convex_prism") {
    return {
      type: "polygon",
      centerOffset,
      offsets: silhouette.convexVertices.map((vertex) =>
        rotate(vertex.xOffsetThousandths, vertex.yOffsetThousandths, rotationMilliDegrees),
      ),
    };
  }
  if (silhouette.shape === "rectangle") {
    const halfWidth = silhouette.widthThousandths / 2;
    const halfDepth = silhouette.depthThousandths / 2;
    return {
      type: "polygon",
      centerOffset,
      offsets: [
        [-halfWidth, -halfDepth],
        [halfWidth, -halfDepth],
        [halfWidth, halfDepth],
        [-halfWidth, halfDepth],
      ].map(([x, y]) => rotate(x, y, rotationMilliDegrees)),
    };
  }
  return {
    type: "ellipse",
    centerOffset,
    radiusX: silhouette.widthThousandths / 2,
    radiusY: silhouette.depthThousandths / 2,
    rotationMilliDegrees,
  };
}

function modelPathCenter(point, geometry) {
  return {
    x: point.centerXThousandths + geometry.centerOffset.x,
    y: point.centerYThousandths + geometry.centerOffset.y,
  };
}

function obstacleInterval(model, startPoint, endPoint, obstacleVertices) {
  if (startPoint.rotationMilliDegrees !== endPoint.rotationMilliDegrees) return null;
  const geometry = silhouetteGeometry(model, startPoint.rotationMilliDegrees);
  const start = modelPathCenter(startPoint, geometry);
  const end = modelPathCenter(endPoint, geometry);
  if (geometry.type === "polygon") {
    const expanded = convexHull(
      obstacleVertices.flatMap((vertex) =>
        geometry.offsets.map((offset) => ({ x: vertex.x - offset.x, y: vertex.y - offset.y })),
      ),
    );
    return polygonObstacleInterval(start, end, expanded);
  }
  const normalize = (point) => {
    const local = rotate(point.x, point.y, -geometry.rotationMilliDegrees);
    return { x: local.x / geometry.radiusX, y: local.y / geometry.radiusY };
  };
  return roundedObstacleInterval(normalize(start), normalize(end), obstacleVertices.map(normalize));
}

function surfaceObstacleIntervals(model, startPoint, endPoint, surface) {
  const vertices = surface.vertices.map((vertex) => ({
    x: vertex.xThousandths,
    y: vertex.yThousandths,
  }));
  const pieces =
    surface.geometryMode === "simple_polygon" ? triangulateSimplePolygon(vertices) : [vertices];
  return pieces
    .map((piece) => obstacleInterval(model, startPoint, endPoint, piece))
    .filter(Boolean);
}

function modelVerticalInterval(model, startPoint, endPoint, parameter) {
  const elevation =
    startPoint.elevationThousandths +
    (endPoint.elevationThousandths - startPoint.elevationThousandths) * parameter;
  const bottom = elevation + model.silhouette.bottomOffsetThousandths;
  return { bottom, top: bottom + model.silhouette.heightThousandths };
}

function addRoot(values, startValue, endValue, target, first, last) {
  const difference = endValue - startValue;
  if (Math.abs(difference) <= EPSILON) return;
  const parameter = (target - startValue) / difference;
  if (parameter > first + EPSILON && parameter < last - EPSILON) values.push(parameter);
}

function projectionBounds(geometry, direction) {
  if (geometry.type === "polygon") {
    const projections = geometry.offsets.map((offset) => dot(offset, direction));
    return { minimum: Math.min(...projections), maximum: Math.max(...projections) };
  }
  const local = rotate(direction.x, direction.y, -geometry.rotationMilliDegrees);
  const radius = Math.hypot(geometry.radiusX * local.x, geometry.radiusY * local.y);
  return { minimum: -radius, maximum: radius };
}

function panelClearanceResult(model, startPoint, endPoint, panel, interval) {
  if (!interval) return { blocked: false, reason: "no_horizontal_overlap" };
  if (panel.topZThousandths <= FREE_TERRAIN_HEIGHT_THOUSANDTHS) {
    return { blocked: false, reason: "terrain_two_inches_or_less" };
  }
  const panelDirection = {
    x: panel.endXThousandths - panel.startXThousandths,
    y: panel.endYThousandths - panel.startYThousandths,
  };
  const length = Math.hypot(panelDirection.x, panelDirection.y);
  const unit = { x: panelDirection.x / length, y: panelDirection.y / length };
  const geometry = silhouetteGeometry(model, startPoint.rotationMilliDegrees);
  const bounds = projectionBounds(geometry, unit);
  const startCenter = modelPathCenter(startPoint, geometry);
  const endCenter = modelPathCenter(endPoint, geometry);
  const origin = { x: panel.startXThousandths, y: panel.startYThousandths };
  const startOffset = dot(subtract(startCenter, origin), unit);
  const endOffset = dot(subtract(endCenter, origin), unit);
  const startVertical = modelVerticalInterval(model, startPoint, endPoint, 0);
  const endVertical = modelVerticalInterval(model, startPoint, endPoint, 1);
  const breaks = [interval.first, interval.last];
  addRoot(
    breaks,
    startVertical.bottom,
    endVertical.bottom,
    panel.topZThousandths,
    interval.first,
    interval.last,
  );
  addRoot(
    breaks,
    startVertical.top,
    endVertical.top,
    panel.bottomZThousandths,
    interval.first,
    interval.last,
  );
  for (const opening of panel.openings) {
    addRoot(
      breaks,
      startOffset + bounds.minimum,
      endOffset + bounds.minimum,
      opening.startOffsetThousandths,
      interval.first,
      interval.last,
    );
    addRoot(
      breaks,
      startOffset + bounds.maximum,
      endOffset + bounds.maximum,
      opening.endOffsetThousandths,
      interval.first,
      interval.last,
    );
    addRoot(
      breaks,
      startVertical.bottom,
      endVertical.bottom,
      opening.bottomZThousandths,
      interval.first,
      interval.last,
    );
    addRoot(
      breaks,
      startVertical.top,
      endVertical.top,
      opening.topZThousandths,
      interval.first,
      interval.last,
    );
  }
  const ordered = [...new Set(breaks)].sort((left, right) => left - right);
  const samples = [
    ...ordered,
    ...ordered.slice(1).map((value, index) => (ordered[index] + value) / 2),
  ];
  let openingClearance = false;
  for (const parameter of samples) {
    const vertical = modelVerticalInterval(model, startPoint, endPoint, parameter);
    const verticallyBlocked =
      vertical.bottom < panel.topZThousandths - EPSILON &&
      vertical.top > panel.bottomZThousandths + EPSILON;
    if (!verticallyBlocked) continue;
    const offset = startOffset + (endOffset - startOffset) * parameter;
    const insideOpening = panel.openings.some(
      (opening) =>
        offset + bounds.minimum >= opening.startOffsetThousandths - EPSILON &&
        offset + bounds.maximum <= opening.endOffsetThousandths + EPSILON &&
        vertical.bottom >= opening.bottomZThousandths - EPSILON &&
        vertical.top <= opening.topZThousandths + EPSILON,
    );
    if (!insideOpening) {
      return { blocked: true, reason: "path_crosses_terrain_panel" };
    }
    openingClearance = true;
  }
  return {
    blocked: false,
    reason: openingClearance ? "whole_envelope_fits_opening" : "vertical_clearance",
  };
}

function surfaceClearanceResult(model, startPoint, endPoint, surface, intervals) {
  if (intervals.length === 0) return { blocked: false, reason: "no_horizontal_overlap" };
  if (surface.topZThousandths <= FREE_TERRAIN_HEIGHT_THOUSANDTHS) {
    return { blocked: false, reason: "terrain_two_inches_or_less" };
  }
  const startVertical = modelVerticalInterval(model, startPoint, endPoint, 0);
  const endVertical = modelVerticalInterval(model, startPoint, endPoint, 1);
  for (const interval of intervals) {
    const breaks = [interval.first, interval.last];
    addRoot(
      breaks,
      startVertical.bottom,
      endVertical.bottom,
      surface.topZThousandths,
      interval.first,
      interval.last,
    );
    addRoot(
      breaks,
      startVertical.top,
      endVertical.top,
      surface.bottomZThousandths,
      interval.first,
      interval.last,
    );
    const ordered = [...new Set(breaks)].sort((left, right) => left - right);
    const samples = [
      ...ordered,
      ...ordered.slice(1).map((value, index) => (ordered[index] + value) / 2),
    ];
    if (
      samples.some((parameter) => {
        const vertical = modelVerticalInterval(model, startPoint, endPoint, parameter);
        return (
          vertical.bottom < surface.topZThousandths - EPSILON &&
          vertical.top > surface.bottomZThousandths + EPSILON
        );
      })
    ) {
      return { blocked: true, reason: "path_crosses_terrain_surface" };
    }
  }
  return { blocked: false, reason: "vertical_clearance" };
}

function footprintGeometry(model, point) {
  if (model.shape === "rectangle") {
    const halfWidth = model.widthThousandths / 2;
    const halfDepth = model.depthThousandths / 2;
    return {
      type: "polygon",
      center: { x: point.centerXThousandths, y: point.centerYThousandths },
      offsets: [
        [-halfWidth, -halfDepth],
        [halfWidth, -halfDepth],
        [halfWidth, halfDepth],
        [-halfWidth, halfDepth],
      ].map(([x, y]) => rotate(x, y, point.rotationMilliDegrees)),
    };
  }
  return {
    type: "ellipse",
    center: { x: point.centerXThousandths, y: point.centerYThousandths },
    radiusX: model.widthThousandths / 2,
    radiusY: model.depthThousandths / 2,
    rotationMilliDegrees: point.rotationMilliDegrees,
  };
}

function supportRadius(geometry, direction) {
  if (geometry.type === "polygon") {
    return Math.max(...geometry.offsets.map((offset) => dot(offset, direction)));
  }
  const local = rotate(direction.x, direction.y, -geometry.rotationMilliDegrees);
  return Math.hypot(geometry.radiusX * local.x, geometry.radiusY * local.y);
}

function footprintWhollyInsideSurface(model, point, surface) {
  const geometry = footprintGeometry(model, point);
  const vertices = surface.vertices.map((vertex) => ({
    x: vertex.xThousandths,
    y: vertex.yThousandths,
  }));
  if (surface.geometryMode !== "simple_polygon") {
    return vertices.every((vertex, index) => {
      const edge = subtract(vertices[(index + 1) % vertices.length], vertex);
      const inward = { x: -edge.y, y: edge.x };
      return (
        dot(subtract(geometry.center, vertex), inward) + EPSILON >=
        supportRadius(geometry, { x: -inward.x, y: -inward.y })
      );
    });
  }
  if (geometry.type === "ellipse") {
    const normalizedVertices = vertices.map((vertex) => {
      const local = rotate(
        vertex.x - geometry.center.x,
        vertex.y - geometry.center.y,
        -geometry.rotationMilliDegrees,
      );
      return { x: local.x / geometry.radiusX, y: local.y / geometry.radiusY };
    });
    const origin = { x: 0, y: 0 };
    return (
      pointInsideSimple(origin, normalizedVertices) &&
      normalizedVertices.every(
        (vertex, index) =>
          pointSegmentDistance(
            origin,
            vertex,
            normalizedVertices[(index + 1) % normalizedVertices.length],
          ) >=
          1 - EPSILON,
      )
    );
  }
  const modelVertices = geometry.offsets.map((offset) => ({
    x: geometry.center.x + offset.x,
    y: geometry.center.y + offset.y,
  }));
  if (!modelVertices.every((vertex) => pointInsideSimple(vertex, vertices))) return false;
  for (let modelIndex = 0; modelIndex < modelVertices.length; modelIndex += 1) {
    const modelStart = modelVertices[modelIndex];
    const modelEnd = modelVertices[(modelIndex + 1) % modelVertices.length];
    const parameters = segmentBoundaryParameters(modelStart, modelEnd, vertices);
    const samples = parameters
      .slice(1)
      .map((parameter, index) =>
        interpolate(modelStart, modelEnd, (parameters[index] + parameter) / 2),
      );
    if (samples.some((sample) => !pointInsideSimple(sample, vertices))) return false;
  }
  return true;
}

function pointInTerrainFootprint(point, footprint) {
  const local = rotate(
    point.centerXThousandths - footprint.centerXThousandths,
    point.centerYThousandths - footprint.centerYThousandths,
    -footprint.rotationMilliDegrees,
  );
  return (
    Math.abs(local.x) <= footprint.widthThousandths / 2 + EPSILON &&
    Math.abs(local.y) <= footprint.heightThousandths / 2 + EPSILON
  );
}

function sectionFootprints(section, terrainFootprints) {
  return terrainFootprints.footprints.filter(
    (footprint) => footprint.areaTerrainSectionId === section.sectionId,
  );
}

function endpointSupportResult(model, point, sections, lowerKeywords) {
  if (point.elevationThousandths === 0) {
    return { blocked: false, reason: "ground_endpoint" };
  }
  const supporting = [];
  for (const section of sections) {
    for (const surface of section.surfaces) {
      if (
        surface.supportsEnding &&
        Math.abs(surface.topZThousandths - point.elevationThousandths) <= EPSILON &&
        footprintWhollyInsideSurface(model, point, surface)
      ) {
        supporting.push({ section, surface });
      }
    }
  }
  if (supporting.length === 0) {
    return { blocked: true, reason: "unsupported_elevated_endpoint" };
  }
  let rejected = null;
  for (const { section, surface } of supporting) {
    if (section.movementType === "no_end") {
      rejected ??= {
        reason: "terrain_forbids_ending_on_top",
        sectionId: section.sectionId,
        obstacleId: surface.id,
      };
      continue;
    }
    if (
      section.movementType === "ruins" &&
      !lowerKeywords.some((keyword) => ["infantry", "beast", "fly"].includes(keyword))
    ) {
      rejected ??= {
        reason: "ruins_upper_floor_keyword_required",
        sectionId: section.sectionId,
        obstacleId: surface.id,
      };
      continue;
    }
    return {
      blocked: false,
      reason: "whole_footprint_supported",
      sectionId: section.sectionId,
      obstacleId: surface.id,
    };
  }
  return { blocked: true, ...rejected };
}

function collisionKey(collision) {
  return [
    collision.modelId,
    collision.pathSegmentIndex,
    collision.sectionId ?? "",
    collision.obstacleType ?? "",
    collision.obstacleId ?? "",
    collision.reason,
  ].join(":");
}

function inspectionPoint(point) {
  if (!point) return null;
  return {
    centerXThousandths: point.centerXThousandths,
    centerYThousandths: point.centerYThousandths,
    elevationThousandths: point.elevationThousandths,
    rotationMilliDegrees: point.rotationMilliDegrees,
  };
}

function inspectionEnvelope(model) {
  const silhouette = model?.silhouette;
  return {
    geometryMode: silhouette?.geometryMode ?? "unavailable",
    shape: silhouette?.shape ?? model?.shape ?? "unavailable",
    widthThousandths: silhouette?.widthThousandths ?? model?.widthThousandths ?? 0,
    depthThousandths: silhouette?.depthThousandths ?? model?.depthThousandths ?? 0,
    heightThousandths: silhouette?.heightThousandths ?? 0,
    bottomOffsetThousandths: silhouette?.bottomOffsetThousandths ?? 0,
    centerOffsetXThousandths: silhouette?.centerOffsetXThousandths ?? 0,
    centerOffsetYThousandths: silhouette?.centerOffsetYThousandths ?? 0,
    convexVertices: Array.isArray(silhouette?.convexVertices)
      ? silhouette.convexVertices.map((vertex) => ({ ...vertex }))
      : [],
  };
}

function obstacleInspection(section, obstacleType, obstacleId, result, reason = result.reason) {
  return {
    sectionId: section.sectionId,
    obstacleType,
    obstacleId,
    status: result.blocked ? "collision" : "clear",
    reason,
  };
}

export function deriveTerrainClearanceFacts({
  formation,
  position,
  terrainFootprints,
  terrainVisibility,
  legacy = false,
}) {
  const models = Array.isArray(position?.models) ? position.models : [];
  const sections = Array.isArray(terrainVisibility?.sections) ? terrainVisibility.sections : [];
  const unavailableReasons = [];
  const collisions = [];
  const modelInspections = [];
  let inspectionCheckCount = 0;
  let omittedInspectionCheckCount = 0;
  const perModelInspectionCheckLimit = Math.max(
    100,
    Math.min(
      MAX_INSPECTION_CHECKS_PER_MODEL,
      Math.floor(MAX_INSPECTION_CHECKS / Math.max(1, models.length)),
    ),
  );
  const recordInspectionCheck = (modelInspection, segment, check) => {
    if (
      inspectionCheckCount < MAX_INSPECTION_CHECKS &&
      modelInspection.recordedCheckCount < perModelInspectionCheckLimit
    ) {
      segment.checks.push(check);
      inspectionCheckCount += 1;
      modelInspection.recordedCheckCount += 1;
      return;
    }
    omittedInspectionCheckCount += 1;
    modelInspection.omittedCheckCount += 1;
  };
  const structurallyReadySections = sections.filter(
    (section) =>
      section.movementGeometryComplete &&
      Array.isArray(section.panels) &&
      Array.isArray(section.surfaces),
  );
  const supportedSections = sections.filter(
    (section) =>
      TERRAIN_MOVEMENT_TYPES.includes(section.movementType) && section.movementType !== "reviewed",
  );
  const readySections = terrainVisibility?.allMovementGeometryRecorded
    ? structurallyReadySections
    : [];
  const terrainComplete = Boolean(
    terrainFootprints &&
      terrainVisibility?.allMovementGeometryRecorded &&
      readySections.length === sections.length &&
      sections.length > 0,
  );
  if (legacy) unavailableReasons.push("legacy_terrain_clearance_unavailable");
  if (!terrainFootprints) unavailableReasons.push("terrain_footprints_unavailable");
  if (!terrainVisibility) unavailableReasons.push("terrain_movement_geometry_unavailable");
  if (terrainVisibility && !terrainComplete)
    unavailableReasons.push("terrain_movement_geometry_incomplete");
  if (supportedSections.length !== sections.length)
    unavailableReasons.push("terrain_movement_rules_require_review");
  let readyModelCount = 0;
  let pathSegmentCount = 0;
  let checkedPathSegmentCount = 0;
  const lowerKeywords = (formation?.keywords ?? []).map((keyword) => keyword.toLowerCase());
  for (const model of models) {
    const path = Array.isArray(model?.path) ? model.path : [];
    const segmentCount = Math.max(1, path.length - 1);
    pathSegmentCount += segmentCount;
    const rotationReady =
      path.length > 0 &&
      path
        .slice(1)
        .every((point, index) => point.rotationMilliDegrees === path[index].rotationMilliDegrees);
    const inspectionSegments =
      path.length === 0
        ? [
            {
              pathSegmentIndex: 0,
              mode: "unavailable",
              status: "unknown",
              start: null,
              end: null,
              checks: [],
            },
          ]
        : (path.length === 1
            ? [[path[0], path[0]]]
            : path.slice(1).map((point, index) => [path[index], point])
          ).map(([startPoint, endPoint], pathSegmentIndex) => ({
            pathSegmentIndex,
            mode: "swept",
            status: "unknown",
            start: inspectionPoint(startPoint),
            end: inspectionPoint(endPoint),
            checks: [],
          }));
    const modelInspection = {
      modelId: model?.modelId ?? "",
      ready: false,
      status: "unknown",
      unavailableReason: null,
      recordedCheckCount: 0,
      omittedCheckCount: 0,
      envelope: inspectionEnvelope(model),
      path: path.map(inspectionPoint),
      segments: inspectionSegments,
      endpointSupport: null,
    };
    modelInspections.push(modelInspection);
    if (!silhouetteReady(model) || path.length === 0 || !rotationReady) {
      const unavailableReason = !rotationReady
        ? `continuous_rotation_clearance_unavailable:${model?.modelId ?? ""}`
        : `model_movement_geometry_unavailable:${model?.modelId ?? ""}`;
      unavailableReasons.push(unavailableReason);
      modelInspection.unavailableReason = unavailableReason;
      modelInspection.segments.forEach((segment) => {
        recordInspectionCheck(modelInspection, segment, {
          sectionId: "",
          obstacleType: "model",
          obstacleId: model?.modelId ?? "",
          status: "unknown",
          reason: unavailableReason,
        });
      });
      continue;
    }
    modelInspection.ready = true;
    readyModelCount += 1;
    const segments =
      path.length === 1
        ? [[path[0], path[0]]]
        : path.slice(1).map((point, index) => [path[index], point]);
    const ignoresRuinObstacles = lowerKeywords.some((keyword) =>
      ["infantry", "beast"].includes(keyword),
    );
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const [startPoint, endPoint] = segments[segmentIndex];
      const segmentInspection = modelInspection.segments[segmentIndex];
      if (terrainComplete && supportedSections.length === sections.length && !legacy) {
        checkedPathSegmentCount += 1;
      }
      for (const section of sections) {
        if (section.movementType === "reviewed") {
          recordInspectionCheck(modelInspection, segmentInspection, {
            sectionId: section.sectionId,
            obstacleType: "section",
            obstacleId: "",
            status: "unknown",
            reason: "terrain_movement_rules_require_review",
          });
          continue;
        }
        const endpointOnly = ignoresRuinObstacles && section.movementType === "ruins";
        if (endpointOnly && segmentIndex < segments.length - 1) {
          segmentInspection.mode = "ruins_pass_through";
          recordInspectionCheck(modelInspection, segmentInspection, {
            sectionId: section.sectionId,
            obstacleType: "section",
            obstacleId: "",
            status: "clear",
            reason: "ruins_pass_through_keyword",
          });
          continue;
        }
        if (endpointOnly) segmentInspection.mode = "endpoint_only";
        const collisionStart = endpointOnly ? endPoint : startPoint;
        for (const panel of section.panels ?? []) {
          const obstacle = [
            { x: panel.startXThousandths, y: panel.startYThousandths },
            { x: panel.endXThousandths, y: panel.endYThousandths },
          ];
          const interval = obstacleInterval(model, collisionStart, endPoint, obstacle);
          const result = panelClearanceResult(model, collisionStart, endPoint, panel, interval);
          const reason = result.blocked
            ? endpointOnly
              ? "endpoint_inside_ruin_panel"
              : result.reason
            : result.reason;
          recordInspectionCheck(
            modelInspection,
            segmentInspection,
            obstacleInspection(section, "panel", panel.id, result, reason),
          );
          if (result.blocked) {
            collisions.push({
              formationId: formation?.id ?? "",
              modelId: model.modelId,
              pathSegmentIndex: segmentIndex,
              sectionId: section.sectionId,
              obstacleType: "panel",
              obstacleId: panel.id,
              reason: endpointOnly ? "endpoint_inside_ruin_panel" : "path_crosses_terrain_panel",
            });
          }
        }
        for (const surface of section.surfaces ?? []) {
          const intervals = surfaceObstacleIntervals(model, collisionStart, endPoint, surface);
          const result = surfaceClearanceResult(
            model,
            collisionStart,
            endPoint,
            surface,
            intervals,
          );
          const reason = result.blocked
            ? endpointOnly
              ? "endpoint_inside_ruin_surface"
              : result.reason
            : result.reason;
          recordInspectionCheck(
            modelInspection,
            segmentInspection,
            obstacleInspection(section, "surface", surface.id, result, reason),
          );
          if (result.blocked) {
            collisions.push({
              formationId: formation?.id ?? "",
              modelId: model.modelId,
              pathSegmentIndex: segmentIndex,
              sectionId: section.sectionId,
              obstacleType: "surface",
              obstacleId: surface.id,
              reason: endpointOnly
                ? "endpoint_inside_ruin_surface"
                : "path_crosses_terrain_surface",
            });
          }
        }
        if ((section.panels ?? []).length === 0 && (section.surfaces ?? []).length === 0) {
          recordInspectionCheck(modelInspection, segmentInspection, {
            sectionId: section.sectionId,
            obstacleType: "section",
            obstacleId: "",
            status: "clear",
            reason: "section_has_no_blocking_geometry",
          });
        }
      }
    }
    const endpoint = path.at(-1);
    const supportResult = endpointSupportResult(model, endpoint, supportedSections, lowerKeywords);
    modelInspection.endpointSupport = {
      status: supportResult.blocked ? "collision" : "clear",
      reason: supportResult.reason,
      sectionId: supportResult.sectionId ?? "",
      obstacleId: supportResult.obstacleId ?? "",
      point: inspectionPoint(endpoint),
    };
    if (supportResult.blocked) {
      const matchingSection = sections.find((section) =>
        sectionFootprints(section, terrainFootprints ?? { footprints: [] }).some((footprint) =>
          pointInTerrainFootprint(endpoint, footprint),
        ),
      );
      collisions.push({
        formationId: formation?.id ?? "",
        modelId: model.modelId,
        pathSegmentIndex: Math.max(0, segments.length - 1),
        sectionId: supportResult.sectionId ?? matchingSection?.sectionId ?? "",
        obstacleType: supportResult.obstacleId ? "surface" : "endpoint",
        obstacleId: supportResult.obstacleId ?? "",
        reason: supportResult.reason,
      });
    }
  }
  const uniqueCollisions = [
    ...new Map(collisions.map((collision) => [collisionKey(collision), collision])).values(),
  ].sort((left, right) => collisionKey(left).localeCompare(collisionKey(right)));
  const reportedCollisions = legacy ? [] : uniqueCollisions;
  const flags =
    (readyModelCount === models.length ? TERRAIN_CLEARANCE_FLAGS.modelsComplete : 0) |
    (terrainComplete ? TERRAIN_CLEARANCE_FLAGS.terrainComplete : 0) |
    (supportedSections.length === sections.length && sections.length > 0
      ? TERRAIN_CLEARANCE_FLAGS.rulesComplete
      : 0);
  const reasons = [...new Set(unavailableReasons)].sort();
  const executable = flags === TERRAIN_CLEARANCE_FLAGS.mask && !legacy;
  const status = reportedCollisions.length > 0 ? "collision" : executable ? "clear" : "unknown";
  for (const modelInspection of modelInspections) {
    if (legacy) {
      modelInspection.status = "unknown";
      modelInspection.unavailableReason = "legacy_terrain_clearance_unavailable";
      modelInspection.segments.forEach((segment) => {
        segment.status = "unknown";
        segment.checks = [
          {
            sectionId: "",
            obstacleType: "legacy",
            obstacleId: "",
            status: "unknown",
            reason: "legacy_terrain_clearance_unavailable",
          },
        ];
      });
      if (modelInspection.endpointSupport) {
        modelInspection.endpointSupport = {
          ...modelInspection.endpointSupport,
          status: "unknown",
          reason: "legacy_terrain_clearance_unavailable",
        };
      }
      continue;
    }
    const collisionSegments = new Set(
      reportedCollisions
        .filter((collision) => collision.modelId === modelInspection.modelId)
        .map((collision) => collision.pathSegmentIndex),
    );
    for (const segment of modelInspection.segments) {
      segment.status = collisionSegments.has(segment.pathSegmentIndex)
        ? "collision"
        : executable && modelInspection.ready
          ? "clear"
          : "unknown";
    }
    modelInspection.status =
      modelInspection.endpointSupport?.status === "collision" ||
      modelInspection.segments.some((segment) => segment.status === "collision")
        ? "collision"
        : executable && modelInspection.ready
          ? "clear"
          : "unknown";
  }
  if (legacy) {
    inspectionCheckCount = 0;
    for (const model of modelInspections) {
      model.recordedCheckCount = model.segments.reduce(
        (total, segment) => total + segment.checks.length,
        0,
      );
      model.omittedCheckCount = 0;
      inspectionCheckCount += model.recordedCheckCount;
    }
    omittedInspectionCheckCount = 0;
  }
  return {
    executable,
    status,
    unavailableReasons: reasons,
    modelCount: models.length,
    readyModelCount,
    sectionCount: sections.length,
    readySectionCount: readySections.length,
    supportedSectionCount: supportedSections.length,
    pathSegmentCount,
    checkedPathSegmentCount,
    collisions: reportedCollisions,
    flags,
    inspection: {
      schemaVersion: TERRAIN_CLEARANCE_INSPECTION_SCHEMA_VERSION,
      formationId: formation?.id ?? "",
      status,
      executable,
      unavailableReasons: reasons,
      traceComplete: omittedInspectionCheckCount === 0,
      recordedCheckCount: inspectionCheckCount,
      omittedCheckCount: omittedInspectionCheckCount,
      sections: sections.map((section) => ({
        sectionId: section.sectionId,
        movementType: section.movementType,
        movementGeometryComplete: Boolean(section.movementGeometryComplete),
        panelIds: (section.panels ?? []).map((panel) => panel.id),
        surfaceIds: (section.surfaces ?? []).map((surface) => surface.id),
      })),
      models: modelInspections,
    },
  };
}

export function terrainClearanceFactValues(fact) {
  return [
    fact.modelCount,
    fact.readyModelCount,
    fact.sectionCount,
    fact.readySectionCount,
    fact.supportedSectionCount,
    fact.pathSegmentCount,
    fact.checkedPathSegmentCount,
    fact.collisions.length,
    fact.flags,
  ];
}

export function terrainClearanceFactValuesAreValid(
  modelCount,
  readyModelCount,
  sectionCount,
  readySectionCount,
  supportedSectionCount,
  pathSegmentCount,
  checkedPathSegmentCount,
  collisionCount,
  flags,
) {
  return Boolean(
    modelCount > 0 &&
      modelCount <= 1000 &&
      readyModelCount <= modelCount &&
      sectionCount > 0 &&
      sectionCount <= 24 &&
      readySectionCount <= sectionCount &&
      supportedSectionCount <= sectionCount &&
      pathSegmentCount >= modelCount &&
      pathSegmentCount <= 64_000 &&
      checkedPathSegmentCount <= pathSegmentCount &&
      collisionCount <= 1_000_000 &&
      (flags & ~TERRAIN_CLEARANCE_FLAGS.mask) === 0 &&
      Boolean(flags & TERRAIN_CLEARANCE_FLAGS.modelsComplete) ===
        (readyModelCount === modelCount) &&
      Boolean(flags & TERRAIN_CLEARANCE_FLAGS.terrainComplete) ===
        (readySectionCount === sectionCount) &&
      Boolean(flags & TERRAIN_CLEARANCE_FLAGS.rulesComplete) ===
        (supportedSectionCount === sectionCount) &&
      (flags !== TERRAIN_CLEARANCE_FLAGS.mask || checkedPathSegmentCount === pathSegmentCount),
  );
}

function inspectionPointIsValid(point) {
  return Boolean(
    point &&
      Number.isInteger(point.centerXThousandths) &&
      Number.isInteger(point.centerYThousandths) &&
      Number.isInteger(point.elevationThousandths) &&
      Number.isInteger(point.rotationMilliDegrees),
  );
}

function inspectionIdentityIsValid(value, maximumLength = 200) {
  return typeof value === "string" && value.length <= maximumLength;
}

function inspectionDimensionIsValid(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100_000;
}

export function terrainClearanceInspectionIsValid(inspection) {
  if (
    inspection?.schemaVersion !== TERRAIN_CLEARANCE_INSPECTION_SCHEMA_VERSION ||
    !inspectionIdentityIsValid(inspection.formationId) ||
    !["clear", "collision", "unknown"].includes(inspection.status) ||
    typeof inspection.executable !== "boolean" ||
    typeof inspection.traceComplete !== "boolean" ||
    !Number.isInteger(inspection.recordedCheckCount) ||
    inspection.recordedCheckCount < 0 ||
    inspection.recordedCheckCount > MAX_INSPECTION_CHECKS ||
    !Number.isInteger(inspection.omittedCheckCount) ||
    inspection.omittedCheckCount < 0 ||
    inspection.traceComplete !== (inspection.omittedCheckCount === 0) ||
    !Array.isArray(inspection.unavailableReasons) ||
    inspection.unavailableReasons.length > 1_024 ||
    !inspection.unavailableReasons.every((reason) => inspectionIdentityIsValid(reason, 500)) ||
    !Array.isArray(inspection.sections) ||
    inspection.sections.length > 24 ||
    !Array.isArray(inspection.models) ||
    inspection.models.length > 1_000 ||
    (inspection.executable && inspection.status === "unknown") ||
    (!inspection.executable && inspection.status === "clear")
  ) {
    return false;
  }
  if (
    !inspection.sections.every(
      (section) =>
        inspectionIdentityIsValid(section?.sectionId) &&
        TERRAIN_MOVEMENT_TYPES.includes(section?.movementType) &&
        typeof section?.movementGeometryComplete === "boolean" &&
        Array.isArray(section?.panelIds) &&
        section.panelIds.length <= 256 &&
        section.panelIds.every((id) => inspectionIdentityIsValid(id)) &&
        Array.isArray(section?.surfaceIds) &&
        section.surfaceIds.length <= 256 &&
        section.surfaceIds.every((id) => inspectionIdentityIsValid(id)),
    )
  ) {
    return false;
  }
  let segmentCount = 0;
  let checkCount = 0;
  for (const model of inspection.models) {
    if (
      !inspectionIdentityIsValid(model?.modelId) ||
      typeof model?.ready !== "boolean" ||
      !["clear", "collision", "unknown"].includes(model?.status) ||
      !Number.isInteger(model?.recordedCheckCount) ||
      model.recordedCheckCount < 0 ||
      !Number.isInteger(model?.omittedCheckCount) ||
      model.omittedCheckCount < 0 ||
      !(
        model?.unavailableReason === null || inspectionIdentityIsValid(model.unavailableReason, 500)
      ) ||
      !model?.envelope ||
      !inspectionIdentityIsValid(model.envelope.geometryMode) ||
      !inspectionIdentityIsValid(model.envelope.shape) ||
      !inspectionDimensionIsValid(model.envelope.widthThousandths) ||
      !inspectionDimensionIsValid(model.envelope.depthThousandths) ||
      !inspectionDimensionIsValid(model.envelope.heightThousandths) ||
      !Number.isInteger(model.envelope.bottomOffsetThousandths) ||
      !Number.isInteger(model.envelope.centerOffsetXThousandths) ||
      !Number.isInteger(model.envelope.centerOffsetYThousandths) ||
      !Array.isArray(model.envelope.convexVertices) ||
      model.envelope.convexVertices.length > 16 ||
      !model.envelope.convexVertices.every(
        (vertex) =>
          Number.isInteger(vertex?.xOffsetThousandths) &&
          Number.isInteger(vertex?.yOffsetThousandths),
      ) ||
      !Array.isArray(model.path) ||
      model.path.length > 64_001 ||
      !model.path.every(inspectionPointIsValid) ||
      !Array.isArray(model.segments)
    ) {
      return false;
    }
    const modelCheckStart = checkCount;
    if (
      model.endpointSupport !== null &&
      (!model.endpointSupport ||
        !["clear", "collision", "unknown"].includes(model.endpointSupport.status) ||
        !inspectionIdentityIsValid(model.endpointSupport.reason, 500) ||
        !inspectionIdentityIsValid(model.endpointSupport.sectionId) ||
        !inspectionIdentityIsValid(model.endpointSupport.obstacleId) ||
        !inspectionPointIsValid(model.endpointSupport.point))
    ) {
      return false;
    }
    segmentCount += model.segments.length;
    if (segmentCount > 64_000) return false;
    for (const segment of model.segments) {
      if (
        !Number.isInteger(segment?.pathSegmentIndex) ||
        segment.pathSegmentIndex < 0 ||
        !inspectionIdentityIsValid(segment.mode) ||
        !["clear", "collision", "unknown"].includes(segment.status) ||
        !(segment.start === null || inspectionPointIsValid(segment.start)) ||
        !(segment.end === null || inspectionPointIsValid(segment.end)) ||
        !Array.isArray(segment.checks)
      ) {
        return false;
      }
      checkCount += segment.checks.length;
      if (checkCount > 1_000_000) return false;
      if (
        !segment.checks.every(
          (check) =>
            inspectionIdentityIsValid(check?.sectionId) &&
            inspectionIdentityIsValid(check?.obstacleType) &&
            inspectionIdentityIsValid(check?.obstacleId) &&
            ["clear", "collision", "unknown"].includes(check?.status) &&
            inspectionIdentityIsValid(check?.reason, 500),
        )
      ) {
        return false;
      }
      if (
        (inspection.traceComplete &&
          segment.status === "collision" &&
          !segment.checks.some((check) => check.status === "collision")) ||
        (segment.status === "clear" && segment.checks.some((check) => check.status !== "clear"))
      ) {
        return false;
      }
    }
    if (checkCount - modelCheckStart !== model.recordedCheckCount) return false;
  }
  return checkCount === inspection.recordedCheckCount;
}

export function terrainClearanceInspectionExport({
  formationName,
  fact,
  terrainFootprints,
  terrainVisibility,
}) {
  if (!terrainClearanceInspectionIsValid(fact?.inspection)) {
    throw new Error("Terrain clearance inspection is structurally invalid");
  }
  return {
    schema: "whc-terrain-clearance-inspection",
    schemaVersion: TERRAIN_CLEARANCE_INSPECTION_SCHEMA_VERSION,
    formationName: String(formationName ?? "").slice(0, 200),
    inspection: fact.inspection,
    terrainFootprints,
    terrainVisibility,
  };
}
