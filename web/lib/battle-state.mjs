import { targetSequenceState } from "./allocation.mjs";
import {
  BATTLE_EFFECT_DURATIONS,
  BATTLE_PHASE_STEPS,
  battleAttackWindow,
  effectExpiresOnAdvance,
  nextBattleClock,
  sameBattleClock,
  setupBattleClock,
  startBattleClock,
} from "./battle-clock.mjs";
import { normalizeDefensiveEquipmentCounts } from "./defensive-equipment.mjs";
import { normalizeBattleRuleCoverageBinding } from "./battle-rule-selection.mjs";
import { chapterApprovedTableBinding } from "./mission-pack.mjs";
import { deriveObjectiveControlFacts } from "./objective-control-facts.mjs";
import { deriveSpatialFacts } from "./spatial-facts.mjs";
import {
  deriveVisibilityFacts,
  TERRAIN_VISIBILITY_FEATURES,
  TERRAIN_VISIBILITY_LIMITS,
  TERRAIN_VISIBILITY_METHODS,
  convexSilhouetteIsValid,
  silhouetteReady,
  terrainVisibilityGeometryIsValid,
} from "./visibility-facts.mjs";

export const BATTLE_STATE_VERSION = 35;
export const OBJECTIVE_CONTROL_BATTLE_STATE_VERSION = 35;
export const CONVEX_SILHOUETTE_BATTLE_STATE_VERSION = 34;
export const RANGED_GEOMETRY_BATTLE_STATE_VERSION = 33;
export const TERRAIN_VISIBILITY_BATTLE_STATE_VERSION = 32;
export const SPATIAL_FACTS_BATTLE_STATE_VERSION = 31;
export const TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION = 30;
export const EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION = 29;
export const MODEL_POSITION_BATTLE_STATE_VERSION = 28;
export const MODEL_PLACEMENT_BATTLE_STATE_VERSION = 27;
export const TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION = 26;
export const TABLE_GEOMETRY_BATTLE_STATE_VERSION = 25;
export const RULE_COVERAGE_BATTLE_STATE_VERSION = 24;
export const RAPID_INGRESS_BATTLE_STATE_VERSION = 23;
export const SMOKESCREEN_BATTLE_STATE_VERSION = 22;
export const COUNTER_OFFENSIVE_BATTLE_STATE_VERSION = 21;
export const SETUP_RULES_BATTLE_STATE_VERSION = 20;
export const TRANSPORT_NESTING_BATTLE_STATE_VERSION = 19;
export const TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION = 18;
export const RANGED_DECLARATION_BATTLE_STATE_VERSION = 17;
export const GO_TO_GROUND_BATTLE_STATE_VERSION = 16;
export const HAZARDOUS_BATTLE_STATE_VERSION = 15;
export const FIRE_OVERWATCH_BATTLE_STATE_VERSION = 14;
export const HEROIC_INTERVENTION_BATTLE_STATE_VERSION = 13;
export const FIGHT_MOVE_BATTLE_STATE_VERSION = 12;
export const CHARGE_MOVE_BATTLE_STATE_VERSION = 11;
export const WEAPON_BEARER_BATTLE_STATE_VERSION = 10;
export const WEAPON_INVENTORY_BATTLE_STATE_VERSION = 9;
export const TARGET_ELIGIBILITY_BATTLE_STATE_VERSION = 8;
export const TRANSPORT_BATTLE_STATE_VERSION = 7;
export const DEPLOYMENT_BATTLE_STATE_VERSION = 6;
export const ACTION_BATTLE_STATE_VERSION = 5;
export const TRACKER_BATTLE_STATE_VERSION = 4;
export const TIMELINE_BATTLE_STATE_VERSION = 3;
export const ROSTER_BATTLE_STATE_VERSION = 2;
export const BATTLE_EVENT_VERSION = 1;
export const LEGACY_BATTLE_STATE_VERSION = 1;

function record(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function boundedString(value, name, maximum = 200) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function nonnegativeInteger(value, name, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

function boundedInteger(value, name, minimum = -1_000_000, maximum = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

const MOVEMENT_KINDS = Object.freeze(["stationary", "normal", "advance", "fall_back"]);
const ACTIVATION_TYPES = Object.freeze(["shooting", "fight"]);
const DEPLOYMENT_LOCATIONS = Object.freeze([
  "not_deployed",
  "battlefield",
  "reserves",
  "strategic_reserves",
  "embarked",
]);
const TARGET_MEASUREMENT_METHODS = Object.freeze(["manual", "uwb", "camera", "imported"]);
const TABLE_GEOMETRY_METHODS = Object.freeze(["manual", "uwb", "camera", "imported"]);
const TERRAIN_FOOTPRINT_METHODS = TABLE_GEOMETRY_METHODS;
const MODEL_PLACEMENT_METHODS = TABLE_GEOMETRY_METHODS;
const MODEL_MEASUREMENT_BASES = Object.freeze(["base", "model"]);
const MODEL_FOOTPRINT_SHAPES = Object.freeze(["circle", "ellipse", "rectangle"]);
const MODEL_PATH_POSITION_CONTEXTS = Object.freeze([
  "movement",
  "charge",
  "heroic_intervention",
  "pile_in",
  "consolidation",
]);
const MODEL_SETUP_POSITION_CONTEXTS = Object.freeze([
  "reserve_arrival",
  "rapid_ingress",
  "disembarkation",
  "destroyed_transport_disembarkation",
  "emergency_disembarkation",
]);

export function modelPositionContextUsesPath(context) {
  return MODEL_PATH_POSITION_CONTEXTS.includes(context);
}
export const TABLE_GEOMETRY_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  sourceLocked: 2,
  terrainReviewed: 4,
  deploymentZonesReviewed: 8,
  objectivesReviewed: 16,
  mask: 31,
});
export const TABLE_GEOMETRY_CONSTANTS = Object.freeze({
  widthThousandths: 60_000,
  heightThousandths: 44_000,
  terrainOutlineCount: 12,
  terrainSectionCount: 12,
  sixByFourCount: 4,
  tenByFiveCount: 2,
  twelveBySixCount: 6,
});
export const TERRAIN_FOOTPRINT_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  sourceLocked: 2,
  placementReviewed: 4,
  groupingReviewed: 8,
  mask: 15,
});
export const MODEL_PLACEMENT_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  sourceLocked: 2,
  boundariesReviewed: 4,
  positionsReviewed: 8,
  noOverlapReviewed: 16,
  objectivesReviewed: 32,
  mask: 63,
});
export const MODEL_POSITION_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  sourceLocked: 2,
  boundariesReviewed: 4,
  positionsReviewed: 8,
  noOverlapReviewed: 16,
  objectivesReviewed: 32,
  pathsReviewed: 64,
  terrainReviewed: 128,
  coherencyReviewed: 256,
  engagementRangeReviewed: 512,
  mask: 1023,
});

export function modelPositionFlags(set, sourceLocked = true) {
  return (
    (set?.reviewedByPlayer ? MODEL_POSITION_FLAGS.reviewedByPlayer : 0) |
    (sourceLocked ? MODEL_POSITION_FLAGS.sourceLocked : 0) |
    (set?.measurementBoundariesReviewed ? MODEL_POSITION_FLAGS.boundariesReviewed : 0) |
    (set?.positionsReviewed ? MODEL_POSITION_FLAGS.positionsReviewed : 0) |
    (set?.noModelOverlapReviewed ? MODEL_POSITION_FLAGS.noOverlapReviewed : 0) |
    (set?.objectiveClearanceReviewed ? MODEL_POSITION_FLAGS.objectivesReviewed : 0) |
    (set?.pathsReviewed ? MODEL_POSITION_FLAGS.pathsReviewed : 0) |
    (set?.terrainClearanceReviewed ? MODEL_POSITION_FLAGS.terrainReviewed : 0) |
    (set?.coherencyReviewed ? MODEL_POSITION_FLAGS.coherencyReviewed : 0) |
    (set?.engagementRangeReviewed ? MODEL_POSITION_FLAGS.engagementRangeReviewed : 0)
  );
}

export function modelPlacementFlags(set, sourceLocked = true) {
  return (
    (set?.reviewedByPlayer ? MODEL_PLACEMENT_FLAGS.reviewedByPlayer : 0) |
    (sourceLocked ? MODEL_PLACEMENT_FLAGS.sourceLocked : 0) |
    (set?.measurementBoundariesReviewed ? MODEL_PLACEMENT_FLAGS.boundariesReviewed : 0) |
    (set?.positionsReviewed ? MODEL_PLACEMENT_FLAGS.positionsReviewed : 0) |
    (set?.noModelOverlapReviewed ? MODEL_PLACEMENT_FLAGS.noOverlapReviewed : 0) |
    (set?.objectiveClearanceReviewed ? MODEL_PLACEMENT_FLAGS.objectivesReviewed : 0)
  );
}

function modelPlacementExtents(model) {
  const halfWidth = model.widthThousandths / 2;
  const halfDepth = model.depthThousandths / 2;
  const angle = (model.rotationMilliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (model.shape === "rectangle") {
    return {
      x: Math.abs(halfWidth * cosine) + Math.abs(halfDepth * sine),
      y: Math.abs(halfWidth * sine) + Math.abs(halfDepth * cosine),
    };
  }
  return {
    x: Math.hypot(halfWidth * cosine, halfDepth * sine),
    y: Math.hypot(halfWidth * sine, halfDepth * cosine),
  };
}

export function modelPlacementSetFacts(set, expectedModelIds) {
  const models = Array.isArray(set?.models) ? set.models : [];
  const expected = new Set(Array.isArray(expectedModelIds) ? expectedModelIds : []);
  const positioned = models.filter(
    (model) =>
      Number.isSafeInteger(model?.centerXThousandths) &&
      Number.isSafeInteger(model?.centerYThousandths) &&
      Number.isSafeInteger(model?.elevationThousandths) &&
      model.elevationThousandths >= 0 &&
      model.elevationThousandths <= 24_000 &&
      Number.isSafeInteger(model?.rotationMilliDegrees) &&
      model.rotationMilliDegrees >= 0 &&
      model.rotationMilliDegrees < 180_000,
  );
  const dimensioned = models.filter(
    (model) =>
      Number.isSafeInteger(model?.widthThousandths) &&
      model.widthThousandths > 0 &&
      model.widthThousandths <= 30_000 &&
      Number.isSafeInteger(model?.depthThousandths) &&
      model.depthThousandths > 0 &&
      model.depthThousandths <= 30_000 &&
      (model.shape !== "circle" || model.widthThousandths === model.depthThousandths),
  );
  const supported = models.filter(
    (model) =>
      MODEL_FOOTPRINT_SHAPES.includes(model?.shape) &&
      MODEL_MEASUREMENT_BASES.includes(model?.measurementBasis),
  );
  const dimensionedIds = new Set(dimensioned.map((model) => model.modelId));
  const supportedIds = new Set(supported.map((model) => model.modelId));
  const inBounds = positioned.filter((model) => {
    if (!dimensionedIds.has(model.modelId) || !supportedIds.has(model.modelId)) return false;
    const extent = modelPlacementExtents(model);
    return (
      model.centerXThousandths - extent.x >= -0.001 &&
      model.centerXThousandths + extent.x <= TABLE_GEOMETRY_CONSTANTS.widthThousandths + 0.001 &&
      model.centerYThousandths - extent.y >= -0.001 &&
      model.centerYThousandths + extent.y <= TABLE_GEOMETRY_CONSTANTS.heightThousandths + 0.001
    );
  });
  return {
    expectedModelCount: expected.size,
    placementCount: models.length,
    uniqueModelCount: new Set(models.map((model) => model?.modelId)).size,
    recognizedModelCount: models.filter((model) => expected.has(model?.modelId)).length,
    positionedModelCount: positioned.length,
    inBoundsModelCount: inBounds.length,
    dimensionedModelCount: dimensioned.length,
    supportedShapeCount: supported.length,
    basedModelCount: models.filter((model) => model?.measurementBasis === "base").length,
    baselessModelCount: models.filter((model) => model?.measurementBasis === "model").length,
  };
}

export function modelPlacementSetIsValid(set, expectedModelIds, sourceLocked = true) {
  const facts = modelPlacementSetFacts(set, expectedModelIds);
  return Boolean(
    facts.expectedModelCount > 0 &&
      facts.expectedModelCount <= 1000 &&
      facts.placementCount === facts.expectedModelCount &&
      facts.uniqueModelCount === facts.placementCount &&
      facts.recognizedModelCount === facts.placementCount &&
      facts.positionedModelCount === facts.placementCount &&
      facts.inBoundsModelCount === facts.placementCount &&
      facts.dimensionedModelCount === facts.placementCount &&
      facts.supportedShapeCount === facts.placementCount &&
      facts.basedModelCount + facts.baselessModelCount === facts.placementCount &&
      modelPlacementFlags(set, sourceLocked) === MODEL_PLACEMENT_FLAGS.mask,
  );
}

function sameModelPosition(first, second) {
  return Boolean(
    first &&
      second &&
      first.centerXThousandths === second.centerXThousandths &&
      first.centerYThousandths === second.centerYThousandths &&
      first.elevationThousandths === second.elevationThousandths &&
      first.rotationMilliDegrees === second.rotationMilliDegrees,
  );
}

function sameModelFootprint(first, second) {
  return Boolean(
    first &&
      second &&
      first.measurementBasis === second.measurementBasis &&
      first.shape === second.shape &&
      first.widthThousandths === second.widthThousandths &&
      first.depthThousandths === second.depthThousandths &&
      first.verticalExtentThousandths === second.verticalExtentThousandths &&
      (!second.silhouette ||
        JSON.stringify(first.silhouette) === JSON.stringify(second.silhouette)),
  );
}

function modelPositionExpectedIds(formation, models) {
  const ids = new Set(models.map((model) => model?.modelId));
  return formation.segments.flatMap((segment) => {
    const selected = segment.modelIds.filter((modelId) => ids.has(modelId));
    return selected.length === formation.health[segment.id].modelsRemaining ? selected : [];
  });
}

export function modelPositionSetFacts(set, formation, previousSet = null) {
  const models = Array.isArray(set?.models) ? set.models : [];
  const expectedIds = modelPositionExpectedIds(formation, models);
  const placementFacts = modelPlacementSetFacts({ models }, expectedIds);
  const previousById = new Map(
    (Array.isArray(previousSet?.models) ? previousSet.models : []).map((model) => [
      model.modelId,
      model,
    ]),
  );
  const movement = modelPositionContextUsesPath(set?.context);
  const paths = models.filter(
    (model) =>
      Array.isArray(model?.path) &&
      model.path.length >= (movement ? 2 : 1) &&
      model.path.length <= 64,
  );
  const pathEndpoints = paths.filter((model) => sameModelPosition(model.path.at(-1), model));
  const pathStarts = paths.filter(
    (model) =>
      !movement ||
      set?.reconcilesStaleStart ||
      sameModelPosition(model.path[0], previousById.get(model.modelId)),
  );
  const matchedFootprints = models.filter(
    (model) => !movement || sameModelFootprint(model, previousById.get(model.modelId)),
  );
  const pathsInBounds = paths.filter((model) =>
    model.path.every((point) => {
      const extent = modelPlacementExtents({ ...model, ...point });
      return (
        point.centerXThousandths - extent.x >= -0.001 &&
        point.centerXThousandths + extent.x <= TABLE_GEOMETRY_CONSTANTS.widthThousandths + 0.001 &&
        point.centerYThousandths - extent.y >= -0.001 &&
        point.centerYThousandths + extent.y <= TABLE_GEOMETRY_CONSTANTS.heightThousandths + 0.001
      );
    }),
  );
  const distances = models.filter(
    (model) =>
      Number.isSafeInteger(model?.distanceMovedThousandths) &&
      model.distanceMovedThousandths >= 0 &&
      model.distanceMovedThousandths <= 120_000 &&
      Number.isSafeInteger(model?.maximumDistanceThousandths) &&
      model.maximumDistanceThousandths >= 0 &&
      model.maximumDistanceThousandths <= 120_000 &&
      model.distanceMovedThousandths <= model.maximumDistanceThousandths,
  );
  const distancesCoverPaths = paths.filter((model) => {
    const minimum = model.path.slice(1).reduce((total, point, index) => {
      const previous = model.path[index];
      return (
        total +
        Math.hypot(
          point.centerXThousandths - previous.centerXThousandths,
          point.centerYThousandths - previous.centerYThousandths,
          point.elevationThousandths - previous.elevationThousandths,
        )
      );
    }, 0);
    return model.distanceMovedThousandths + 0.001 >= minimum;
  });
  return {
    ...placementFacts,
    liveModelCount: formation.segments.reduce(
      (total, segment) => total + formation.health[segment.id].modelsRemaining,
      0,
    ),
    liveSegmentCount: formation.segments.filter(
      (segment) => formation.health[segment.id].modelsRemaining > 0,
    ).length,
    matchedLiveSegmentCount: formation.segments.filter((segment) => {
      const selected = models.filter((model) => segment.modelIds.includes(model.modelId)).length;
      return selected === formation.health[segment.id].modelsRemaining;
    }).length,
    pathModelCount: paths.length,
    pathStartCount: pathStarts.length,
    pathEndpointCount: pathEndpoints.length,
    pathInBoundsCount: pathsInBounds.length,
    footprintMatchCount: matchedFootprints.length,
    distanceWithinLimitCount: distances.length,
    distanceCoversPathCount: distancesCoverPaths.length,
  };
}

export function modelPositionSetIsValid(set, formation, previousSet = null, sourceLocked = true) {
  const facts = modelPositionSetFacts(set, formation, previousSet);
  return Boolean(
    facts.liveModelCount > 0 &&
      facts.liveModelCount <= 1000 &&
      facts.expectedModelCount === facts.liveModelCount &&
      facts.placementCount === facts.liveModelCount &&
      facts.uniqueModelCount === facts.placementCount &&
      facts.recognizedModelCount === facts.placementCount &&
      facts.positionedModelCount === facts.placementCount &&
      facts.inBoundsModelCount === facts.placementCount &&
      facts.dimensionedModelCount === facts.placementCount &&
      facts.supportedShapeCount === facts.placementCount &&
      facts.basedModelCount + facts.baselessModelCount === facts.placementCount &&
      facts.matchedLiveSegmentCount === formation.segments.length &&
      facts.pathModelCount === facts.placementCount &&
      facts.pathStartCount === facts.placementCount &&
      facts.pathEndpointCount === facts.placementCount &&
      facts.pathInBoundsCount === facts.placementCount &&
      facts.footprintMatchCount === facts.placementCount &&
      facts.distanceWithinLimitCount === facts.placementCount &&
      facts.distanceCoversPathCount === facts.placementCount &&
      modelPositionFlags(set, sourceLocked) === MODEL_POSITION_FLAGS.mask,
  );
}

export function terrainFootprintFlags(set, sourceLocked = true) {
  return (
    (set?.reviewedByPlayer ? TERRAIN_FOOTPRINT_FLAGS.reviewedByPlayer : 0) |
    (sourceLocked ? TERRAIN_FOOTPRINT_FLAGS.sourceLocked : 0) |
    (set?.placementReviewed ? TERRAIN_FOOTPRINT_FLAGS.placementReviewed : 0) |
    (set?.sectionGroupingReviewed ? TERRAIN_FOOTPRINT_FLAGS.groupingReviewed : 0)
  );
}

export function terrainFootprintCorners(footprint) {
  const angle = (footprint.rotationMilliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = footprint.widthThousandths / 2;
  const halfHeight = footprint.heightThousandths / 2;
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => ({
    xThousandths: footprint.centerXThousandths + x * cosine - y * sine,
    yThousandths: footprint.centerYThousandths + x * sine + y * cosine,
  }));
}

function terrainFootprintsOverlap(first, second) {
  const firstCorners = terrainFootprintCorners(first);
  const secondCorners = terrainFootprintCorners(second);
  const axes = [firstCorners, secondCorners].flatMap((corners) =>
    [0, 1].map((index) => {
      const next = corners[(index + 1) % corners.length];
      const current = corners[index];
      return {
        x: -(next.yThousandths - current.yThousandths),
        y: next.xThousandths - current.xThousandths,
      };
    }),
  );
  return axes.every((axis) => {
    const project = (corner) => corner.xThousandths * axis.x + corner.yThousandths * axis.y;
    const firstProjection = firstCorners.map(project);
    const secondProjection = secondCorners.map(project);
    return (
      Math.max(...firstProjection) > Math.min(...secondProjection) + 0.001 &&
      Math.max(...secondProjection) > Math.min(...firstProjection) + 0.001
    );
  });
}

export function terrainFootprintSetFacts(set) {
  const footprints = Array.isArray(set?.footprints) ? set.footprints : [];
  const positioned = footprints.filter(
    (footprint) =>
      Number.isSafeInteger(footprint?.centerXThousandths) &&
      Number.isSafeInteger(footprint?.centerYThousandths) &&
      Number.isSafeInteger(footprint?.rotationMilliDegrees) &&
      footprint.rotationMilliDegrees >= 0 &&
      footprint.rotationMilliDegrees < 180_000,
  );
  const inBounds = positioned.filter((footprint) =>
    terrainFootprintCorners(footprint).every(
      (corner) =>
        corner.xThousandths >= -0.001 &&
        corner.xThousandths <= TABLE_GEOMETRY_CONSTANTS.widthThousandths + 0.001 &&
        corner.yThousandths >= -0.001 &&
        corner.yThousandths <= TABLE_GEOMETRY_CONSTANTS.heightThousandths + 0.001,
    ),
  );
  const sizeCount = (width, height) =>
    footprints.filter(
      (footprint) =>
        footprint?.widthThousandths === width && footprint?.heightThousandths === height,
    ).length;
  let overlapPairCount = 0;
  for (let first = 0; first < positioned.length; first += 1) {
    for (let second = first + 1; second < positioned.length; second += 1) {
      if (terrainFootprintsOverlap(positioned[first], positioned[second])) overlapPairCount += 1;
    }
  }
  return {
    footprintCount: footprints.length,
    positionedFootprintCount: positioned.length,
    uniqueFootprintCount: new Set(footprints.map((footprint) => footprint?.id)).size,
    inBoundsFootprintCount: inBounds.length,
    groupedFootprintCount: footprints.filter(
      (footprint) =>
        typeof footprint?.areaTerrainSectionId === "string" &&
        footprint.areaTerrainSectionId.trim().length > 0,
    ).length,
    overlapPairCount,
    sixByFourCount: sizeCount(6_000, 4_000),
    tenByFiveCount: sizeCount(10_000, 5_000),
    twelveBySixCount: sizeCount(12_000, 6_000),
  };
}

export function terrainFootprintSetIsValid(set, sourceLocked = true) {
  const facts = terrainFootprintSetFacts(set);
  return Boolean(
    facts.footprintCount === TABLE_GEOMETRY_CONSTANTS.terrainOutlineCount &&
      facts.positionedFootprintCount === facts.footprintCount &&
      facts.uniqueFootprintCount === facts.footprintCount &&
      facts.inBoundsFootprintCount === facts.footprintCount &&
      facts.groupedFootprintCount === facts.footprintCount &&
      facts.overlapPairCount === 0 &&
      facts.sixByFourCount === TABLE_GEOMETRY_CONSTANTS.sixByFourCount &&
      facts.tenByFiveCount === TABLE_GEOMETRY_CONSTANTS.tenByFiveCount &&
      facts.twelveBySixCount === TABLE_GEOMETRY_CONSTANTS.twelveBySixCount &&
      terrainFootprintFlags(set, sourceLocked) === TERRAIN_FOOTPRINT_FLAGS.mask,
  );
}

export function tableGeometryFlags(geometry, sourceLocked = true) {
  return (
    (geometry?.reviewedByPlayer ? TABLE_GEOMETRY_FLAGS.reviewedByPlayer : 0) |
    (sourceLocked ? TABLE_GEOMETRY_FLAGS.sourceLocked : 0) |
    (geometry?.terrainLayoutReviewed ? TABLE_GEOMETRY_FLAGS.terrainReviewed : 0) |
    (geometry?.deploymentZonesReviewed ? TABLE_GEOMETRY_FLAGS.deploymentZonesReviewed : 0) |
    (geometry?.objectivePositionsReviewed ? TABLE_GEOMETRY_FLAGS.objectivesReviewed : 0)
  );
}

export function tableGeometryIsValid(geometry, sourceLocked = true) {
  const profile = geometry?.terrainProfile;
  const objectiveCount = Array.isArray(geometry?.objectivePositions)
    ? geometry.objectivePositions.length
    : 0;
  const positionedObjectiveCount = Array.isArray(geometry?.objectivePositions)
    ? geometry.objectivePositions.filter(
        (objective) =>
          Number.isSafeInteger(objective?.xThousandths) &&
          objective.xThousandths >= 0 &&
          objective.xThousandths <= TABLE_GEOMETRY_CONSTANTS.widthThousandths &&
          Number.isSafeInteger(objective?.yThousandths) &&
          objective.yThousandths >= 0 &&
          objective.yThousandths <= TABLE_GEOMETRY_CONSTANTS.heightThousandths,
      ).length
    : 0;
  const uniquePositionCount = Array.isArray(geometry?.objectivePositions)
    ? new Set(
        geometry.objectivePositions.map(
          (objective) => `${objective?.xThousandths}:${objective?.yThousandths}`,
        ),
      ).size
    : 0;
  return Boolean(
    geometry?.battlefieldWidthThousandths === TABLE_GEOMETRY_CONSTANTS.widthThousandths &&
      geometry?.battlefieldHeightThousandths === TABLE_GEOMETRY_CONSTANTS.heightThousandths &&
      objectiveCount >= 1 &&
      objectiveCount <= 12 &&
      positionedObjectiveCount === objectiveCount &&
      uniquePositionCount === objectiveCount &&
      profile?.sectionCount === TABLE_GEOMETRY_CONSTANTS.terrainSectionCount &&
      profile?.sixByFourCount === TABLE_GEOMETRY_CONSTANTS.sixByFourCount &&
      profile?.tenByFiveCount === TABLE_GEOMETRY_CONSTANTS.tenByFiveCount &&
      profile?.twelveBySixCount === TABLE_GEOMETRY_CONSTANTS.twelveBySixCount &&
      profile.sixByFourCount + profile.tenByFiveCount + profile.twelveBySixCount ===
        profile.sectionCount &&
      tableGeometryFlags(geometry, sourceLocked) === TABLE_GEOMETRY_FLAGS.mask,
  );
}

function battleRuleCoverageRequiresTableGeometry(ruleCoverage) {
  return Boolean(
    ruleCoverage?.report.permitted &&
      ruleCoverage.plan.mission.sourceId.startsWith("chapter-approved-2025-26-v1.4-") &&
      ruleCoverage.plan.terrain.sourceId.startsWith("chapter-approved-2025-26-v1.4-layout-"),
  );
}
export const FIRE_OVERWATCH_TRIGGERS = Object.freeze([
  "set_up",
  "normal_move_start",
  "normal_move_end",
  "advance_start",
  "advance_end",
  "fall_back_start",
  "fall_back_end",
  "charge_declared",
]);

export const FIRE_OVERWATCH_FLAGS = Object.freeze({
  targetVisible: 1,
  eligibleToShoot: 2,
  nonTitanic: 4,
  outOfPhaseRestrictions: 8,
  hitsOnUnmodifiedSix: 16,
  criticalHitsOnSix: 32,
});

export const HAZARDOUS_FLAGS = Object.freeze({
  selectedBearer: 1,
  selectionPriority: 2,
  mask: 3,
});

export const GO_TO_GROUND_FLAGS = Object.freeze({
  targetSelected: 1,
  targetInfantry: 2,
  respondingPlayer: 4,
  sixPlusInvulnerable: 8,
  benefitOfCover: 16,
  mask: 31,
});

export const COUNTER_OFFENSIVE_FLAGS = Object.freeze({
  enemyJustFought: 1,
  targetInEngagementRange: 2,
  targetNotFought: 4,
  respondingPlayer: 8,
  fightsNext: 16,
  mask: 31,
});

export const SMOKESCREEN_FLAGS = Object.freeze({
  targetSelected: 1,
  targetSmoke: 2,
  respondingPlayer: 4,
  benefitOfCover: 8,
  stealth: 16,
  mask: 31,
});

export const RAPID_INGRESS_FLAGS = Object.freeze({
  targetInReserves: 1,
  respondingPlayer: 2,
  arrivesAsReinforcements: 4,
  placementLegal: 8,
  passengersRemainEmbarked: 16,
  mask: 31,
});

export const RAPID_INGRESS_PLACEMENT_METHODS = Object.freeze([
  "deep_strike",
  "strategic_reserves",
  "source_rule",
]);

export function rapidIngressIsValid(
  phase,
  step,
  battleRound,
  earliestBattleRound,
  commandPointsBefore,
  commandPointCost,
  commandPointsAfter,
  alreadyUsed,
  targetBattleShocked,
  firstRoundOutOfPhaseAllowed,
  flags,
) {
  return Boolean(
    phase === "movement" &&
      step === "end" &&
      Number.isSafeInteger(battleRound) &&
      battleRound >= 1 &&
      battleRound <= 5 &&
      Number.isSafeInteger(earliestBattleRound) &&
      earliestBattleRound >= 1 &&
      earliestBattleRound <= 5 &&
      battleRound >= earliestBattleRound &&
      (battleRound !== 1 || firstRoundOutOfPhaseAllowed) &&
      Number.isSafeInteger(commandPointsBefore) &&
      commandPointsBefore >= 1 &&
      commandPointsBefore <= 100_000 &&
      commandPointCost === 1 &&
      commandPointsAfter === commandPointsBefore - commandPointCost &&
      !alreadyUsed &&
      !targetBattleShocked &&
      flags === RAPID_INGRESS_FLAGS.mask,
  );
}

export const RANGED_DECLARATION_FLAGS = Object.freeze({
  sameActivation: 1,
  beforeAttacks: 2,
  allEligible: 4,
  weaponCountsValid: 8,
  targetsContiguous: 16,
  profilesContiguous: 32,
  mask: 63,
});

export const RANGED_GEOMETRY_FLAGS = Object.freeze({
  directVisible: 1,
  indirectFire: 2,
  weaponHasIndirect: 4,
  visibilityProof: 8,
  visibilityOverride: 16,
  fullyVisible: 32,
  fullVisibilityProof: 64,
  fullVisibilityOverride: 128,
  reviewedByPlayer: 256,
  mask: 511,
});

export function rangedDeclarationIsValid(
  declarationCount,
  uniqueDeclarationCount,
  targetRunCount,
  uniqueTargetCount,
  profileRunCount,
  uniqueTargetProfileCount,
  flags,
) {
  return Boolean(
    Number.isSafeInteger(declarationCount) &&
      declarationCount >= 1 &&
      declarationCount <= 256 &&
      uniqueDeclarationCount === declarationCount &&
      targetRunCount === uniqueTargetCount &&
      uniqueTargetCount >= 1 &&
      uniqueTargetCount <= declarationCount &&
      profileRunCount === uniqueTargetProfileCount &&
      uniqueTargetProfileCount >= uniqueTargetCount &&
      uniqueTargetProfileCount <= declarationCount &&
      flags === RANGED_DECLARATION_FLAGS.mask,
  );
}

export function transportLoadIsValid(
  usedCapacity,
  capacity,
  allowanceModels,
  allowanceMaximum,
  modeCount,
) {
  return Boolean(
    Number.isSafeInteger(usedCapacity) &&
      usedCapacity >= 0 &&
      Number.isSafeInteger(capacity) &&
      capacity > 0 &&
      usedCapacity <= capacity &&
      Number.isSafeInteger(allowanceModels) &&
      allowanceModels >= 0 &&
      Number.isSafeInteger(allowanceMaximum) &&
      allowanceMaximum >= 0 &&
      Number.isSafeInteger(modeCount) &&
      modeCount >= 0 &&
      modeCount <= 1 &&
      ((allowanceMaximum === 0 && allowanceModels === 0) ||
        (allowanceMaximum > 0 && allowanceModels <= allowanceMaximum)),
  );
}

const DEPLOYMENT_ROOT_LOCATION = Object.freeze({
  not_deployed: 0,
  battlefield: 1,
  reserves: 2,
  strategic_reserves: 3,
});

const AIRCRAFT_MODE = Object.freeze({
  "": 0,
  aircraft: 1,
  hover: 2,
});

export function transportDeploymentChainIsValid(
  chainLength,
  uniqueFormationCount,
  rootLocation,
  reserveEligibilityCount,
) {
  return Boolean(
    Number.isSafeInteger(chainLength) &&
      chainLength >= 1 &&
      chainLength <= 257 &&
      uniqueFormationCount === chainLength &&
      Number.isSafeInteger(rootLocation) &&
      rootLocation >= DEPLOYMENT_ROOT_LOCATION.not_deployed &&
      rootLocation <= DEPLOYMENT_ROOT_LOCATION.strategic_reserves &&
      Number.isSafeInteger(reserveEligibilityCount) &&
      reserveEligibilityCount >= 0 &&
      reserveEligibilityCount <= chainLength &&
      ((rootLocation === DEPLOYMENT_ROOT_LOCATION.not_deployed && reserveEligibilityCount === 0) ||
        rootLocation === DEPLOYMENT_ROOT_LOCATION.battlefield ||
        reserveEligibilityCount === chainLength),
  );
}

export function initialDeploymentIsValid(
  isDedicatedTransport,
  startingPassengerCount,
  isAircraft,
  hasHover,
  aircraftMode,
  rootLocation,
) {
  if (
    ![isDedicatedTransport, isAircraft, hasHover].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1,
    ) ||
    !Number.isSafeInteger(startingPassengerCount) ||
    startingPassengerCount < 0 ||
    !Number.isSafeInteger(aircraftMode) ||
    aircraftMode < AIRCRAFT_MODE[""] ||
    aircraftMode > AIRCRAFT_MODE.hover ||
    !Number.isSafeInteger(rootLocation) ||
    rootLocation < DEPLOYMENT_ROOT_LOCATION.not_deployed ||
    rootLocation > DEPLOYMENT_ROOT_LOCATION.strategic_reserves
  ) {
    return false;
  }
  const modeIsValid =
    (!isAircraft && aircraftMode === AIRCRAFT_MODE[""]) ||
    (Boolean(isAircraft) &&
      (aircraftMode === AIRCRAFT_MODE.aircraft ||
        (aircraftMode === AIRCRAFT_MODE.hover && Boolean(hasHover))));
  if (!modeIsValid) return false;
  if (isDedicatedTransport && startingPassengerCount === 0) {
    return rootLocation === DEPLOYMENT_ROOT_LOCATION.not_deployed;
  }
  if (rootLocation === DEPLOYMENT_ROOT_LOCATION.not_deployed) return false;
  if (!isAircraft) return true;
  if (aircraftMode === AIRCRAFT_MODE.aircraft) {
    return rootLocation === DEPLOYMENT_ROOT_LOCATION.reserves;
  }
  return (
    rootLocation === DEPLOYMENT_ROOT_LOCATION.battlefield ||
    rootLocation === DEPLOYMENT_ROOT_LOCATION.strategic_reserves
  );
}

function canonicalRangedDeclarations(declarations) {
  const targetOrder = [...new Set(declarations.map((entry) => entry.targetFormationId))];
  return targetOrder.flatMap((targetFormationId) => {
    const targetDeclarations = declarations.filter(
      (entry) => entry.targetFormationId === targetFormationId,
    );
    const profileOrder = [...new Set(targetDeclarations.map((entry) => entry.weaponId))];
    return profileOrder.flatMap((weaponId) =>
      targetDeclarations.filter((entry) => entry.weaponId === weaponId),
    );
  });
}

function rangedDeclarationStructure(declarations) {
  const targetRuns = [];
  const profileRuns = [];
  for (const declaration of declarations) {
    if (targetRuns.at(-1) !== declaration.targetFormationId) {
      targetRuns.push(declaration.targetFormationId);
    }
    const profileKey = `${declaration.targetFormationId}:${declaration.weaponId}`;
    if (profileRuns.at(-1) !== profileKey) profileRuns.push(profileKey);
  }
  return {
    declarationCount: declarations.length,
    uniqueDeclarationCount: new Set(declarations.map((entry) => entry.id)).size,
    targetRunCount: targetRuns.length,
    uniqueTargetCount: new Set(declarations.map((entry) => entry.targetFormationId)).size,
    profileRunCount: profileRuns.length,
    uniqueTargetProfileCount: new Set(
      declarations.map((entry) => `${entry.targetFormationId}:${entry.weaponId}`),
    ).size,
  };
}

function normalizeSnapshotJson(value, name, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 4096 || depth > 8) throw new Error(`${name} is too complex`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 1000) throw new Error(`${name} contains an oversized string`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
      throw new Error(`${name} contains an invalid number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error(`${name} contains an oversized array`);
    return value.map((entry, index) =>
      normalizeSnapshotJson(entry, `${name}[${index}]`, depth + 1, budget),
    );
  }
  if (!value || typeof value !== "object") throw new Error(`${name} must contain JSON values`);
  const entries = Object.entries(value);
  if (entries.length > 256) throw new Error(`${name} contains too many fields`);
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (!key || key.length > 100) throw new Error(`${name} contains an invalid field name`);
      return [key, normalizeSnapshotJson(entry, `${name}.${key}`, depth + 1, budget)];
    }),
  );
}

function normalizeRangedAttackSnapshot(value) {
  const snapshot = normalizeSnapshotJson(value, "Ranged attack snapshot");
  record(snapshot, "Ranged attack snapshot must be an object");
  if (
    !Array.isArray(snapshot.attackProfiles) ||
    snapshot.attackProfiles.length < 1 ||
    snapshot.attackProfiles.length > 32 ||
    !snapshot.attackProfiles.every(
      (profile) => profile && typeof profile === "object" && !Array.isArray(profile),
    )
  ) {
    throw new Error("Ranged attack snapshot must contain 1 to 32 attack profiles");
  }
  if (
    !Array.isArray(snapshot.targets) ||
    snapshot.targets.length < 1 ||
    snapshot.targets.length > 64 ||
    !snapshot.targets.every(
      (target) =>
        target &&
        typeof target === "object" &&
        !Array.isArray(target) &&
        Number.isSafeInteger(target.modelCount) &&
        target.modelCount >= 1,
    )
  ) {
    throw new Error("Ranged attack snapshot must contain 1 to 16 target segments");
  }
  if (
    !Array.isArray(snapshot.segmentIds) ||
    snapshot.segmentIds.length !== snapshot.targets.length ||
    snapshot.segmentIds.some((id) => typeof id !== "string" || !id || id.length > 100) ||
    (snapshot.targetModelIds === undefined &&
      new Set(snapshot.segmentIds).size !== snapshot.segmentIds.length) ||
    (snapshot.targetModelIds !== undefined &&
      (!Array.isArray(snapshot.targetModelIds) ||
        snapshot.targetModelIds.length !== snapshot.targets.length ||
        snapshot.targetModelIds.some((id) => typeof id !== "string" || !id || id.length > 200) ||
        new Set(snapshot.targetModelIds).size !== snapshot.targetModelIds.length))
  ) {
    throw new Error("Ranged attack snapshot model and segment ids must match its targets");
  }
  nonnegativeInteger(snapshot.initialWoundsLost, "Ranged snapshot initial wounds", 1024);
  const summary = record(snapshot.summary, "Ranged attack snapshot summary must be an object");
  boundedString(summary.attacker, "Ranged snapshot attacker", 200);
  boundedString(summary.weapon, "Ranged snapshot weapon", 200);
  boundedString(summary.target, "Ranged snapshot target", 200);
  return snapshot;
}

function normalizeRangedGeometryDecision(value) {
  const decision = record(value, "Ranged geometry decision must be an object");
  const modelIds = (candidate, name, maximum = 1000, unique = true) => {
    if (
      !Array.isArray(candidate) ||
      candidate.length < 1 ||
      candidate.length > maximum ||
      candidate.some((id) => typeof id !== "string" || !id || id.length > 200) ||
      (unique && new Set(candidate).size !== candidate.length)
    ) {
      throw new Error(`${name} must contain valid model ids`);
    }
    return [...candidate];
  };
  const normalized = {
    observerModelIds: modelIds(decision.observerModelIds, "Ranged geometry observers"),
    declaredBearerModelIds: modelIds(
      decision.declaredBearerModelIds,
      "Ranged geometry declared bearers",
      1000,
      false,
    ),
    provenObserverModelIds:
      Array.isArray(decision.provenObserverModelIds) && decision.provenObserverModelIds.length > 0
        ? modelIds(decision.provenObserverModelIds, "Ranged geometry proven observers", 1000)
        : [],
    targetModelIds: modelIds(decision.targetModelIds, "Ranged geometry target models"),
    visibilityResolution: boundedString(
      decision.visibilityResolution,
      "Ranged visibility resolution",
      30,
    ),
    fullVisibilityResolution: boundedString(
      decision.fullVisibilityResolution,
      "Ranged full visibility resolution",
      30,
    ),
    visibilityOverrideReason: decision.visibilityOverrideReason
      ? boundedString(decision.visibilityOverrideReason, "Ranged visibility override", 300).trim()
      : "",
    fullVisibilityOverrideReason: decision.fullVisibilityOverrideReason
      ? boundedString(
          decision.fullVisibilityOverrideReason,
          "Ranged full visibility override",
          300,
        ).trim()
      : "",
    coverOverrideReason: decision.coverOverrideReason
      ? boundedString(decision.coverOverrideReason, "Ranged cover override", 300).trim()
      : "",
    flags: nonnegativeInteger(decision.flags, "Ranged geometry flags", 511),
  };
  if (
    !["geometry_proof", "player_override", "indirect_fire"].includes(
      normalized.visibilityResolution,
    ) ||
    !["geometry_proof", "player_override", "not_fully_visible"].includes(
      normalized.fullVisibilityResolution,
    ) ||
    !Array.isArray(decision.cover) ||
    decision.cover.length !== normalized.targetModelIds.length
  ) {
    throw new Error("Ranged geometry decision has unsupported resolutions");
  }
  normalized.cover = decision.cover.map((entry, index) => {
    const item = record(entry, "Ranged cover decision must be an object");
    const modelId = boundedString(item.modelId, "Ranged cover model id", 200);
    const resolution = boundedString(item.resolution, "Ranged cover resolution", 30);
    if (
      modelId !== normalized.targetModelIds[index] ||
      !["geometry_proof", "player_override"].includes(resolution)
    ) {
      throw new Error("Ranged cover decisions must match the target model order");
    }
    return { modelId, benefitOfCover: Boolean(item.benefitOfCover), resolution };
  });
  return normalized;
}

export function goToGroundIsValid(
  phase,
  commandPointsBefore,
  commandPointCost,
  commandPointsAfter,
  alreadyUsed,
  targetBattleShocked,
  flags,
) {
  return Boolean(
    phase === "shooting" &&
      Number.isSafeInteger(commandPointsBefore) &&
      commandPointsBefore >= 1 &&
      commandPointsBefore <= 100_000 &&
      commandPointCost === 1 &&
      commandPointsAfter === commandPointsBefore - commandPointCost &&
      !alreadyUsed &&
      !targetBattleShocked &&
      flags === GO_TO_GROUND_FLAGS.mask,
  );
}

export function goToGroundFlags(event, targetIsInfantry, respondingPlayer) {
  return (
    GO_TO_GROUND_FLAGS.targetSelected |
    (targetIsInfantry ? GO_TO_GROUND_FLAGS.targetInfantry : 0) |
    (respondingPlayer ? GO_TO_GROUND_FLAGS.respondingPlayer : 0) |
    (event.allModelsHaveSixPlusInvulnerable ? GO_TO_GROUND_FLAGS.sixPlusInvulnerable : 0) |
    (event.allModelsHaveBenefitOfCover ? GO_TO_GROUND_FLAGS.benefitOfCover : 0)
  );
}

export function counterOffensiveIsValid(
  phase,
  commandPointsBefore,
  commandPointCost,
  commandPointsAfter,
  alreadyUsed,
  targetBattleShocked,
  flags,
) {
  return Boolean(
    phase === "fight" &&
      Number.isSafeInteger(commandPointsBefore) &&
      commandPointsBefore >= 2 &&
      commandPointsBefore <= 100_000 &&
      commandPointCost === 2 &&
      commandPointsAfter === commandPointsBefore - commandPointCost &&
      !alreadyUsed &&
      !targetBattleShocked &&
      flags === COUNTER_OFFENSIVE_FLAGS.mask,
  );
}

export function counterOffensiveFlags(event, targetNotFought, respondingPlayer) {
  return (
    COUNTER_OFFENSIVE_FLAGS.enemyJustFought |
    (event.targetInEngagementRange ? COUNTER_OFFENSIVE_FLAGS.targetInEngagementRange : 0) |
    (targetNotFought ? COUNTER_OFFENSIVE_FLAGS.targetNotFought : 0) |
    (respondingPlayer ? COUNTER_OFFENSIVE_FLAGS.respondingPlayer : 0) |
    (event.fightsNextConfirmed ? COUNTER_OFFENSIVE_FLAGS.fightsNext : 0)
  );
}

export function smokescreenIsValid(
  phase,
  commandPointsBefore,
  commandPointCost,
  commandPointsAfter,
  alreadyUsed,
  targetBattleShocked,
  flags,
) {
  return Boolean(
    phase === "shooting" &&
      Number.isSafeInteger(commandPointsBefore) &&
      commandPointsBefore >= 1 &&
      commandPointsBefore <= 100_000 &&
      commandPointCost === 1 &&
      commandPointsAfter === commandPointsBefore - commandPointCost &&
      !alreadyUsed &&
      !targetBattleShocked &&
      flags === SMOKESCREEN_FLAGS.mask,
  );
}

export function smokescreenFlags(event, targetIsSmoke, respondingPlayer) {
  return (
    SMOKESCREEN_FLAGS.targetSelected |
    (targetIsSmoke ? SMOKESCREEN_FLAGS.targetSmoke : 0) |
    (respondingPlayer ? SMOKESCREEN_FLAGS.respondingPlayer : 0) |
    (event.allModelsHaveBenefitOfCover ? SMOKESCREEN_FLAGS.benefitOfCover : 0) |
    (event.allModelsHaveStealth ? SMOKESCREEN_FLAGS.stealth : 0)
  );
}

export function rapidIngressPlacementIsLegal(event, deployment) {
  if (!event.placementConfirmed) return false;
  if (event.placementMethod === "deep_strike") {
    return Boolean(event.allModelsHaveDeepStrike && event.moreThanNineFromEnemyModels);
  }
  if (event.placementMethod === "strategic_reserves") {
    if (deployment?.location !== "strategic_reserves" || !event.moreThanNineFromEnemyModels) {
      return false;
    }
    const normalEdgePlacement =
      event.whollyWithinSixOfBattlefieldEdge &&
      (event.clock.battleRound >= 3 || event.outsideEnemyDeploymentZone);
    const largeModelException = event.largeModelEdgeException && event.touchingOwnBattlefieldEdge;
    return normalEdgePlacement || largeModelException;
  }
  return Boolean(
    event.placementMethod === "source_rule" &&
      deployment?.location === "reserves" &&
      event.sourceRulePlacementConfirmed,
  );
}

export function rapidIngressFlags(event, targetInReserves, respondingPlayer, placementLegal) {
  return (
    (targetInReserves ? RAPID_INGRESS_FLAGS.targetInReserves : 0) |
    (respondingPlayer ? RAPID_INGRESS_FLAGS.respondingPlayer : 0) |
    (event.arrivesAsReinforcements ? RAPID_INGRESS_FLAGS.arrivesAsReinforcements : 0) |
    (placementLegal ? RAPID_INGRESS_FLAGS.placementLegal : 0) |
    (event.passengersRemainEmbarked ? RAPID_INGRESS_FLAGS.passengersRemainEmbarked : 0)
  );
}

export function hazardousResolutionIsValid(
  initialRoll,
  reroll,
  rerollExplained,
  remainingWounds,
  feelNoPain,
  feelNoPainRollCount,
  ignoredWounds,
  appliedDamage,
  modelDestroyed,
  flags,
) {
  const finalRoll = reroll === 0 ? initialRoll : reroll;
  if (
    initialRoll < 1 ||
    initialRoll > 6 ||
    reroll < 0 ||
    reroll > 6 ||
    (reroll !== 0 && !rerollExplained) ||
    finalRoll !== 1 ||
    remainingWounds < 1 ||
    remainingWounds > 1024 ||
    (feelNoPain !== 0 && (feelNoPain < 2 || feelNoPain > 6)) ||
    flags !== HAZARDOUS_FLAGS.mask
  ) {
    return false;
  }
  if (feelNoPain === 0) {
    if (
      feelNoPainRollCount !== 0 ||
      ignoredWounds !== 0 ||
      appliedDamage !== Math.min(3, remainingWounds)
    ) {
      return false;
    }
  } else if (
    feelNoPainRollCount < 1 ||
    feelNoPainRollCount > 3 ||
    ignoredWounds > feelNoPainRollCount ||
    appliedDamage !== feelNoPainRollCount - ignoredWounds ||
    (appliedDamage !== remainingWounds &&
      (appliedDamage >= remainingWounds || feelNoPainRollCount !== 3))
  ) {
    return false;
  }
  return modelDestroyed ? appliedDamage === remainingWounds : appliedDamage < remainingWounds;
}

export function fireOverwatchFlags(event) {
  return (
    (event.targetVisible ? FIRE_OVERWATCH_FLAGS.targetVisible : 0) |
    (event.shootingEligibilityConfirmed ? FIRE_OVERWATCH_FLAGS.eligibleToShoot : 0) |
    (event.titanicRestrictionSatisfied ? FIRE_OVERWATCH_FLAGS.nonTitanic : 0) |
    (event.outOfPhaseRestrictionsConfirmed ? FIRE_OVERWATCH_FLAGS.outOfPhaseRestrictions : 0) |
    (event.hitsOnUnmodifiedSixConfirmed ? FIRE_OVERWATCH_FLAGS.hitsOnUnmodifiedSix : 0) |
    (event.criticalHitsOnSixConfirmed ? FIRE_OVERWATCH_FLAGS.criticalHitsOnSix : 0)
  );
}

export function fireOverwatchIsValid(trigger, phase, distanceThousandths, flags) {
  const triggerIndex = FIRE_OVERWATCH_TRIGGERS.indexOf(trigger) + 1;
  if (
    triggerIndex < 1 ||
    !["movement", "charge"].includes(phase) ||
    !Number.isSafeInteger(distanceThousandths) ||
    distanceThousandths < 1 ||
    distanceThousandths > 24_000 ||
    flags !== 63
  ) {
    return false;
  }
  if (trigger === "set_up") return true;
  if (trigger === "charge_declared") return phase === "charge";
  return phase === "movement";
}

export function rangedTargetEligibilityIsValid(fact, declaredWeaponCount) {
  return Boolean(
    fact &&
      Number.isSafeInteger(fact.publishedRangeThousandths) &&
      fact.publishedRangeThousandths > 0 &&
      Number.isSafeInteger(fact.effectiveRangeThousandths) &&
      fact.effectiveRangeThousandths > 0 &&
      Number.isSafeInteger(fact.measuredDistanceThousandths) &&
      fact.measuredDistanceThousandths > 0 &&
      fact.measuredDistanceThousandths <= fact.effectiveRangeThousandths &&
      Number.isSafeInteger(fact.eligibleWeaponCount) &&
      Number.isSafeInteger(declaredWeaponCount) &&
      declaredWeaponCount > 0 &&
      declaredWeaponCount <= fact.eligibleWeaponCount &&
      fact.reviewedByPlayer &&
      (!fact.fullyVisible || fact.visible) &&
      ((fact.visible && !fact.indirectFire) ||
        (!fact.visible && fact.indirectFire && fact.weaponHasIndirect)) &&
      (fact.publishedRangeThousandths === fact.effectiveRangeThousandths ||
        Boolean(fact.rangeOverrideReason?.trim())),
  );
}

export function rangedGeometryResolutionIsValid(
  observerCount,
  provenObserverCount,
  targetModelCount,
  coverProvenCount,
  coverOverrideCount,
  flags,
) {
  if (
    ![
      observerCount,
      provenObserverCount,
      targetModelCount,
      coverProvenCount,
      coverOverrideCount,
    ].every(Number.isSafeInteger) ||
    observerCount < 1 ||
    observerCount > 1000 ||
    provenObserverCount < 0 ||
    provenObserverCount > observerCount ||
    targetModelCount < 1 ||
    targetModelCount > 1000 ||
    coverProvenCount < 0 ||
    coverProvenCount > targetModelCount ||
    coverOverrideCount !== targetModelCount - coverProvenCount ||
    !Number.isSafeInteger(flags) ||
    (flags & ~RANGED_GEOMETRY_FLAGS.mask) !== 0 ||
    (flags & RANGED_GEOMETRY_FLAGS.reviewedByPlayer) === 0
  ) {
    return false;
  }
  const directVisible = (flags & RANGED_GEOMETRY_FLAGS.directVisible) !== 0;
  const indirectFire = (flags & RANGED_GEOMETRY_FLAGS.indirectFire) !== 0;
  const visibilityProof = (flags & RANGED_GEOMETRY_FLAGS.visibilityProof) !== 0;
  const visibilityOverride = (flags & RANGED_GEOMETRY_FLAGS.visibilityOverride) !== 0;
  const fullyVisible = (flags & RANGED_GEOMETRY_FLAGS.fullyVisible) !== 0;
  const fullProof = (flags & RANGED_GEOMETRY_FLAGS.fullVisibilityProof) !== 0;
  const fullOverride = (flags & RANGED_GEOMETRY_FLAGS.fullVisibilityOverride) !== 0;
  const directValid =
    directVisible &&
    !indirectFire &&
    ((visibilityProof && !visibilityOverride && provenObserverCount === observerCount) ||
      (!visibilityProof && visibilityOverride && provenObserverCount < observerCount));
  const indirectValid =
    !directVisible &&
    indirectFire &&
    (flags & RANGED_GEOMETRY_FLAGS.weaponHasIndirect) !== 0 &&
    !visibilityProof &&
    !visibilityOverride &&
    provenObserverCount < observerCount;
  const fullValid =
    (fullyVisible &&
      directVisible &&
      ((fullProof && !fullOverride) || (!fullProof && fullOverride))) ||
    (!fullyVisible && !fullProof && !fullOverride);
  return (directValid || indirectValid) && fullValid;
}

export function weaponInventoryDeclarationIsValid(
  inventoryCount,
  sourceModelsRemaining,
  usedCount,
  declaredCount,
  inventoryFlags,
  declaredFlags,
) {
  return Boolean(
    Number.isSafeInteger(inventoryCount) &&
      inventoryCount > 0 &&
      Number.isSafeInteger(sourceModelsRemaining) &&
      sourceModelsRemaining > 0 &&
      Number.isSafeInteger(usedCount) &&
      usedCount >= 0 &&
      usedCount <= inventoryCount &&
      Number.isSafeInteger(declaredCount) &&
      declaredCount > 0 &&
      declaredCount <= inventoryCount - usedCount &&
      Number.isSafeInteger(inventoryFlags) &&
      inventoryFlags >= 0 &&
      inventoryFlags <= 3 &&
      Number.isSafeInteger(declaredFlags) &&
      declaredFlags >= 0 &&
      declaredFlags <= 3 &&
      ((declaredFlags & 1) === 0 || (inventoryFlags & 1) !== 0) &&
      ((declaredFlags & 2) === 0 || (inventoryFlags & 2) !== 0),
  );
}

export function weaponBearerDeclarationIsValid(
  inventoryCount,
  survivingBearerCount,
  usedCount,
  declaredCount,
  inventoryFlags,
  declaredFlags,
) {
  return Boolean(
    weaponInventoryDeclarationIsValid(
      inventoryCount,
      1,
      usedCount,
      declaredCount,
      inventoryFlags,
      declaredFlags,
    ) &&
      Number.isSafeInteger(survivingBearerCount) &&
      survivingBearerCount > 0 &&
      survivingBearerCount <= inventoryCount &&
      usedCount <= survivingBearerCount &&
      declaredCount <= survivingBearerCount - usedCount,
  );
}

export const CHARGE_RESOLUTION_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  phaseStartEligible: 2,
  startedOutsideEngagementRange: 4,
  allTargetsEngaged: 8,
  unitCoherency: 16,
  nonTargetsAvoided: 32,
  allModelsCloser: 64,
  baseContactMaximized: 128,
  rollOverrideExplained: 256,
  failureExplained: 512,
});

export const FIGHT_MOVE_STAGES = Object.freeze(["pile_in", "consolidation"]);
export const FIGHT_MOVE_DESTINATIONS = Object.freeze(["none", "enemy", "objective"]);
export const FIGHT_MOVE_FLAGS = Object.freeze({
  reviewedByPlayer: 1,
  unitCoherency: 2,
  endsWithinEngagementRange: 4,
  allMovedModelsCloserToEnemy: 8,
  baseContactMaximized: 16,
  baseContactModelsStationary: 32,
  enemyDestinationImpossible: 64,
  endsWithinObjectiveRange: 128,
  allMovedModelsCloserToObjective: 256,
  objectiveDestinationImpossible: 512,
  outcomeExplained: 1024,
  ruleRestricted: 2048,
});

export const HEROIC_INTERVENTION_FLAGS = Object.freeze({
  targetEligibilityReviewed: 1,
  vehicleRestrictionSatisfied: 2,
  soleTriggerTarget: 4,
  chargeBonusSuppressed: 8,
});

export function heroicInterventionFlags(event) {
  return (
    (event.targetEligibilityConfirmed ? HEROIC_INTERVENTION_FLAGS.targetEligibilityReviewed : 0) |
    (event.vehicleRestrictionSatisfied
      ? HEROIC_INTERVENTION_FLAGS.vehicleRestrictionSatisfied
      : 0) |
    (event.soleTriggerTargetConfirmed ? HEROIC_INTERVENTION_FLAGS.soleTriggerTarget : 0) |
    (event.chargeBonusSuppressedConfirmed ? HEROIC_INTERVENTION_FLAGS.chargeBonusSuppressed : 0)
  );
}

export function heroicInterventionChargeFlags(event) {
  return (
    (event.movementReviewedByPlayer ? CHARGE_RESOLUTION_FLAGS.reviewedByPlayer : 0) |
    (event.targetEligibilityConfirmed ? CHARGE_RESOLUTION_FLAGS.phaseStartEligible : 0) |
    (event.startedOutsideEngagementRange
      ? CHARGE_RESOLUTION_FLAGS.startedOutsideEngagementRange
      : 0) |
    (event.successful && event.endsWithinEngagementRange
      ? CHARGE_RESOLUTION_FLAGS.allTargetsEngaged
      : 0) |
    (event.unitCoherencyConfirmed ? CHARGE_RESOLUTION_FLAGS.unitCoherency : 0) |
    (event.nonTargetEngagementRangeAvoided ? CHARGE_RESOLUTION_FLAGS.nonTargetsAvoided : 0) |
    (event.allModelsCloserToTarget ? CHARGE_RESOLUTION_FLAGS.allModelsCloser : 0) |
    (event.baseContactMaximized ? CHARGE_RESOLUTION_FLAGS.baseContactMaximized : 0) |
    (event.rollOverrideReason ? CHARGE_RESOLUTION_FLAGS.rollOverrideExplained : 0) |
    (event.failureReason ? CHARGE_RESOLUTION_FLAGS.failureExplained : 0)
  );
}

export function heroicInterventionIsValid(
  dieOne,
  dieTwo,
  rollModifier,
  chargeDistanceThousandths,
  startDistanceThousandths,
  maximumModelMoveThousandths,
  successful,
  chargeFlags,
  heroicFlags,
) {
  return (
    Number.isSafeInteger(startDistanceThousandths) &&
    startDistanceThousandths > 0 &&
    startDistanceThousandths <= 6000 &&
    heroicFlags === 15 &&
    chargeResolutionIsValid(
      dieOne,
      dieTwo,
      rollModifier,
      chargeDistanceThousandths,
      startDistanceThousandths,
      maximumModelMoveThousandths,
      1,
      successful,
      chargeFlags,
    )
  );
}

export function fightMoveIsValid(stage, destination, maximumModelMoveThousandths, flags) {
  if (
    !Number.isSafeInteger(stage) ||
    stage < 1 ||
    stage > 2 ||
    !Number.isSafeInteger(destination) ||
    destination < 0 ||
    destination > 2 ||
    !Number.isSafeInteger(maximumModelMoveThousandths) ||
    maximumModelMoveThousandths < 0 ||
    maximumModelMoveThousandths > 3000 ||
    !Number.isSafeInteger(flags) ||
    flags < 0 ||
    flags > 4095
  ) {
    return false;
  }
  if (destination === 1) {
    return flags === 63;
  }
  if (stage === 1) {
    return (
      destination === 0 && maximumModelMoveThousandths === 0 && (flags === 1121 || flags === 3105)
    );
  }
  if (destination === 2) {
    return flags === 1507;
  }
  return (
    destination === 0 && maximumModelMoveThousandths === 0 && (flags === 1633 || flags === 3105)
  );
}

export function fightMoveFlags(event) {
  return (
    (event.movementReviewedByPlayer ? FIGHT_MOVE_FLAGS.reviewedByPlayer : 0) |
    (event.unitCoherencyConfirmed ? FIGHT_MOVE_FLAGS.unitCoherency : 0) |
    (event.endsWithinEngagementRange ? FIGHT_MOVE_FLAGS.endsWithinEngagementRange : 0) |
    (event.allMovedModelsCloserToEnemy ? FIGHT_MOVE_FLAGS.allMovedModelsCloserToEnemy : 0) |
    (event.baseContactMaximized ? FIGHT_MOVE_FLAGS.baseContactMaximized : 0) |
    (event.baseContactModelsStationary ? FIGHT_MOVE_FLAGS.baseContactModelsStationary : 0) |
    (event.enemyDestinationImpossible ? FIGHT_MOVE_FLAGS.enemyDestinationImpossible : 0) |
    (event.endsWithinObjectiveRange ? FIGHT_MOVE_FLAGS.endsWithinObjectiveRange : 0) |
    (event.allMovedModelsCloserToObjective ? FIGHT_MOVE_FLAGS.allMovedModelsCloserToObjective : 0) |
    (event.objectiveDestinationImpossible ? FIGHT_MOVE_FLAGS.objectiveDestinationImpossible : 0) |
    (event.outcomeReason ? FIGHT_MOVE_FLAGS.outcomeExplained : 0) |
    (event.movementRuleRestricted ? FIGHT_MOVE_FLAGS.ruleRestricted : 0)
  );
}

export function chargeResolutionIsValid(
  dieOne,
  dieTwo,
  rollModifier,
  chargeDistanceThousandths,
  maximumTargetDistanceThousandths,
  maximumModelMoveThousandths,
  targetCount,
  successful,
  flags,
) {
  const flag = (name) => (flags & CHARGE_RESOLUTION_FLAGS[name]) !== 0;
  const unmodifiedDistance = Math.max(0, dieOne + dieTwo + rollModifier) * 1000;
  return Boolean(
    Number.isSafeInteger(dieOne) &&
      dieOne >= 1 &&
      dieOne <= 6 &&
      Number.isSafeInteger(dieTwo) &&
      dieTwo >= 1 &&
      dieTwo <= 6 &&
      Number.isSafeInteger(rollModifier) &&
      rollModifier >= -12 &&
      rollModifier <= 12 &&
      Number.isSafeInteger(chargeDistanceThousandths) &&
      chargeDistanceThousandths >= 0 &&
      chargeDistanceThousandths <= 24_000 &&
      Number.isSafeInteger(maximumTargetDistanceThousandths) &&
      maximumTargetDistanceThousandths > 0 &&
      maximumTargetDistanceThousandths <= 12_000 &&
      Number.isSafeInteger(maximumModelMoveThousandths) &&
      maximumModelMoveThousandths >= 0 &&
      maximumModelMoveThousandths <= 24_000 &&
      Number.isSafeInteger(targetCount) &&
      targetCount > 0 &&
      targetCount <= 12 &&
      Number.isSafeInteger(flags) &&
      flags >= 0 &&
      flags <= 1023 &&
      flag("reviewedByPlayer") &&
      flag("phaseStartEligible") &&
      flag("startedOutsideEngagementRange") &&
      (chargeDistanceThousandths === unmodifiedDistance || flag("rollOverrideExplained")) &&
      (successful
        ? maximumModelMoveThousandths > 0 &&
          maximumModelMoveThousandths <= chargeDistanceThousandths &&
          flag("allTargetsEngaged") &&
          flag("unitCoherency") &&
          flag("nonTargetsAvoided") &&
          flag("allModelsCloser") &&
          flag("baseContactMaximized")
        : maximumModelMoveThousandths === 0 && flag("failureExplained")),
  );
}

export function chargeResolutionFlags(event) {
  return (
    (event.movementReviewedByPlayer ? CHARGE_RESOLUTION_FLAGS.reviewedByPlayer : 0) |
    (event.phaseStartEligibilityConfirmed ? CHARGE_RESOLUTION_FLAGS.phaseStartEligible : 0) |
    (event.startedOutsideEngagementRange
      ? CHARGE_RESOLUTION_FLAGS.startedOutsideEngagementRange
      : 0) |
    (event.targetFacts?.every((target) => target.endsWithinEngagementRange)
      ? CHARGE_RESOLUTION_FLAGS.allTargetsEngaged
      : 0) |
    (event.unitCoherencyConfirmed ? CHARGE_RESOLUTION_FLAGS.unitCoherency : 0) |
    (event.nonTargetEngagementRangeAvoided ? CHARGE_RESOLUTION_FLAGS.nonTargetsAvoided : 0) |
    (event.allModelsCloserToTarget ? CHARGE_RESOLUTION_FLAGS.allModelsCloser : 0) |
    (event.baseContactMaximized ? CHARGE_RESOLUTION_FLAGS.baseContactMaximized : 0) |
    (event.rollOverrideReason ? CHARGE_RESOLUTION_FLAGS.rollOverrideExplained : 0) |
    (event.failureReason ? CHARGE_RESOLUTION_FLAGS.failureExplained : 0)
  );
}

function formationDestroyed(formation) {
  return Object.values(formation?.health ?? {}).every((health) => health.modelsRemaining === 0);
}

function sameTurn(left, right) {
  return (
    left?.status === "active" &&
    right?.status === "active" &&
    left.battleRound === right.battleRound &&
    left.turn === right.turn &&
    left.activePlayerId === right.activePlayerId
  );
}

function samePhase(left, right) {
  return sameTurn(left, right) && left.phase === right.phase;
}

function otherPlayerId(players, playerId) {
  const other = players.find((player) => player.id !== playerId);
  if (!other) throw new Error("Battle state cannot determine the other player");
  return other.id;
}

function defaultMission(players) {
  return {
    name: "Custom mission",
    pointsLimit: 2000,
    deploymentFirstPlayerId: players[0].id,
    commandPointsPerCommandPhase: 1,
    startingCommandPoints: Object.fromEntries(players.map((player) => [player.id, 0])),
    objectives: Array.from({ length: 5 }, (_, index) => ({
      id: `objective-${index + 1}`,
      name: `Objective ${index + 1}`,
    })),
  };
}

function normalizeMission(candidate, players) {
  const mission = record(candidate, "Battle mission must be an object");
  if (!Array.isArray(mission.objectives) || mission.objectives.length > 12) {
    throw new Error("Battle mission must contain at most 12 objectives");
  }
  const objectives = mission.objectives.map((candidateObjective) => {
    const objective = record(candidateObjective, "Each objective must be an object");
    return {
      id: boundedString(objective.id, "Objective id", 100),
      name: boundedString(objective.name, "Objective name", 100),
    };
  });
  if (new Set(objectives.map((objective) => objective.id)).size !== objectives.length) {
    throw new Error("Objective ids must be unique");
  }
  const starting = record(
    mission.startingCommandPoints,
    "Mission startingCommandPoints must be an object",
  );
  const startingCommandPoints = Object.fromEntries(
    [...players].map((playerId) => [
      playerId,
      nonnegativeInteger(starting[playerId], `Starting Command Points for ${playerId}`, 100),
    ]),
  );
  if (Object.keys(starting).some((playerId) => !players.has(playerId))) {
    throw new Error("Mission startingCommandPoints contains an unknown player");
  }
  const deploymentFirstPlayerId = boundedString(
    mission.deploymentFirstPlayerId ?? [...players][0],
    "Mission deployment first player",
    100,
  );
  if (!players.has(deploymentFirstPlayerId)) {
    throw new Error("Mission deployment first player is unknown");
  }
  return {
    name: boundedString(mission.name, "Mission name", 200),
    pointsLimit: nonnegativeInteger(mission.pointsLimit ?? 2000, "Mission points limit", 100000),
    deploymentFirstPlayerId,
    commandPointsPerCommandPhase: nonnegativeInteger(
      mission.commandPointsPerCommandPhase,
      "Command Points per Command phase",
      10,
    ),
    startingCommandPoints,
    objectives,
  };
}

function normalizeTableGeometry(candidate) {
  const geometry = record(candidate, "Table geometry must be an object");
  if (
    !Array.isArray(geometry.objectivePositions) ||
    geometry.objectivePositions.length < 1 ||
    geometry.objectivePositions.length > 12
  ) {
    throw new Error("Table geometry must position 1 to 12 objective markers");
  }
  const objectivePositions = geometry.objectivePositions.map((candidateObjective) => {
    const objective = record(candidateObjective, "Each objective position must be an object");
    return {
      objectiveId: boundedString(objective.objectiveId, "Geometry objective id", 100),
      xThousandths: nonnegativeInteger(
        objective.xThousandths,
        "Objective x-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.widthThousandths,
      ),
      yThousandths: nonnegativeInteger(
        objective.yThousandths,
        "Objective y-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.heightThousandths,
      ),
    };
  });
  if (
    new Set(objectivePositions.map((objective) => objective.objectiveId)).size !==
    objectivePositions.length
  ) {
    throw new Error("Table geometry objective ids must be unique");
  }
  const profile = record(geometry.terrainProfile, "Table terrain profile must be an object");
  const normalized = {
    missionSourceId: boundedString(geometry.missionSourceId, "Geometry mission source id", 200),
    terrainSourceId: boundedString(geometry.terrainSourceId, "Geometry terrain source id", 200),
    deploymentName: boundedString(geometry.deploymentName, "Geometry deployment name", 100),
    battlefieldWidthThousandths: nonnegativeInteger(
      geometry.battlefieldWidthThousandths,
      "Battlefield width thousandths",
      100_000,
    ),
    battlefieldHeightThousandths: nonnegativeInteger(
      geometry.battlefieldHeightThousandths,
      "Battlefield height thousandths",
      100_000,
    ),
    origin: boundedString(geometry.origin, "Table coordinate origin", 60),
    objectivePositions,
    terrainProfile: {
      sectionCount: nonnegativeInteger(profile.sectionCount, "Terrain section count", 100),
      sixByFourCount: nonnegativeInteger(profile.sixByFourCount, "6 by 4 terrain count", 100),
      tenByFiveCount: nonnegativeInteger(profile.tenByFiveCount, "10 by 5 terrain count", 100),
      twelveBySixCount: nonnegativeInteger(profile.twelveBySixCount, "12 by 6 terrain count", 100),
      sourcePage: nonnegativeInteger(profile.sourcePage, "Terrain layout source page", 1000),
    },
    terrainLayoutReviewed: Boolean(geometry.terrainLayoutReviewed),
    deploymentZonesReviewed: Boolean(geometry.deploymentZonesReviewed),
    objectivePositionsReviewed: Boolean(geometry.objectivePositionsReviewed),
    reviewedByPlayer: Boolean(geometry.reviewedByPlayer),
    method: boundedString(geometry.method, "Table geometry method", 20),
    reviewReason: geometry.reviewedByPlayer
      ? boundedString(geometry.reviewReason, "Table geometry review", 500).trim()
      : "",
  };
  if (normalized.origin !== "attacker-left-near") {
    throw new Error("Table geometry coordinate origin is unsupported");
  }
  if (!TABLE_GEOMETRY_METHODS.includes(normalized.method)) {
    throw new Error("Table geometry method is unsupported");
  }
  if (!normalized.reviewReason) {
    throw new Error("Table geometry review must explain the checked tabletop facts");
  }
  if (!tableGeometryIsValid(normalized, true)) {
    throw new Error("Table geometry does not match the source-locked tournament frame");
  }
  return normalized;
}

function normalizeTerrainFootprintSet(candidate) {
  const set = record(candidate, "Terrain footprint set must be an object");
  if (!Array.isArray(set.footprints) || set.footprints.length !== 12) {
    throw new Error("Terrain footprint set must contain the twelve source outlines");
  }
  const footprints = set.footprints.map((candidateFootprint) => {
    const footprint = record(candidateFootprint, "Each terrain footprint must be an object");
    return {
      id: boundedString(footprint.id, "Terrain footprint id", 100),
      widthThousandths: nonnegativeInteger(
        footprint.widthThousandths,
        "Terrain footprint width thousandths",
        12_000,
      ),
      heightThousandths: nonnegativeInteger(
        footprint.heightThousandths,
        "Terrain footprint height thousandths",
        6_000,
      ),
      centerXThousandths: nonnegativeInteger(
        footprint.centerXThousandths,
        "Terrain footprint centre x-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.widthThousandths,
      ),
      centerYThousandths: nonnegativeInteger(
        footprint.centerYThousandths,
        "Terrain footprint centre y-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.heightThousandths,
      ),
      rotationMilliDegrees: nonnegativeInteger(
        footprint.rotationMilliDegrees,
        "Terrain footprint rotation milli-degrees",
        179_999,
      ),
      areaTerrainSectionId: boundedString(
        footprint.areaTerrainSectionId,
        "Area terrain section id",
        100,
      ),
    };
  });
  const normalized = {
    missionSourceId: boundedString(set.missionSourceId, "Terrain mission source id", 200),
    terrainSourceId: boundedString(set.terrainSourceId, "Terrain layout source id", 200),
    battlefieldWidthThousandths: nonnegativeInteger(
      set.battlefieldWidthThousandths,
      "Terrain battlefield width thousandths",
      100_000,
    ),
    battlefieldHeightThousandths: nonnegativeInteger(
      set.battlefieldHeightThousandths,
      "Terrain battlefield height thousandths",
      100_000,
    ),
    origin: boundedString(set.origin, "Terrain coordinate origin", 60),
    sourcePage: nonnegativeInteger(set.sourcePage, "Terrain source page", 1000),
    footprints,
    placementReviewed: Boolean(set.placementReviewed),
    sectionGroupingReviewed: Boolean(set.sectionGroupingReviewed),
    reviewedByPlayer: Boolean(set.reviewedByPlayer),
    method: boundedString(set.method, "Terrain footprint method", 20),
    reviewReason: set.reviewedByPlayer
      ? boundedString(set.reviewReason, "Terrain footprint review", 500).trim()
      : "",
  };
  if (normalized.origin !== "attacker-left-near") {
    throw new Error("Terrain footprint coordinate origin is unsupported");
  }
  if (!TERRAIN_FOOTPRINT_METHODS.includes(normalized.method)) {
    throw new Error("Terrain footprint method is unsupported");
  }
  if (!normalized.reviewReason) {
    throw new Error("Terrain footprint review must explain the checked tabletop facts");
  }
  if (!terrainFootprintSetIsValid(normalized, true)) {
    throw new Error("Terrain footprints do not match the source-locked tournament layout");
  }
  return normalized;
}

function normalizeTerrainVisibilityGeometry(candidate) {
  const set = record(candidate, "Terrain visibility geometry must be an object");
  if (
    !Array.isArray(set.sections) ||
    set.sections.length < 1 ||
    set.sections.length > TERRAIN_VISIBILITY_LIMITS.maximumSections
  ) {
    throw new Error("Terrain visibility geometry must contain 1 to 24 area terrain sections");
  }
  let panelCount = 0;
  const sections = set.sections.map((candidateSection) => {
    const section = record(candidateSection, "Each terrain visibility section must be an object");
    const featureType = boundedString(section.featureType, "Terrain feature type", 20);
    if (!TERRAIN_VISIBILITY_FEATURES.includes(featureType)) {
      throw new Error("Terrain visibility feature type is unsupported");
    }
    if (!Array.isArray(section.panels)) {
      throw new Error("Terrain visibility section panels must be an array");
    }
    panelCount += section.panels.length;
    return {
      sectionId: boundedString(section.sectionId, "Terrain visibility section id", 100),
      featureType,
      geometryComplete: Boolean(section.geometryComplete),
      panels: section.panels.map((candidatePanel) => {
        const panel = record(candidatePanel, "Each visibility panel must be an object");
        if (
          !Array.isArray(panel.openings) ||
          panel.openings.length > TERRAIN_VISIBILITY_LIMITS.maximumOpeningsPerPanel
        ) {
          throw new Error("A visibility panel can contain at most 32 openings");
        }
        return {
          id: boundedString(panel.id, "Visibility panel id", 100),
          startXThousandths: nonnegativeInteger(
            panel.startXThousandths,
            "Visibility panel start x-coordinate",
            60_000,
          ),
          startYThousandths: nonnegativeInteger(
            panel.startYThousandths,
            "Visibility panel start y-coordinate",
            44_000,
          ),
          endXThousandths: nonnegativeInteger(
            panel.endXThousandths,
            "Visibility panel end x-coordinate",
            60_000,
          ),
          endYThousandths: nonnegativeInteger(
            panel.endYThousandths,
            "Visibility panel end y-coordinate",
            44_000,
          ),
          bottomZThousandths: nonnegativeInteger(
            panel.bottomZThousandths,
            "Visibility panel bottom elevation",
            TERRAIN_VISIBILITY_LIMITS.maximumHeightThousandths,
          ),
          topZThousandths: nonnegativeInteger(
            panel.topZThousandths,
            "Visibility panel top elevation",
            TERRAIN_VISIBILITY_LIMITS.maximumHeightThousandths,
          ),
          openings: panel.openings.map((candidateOpening) => {
            const opening = record(
              candidateOpening,
              "Each visibility panel opening must be an object",
            );
            return {
              startOffsetThousandths: nonnegativeInteger(
                opening.startOffsetThousandths,
                "Visibility opening start offset",
                100_000,
              ),
              endOffsetThousandths: nonnegativeInteger(
                opening.endOffsetThousandths,
                "Visibility opening end offset",
                100_000,
              ),
              bottomZThousandths: nonnegativeInteger(
                opening.bottomZThousandths,
                "Visibility opening bottom elevation",
                TERRAIN_VISIBILITY_LIMITS.maximumHeightThousandths,
              ),
              topZThousandths: nonnegativeInteger(
                opening.topZThousandths,
                "Visibility opening top elevation",
                TERRAIN_VISIBILITY_LIMITS.maximumHeightThousandths,
              ),
            };
          }),
        };
      }),
    };
  });
  if (panelCount > TERRAIN_VISIBILITY_LIMITS.maximumPanels) {
    throw new Error("Terrain visibility geometry can contain at most 256 wall panels");
  }
  const method = boundedString(set.method, "Terrain visibility method", 20);
  if (!TERRAIN_VISIBILITY_METHODS.includes(method)) {
    throw new Error("Terrain visibility measurement method is unsupported");
  }
  return {
    missionSourceId: boundedString(set.missionSourceId, "Visibility mission source id", 200),
    terrainSourceId: boundedString(set.terrainSourceId, "Visibility terrain source id", 200),
    sections,
    allFeaturesRecorded: Boolean(set.allFeaturesRecorded),
    reviewedByPlayer: Boolean(set.reviewedByPlayer),
    method,
    reviewReason: set.reviewedByPlayer
      ? boundedString(set.reviewReason, "Terrain visibility review", 500).trim()
      : "",
  };
}

function normalizeModelSilhouette(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const silhouette = record(candidate, "Model 3D silhouette must be an object");
  const shape = boundedString(silhouette.shape, "Model silhouette shape", 20);
  if (!MODEL_FOOTPRINT_SHAPES.includes(shape)) {
    throw new Error("Model silhouette shape is unsupported");
  }
  const widthThousandths = nonnegativeInteger(
    silhouette.widthThousandths,
    "Model silhouette width",
    30_000,
  );
  const depthThousandths = nonnegativeInteger(
    silhouette.depthThousandths,
    "Model silhouette depth",
    30_000,
  );
  const heightThousandths = nonnegativeInteger(
    silhouette.heightThousandths,
    "Model silhouette height",
    30_000,
  );
  if (widthThousandths === 0 || depthThousandths === 0 || heightThousandths === 0) {
    throw new Error("Model silhouette dimensions must be greater than zero");
  }
  if (shape === "circle" && widthThousandths !== depthThousandths) {
    throw new Error("A circular model silhouette must have equal width and depth");
  }
  if (
    !Array.isArray(silhouette.sightPoints) ||
    silhouette.sightPoints.length < 1 ||
    silhouette.sightPoints.length > TERRAIN_VISIBILITY_LIMITS.maximumSightPointsPerModel
  ) {
    throw new Error("Model silhouette must contain 1 to 16 reviewed physical sight points");
  }
  const sightPoints = silhouette.sightPoints.map((candidatePoint) => {
    const point = record(candidatePoint, "Each model sight point must be an object");
    const normalized = {
      xOffsetThousandths: boundedInteger(
        point.xOffsetThousandths,
        "Model sight point x-offset",
        -30_000,
        30_000,
      ),
      yOffsetThousandths: boundedInteger(
        point.yOffsetThousandths,
        "Model sight point y-offset",
        -30_000,
        30_000,
      ),
      heightThousandths: nonnegativeInteger(
        point.heightThousandths,
        "Model sight point height",
        heightThousandths,
      ),
    };
    const horizontalInside =
      shape === "rectangle"
        ? Math.abs(normalized.xOffsetThousandths) <= widthThousandths / 2 &&
          Math.abs(normalized.yOffsetThousandths) <= depthThousandths / 2
        : (normalized.xOffsetThousandths / (widthThousandths / 2)) ** 2 +
            (normalized.yOffsetThousandths / (depthThousandths / 2)) ** 2 <=
          1 + 1e-9;
    if (!horizontalInside) throw new Error("Model sight point is outside its silhouette envelope");
    return normalized;
  });
  const normalized = {
    shape,
    widthThousandths,
    depthThousandths,
    heightThousandths,
    bottomOffsetThousandths: nonnegativeInteger(
      silhouette.bottomOffsetThousandths,
      "Model silhouette bottom offset",
      30_000,
    ),
    centerOffsetXThousandths: boundedInteger(
      silhouette.centerOffsetXThousandths,
      "Model silhouette centre x-offset",
      -30_000,
      30_000,
    ),
    centerOffsetYThousandths: boundedInteger(
      silhouette.centerOffsetYThousandths,
      "Model silhouette centre y-offset",
      -30_000,
      30_000,
    ),
    sightPoints,
    envelopeReviewed: Boolean(silhouette.envelopeReviewed),
    sightPointsReviewed: Boolean(silhouette.sightPointsReviewed),
  };
  if (
    silhouette.geometryMode !== undefined ||
    silhouette.convexVertices !== undefined ||
    silhouette.convexReviewed !== undefined
  ) {
    const geometryMode = boundedString(
      silhouette.geometryMode,
      "Model silhouette geometry mode",
      20,
    );
    if (!["primitive", "convex_prism"].includes(geometryMode)) {
      throw new Error("Model silhouette geometry mode is unsupported");
    }
    const convexVertices = Array.isArray(silhouette.convexVertices)
      ? silhouette.convexVertices.map((candidateVertex) => {
          const vertex = record(candidateVertex, "Each convex silhouette vertex must be an object");
          const normalizedVertex = {
            xOffsetThousandths: boundedInteger(
              vertex.xOffsetThousandths,
              "Convex silhouette x-offset",
              -30_000,
              30_000,
            ),
            yOffsetThousandths: boundedInteger(
              vertex.yOffsetThousandths,
              "Convex silhouette y-offset",
              -30_000,
              30_000,
            ),
          };
          const horizontalInside =
            shape === "rectangle"
              ? Math.abs(normalizedVertex.xOffsetThousandths) <= widthThousandths / 2 &&
                Math.abs(normalizedVertex.yOffsetThousandths) <= depthThousandths / 2
              : (normalizedVertex.xOffsetThousandths / (widthThousandths / 2)) ** 2 +
                  (normalizedVertex.yOffsetThousandths / (depthThousandths / 2)) ** 2 <=
                1 + 1e-9;
          if (!horizontalInside) {
            throw new Error("Convex silhouette vertex is outside its reviewed envelope");
          }
          return normalizedVertex;
        })
      : [];
    const convexReviewed = Boolean(silhouette.convexReviewed);
    if (
      geometryMode === "convex_prism" &&
      (!convexReviewed || !convexSilhouetteIsValid(convexVertices, 1))
    ) {
      throw new Error(
        "A convex-prism silhouette requires 3 to 16 strictly convex counter-clockwise reviewed vertices",
      );
    }
    normalized.geometryMode = geometryMode;
    normalized.convexVertices = convexVertices;
    normalized.convexReviewed = convexReviewed;
  }
  return normalized;
}

function normalizeModelPlacementSet(candidate, formation) {
  const set = record(candidate, "Model placement set must be an object");
  if (formation.weaponBearerTracking !== "exact") {
    throw new Error("Model placement requires exact battle model identities");
  }
  if (!Array.isArray(set.models) || set.models.length < 1 || set.models.length > 1000) {
    throw new Error("Model placement must contain 1 to 1000 model footprints");
  }
  const models = set.models.map((candidateModel) => {
    const model = record(candidateModel, "Each model placement must be an object");
    const shape = boundedString(model.shape, "Model footprint shape", 20);
    const measurementBasis = boundedString(model.measurementBasis, "Model measurement basis", 20);
    if (!MODEL_FOOTPRINT_SHAPES.includes(shape)) {
      throw new Error("Model footprint shape is unsupported");
    }
    if (!MODEL_MEASUREMENT_BASES.includes(measurementBasis)) {
      throw new Error("Model measurement basis must be base or model");
    }
    return {
      modelId: boundedString(model.modelId, "Placed battle model id", 200),
      measurementBasis,
      shape,
      widthThousandths: nonnegativeInteger(
        model.widthThousandths,
        "Model footprint width thousandths",
        30_000,
      ),
      depthThousandths: nonnegativeInteger(
        model.depthThousandths,
        "Model footprint depth thousandths",
        30_000,
      ),
      verticalExtentThousandths: nonnegativeInteger(
        model.verticalExtentThousandths ?? 0,
        "Model measurement-boundary vertical extent thousandths",
        30_000,
      ),
      centerXThousandths: nonnegativeInteger(
        model.centerXThousandths,
        "Model centre x-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.widthThousandths,
      ),
      centerYThousandths: nonnegativeInteger(
        model.centerYThousandths,
        "Model centre y-coordinate thousandths",
        TABLE_GEOMETRY_CONSTANTS.heightThousandths,
      ),
      elevationThousandths: nonnegativeInteger(
        model.elevationThousandths,
        "Model elevation thousandths",
        24_000,
      ),
      rotationMilliDegrees: nonnegativeInteger(
        model.rotationMilliDegrees,
        "Model rotation milli-degrees",
        179_999,
      ),
      silhouette: normalizeModelSilhouette(model.silhouette),
    };
  });
  const normalized = {
    context: boundedString(set.context, "Model placement context", 30),
    referenceEventId: boundedString(
      set.referenceEventId,
      "Model placement reference event id",
      100,
    ),
    missionSourceId: boundedString(set.missionSourceId, "Model placement mission source id", 200),
    terrainSourceId: boundedString(set.terrainSourceId, "Model placement terrain source id", 200),
    battlefieldWidthThousandths: nonnegativeInteger(
      set.battlefieldWidthThousandths,
      "Model placement battlefield width thousandths",
      100_000,
    ),
    battlefieldHeightThousandths: nonnegativeInteger(
      set.battlefieldHeightThousandths,
      "Model placement battlefield height thousandths",
      100_000,
    ),
    origin: boundedString(set.origin, "Model placement coordinate origin", 60),
    models,
    measurementBoundariesReviewed: Boolean(set.measurementBoundariesReviewed),
    positionsReviewed: Boolean(set.positionsReviewed),
    noModelOverlapReviewed: Boolean(set.noModelOverlapReviewed),
    objectiveClearanceReviewed: Boolean(set.objectiveClearanceReviewed),
    reviewedByPlayer: Boolean(set.reviewedByPlayer),
    method: boundedString(set.method, "Model placement method", 20),
    reviewReason: set.reviewedByPlayer
      ? boundedString(set.reviewReason, "Model placement review", 500).trim()
      : "",
  };
  if (normalized.context !== "deployment") {
    throw new Error("Only deployment model placement is supported in battle-state version 27");
  }
  if (normalized.origin !== "attacker-left-near") {
    throw new Error("Model placement coordinate origin is unsupported");
  }
  if (!MODEL_PLACEMENT_METHODS.includes(normalized.method)) {
    throw new Error("Model placement method is unsupported");
  }
  if (!normalized.reviewReason) {
    throw new Error("Model placement review must explain the checked tabletop facts");
  }
  if (
    !modelPlacementSetIsValid(
      normalized,
      formation.modelInstances.map((model) => model.id),
      true,
    )
  ) {
    throw new Error("Model placement does not match the reviewed battlefield and formation");
  }
  return normalized;
}

function normalizeModelPositionPoint(candidate, label) {
  const point = record(candidate, `${label} must be an object`);
  return {
    centerXThousandths: nonnegativeInteger(
      point.centerXThousandths,
      `${label} centre x-coordinate thousandths`,
      TABLE_GEOMETRY_CONSTANTS.widthThousandths,
    ),
    centerYThousandths: nonnegativeInteger(
      point.centerYThousandths,
      `${label} centre y-coordinate thousandths`,
      TABLE_GEOMETRY_CONSTANTS.heightThousandths,
    ),
    elevationThousandths: nonnegativeInteger(
      point.elevationThousandths,
      `${label} elevation thousandths`,
      24_000,
    ),
    rotationMilliDegrees: nonnegativeInteger(
      point.rotationMilliDegrees,
      `${label} rotation milli-degrees`,
      179_999,
    ),
  };
}

function normalizeModelPositionSet(candidate, formation) {
  const set = record(candidate, "Model position set must be an object");
  if (formation.weaponBearerTracking !== "exact") {
    throw new Error("Model positions require exact battle model identities");
  }
  if (!Array.isArray(set.models) || set.models.length < 1 || set.models.length > 1000) {
    throw new Error("Model positions must contain 1 to 1000 model footprints");
  }
  const knownModelIds = new Set(formation.modelInstances.map((model) => model.id));
  const models = set.models.map((candidateModel) => {
    const model = record(candidateModel, "Each model position must be an object");
    const shape = boundedString(model.shape, "Model footprint shape", 20);
    const measurementBasis = boundedString(model.measurementBasis, "Model measurement basis", 20);
    if (!MODEL_FOOTPRINT_SHAPES.includes(shape)) {
      throw new Error("Model footprint shape is unsupported");
    }
    if (!MODEL_MEASUREMENT_BASES.includes(measurementBasis)) {
      throw new Error("Model measurement basis must be base or model");
    }
    const modelId = boundedString(model.modelId, "Positioned battle model id", 200);
    if (!knownModelIds.has(modelId)) throw new Error("Positioned battle model id is unknown");
    if (!Array.isArray(model.path) || model.path.length < 1 || model.path.length > 64) {
      throw new Error("Each model position requires 1 to 64 reviewed path points");
    }
    return {
      modelId,
      measurementBasis,
      shape,
      widthThousandths: nonnegativeInteger(
        model.widthThousandths,
        "Model footprint width thousandths",
        30_000,
      ),
      depthThousandths: nonnegativeInteger(
        model.depthThousandths,
        "Model footprint depth thousandths",
        30_000,
      ),
      verticalExtentThousandths: nonnegativeInteger(
        model.verticalExtentThousandths ?? 0,
        "Model measurement-boundary vertical extent thousandths",
        30_000,
      ),
      ...normalizeModelPositionPoint(model, "Model endpoint"),
      path: model.path.map((point) => normalizeModelPositionPoint(point, "Model path point")),
      distanceMovedThousandths: nonnegativeInteger(
        model.distanceMovedThousandths,
        "Model measured movement distance thousandths",
        120_000,
      ),
      maximumDistanceThousandths: nonnegativeInteger(
        model.maximumDistanceThousandths,
        "Model maximum movement distance thousandths",
        120_000,
      ),
      silhouette: normalizeModelSilhouette(model.silhouette),
    };
  });
  if (new Set(models.map((model) => model.modelId)).size !== models.length) {
    throw new Error("Model positions must reference unique model identities");
  }
  const normalized = {
    context: boundedString(set.context, "Model position context", 40),
    referenceEventId: boundedString(set.referenceEventId, "Model position reference event id", 100),
    missionSourceId: boundedString(set.missionSourceId, "Model position mission source id", 200),
    terrainSourceId: boundedString(set.terrainSourceId, "Model position terrain source id", 200),
    battlefieldWidthThousandths: nonnegativeInteger(
      set.battlefieldWidthThousandths,
      "Model position battlefield width thousandths",
      100_000,
    ),
    battlefieldHeightThousandths: nonnegativeInteger(
      set.battlefieldHeightThousandths,
      "Model position battlefield height thousandths",
      100_000,
    ),
    origin: boundedString(set.origin, "Model position coordinate origin", 60),
    models,
    measurementBoundariesReviewed: Boolean(set.measurementBoundariesReviewed),
    positionsReviewed: Boolean(set.positionsReviewed),
    noModelOverlapReviewed: Boolean(set.noModelOverlapReviewed),
    objectiveClearanceReviewed: Boolean(set.objectiveClearanceReviewed),
    pathsReviewed: Boolean(set.pathsReviewed),
    terrainClearanceReviewed: Boolean(set.terrainClearanceReviewed),
    coherencyReviewed: Boolean(set.coherencyReviewed),
    engagementRangeReviewed: Boolean(set.engagementRangeReviewed),
    reconcilesStaleStart: Boolean(set.reconcilesStaleStart),
    reviewedByPlayer: Boolean(set.reviewedByPlayer),
    method: boundedString(set.method, "Model position method", 20),
    reviewReason: set.reviewedByPlayer
      ? boundedString(set.reviewReason, "Model position review", 500).trim()
      : "",
  };
  if (
    ![...MODEL_PATH_POSITION_CONTEXTS, ...MODEL_SETUP_POSITION_CONTEXTS].includes(
      normalized.context,
    )
  ) {
    throw new Error("Model position context is unsupported");
  }
  if (
    modelPositionContextUsesPath(normalized.context) &&
    models.some((model) => model.path.length < 2)
  ) {
    throw new Error("Movement model positions require a start and endpoint");
  }
  if (
    !modelPositionContextUsesPath(normalized.context) &&
    models.some(
      (model) =>
        model.path.length !== 1 ||
        model.distanceMovedThousandths !== 0 ||
        model.maximumDistanceThousandths !== 0,
    )
  ) {
    throw new Error("Reserve setup positions require one endpoint and no movement distance");
  }
  if (normalized.origin !== "attacker-left-near") {
    throw new Error("Model position coordinate origin is unsupported");
  }
  if (!MODEL_PLACEMENT_METHODS.includes(normalized.method)) {
    throw new Error("Model position method is unsupported");
  }
  if (!normalized.reviewReason) {
    throw new Error("Model position review must explain the checked tabletop facts");
  }
  return normalized;
}

function normalizePlayers(players, stateVersion) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error("Battle state must contain exactly two players");
  }
  const normalized = players.map((candidate) => {
    const player = record(candidate, "Each battle player must be an object");
    const normalized = {
      id: boundedString(player.id, "Player id", 100),
      listId: boundedString(player.listId, "Player list id", 100),
      name: boundedString(player.name, "Player name"),
    };
    if (stateVersion >= ROSTER_BATTLE_STATE_VERSION) {
      normalized.listUpdatedAt = nonnegativeInteger(
        player.listUpdatedAt,
        "Player listUpdatedAt",
        Number.MAX_SAFE_INTEGER,
      );
    }
    return normalized;
  });
  if (new Set(normalized.map((player) => player.id)).size !== normalized.length) {
    throw new Error("Battle player ids must be unique");
  }
  return normalized;
}

function normalizeClock(candidate, players) {
  const clock = record(candidate, "Battle clock must be an object");
  const normalized = {
    status: boundedString(clock.status, "Battle clock status", 20),
    battleRound: nonnegativeInteger(clock.battleRound, "Battle round", 5),
    turn: nonnegativeInteger(clock.turn, "Battle turn", 2),
    phase: boundedString(clock.phase, "Battle phase", 40),
    step: boundedString(clock.step, "Battle step", 40),
    firstPlayerId: typeof clock.firstPlayerId === "string" ? clock.firstPlayerId : "",
    activePlayerId: typeof clock.activePlayerId === "string" ? clock.activePlayerId : "",
    priorityPlayerId: typeof clock.priorityPlayerId === "string" ? clock.priorityPlayerId : "",
  };
  if (normalized.status === "setup") {
    if (!sameBattleClock(normalized, setupBattleClock())) {
      throw new Error("Setup battle clock is invalid");
    }
    return normalized;
  }
  if (normalized.status === "complete") {
    if (
      normalized.battleRound !== 5 ||
      normalized.turn !== 2 ||
      normalized.phase !== "complete" ||
      normalized.step !== "complete" ||
      normalized.activePlayerId ||
      normalized.priorityPlayerId ||
      !players.has(normalized.firstPlayerId)
    ) {
      throw new Error("Completed battle clock is invalid");
    }
    return normalized;
  }
  if (
    normalized.status !== "active" ||
    normalized.battleRound < 1 ||
    normalized.turn < 1 ||
    !BATTLE_PHASE_STEPS[normalized.phase]?.includes(normalized.step) ||
    !players.has(normalized.firstPlayerId) ||
    !players.has(normalized.activePlayerId) ||
    !players.has(normalized.priorityPlayerId)
  ) {
    throw new Error("Active battle clock is invalid");
  }
  return normalized;
}

function normalizeStringArray(value, name, maximum = 100) {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || !entry || entry.length > 200) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${name} must contain at most ${maximum} unique strings`);
  }
  return [...value];
}

function normalizeChoice(candidate, players) {
  const choice = record(candidate, "Pending choice must be an object");
  if (!Array.isArray(choice.options) || choice.options.length < 1 || choice.options.length > 32) {
    throw new Error("Pending choice must contain 1 to 32 options");
  }
  const options = choice.options.map((candidateOption) => {
    const option = record(candidateOption, "Each pending choice option must be an object");
    return {
      id: boundedString(option.id, "Pending choice option id", 100),
      label: boundedString(option.label, "Pending choice option label"),
    };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new Error("Pending choice option ids must be unique");
  }
  const minimumSelections = nonnegativeInteger(
    choice.minimumSelections,
    "Pending choice minimum selections",
    options.length,
  );
  const maximumSelections = nonnegativeInteger(
    choice.maximumSelections,
    "Pending choice maximum selections",
    options.length,
  );
  if (minimumSelections > maximumSelections) {
    throw new Error("Pending choice selection bounds are invalid");
  }
  const ownerPlayerId = boundedString(choice.ownerPlayerId, "Pending choice owner", 100);
  if (!players.has(ownerPlayerId)) throw new Error("Pending choice owner is unknown");
  return {
    id: boundedString(choice.id, "Pending choice id", 100),
    kind: boundedString(choice.kind, "Pending choice kind", 60),
    ownerPlayerId,
    prompt: boundedString(choice.prompt, "Pending choice prompt", 500),
    minimumSelections,
    maximumSelections,
    options,
  };
}

function normalizeEffect(candidate, players) {
  const effect = record(candidate, "Battle effect must be an object");
  const ownerPlayerId = boundedString(effect.ownerPlayerId, "Battle effect owner", 100);
  if (!players.has(ownerPlayerId)) throw new Error("Battle effect owner is unknown");
  const duration = boundedString(effect.duration, "Battle effect duration", 40);
  if (!BATTLE_EFFECT_DURATIONS.includes(duration)) {
    throw new Error("Battle effect duration is unsupported");
  }
  const normalized = {
    id: boundedString(effect.id, "Battle effect id", 100),
    name: boundedString(effect.name, "Battle effect name"),
    ownerPlayerId,
    sourceFormationId:
      typeof effect.sourceFormationId === "string" && effect.sourceFormationId
        ? boundedString(effect.sourceFormationId, "Battle effect source formation id")
        : "",
    duration,
    appliedAt: normalizeClock(effect.appliedAt, players),
  };
  if (normalized.appliedAt.status !== "active") {
    throw new Error("Battle effects require an active clock");
  }
  return normalized;
}

function normalizeSegment(candidate) {
  const segment = record(candidate, "Each formation segment must be an object");
  const wounds = nonnegativeInteger(segment.wounds, "Segment wounds", 1024);
  const startingModels = nonnegativeInteger(
    segment.startingModels,
    "Segment starting models",
    1000,
  );
  if (wounds < 1 || startingModels < 1) {
    throw new Error("Formation segments must contain at least one model with at least one wound");
  }
  const feelNoPain = nonnegativeInteger(segment.feelNoPain ?? 0, "Segment Feel No Pain", 6);
  if (feelNoPain === 1) throw new Error("Segment Feel No Pain must be 0 or from 2 to 6");
  const normalized = {
    id: boundedString(segment.id, "Segment id"),
    savedUnitId: boundedString(segment.savedUnitId, "Segment saved unit id", 100),
    unitName: boundedString(segment.unitName, "Segment unit name"),
    modelName: boundedString(segment.modelName, "Segment model name"),
    role: boundedString(segment.role, "Segment role", 40),
    keywords: normalizeStringArray(segment.keywords ?? [], "Segment keywords", 100).map((keyword) =>
      keyword.toLowerCase(),
    ),
    wounds,
    objectiveControl:
      segment.objectiveControl == null
        ? null
        : nonnegativeInteger(segment.objectiveControl, "Segment Objective Control", 1000),
    feelNoPain,
    startingModels,
  };
  if (segment.baseSegmentId !== undefined || segment.modelIds !== undefined) {
    normalized.baseSegmentId = boundedString(segment.baseSegmentId, "Segment base id");
    normalized.modelIds = normalizeStringArray(segment.modelIds, "Segment model ids", 1000);
    if (
      normalized.modelIds.length !== startingModels ||
      new Set(normalized.modelIds).size !== normalized.modelIds.length
    ) {
      throw new Error("Exact battle segments require one unique model id per starting model");
    }
    if (!Array.isArray(segment.weaponCopies) || segment.weaponCopies.length > 256) {
      throw new Error("Segment weapon copies must contain at most 256 groups");
    }
    normalized.weaponCopies = segment.weaponCopies.map((candidateCopy) => {
      const copy = record(candidateCopy, "Each segment weapon copy must be an object");
      return {
        groupId: boundedString(copy.groupId, "Segment weapon group id", 200),
        name: boundedString(copy.name, "Segment weapon name", 200),
        count: nonnegativeInteger(copy.count, "Segment weapon copies per model", 1000),
      };
    });
    if (
      normalized.weaponCopies.some((copy) => copy.count < 1) ||
      new Set(normalized.weaponCopies.map((copy) => copy.groupId)).size !==
        normalized.weaponCopies.length
    ) {
      throw new Error("Segment weapon copies must be positive and unique");
    }
  }
  return normalized;
}

function normalizeModelInstances(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw new Error("Exact battle formation must contain 1 to 1000 model instances");
  }
  const models = value.map((candidate) => {
    const model = record(candidate, "Each battle model instance must be an object");
    return {
      id: boundedString(model.id, "Battle model instance id"),
      baseSegmentId: boundedString(model.baseSegmentId, "Battle model base segment id"),
      savedUnitId: boundedString(model.savedUnitId, "Battle model saved unit id", 100),
      unitName: boundedString(model.unitName, "Battle model unit name"),
      modelName: boundedString(model.modelName, "Battle model name"),
      keywords: normalizeStringArray(model.keywords ?? [], "Battle model keywords", 100).map(
        (keyword) => keyword.toLowerCase(),
      ),
      ordinal: nonnegativeInteger(model.ordinal, "Battle model ordinal", 1000),
    };
  });
  if (
    models.some((model) => model.ordinal < 1) ||
    new Set(models.map((model) => model.id)).size !== models.length
  ) {
    throw new Error("Battle model instances require positive ordinals and unique ids");
  }
  return models;
}

function normalizeRepeatedStringArray(value, name, maximum = 1000) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${name} must contain at most ${maximum} strings`);
  }
  return value.map((entry) => boundedString(entry, name, 200));
}

function normalizeWeaponProfile(candidate) {
  const profile = record(candidate, "Each weapon inventory profile must be an object");
  const type = boundedString(profile.type, "Weapon inventory profile type", 20);
  if (type !== "Ranged" && type !== "Melee") {
    throw new Error("Weapon inventory profile type must be Ranged or Melee");
  }
  const publishedRangeThousandths = nonnegativeInteger(
    profile.publishedRangeThousandths,
    "Weapon inventory published Range",
    1_000_000,
  );
  if (
    (type === "Ranged" && publishedRangeThousandths < 1) ||
    (type === "Melee" && publishedRangeThousandths !== 0)
  ) {
    throw new Error("Weapon inventory profile Range does not match its type");
  }
  return {
    weaponId: boundedString(profile.weaponId, "Weapon inventory profile id", 100),
    name: boundedString(profile.name, "Weapon inventory profile name", 200),
    type,
    publishedRangeThousandths,
    hasAssault: Boolean(profile.hasAssault),
    hasIndirect: Boolean(profile.hasIndirect),
    hasHazardous: Boolean(profile.hasHazardous),
  };
}

function normalizeWeaponInventory(value, segments, stateVersion, modelInstances, tracking) {
  if (stateVersion < WEAPON_INVENTORY_BATTLE_STATE_VERSION) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Formation weapon inventory must contain at most 256 weapon groups");
  }
  const savedUnitIds = new Set(segments.map((segment) => segment.savedUnitId));
  const inventory = value.map((candidate) => {
    const group = record(candidate, "Each weapon inventory group must be an object");
    const sourceSavedUnitId = boundedString(
      group.sourceSavedUnitId,
      "Weapon inventory source saved unit id",
      100,
    );
    if (!savedUnitIds.has(sourceSavedUnitId)) {
      throw new Error("Weapon inventory source is not part of its formation");
    }
    if (!Array.isArray(group.profiles) || group.profiles.length < 1 || group.profiles.length > 16) {
      throw new Error("Weapon inventory group must contain 1 to 16 profiles");
    }
    const profiles = group.profiles.map(normalizeWeaponProfile);
    if (new Set(profiles.map((profile) => profile.weaponId)).size !== profiles.length) {
      throw new Error("Weapon inventory profile ids must be unique within a group");
    }
    const normalized = {
      sourceSavedUnitId,
      groupId: boundedString(group.groupId, "Weapon inventory group id", 200),
      name: boundedString(group.name, "Weapon inventory group name", 200),
      count: nonnegativeInteger(group.count, "Weapon inventory equipped count", 1000),
      profiles,
    };
    if (stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
      normalized.bearerModelIds = normalizeRepeatedStringArray(
        group.bearerModelIds ?? [],
        "Weapon bearer model ids",
        1000,
      );
      normalized.bearerAssignmentsReviewed = Boolean(group.bearerAssignmentsReviewed);
      normalized.bearerAssignmentSource = boundedString(
        group.bearerAssignmentSource ??
          (tracking === "legacy_aggregate" ? "legacy" : "setup_required"),
        "Weapon bearer assignment source",
        40,
      );
      if (tracking === "exact") {
        if (normalized.bearerModelIds.length !== normalized.count) {
          throw new Error("Every equipped weapon copy requires an exact bearer model id");
        }
        const models = new Map(modelInstances.map((model) => [model.id, model]));
        if (
          normalized.bearerModelIds.some(
            (modelId) => models.get(modelId)?.savedUnitId !== sourceSavedUnitId,
          )
        ) {
          throw new Error("Weapon bearers must belong to the weapon source saved unit");
        }
      } else if (normalized.bearerModelIds.length > 0) {
        throw new Error("Legacy aggregate weapon inventory cannot claim exact bearer ids");
      }
    }
    return normalized;
  });
  if (inventory.some((group) => group.count < 1)) {
    throw new Error("Weapon inventory groups must contain at least one equipped copy");
  }
  const keys = inventory.map((group) => `${group.sourceSavedUnitId}\u0000${group.groupId}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Formation weapon inventory groups must be unique per source unit");
  }
  return inventory;
}

function normalizeTransportOptions(value, segments, stateVersion) {
  if (stateVersion < TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error("Formation Transport options must contain at most 256 entries");
  }
  const savedUnitIds = new Set(segments.map((segment) => segment.savedUnitId));
  const options = value.map((candidate) => {
    const option = record(candidate, "Each formation Transport option must be an object");
    if (!Array.isArray(option.assignments) || option.assignments.length < 1) {
      throw new Error("Each formation Transport option requires component assignments");
    }
    const assignments = option.assignments.map((candidateAssignment) => {
      const assignment = record(
        candidateAssignment,
        "Each Transport component assignment must be an object",
      );
      const sourceSavedUnitId = boundedString(
        assignment.sourceSavedUnitId,
        "Transport component saved unit id",
        100,
      );
      if (!savedUnitIds.has(sourceSavedUnitId)) {
        throw new Error("Transport component assignment is not part of its formation");
      }
      const poolKind = boundedString(assignment.poolKind, "Transport pool kind", 20);
      if (!new Set(["primary", "additional", "alternative"]).has(poolKind)) {
        throw new Error("Transport pool kind is unsupported");
      }
      const nullableInteger = (candidateValue, name) =>
        candidateValue === null ? null : nonnegativeInteger(candidateValue, name, 100000);
      const nestedPassengerPolicy =
        assignment.sharedAllowanceNestedPassengerPolicy === null
          ? null
          : boundedString(
              assignment.sharedAllowanceNestedPassengerPolicy,
              "Nested Transport passenger policy",
              40,
            );
      if (
        nestedPassengerPolicy !== null &&
        !["included_in_fixed_cost", "excluded_from_capacity"].includes(nestedPassengerPolicy)
      ) {
        throw new Error("Nested Transport passenger policy is unsupported");
      }
      return {
        sourceSavedUnitId,
        modelCost: nonnegativeInteger(assignment.modelCost, "Transport model cost", 100000),
        poolPosition: nonnegativeInteger(assignment.poolPosition, "Transport pool position", 1000),
        poolKind,
        poolCapacity: nonnegativeInteger(
          assignment.poolCapacity,
          "Transport pool capacity",
          100000,
        ),
        poolLabel: boundedString(assignment.poolLabel, "Transport pool label", 200),
        sharedAllowancePosition: nullableInteger(
          assignment.sharedAllowancePosition,
          "Transport shared allowance position",
        ),
        sharedAllowanceMaximumModels: nullableInteger(
          assignment.sharedAllowanceMaximumModels,
          "Transport shared allowance model limit",
        ),
        sharedAllowancePrimaryCapacityWhileUsed: nullableInteger(
          assignment.sharedAllowancePrimaryCapacityWhileUsed,
          "Transport shared allowance primary capacity",
        ),
        sharedAllowanceNestedPassengerPolicy: nestedPassengerPolicy,
      };
    });
    const assignmentIds = assignments.map((assignment) => assignment.sourceSavedUnitId);
    if (
      new Set(assignmentIds).size !== assignments.length ||
      assignments.length !== savedUnitIds.size ||
      [...savedUnitIds].some((savedUnitId) => !assignmentIds.includes(savedUnitId))
    ) {
      throw new Error("Transport option must assign every formation component exactly once");
    }
    if (assignments.some((assignment) => assignment.modelCost < 1 || assignment.poolCapacity < 1)) {
      throw new Error("Transport option costs and capacities must be positive");
    }
    return {
      transportFormationId: boundedString(
        option.transportFormationId,
        "Compatible Transport formation id",
        100,
      ),
      assignments,
    };
  });
  if (new Set(options.map((option) => option.transportFormationId)).size !== options.length) {
    throw new Error("Compatible Transport formation ids must be unique");
  }
  return options;
}

function normalizeFormation(candidate, stateVersion) {
  const formation = record(candidate, "Formation registration must be an object");
  if (
    !Array.isArray(formation.segments) ||
    formation.segments.length < 1 ||
    formation.segments.length > 32
  ) {
    throw new Error("Formation must contain 1 to 32 model segments");
  }
  const segments = formation.segments.map(normalizeSegment);
  if (new Set(segments.map((segment) => segment.id)).size !== segments.length) {
    throw new Error("Formation segment ids must be unique");
  }
  const tracking =
    stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION
      ? boundedString(
          formation.weaponBearerTracking ?? "legacy_aggregate",
          "Weapon bearer tracking mode",
          30,
        )
      : "legacy_aggregate";
  if (tracking !== "exact" && tracking !== "legacy_aggregate") {
    throw new Error("Weapon bearer tracking mode must be exact or legacy_aggregate");
  }
  const modelInstances =
    stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION && tracking === "exact"
      ? normalizeModelInstances(formation.modelInstances)
      : [];
  const normalized = {
    id: boundedString(formation.id, "Formation id"),
    playerId: boundedString(formation.playerId, "Formation player id", 100),
    sourceFormationId: boundedString(
      formation.sourceFormationId,
      "Formation source formation id",
      100,
    ),
    name: boundedString(formation.name, "Formation name"),
    assignedTransportFormationId:
      typeof formation.assignedTransportFormationId === "string" &&
      formation.assignedTransportFormationId
        ? boundedString(
            formation.assignedTransportFormationId,
            "Assigned Transport formation id",
            100,
          )
        : "",
    keywords: normalizeStringArray(formation.keywords ?? [], "Formation keywords", 100).map(
      (keyword) => keyword.toLowerCase(),
    ),
    segments,
  };
  if (
    stateVersion >= SETUP_RULES_BATTLE_STATE_VERSION ||
    formation.deploymentTraits !== undefined
  ) {
    const traits = record(
      formation.deploymentTraits ?? {},
      "Formation deployment traits must be an object",
    );
    normalized.deploymentTraits = {
      dedicatedTransport:
        traits.dedicatedTransport === undefined
          ? normalized.keywords.includes("dedicated transport")
          : Boolean(traits.dedicatedTransport),
      aircraft:
        traits.aircraft === undefined
          ? normalized.keywords.includes("aircraft")
          : Boolean(traits.aircraft),
      hover: Boolean(traits.hover),
    };
    if (
      normalized.deploymentTraits.dedicatedTransport !==
        normalized.keywords.includes("dedicated transport") ||
      normalized.deploymentTraits.aircraft !== normalized.keywords.includes("aircraft") ||
      (normalized.deploymentTraits.hover && !normalized.deploymentTraits.aircraft)
    ) {
      throw new Error("Formation deployment traits do not match its locked source facts");
    }
  }
  normalized.transportOptions = normalizeTransportOptions(
    formation.transportOptions ?? [],
    segments,
    stateVersion,
  );
  if (stateVersion >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
    normalized.weaponBearerTracking = tracking;
    normalized.modelInstances = modelInstances;
  }
  normalized.weaponInventory = normalizeWeaponInventory(
    formation.weaponInventory ?? [],
    segments,
    stateVersion,
    modelInstances,
    tracking,
  );
  normalized.defensiveEquipmentCounts = normalizeDefensiveEquipmentCounts(
    formation.defensiveEquipmentCounts ?? {},
    "Formation defensiveEquipmentCounts",
  );
  if (tracking === "exact") {
    const instances = new Map(modelInstances.map((model) => [model.id, model]));
    const assignedModels = segments.flatMap((segment) => segment.modelIds ?? []);
    if (
      assignedModels.length !== modelInstances.length ||
      new Set(assignedModels).size !== modelInstances.length ||
      assignedModels.some((modelId) => !instances.has(modelId))
    ) {
      throw new Error("Exact battle segments must partition every registered model instance");
    }
    for (const segment of segments) {
      if (!segment.baseSegmentId || !segment.modelIds || !segment.weaponCopies) {
        throw new Error("Exact weapon bearer tracking requires exact battle segments");
      }
      if (
        segment.modelIds.some(
          (modelId) => instances.get(modelId)?.baseSegmentId !== segment.baseSegmentId,
        )
      ) {
        throw new Error("Exact battle segment contains a model from another base profile");
      }
      const expected = normalized.weaponInventory.flatMap((group) => {
        const count = group.bearerModelIds.filter(
          (modelId) => modelId === segment.modelIds[0],
        ).length;
        return count > 0 ? [{ groupId: group.groupId, name: group.name, count }] : [];
      });
      if (
        segment.modelIds.some((modelId) =>
          normalized.weaponInventory.some(
            (group) =>
              group.bearerModelIds.filter((candidate) => candidate === modelId).length !==
              (expected.find((copy) => copy.groupId === group.groupId)?.count ?? 0),
          ),
        ) ||
        JSON.stringify(segment.weaponCopies) !== JSON.stringify(expected)
      ) {
        throw new Error(
          "Exact battle segment weapon signature does not match its bearer assignments",
        );
      }
    }
  }
  return normalized;
}

function weaponInventoryProfileIdentity(inventory) {
  return inventory.map(({ sourceSavedUnitId, groupId, name, count, profiles }) => ({
    sourceSavedUnitId,
    groupId,
    name,
    count,
    profiles,
  }));
}

function segmentsForBearerAssignments(formation, weaponInventory) {
  const existingByModelId = new Map(
    formation.segments.flatMap((segment) =>
      (segment.modelIds ?? []).map((modelId) => [modelId, segment]),
    ),
  );
  const grouped = new Map();
  for (const model of formation.modelInstances) {
    const source = existingByModelId.get(model.id);
    if (!source) throw new Error("Battle model is absent from its exact health segments");
    const weaponCopies = weaponInventory.flatMap((group) => {
      const count = group.bearerModelIds.filter((modelId) => modelId === model.id).length;
      return count > 0 ? [{ groupId: group.groupId, name: group.name, count }] : [];
    });
    const key = `${model.baseSegmentId}\u0000${JSON.stringify(
      weaponCopies.map(({ groupId, count }) => [groupId, count]),
    )}`;
    const entry = grouped.get(key) ?? { source, model, weaponCopies, modelIds: [] };
    entry.modelIds.push(model.id);
    grouped.set(key, entry);
  }
  const perBaseIndex = new Map();
  return [...grouped.values()].map(({ source, model, weaponCopies, modelIds }) => {
    const index = (perBaseIndex.get(model.baseSegmentId) ?? 0) + 1;
    perBaseIndex.set(model.baseSegmentId, index);
    return {
      id: `${model.baseSegmentId}:loadout:${index}`,
      baseSegmentId: model.baseSegmentId,
      savedUnitId: source.savedUnitId,
      unitName: source.unitName,
      modelName: source.modelName,
      role: source.role,
      keywords: source.keywords,
      wounds: source.wounds,
      objectiveControl: source.objectiveControl,
      feelNoPain: source.feelNoPain,
      startingModels: modelIds.length,
      modelIds,
      weaponCopies,
    };
  });
}

function prepareExactFormationRegistration(formation) {
  if (formation.weaponBearerTracking) return formation;
  const modelInstances = formation.segments.flatMap((segment) =>
    Array.from({ length: segment.startingModels }, (_, index) => ({
      id: `${segment.id}:model:${index + 1}`,
      baseSegmentId: segment.id,
      savedUnitId: segment.savedUnitId,
      unitName: segment.unitName,
      modelName: segment.modelName,
      keywords: segment.keywords ?? [],
      ordinal: index + 1,
    })),
  );
  const weaponInventory = (formation.weaponInventory ?? []).map((group) => {
    const candidates = modelInstances.filter(
      (model) => model.savedUnitId === group.sourceSavedUnitId,
    );
    if (candidates.length < 1) {
      throw new Error("Weapon inventory source has no registered model bearer");
    }
    const exact = candidates.length === 1 || group.count === candidates.length;
    const bearerModelIds =
      candidates.length === 1
        ? Array.from({ length: group.count }, () => candidates[0].id)
        : Array.from(
            { length: group.count },
            (_, index) => candidates[index % candidates.length].id,
          );
    return {
      ...group,
      bearerModelIds,
      bearerAssignmentsReviewed: exact,
      bearerAssignmentSource:
        candidates.length === 1 ? "single_model" : exact ? "one_per_model" : "setup_required",
    };
  });
  const provisional = {
    ...formation,
    weaponBearerTracking: "exact",
    modelInstances,
    weaponInventory,
    segments: formation.segments.map((segment) => ({
      ...segment,
      baseSegmentId: segment.id,
      modelIds: modelInstances
        .filter((model) => model.baseSegmentId === segment.id)
        .map((model) => model.id),
      weaponCopies: [],
    })),
  };
  const split = segmentsForBearerAssignments(provisional, weaponInventory);
  const countsByBase = new Map();
  for (const segment of split) {
    countsByBase.set(segment.baseSegmentId, (countsByBase.get(segment.baseSegmentId) ?? 0) + 1);
  }
  return {
    ...provisional,
    segments: split.map((segment) => ({
      ...segment,
      id: countsByBase.get(segment.baseSegmentId) === 1 ? segment.baseSegmentId : segment.id,
    })),
  };
}

function normalizeHealth(candidate, segment, label) {
  const health = record(candidate, `${label} health must be an object`);
  const modelsRemaining = nonnegativeInteger(
    health.modelsRemaining,
    `${label} modelsRemaining`,
    segment.startingModels,
  );
  const woundsLost = nonnegativeInteger(
    health.woundsLost,
    `${label} woundsLost`,
    segment.wounds - 1,
  );
  if (modelsRemaining === 0 && woundsLost !== 0) {
    throw new Error(`${label} destroyed segment cannot retain wounds`);
  }
  return { modelsRemaining, woundsLost };
}

function normalizeHealthAllocations(value, formation, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(`${label} must contain 1 to 32 segment allocations`);
  }
  const segmentMap = new Map(formation.segments.map((segment) => [segment.id, segment]));
  const allocations = value.map((candidateAllocation) => {
    const allocation = record(candidateAllocation, `Each ${label} allocation must be an object`);
    const segmentId = boundedString(allocation.segmentId, `${label} segment id`);
    const segment = segmentMap.get(segmentId);
    if (!segment) throw new Error(`${label} references an unknown segment`);
    return {
      segmentId,
      before: normalizeHealth(allocation.before, segment, `${label} before`),
      after: normalizeHealth(allocation.after, segment, `${label} after`),
    };
  });
  if (new Set(allocations.map((allocation) => allocation.segmentId)).size !== allocations.length) {
    throw new Error(`${label} allocations must reference unique segments`);
  }
  return allocations;
}

function normalizeDieRolls(value, name, { allowZero = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some((roll) => !Number.isSafeInteger(roll) || roll < (allowZero ? 0 : 1) || roll > 6)
  ) {
    throw new Error(`${name} must contain at most 1000 D6 results`);
  }
  return [...value];
}

function normalizeSummary(candidate) {
  const summary = record(candidate, "Attack summary must be an object");
  const normalized = {};
  for (const key of ["damage", "successful", "modelsDestroyed"]) {
    normalized[key] = nonnegativeInteger(summary[key], `Attack summary ${key}`);
  }
  for (const key of ["attacker", "weapon", "target"]) {
    normalized[key] = boundedString(summary[key], `Attack summary ${key}`);
  }
  return normalized;
}

function normalizeEvent(candidate, sequence, formations, stateVersion) {
  const event = record(candidate, "Each battle event must be an object");
  const normalized = {
    version: nonnegativeInteger(event.version, "Event version", BATTLE_EVENT_VERSION),
    id: boundedString(event.id, "Event id", 100),
    sequence: nonnegativeInteger(event.sequence, "Event sequence"),
    at: nonnegativeInteger(event.at, "Event timestamp", Number.MAX_SAFE_INTEGER),
    type: boundedString(event.type, "Event type", 40),
  };
  if (normalized.version !== BATTLE_EVENT_VERSION)
    throw new Error("Unsupported battle event version");
  if (normalized.sequence !== sequence) throw new Error("Battle event sequence is not contiguous");
  if (
    stateVersion < TIMELINE_BATTLE_STATE_VERSION &&
    [
      "battle_started",
      "clock_advanced",
      "choice_opened",
      "choice_resolved",
      "effect_applied",
    ].includes(event.type)
  ) {
    throw new Error("Battle timeline events require battle-state version 3");
  }
  if (
    stateVersion < TRACKER_BATTLE_STATE_VERSION &&
    [
      "mission_configured",
      "resource_changed",
      "score_recorded",
      "objective_control_changed",
      "objective_control_override_cleared",
      "battleshock_changed",
    ].includes(event.type)
  ) {
    throw new Error("Battle tracker events require battle-state version 4");
  }
  if (
    stateVersion < ACTION_BATTLE_STATE_VERSION &&
    [
      "movement_recorded",
      "charge_recorded",
      "activation_started",
      "activation_completed",
      "fight_priority_passed",
    ].includes(event.type)
  ) {
    throw new Error("Battle action events require battle-state version 5");
  }
  if (
    stateVersion < DEPLOYMENT_BATTLE_STATE_VERSION &&
    ["deployment_declared", "formation_deployed", "reserve_arrived"].includes(event.type)
  ) {
    throw new Error("Battle deployment events require battle-state version 6");
  }
  if (
    stateVersion < TRANSPORT_BATTLE_STATE_VERSION &&
    ["formation_embarked", "formation_disembarked", "transport_destroyed_resolved"].includes(
      event.type,
    )
  ) {
    throw new Error("Transport events require battle-state version 7");
  }
  if (
    stateVersion < TARGET_ELIGIBILITY_BATTLE_STATE_VERSION &&
    event.type === "ranged_target_eligibility_recorded"
  ) {
    throw new Error("Structured target eligibility requires battle-state version 8");
  }
  if (stateVersion < FIGHT_MOVE_BATTLE_STATE_VERSION && event.type === "fight_move_recorded") {
    throw new Error("Structured Fight movement requires battle-state version 12");
  }
  if (
    stateVersion < HEROIC_INTERVENTION_BATTLE_STATE_VERSION &&
    ["heroic_intervention_resolved", "heroic_intervention_passed"].includes(event.type)
  ) {
    throw new Error("Heroic Intervention reactions require battle-state version 13");
  }
  if (
    stateVersion < FIRE_OVERWATCH_BATTLE_STATE_VERSION &&
    [
      "movement_started",
      "charge_declared",
      "fire_overwatch_passed",
      "fire_overwatch_started",
    ].includes(event.type)
  ) {
    throw new Error("Fire Overwatch reactions require battle-state version 14");
  }
  if (
    stateVersion < HAZARDOUS_BATTLE_STATE_VERSION &&
    ["hazardous_tests_recorded", "hazardous_damage_resolved"].includes(event.type)
  ) {
    throw new Error("Hazardous resolution requires battle-state version 15");
  }
  if (
    stateVersion < GO_TO_GROUND_BATTLE_STATE_VERSION &&
    ["go_to_ground_passed", "go_to_ground_resolved"].includes(event.type)
  ) {
    throw new Error("Go to Ground reactions require battle-state version 16");
  }
  if (
    stateVersion < RANGED_DECLARATION_BATTLE_STATE_VERSION &&
    ["ranged_target_declaration_retracted", "ranged_targets_declared"].includes(event.type)
  ) {
    throw new Error("Activation-wide ranged declarations require battle-state version 17");
  }
  if (
    stateVersion < COUNTER_OFFENSIVE_BATTLE_STATE_VERSION &&
    ["counter_offensive_passed", "counter_offensive_resolved"].includes(event.type)
  ) {
    throw new Error("Counter-offensive reactions require battle-state version 21");
  }
  if (
    stateVersion < SMOKESCREEN_BATTLE_STATE_VERSION &&
    ["smokescreen_passed", "smokescreen_resolved"].includes(event.type)
  ) {
    throw new Error("Smokescreen reactions require battle-state version 22");
  }
  if (
    stateVersion < RAPID_INGRESS_BATTLE_STATE_VERSION &&
    ["rapid_ingress_passed", "rapid_ingress_resolved"].includes(event.type)
  ) {
    throw new Error("Rapid Ingress reactions require battle-state version 23");
  }
  if (
    stateVersion < RULE_COVERAGE_BATTLE_STATE_VERSION &&
    event.type === "rule_coverage_configured"
  ) {
    throw new Error("Rule coverage configuration requires battle-state version 24");
  }
  if (
    stateVersion < TABLE_GEOMETRY_BATTLE_STATE_VERSION &&
    event.type === "table_geometry_recorded"
  ) {
    throw new Error("Table geometry requires battle-state version 25");
  }
  if (event.type === "table_geometry_recorded") {
    normalized.geometry = normalizeTableGeometry(event.geometry);
    return normalized;
  }
  if (
    stateVersion < TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION &&
    event.type === "terrain_footprints_recorded"
  ) {
    throw new Error("Terrain footprints require battle-state version 26");
  }
  if (event.type === "terrain_footprints_recorded") {
    normalized.terrainFootprints = normalizeTerrainFootprintSet(event.terrainFootprints);
    return normalized;
  }
  if (
    stateVersion < TERRAIN_VISIBILITY_BATTLE_STATE_VERSION &&
    event.type === "terrain_visibility_recorded"
  ) {
    throw new Error("Terrain visibility geometry requires battle-state version 32");
  }
  if (event.type === "terrain_visibility_recorded") {
    normalized.terrainVisibility = normalizeTerrainVisibilityGeometry(event.terrainVisibility);
    return normalized;
  }
  if (
    stateVersion < MODEL_PLACEMENT_BATTLE_STATE_VERSION &&
    event.type === "model_placements_recorded"
  ) {
    throw new Error("Model placement requires battle-state version 27");
  }
  if (event.type === "model_placements_recorded") {
    normalized.formationId = boundedString(event.formationId, "Placed formation id", 100);
    const formation = formations.byId.get(normalized.formationId);
    if (!formation) throw new Error("Placed formation is not registered");
    normalized.placement = normalizeModelPlacementSet(event.placement, formation);
    return normalized;
  }
  if (
    stateVersion < MODEL_POSITION_BATTLE_STATE_VERSION &&
    event.type === "model_positions_recorded"
  ) {
    throw new Error("Model positions require battle-state version 28");
  }
  if (event.type === "model_positions_recorded") {
    normalized.formationId = boundedString(event.formationId, "Positioned formation id", 100);
    const formation = formations.byId.get(normalized.formationId);
    if (!formation) throw new Error("Positioned formation is not registered");
    normalized.position = normalizeModelPositionSet(event.position, formation);
    return normalized;
  }
  if (event.type === "formation_registered") {
    const formation = normalizeFormation(event.formation, stateVersion);
    if (!formations.players.has(formation.playerId)) throw new Error("Formation player is unknown");
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "formation_configured") {
    const formation = normalizeFormation(event.formation, stateVersion);
    const previous = formations.byId.get(formation.id);
    if (!previous) throw new Error("Configured formation is not registered");
    if (
      previous.playerId !== formation.playerId ||
      previous.sourceFormationId !== formation.sourceFormationId ||
      previous.assignedTransportFormationId !== formation.assignedTransportFormationId ||
      JSON.stringify(previous.deploymentTraits) !== JSON.stringify(formation.deploymentTraits) ||
      JSON.stringify(previous.transportOptions) !== JSON.stringify(formation.transportOptions) ||
      JSON.stringify(weaponInventoryProfileIdentity(previous.weaponInventory)) !==
        JSON.stringify(weaponInventoryProfileIdentity(formation.weaponInventory))
    ) {
      throw new Error("Formation identity cannot change during battle setup");
    }
    normalized.formation = formation;
    formations.byId.set(formation.id, formation);
    return normalized;
  }
  if (event.type === "rule_coverage_configured") {
    normalized.coverage = normalizeBattleRuleCoverageBinding(event.coverage);
    return normalized;
  }
  if (event.type === "battle_started") {
    normalized.firstPlayerId = boundedString(event.firstPlayerId, "First player id", 100);
    if (!formations.players.has(normalized.firstPlayerId)) {
      throw new Error("First player is unknown");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "clock_advanced") {
    normalized.from = normalizeClock(event.from, formations.players);
    normalized.to = normalizeClock(event.to, formations.players);
    normalized.expiredEffectIds = normalizeStringArray(
      event.expiredEffectIds,
      "Expired effect ids",
      1000,
    );
    return normalized;
  }
  if (event.type === "choice_opened") {
    normalized.choice = normalizeChoice(event.choice, formations.players);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "choice_resolved") {
    normalized.choiceId = boundedString(event.choiceId, "Resolved choice id", 100);
    normalized.selectedOptionIds = normalizeStringArray(
      event.selectedOptionIds,
      "Selected option ids",
      32,
    );
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "effect_applied") {
    normalized.effect = normalizeEffect(event.effect, formations.players);
    return normalized;
  }
  if (event.type === "mission_configured") {
    normalized.mission = normalizeMission(event.mission, formations.players);
    return normalized;
  }
  if (event.type === "resource_changed") {
    normalized.playerId = boundedString(event.playerId, "Resource player id", 100);
    if (!formations.players.has(normalized.playerId)) throw new Error("Resource player is unknown");
    normalized.resourceId = boundedString(event.resourceId, "Resource id", 100);
    normalized.name = boundedString(event.name, "Resource name", 100);
    normalized.before = nonnegativeInteger(event.before, "Resource value before change", 100000);
    normalized.after = nonnegativeInteger(event.after, "Resource value after change", 100000);
    normalized.maximum =
      event.maximum === null ? null : nonnegativeInteger(event.maximum, "Resource maximum", 100000);
    if (normalized.maximum !== null && normalized.after > normalized.maximum) {
      throw new Error("Resource value cannot exceed its maximum");
    }
    normalized.reason = boundedString(event.reason, "Resource change reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "score_recorded") {
    normalized.playerId = boundedString(event.playerId, "Scoring player id", 100);
    if (!formations.players.has(normalized.playerId)) throw new Error("Scoring player is unknown");
    normalized.category = boundedString(event.category, "Scoring category", 60);
    normalized.points = boundedInteger(event.points, "Scoring points", -1000, 1000);
    normalized.before = nonnegativeInteger(event.before, "Victory Points before score", 100000);
    normalized.after = nonnegativeInteger(event.after, "Victory Points after score", 100000);
    normalized.reason = boundedString(event.reason, "Scoring reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "objective_control_changed") {
    normalized.objectiveId = boundedString(event.objectiveId, "Objective id", 100);
    normalized.controllerPlayerId =
      typeof event.controllerPlayerId === "string" && event.controllerPlayerId
        ? boundedString(event.controllerPlayerId, "Objective controller", 100)
        : "";
    if (normalized.controllerPlayerId && !formations.players.has(normalized.controllerPlayerId)) {
      throw new Error("Objective controller is unknown");
    }
    normalized.contested = Boolean(event.contested);
    if (normalized.controllerPlayerId && normalized.contested) {
      throw new Error("A controlled objective cannot also be contested");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "objective_control_override_cleared") {
    normalized.objectiveId = boundedString(event.objectiveId, "Objective id", 100);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "battleshock_changed") {
    normalized.formationId = boundedString(event.formationId, "Battle-shock formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Battle-shock formation is not registered");
    }
    normalized.battleShocked = Boolean(event.battleShocked);
    normalized.reason = boundedString(event.reason, "Battle-shock reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "movement_started") {
    normalized.formationId = boundedString(event.formationId, "Moving formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Moving formation is not registered");
    }
    normalized.movement = boundedString(event.movement, "Movement kind", 20);
    if (!["normal", "advance", "fall_back"].includes(normalized.movement)) {
      throw new Error("Only a Normal, Advance, or Fall Back move has a start trigger");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "movement_recorded") {
    normalized.formationId = boundedString(event.formationId, "Movement formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Movement formation is not registered");
    }
    normalized.movement = boundedString(event.movement, "Movement kind", 20);
    if (!MOVEMENT_KINDS.includes(normalized.movement)) {
      throw new Error("Movement kind is unsupported");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "charge_declared") {
    normalized.formationId = boundedString(event.formationId, "Charging formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Charging formation is not registered");
    }
    normalized.targetFormationIds = normalizeStringArray(
      event.targetFormationIds,
      "Charge declaration target formation ids",
      12,
    );
    if (normalized.targetFormationIds.length < 1) {
      throw new Error("A charge declaration must name at least one target formation");
    }
    if (normalized.targetFormationIds.some((id) => !formations.byId.has(id))) {
      throw new Error("Charge declaration target formation is not registered");
    }
    if (!Array.isArray(event.targetFacts) || event.targetFacts.length < 1) {
      throw new Error("A charge declaration requires target distance facts");
    }
    normalized.targetFacts = event.targetFacts.map((candidate) => {
      const fact = record(candidate, "Each charge declaration target fact must be an object");
      return {
        formationId: boundedString(
          fact.formationId,
          "Charge declaration target fact formation id",
          100,
        ),
        startDistanceThousandths: nonnegativeInteger(
          fact.startDistanceThousandths,
          "Charge declaration target starting distance",
          12000,
        ),
      };
    });
    if (
      normalized.targetFacts.some((fact) => fact.startDistanceThousandths < 1) ||
      normalized.targetFacts.length !== normalized.targetFormationIds.length ||
      new Set(normalized.targetFacts.map((fact) => fact.formationId)).size !==
        normalized.targetFacts.length ||
      normalized.targetFormationIds.some(
        (formationId) => !normalized.targetFacts.some((fact) => fact.formationId === formationId),
      )
    ) {
      throw new Error("Charge declaration target facts must cover each target exactly once");
    }
    normalized.phaseStartEligibilityConfirmed = Boolean(event.phaseStartEligibilityConfirmed);
    normalized.phaseStartEligibilityReason = normalized.phaseStartEligibilityConfirmed
      ? boundedString(
          event.phaseStartEligibilityReason,
          "Charge declaration phase-start eligibility reason",
          300,
        )
      : "";
    normalized.startedOutsideEngagementRange = Boolean(event.startedOutsideEngagementRange);
    normalized.eligibilityOverride = Boolean(event.eligibilityOverride);
    normalized.overrideReason = normalized.eligibilityOverride
      ? boundedString(event.overrideReason, "Charge declaration eligibility override reason", 300)
      : "";
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "deployment_declared") {
    normalized.formationId = boundedString(event.formationId, "Deployment formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Deployment formation is not registered");
    }
    normalized.location = boundedString(event.location, "Deployment location", 40);
    if (!DEPLOYMENT_LOCATIONS.includes(normalized.location)) {
      throw new Error("Deployment location is unsupported");
    }
    if (normalized.location === "not_deployed" && stateVersion < SETUP_RULES_BATTLE_STATE_VERSION) {
      throw new Error("Not-deployed setup requires battle-state version 20");
    }
    normalized.transportFormationId =
      normalized.location === "embarked"
        ? boundedString(event.transportFormationId, "Embarked Transport formation id", 100)
        : "";
    if (normalized.transportFormationId && !formations.byId.has(normalized.transportFormationId)) {
      throw new Error("Embarked Transport formation is not registered");
    }
    normalized.points = nonnegativeInteger(event.points, "Deployment points", 100000);
    normalized.earliestBattleRound = nonnegativeInteger(
      event.earliestBattleRound,
      "Earliest reserve battle round",
      5,
    );
    if (normalized.earliestBattleRound < 1) {
      throw new Error("Earliest reserve battle round must be from 1 to 5");
    }
    if (
      normalized.location === "strategic_reserves" &&
      (normalized.points < 1 || normalized.earliestBattleRound < 2)
    ) {
      throw new Error("Strategic Reserves require points and cannot arrive in round one");
    }
    normalized.eligibilityConfirmed = Boolean(event.eligibilityConfirmed);
    normalized.eligibilityReason = normalized.eligibilityConfirmed
      ? boundedString(event.eligibilityReason, "Reserve eligibility confirmation", 300)
      : "";
    if (
      ["reserves", "strategic_reserves"].includes(normalized.location) &&
      !normalized.eligibilityConfirmed
    ) {
      throw new Error("A Reserves declaration requires explicit source-rule eligibility");
    }
    normalized.aircraftMode = event.aircraftMode ?? "";
    if (typeof normalized.aircraftMode !== "string" || normalized.aircraftMode.length > 20) {
      throw new Error("Aircraft setup mode must be a string of at most 20 characters");
    }
    if (!Object.hasOwn(AIRCRAFT_MODE, normalized.aircraftMode)) {
      throw new Error("Aircraft setup mode is unsupported");
    }
    return normalized;
  }
  if (event.type === "formation_deployed") {
    normalized.formationId = boundedString(event.formationId, "Deployed formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Deployed formation is not registered");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Deployment placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Deployment requires explicit deployment-zone and table-state confirmation");
    }
    return normalized;
  }
  if (event.type === "reserve_arrived") {
    normalized.formationId = boundedString(event.formationId, "Reserve formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Reserve formation is not registered");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Reserve placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Reserve arrival requires explicit placement confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "formation_embarked") {
    normalized.formationId = boundedString(event.formationId, "Embarking formation id", 100);
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Embarkation Transport formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.transportFormationId)
    ) {
      throw new Error("Embarkation references an unregistered formation");
    }
    normalized.rangeConfirmed = Boolean(event.rangeConfirmed);
    normalized.rangeReason = normalized.rangeConfirmed
      ? boundedString(event.rangeReason, "Embarkation range confirmation", 300)
      : "";
    if (!normalized.rangeConfirmed) {
      throw new Error("Embarkation requires explicit whole-unit 3-inch range confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "formation_disembarked") {
    normalized.formationId = boundedString(event.formationId, "Disembarking formation id", 100);
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Disembarkation Transport formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.transportFormationId)
    ) {
      throw new Error("Disembarkation references an unregistered formation");
    }
    normalized.placementConfirmed = Boolean(event.placementConfirmed);
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Disembarkation placement confirmation", 300)
      : "";
    if (!normalized.placementConfirmed) {
      throw new Error("Disembarkation requires explicit 3-inch placement confirmation");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "transport_destroyed_resolved") {
    normalized.transportFormationId = boundedString(
      event.transportFormationId,
      "Destroyed Transport formation id",
      100,
    );
    normalized.causeEventId = boundedString(
      event.causeEventId,
      "Destroyed Transport cause id",
      100,
    );
    if (!formations.byId.has(normalized.transportFormationId)) {
      throw new Error("Destroyed Transport is not registered");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    normalized.deadlyDemiseResolvedConfirmed = Boolean(event.deadlyDemiseResolvedConfirmed);
    normalized.deadlyDemiseResolutionReason = normalized.deadlyDemiseResolvedConfirmed
      ? boundedString(
          event.deadlyDemiseResolutionReason,
          "Deadly Demise resolution confirmation",
          300,
        )
      : "";
    if (!normalized.deadlyDemiseResolvedConfirmed) {
      throw new Error(
        "Destroyed Transport resolution requires confirmation that Deadly Demise was resolved first or does not apply",
      );
    }
    if (
      !Array.isArray(event.passengers) ||
      event.passengers.length < 1 ||
      event.passengers.length > 32
    ) {
      throw new Error("Destroyed Transport resolution must contain 1 to 32 passengers");
    }
    normalized.passengers = event.passengers.map((candidatePassenger) => {
      const passenger = record(
        candidatePassenger,
        "Each destroyed Transport passenger must be an object",
      );
      const formationId = boundedString(
        passenger.formationId,
        "Destroyed Transport passenger id",
        100,
      );
      const formation = formations.byId.get(formationId);
      if (!formation) throw new Error("Destroyed Transport passenger is not registered");
      const firstSegmentId = boundedString(
        passenger.firstSegmentId,
        "Destroyed Transport first allocation profile",
        100,
      );
      if (!formation.segments.some((segment) => segment.id === firstSegmentId)) {
        throw new Error("Destroyed Transport allocation profile is not in the passenger unit");
      }
      const emergency = Boolean(passenger.emergency);
      const placementConfirmed = Boolean(passenger.placementConfirmed);
      const placementReason = placementConfirmed
        ? boundedString(
            passenger.placementReason,
            "Destroyed Transport placement confirmation",
            300,
          )
        : "";
      if (!placementConfirmed) {
        throw new Error("Destroyed Transport disembarkation requires placement confirmation");
      }
      return {
        formationId,
        firstSegmentId,
        emergency,
        placementConfirmed,
        placementReason,
        unplacedModels: nonnegativeInteger(
          passenger.unplacedModels,
          "Unplaced passenger models",
          1000,
        ),
        rolls: normalizeDieRolls(passenger.rolls, "Destroyed Transport rolls"),
        feelNoPainRolls: normalizeDieRolls(
          passenger.feelNoPainRolls,
          "Destroyed Transport Feel No Pain rolls",
          { allowZero: true },
        ),
        summary: {
          damage: nonnegativeInteger(passenger.summary?.damage, "Destroyed Transport damage"),
          modelsDestroyed: nonnegativeInteger(
            passenger.summary?.modelsDestroyed,
            "Destroyed Transport casualties",
            1000,
          ),
        },
        allocations: normalizeHealthAllocations(
          passenger.allocations,
          formation,
          "Destroyed Transport",
        ),
      };
    });
    if (
      new Set(normalized.passengers.map((passenger) => passenger.formationId)).size !==
      normalized.passengers.length
    ) {
      throw new Error("Destroyed Transport passengers must be unique");
    }
    return normalized;
  }
  if (event.type === "charge_recorded") {
    normalized.formationId = boundedString(event.formationId, "Charge formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Charging formation is not registered");
    }
    normalized.targetFormationIds = normalizeStringArray(
      event.targetFormationIds,
      "Charge target formation ids",
      12,
    );
    if (normalized.targetFormationIds.length < 1) {
      throw new Error("A charge must name at least one target formation");
    }
    if (normalized.targetFormationIds.some((id) => !formations.byId.has(id))) {
      throw new Error("Charge target formation is not registered");
    }
    if (stateVersion >= CHARGE_MOVE_BATTLE_STATE_VERSION && Array.isArray(event.rolls)) {
      normalized.rolls = normalizeDieRolls(event.rolls, "Charge dice");
      if (normalized.rolls.length !== 2) throw new Error("A Charge roll must contain two D6 rolls");
      normalized.rollModifier = boundedInteger(event.rollModifier, "Charge roll modifier", -12, 12);
      normalized.chargeDistanceThousandths = nonnegativeInteger(
        event.chargeDistanceThousandths,
        "Charge distance",
        24_000,
      );
      normalized.rollOverrideReason = event.rollOverrideReason
        ? boundedString(event.rollOverrideReason, "Charge roll override reason", 300)
        : "";
      if (!Array.isArray(event.targetFacts) || event.targetFacts.length < 1) {
        throw new Error("Structured charge movement requires target facts");
      }
      normalized.targetFacts = event.targetFacts.map((candidate) => {
        const fact = record(candidate, "Each charge target fact must be an object");
        return {
          formationId: boundedString(fact.formationId, "Charge target fact formation id", 100),
          startDistanceThousandths: nonnegativeInteger(
            fact.startDistanceThousandths,
            "Charge target starting distance",
            12_000,
          ),
          endsWithinEngagementRange: Boolean(fact.endsWithinEngagementRange),
        };
      });
      if (
        normalized.targetFacts.some((fact) => fact.startDistanceThousandths < 1) ||
        new Set(normalized.targetFacts.map((fact) => fact.formationId)).size !==
          normalized.targetFacts.length ||
        normalized.targetFacts.length !== normalized.targetFormationIds.length ||
        normalized.targetFormationIds.some(
          (formationId) => !normalized.targetFacts.some((fact) => fact.formationId === formationId),
        )
      ) {
        throw new Error("Charge target facts must cover each selected target exactly once");
      }
      normalized.phaseStartEligibilityConfirmed = Boolean(event.phaseStartEligibilityConfirmed);
      normalized.phaseStartEligibilityReason = normalized.phaseStartEligibilityConfirmed
        ? boundedString(
            event.phaseStartEligibilityReason,
            "Charge phase-start eligibility reason",
            300,
          )
        : "";
      normalized.startedOutsideEngagementRange = Boolean(event.startedOutsideEngagementRange);
      normalized.maximumModelMoveThousandths = nonnegativeInteger(
        event.maximumModelMoveThousandths,
        "Maximum Charge move",
        24_000,
      );
      normalized.unitCoherencyConfirmed = Boolean(event.unitCoherencyConfirmed);
      normalized.nonTargetEngagementRangeAvoided = Boolean(event.nonTargetEngagementRangeAvoided);
      normalized.allModelsCloserToTarget = Boolean(event.allModelsCloserToTarget);
      normalized.baseContactMaximized = Boolean(event.baseContactMaximized);
      normalized.movementReviewedByPlayer = Boolean(event.movementReviewedByPlayer);
      normalized.movementReviewReason = normalized.movementReviewedByPlayer
        ? boundedString(event.movementReviewReason, "Charge movement review reason", 300)
        : "";
      normalized.successful = Boolean(event.successful);
      normalized.failureReason = normalized.successful
        ? ""
        : boundedString(event.failureReason, "Charge failure reason", 300);
    } else {
      normalized.successful = Boolean(event.successful);
      normalized.roll = nonnegativeInteger(event.roll, "Charge roll", 12);
      if (normalized.roll < 2) throw new Error("Charge roll must be from 2 to 12");
      normalized.targetEligibilityConfirmed = Boolean(event.targetEligibilityConfirmed);
      normalized.targetEligibilityReason = normalized.targetEligibilityConfirmed
        ? boundedString(event.targetEligibilityReason, "Charge target eligibility reason", 300)
        : "";
    }
    normalized.eligibilityOverride = Boolean(event.eligibilityOverride);
    normalized.overrideReason = normalized.eligibilityOverride
      ? boundedString(event.overrideReason, "Charge eligibility override reason", 300)
      : "";
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "heroic_intervention_passed") {
    normalized.triggerChargeEventId = boundedString(
      event.triggerChargeEventId,
      "Heroic Intervention trigger charge id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Heroic Intervention player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Heroic Intervention player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Heroic Intervention pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "heroic_intervention_resolved") {
    normalized.triggerChargeEventId = boundedString(
      event.triggerChargeEventId,
      "Heroic Intervention trigger charge id",
      100,
    );
    normalized.formationId = boundedString(
      event.formationId,
      "Heroic Intervention formation id",
      100,
    );
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Heroic Intervention target id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.targetFormationId)
    ) {
      throw new Error("Heroic Intervention references an unregistered formation");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Heroic Intervention Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Heroic Intervention",
      100000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Heroic Intervention",
      100000,
    );
    normalized.costOverrideReason = event.costOverrideReason
      ? boundedString(event.costOverrideReason, "Heroic Intervention cost override reason", 300)
      : "";
    normalized.usageOverrideReason = event.usageOverrideReason
      ? boundedString(event.usageOverrideReason, "Heroic Intervention usage override reason", 300)
      : "";
    normalized.stratagemEligibilityOverrideReason = event.stratagemEligibilityOverrideReason
      ? boundedString(
          event.stratagemEligibilityOverrideReason,
          "Heroic Intervention eligibility override reason",
          300,
        )
      : "";
    normalized.rolls = normalizeDieRolls(event.rolls, "Heroic Intervention charge dice");
    if (normalized.rolls.length !== 2) {
      throw new Error("A Heroic Intervention Charge roll must contain two D6 rolls");
    }
    normalized.rollModifier = boundedInteger(
      event.rollModifier,
      "Heroic Intervention roll modifier",
      -12,
      12,
    );
    normalized.chargeDistanceThousandths = nonnegativeInteger(
      event.chargeDistanceThousandths,
      "Heroic Intervention Charge distance",
      24000,
    );
    normalized.rollOverrideReason = event.rollOverrideReason
      ? boundedString(event.rollOverrideReason, "Heroic Intervention roll override reason", 300)
      : "";
    normalized.startDistanceThousandths = nonnegativeInteger(
      event.startDistanceThousandths,
      "Heroic Intervention starting distance",
      6000,
    );
    if (normalized.startDistanceThousandths < 1) {
      throw new Error("Heroic Intervention starting distance must be positive");
    }
    normalized.targetEligibilityConfirmed = Boolean(event.targetEligibilityConfirmed);
    normalized.targetEligibilityReason = normalized.targetEligibilityConfirmed
      ? boundedString(
          event.targetEligibilityReason,
          "Heroic Intervention target eligibility reason",
          300,
        )
      : "";
    normalized.startedOutsideEngagementRange = Boolean(event.startedOutsideEngagementRange);
    normalized.maximumModelMoveThousandths = nonnegativeInteger(
      event.maximumModelMoveThousandths,
      "Heroic Intervention maximum Charge move",
      24000,
    );
    normalized.endsWithinEngagementRange = Boolean(event.endsWithinEngagementRange);
    normalized.unitCoherencyConfirmed = Boolean(event.unitCoherencyConfirmed);
    normalized.nonTargetEngagementRangeAvoided = Boolean(event.nonTargetEngagementRangeAvoided);
    normalized.allModelsCloserToTarget = Boolean(event.allModelsCloserToTarget);
    normalized.baseContactMaximized = Boolean(event.baseContactMaximized);
    normalized.movementReviewedByPlayer = Boolean(event.movementReviewedByPlayer);
    normalized.movementReviewReason = normalized.movementReviewedByPlayer
      ? boundedString(event.movementReviewReason, "Heroic Intervention movement review", 300)
      : "";
    normalized.vehicleRestrictionSatisfied = Boolean(event.vehicleRestrictionSatisfied);
    normalized.soleTriggerTargetConfirmed = Boolean(event.soleTriggerTargetConfirmed);
    normalized.chargeBonusSuppressedConfirmed = Boolean(event.chargeBonusSuppressedConfirmed);
    normalized.successful = Boolean(event.successful);
    normalized.failureReason = normalized.successful
      ? ""
      : boundedString(event.failureReason, "Heroic Intervention failure reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "fire_overwatch_passed") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Fire Overwatch trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Fire Overwatch player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Fire Overwatch player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Fire Overwatch pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "go_to_ground_passed") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Go to Ground trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Go to Ground player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Go to Ground player is unknown");
    }
    normalized.targetFormationId =
      stateVersion >= RANGED_DECLARATION_BATTLE_STATE_VERSION && !event.targetFormationId
        ? ""
        : boundedString(event.targetFormationId, "Go to Ground target formation id", 100);
    if (normalized.targetFormationId && !formations.byId.has(normalized.targetFormationId)) {
      throw new Error("Go to Ground target formation is unknown");
    }
    normalized.reason = boundedString(event.reason, "Go to Ground pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "go_to_ground_resolved") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Go to Ground trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Go to Ground player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Go to Ground player is unknown");
    }
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Go to Ground target formation id",
      100,
    );
    if (!formations.byId.has(normalized.targetFormationId)) {
      throw new Error("Go to Ground target formation is unknown");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Go to Ground Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Go to Ground",
      100_000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Go to Ground",
      100_000,
    );
    normalized.allModelsHaveSixPlusInvulnerable = Boolean(event.allModelsHaveSixPlusInvulnerable);
    normalized.allModelsHaveBenefitOfCover = Boolean(event.allModelsHaveBenefitOfCover);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "smokescreen_passed") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Smokescreen trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Smokescreen player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Smokescreen player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Smokescreen pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "smokescreen_resolved") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Smokescreen trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Smokescreen player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Smokescreen player is unknown");
    }
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Smokescreen target formation id",
      100,
    );
    if (!formations.byId.has(normalized.targetFormationId)) {
      throw new Error("Smokescreen target formation is unknown");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Smokescreen Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Smokescreen",
      100_000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Smokescreen",
      100_000,
    );
    normalized.allModelsHaveBenefitOfCover = Boolean(event.allModelsHaveBenefitOfCover);
    normalized.allModelsHaveStealth = Boolean(event.allModelsHaveStealth);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "rapid_ingress_passed") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Rapid Ingress trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Rapid Ingress player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Rapid Ingress player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Rapid Ingress pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "rapid_ingress_resolved") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Rapid Ingress trigger event id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Rapid Ingress player id", 100);
    normalized.formationId = boundedString(event.formationId, "Rapid Ingress formation id", 100);
    if (
      !formations.players.has(normalized.playerId) ||
      !formations.byId.has(normalized.formationId)
    ) {
      throw new Error("Rapid Ingress references an unknown player or formation");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Rapid Ingress Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Rapid Ingress",
      100_000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Rapid Ingress",
      100_000,
    );
    normalized.placementMethod = boundedString(
      event.placementMethod,
      "Rapid Ingress placement method",
      30,
    );
    if (!RAPID_INGRESS_PLACEMENT_METHODS.includes(normalized.placementMethod)) {
      throw new Error("Rapid Ingress placement method is unsupported");
    }
    for (const key of [
      "placementConfirmed",
      "allModelsHaveDeepStrike",
      "whollyWithinSixOfBattlefieldEdge",
      "outsideEnemyDeploymentZone",
      "moreThanNineFromEnemyModels",
      "largeModelEdgeException",
      "touchingOwnBattlefieldEdge",
      "sourceRulePlacementConfirmed",
      "firstRoundOutOfPhaseAllowed",
      "arrivesAsReinforcements",
      "passengersRemainEmbarked",
    ]) {
      normalized[key] = Boolean(event[key]);
    }
    normalized.placementReason = normalized.placementConfirmed
      ? boundedString(event.placementReason, "Rapid Ingress placement confirmation", 300)
      : "";
    normalized.firstRoundOutOfPhaseReason = normalized.firstRoundOutOfPhaseAllowed
      ? boundedString(
          event.firstRoundOutOfPhaseReason,
          "Rapid Ingress first-round source rule",
          300,
        )
      : "";
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "fire_overwatch_started") {
    normalized.triggerEventId = boundedString(
      event.triggerEventId,
      "Fire Overwatch trigger event id",
      100,
    );
    normalized.formationId = boundedString(event.formationId, "Fire Overwatch formation id", 100);
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Fire Overwatch target id",
      100,
    );
    if (
      !formations.byId.has(normalized.formationId) ||
      !formations.byId.has(normalized.targetFormationId)
    ) {
      throw new Error("Fire Overwatch references an unregistered formation");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Fire Overwatch Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Fire Overwatch",
      100000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Fire Overwatch",
      100000,
    );
    normalized.costOverrideReason = event.costOverrideReason
      ? boundedString(event.costOverrideReason, "Fire Overwatch cost override reason", 300)
      : "";
    normalized.usageOverrideReason = event.usageOverrideReason
      ? boundedString(event.usageOverrideReason, "Fire Overwatch usage override reason", 300)
      : "";
    normalized.stratagemEligibilityOverrideReason = event.stratagemEligibilityOverrideReason
      ? boundedString(
          event.stratagemEligibilityOverrideReason,
          "Fire Overwatch eligibility override reason",
          300,
        )
      : "";
    normalized.distanceThousandths = nonnegativeInteger(
      event.distanceThousandths,
      "Fire Overwatch distance",
      24000,
    );
    normalized.targetVisible = Boolean(event.targetVisible);
    normalized.shootingEligibilityConfirmed = Boolean(event.shootingEligibilityConfirmed);
    normalized.shootingEligibilityReason = normalized.shootingEligibilityConfirmed
      ? boundedString(
          event.shootingEligibilityReason,
          "Fire Overwatch shooting eligibility reason",
          300,
        )
      : "";
    normalized.outOfPhaseRestrictionsConfirmed = Boolean(event.outOfPhaseRestrictionsConfirmed);
    normalized.outOfPhaseRestrictionsReason = normalized.outOfPhaseRestrictionsConfirmed
      ? boundedString(
          event.outOfPhaseRestrictionsReason,
          "Fire Overwatch out-of-phase review reason",
          300,
        )
      : "";
    normalized.hitsOnUnmodifiedSixConfirmed = Boolean(event.hitsOnUnmodifiedSixConfirmed);
    normalized.criticalHitsOnSixConfirmed = Boolean(event.criticalHitsOnSixConfirmed);
    normalized.titanicRestrictionSatisfied = Boolean(event.titanicRestrictionSatisfied);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "activation_started") {
    normalized.formationId = boundedString(event.formationId, "Activation formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Activation formation is not registered");
    }
    normalized.activationType = boundedString(event.activationType, "Activation type", 20);
    if (!ACTIVATION_TYPES.includes(normalized.activationType)) {
      throw new Error("Activation type is unsupported");
    }
    normalized.weaponHasAssault = Boolean(event.weaponHasAssault);
    normalized.eligibilityOverride = Boolean(event.eligibilityOverride);
    normalized.overrideReason = normalized.eligibilityOverride
      ? boundedString(event.overrideReason, "Activation eligibility override reason", 300)
      : "";
    normalized.fightsFirst = Boolean(event.fightsFirst);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "fight_move_recorded") {
    normalized.formationId = boundedString(event.formationId, "Fight movement formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Fight movement formation is not registered");
    }
    normalized.activationEventId = boundedString(
      event.activationEventId,
      "Fight movement activation event id",
      100,
    );
    normalized.stage = boundedString(event.stage, "Fight movement stage", 20);
    if (!FIGHT_MOVE_STAGES.includes(normalized.stage)) {
      throw new Error("Fight movement stage is unsupported");
    }
    normalized.destination = boundedString(event.destination, "Fight movement destination", 20);
    if (!FIGHT_MOVE_DESTINATIONS.includes(normalized.destination)) {
      throw new Error("Fight movement destination is unsupported");
    }
    if (normalized.stage === "pile_in" && normalized.destination === "objective") {
      throw new Error("A Pile-in move cannot use an objective destination");
    }
    normalized.maximumModelMoveThousandths = nonnegativeInteger(
      event.maximumModelMoveThousandths,
      "Fight movement maximum model move",
      3000,
    );
    normalized.movementReviewedByPlayer = Boolean(event.movementReviewedByPlayer);
    normalized.movementReviewReason = normalized.movementReviewedByPlayer
      ? boundedString(event.movementReviewReason, "Fight movement review reason", 300)
      : "";
    normalized.baseContactModelsStationary = Boolean(event.baseContactModelsStationary);
    normalized.unitCoherencyConfirmed = Boolean(event.unitCoherencyConfirmed);
    normalized.endsWithinEngagementRange = Boolean(event.endsWithinEngagementRange);
    normalized.allMovedModelsCloserToEnemy = Boolean(event.allMovedModelsCloserToEnemy);
    normalized.baseContactMaximized = Boolean(event.baseContactMaximized);
    normalized.enemyDestinationImpossible = Boolean(event.enemyDestinationImpossible);
    normalized.objectiveId =
      normalized.destination === "objective"
        ? boundedString(event.objectiveId, "Consolidation objective id", 100)
        : "";
    normalized.endsWithinObjectiveRange = Boolean(event.endsWithinObjectiveRange);
    normalized.allMovedModelsCloserToObjective = Boolean(event.allMovedModelsCloserToObjective);
    normalized.objectiveDestinationImpossible = Boolean(event.objectiveDestinationImpossible);
    normalized.movementRuleRestricted = Boolean(event.movementRuleRestricted);
    normalized.movementRuleRestrictionReason = normalized.movementRuleRestricted
      ? boundedString(event.movementRuleRestrictionReason, "Fight movement rule restriction", 300)
      : "";
    normalized.outcomeReason =
      normalized.destination === "enemy"
        ? ""
        : boundedString(event.outcomeReason, "Fight movement outcome reason", 300);
    normalized.meleeAttacksCompleteConfirmed =
      normalized.stage === "consolidation" && Boolean(event.meleeAttacksCompleteConfirmed);
    normalized.meleeAttacksCompletionReason = normalized.meleeAttacksCompleteConfirmed
      ? boundedString(event.meleeAttacksCompletionReason, "Melee attacks completion reason", 300)
      : "";
    if (normalized.stage === "consolidation" && !normalized.meleeAttacksCompleteConfirmed) {
      throw new Error("Consolidation requires confirmation that melee attacks are complete");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "activation_completed") {
    normalized.formationId = boundedString(event.formationId, "Activation formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Activation formation is not registered");
    }
    normalized.activationType = boundedString(event.activationType, "Activation type", 20);
    if (!ACTIVATION_TYPES.includes(normalized.activationType)) {
      throw new Error("Activation type is unsupported");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "hazardous_tests_recorded") {
    normalized.activationEventId = boundedString(
      event.activationEventId,
      "Hazardous activation event id",
      100,
    );
    normalized.formationId = boundedString(event.formationId, "Hazardous formation id", 100);
    if (!formations.byId.has(normalized.formationId)) {
      throw new Error("Hazardous tests reference an unregistered formation");
    }
    if (!Array.isArray(event.tests) || event.tests.length < 1 || event.tests.length > 1000) {
      throw new Error("Hazardous tests must contain 1 to 1000 rolls");
    }
    normalized.tests = event.tests.map((candidate) => {
      const test = record(candidate, "Each Hazardous test must be an object");
      const initialRoll = nonnegativeInteger(test.initialRoll, "Hazardous initial roll", 6);
      const reroll = nonnegativeInteger(test.reroll ?? 0, "Hazardous re-roll", 6);
      if (initialRoll < 1 || (reroll !== 0 && reroll < 1)) {
        throw new Error("Hazardous rolls must be D6 results");
      }
      const rerollReason = reroll
        ? boundedString(test.rerollReason, "Hazardous re-roll reason", 300).trim()
        : "";
      if (reroll && !rerollReason) {
        throw new Error("A Hazardous re-roll requires its source rule or Stratagem");
      }
      return { initialRoll, reroll, rerollReason };
    });
    normalized.deferredUntilChargeMove = Boolean(event.deferredUntilChargeMove);
    normalized.triggerChargeEventId = normalized.deferredUntilChargeMove
      ? boundedString(event.triggerChargeEventId, "Hazardous trigger Charge event id", 100)
      : "";
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "hazardous_damage_resolved") {
    normalized.testEventId = boundedString(event.testEventId, "Hazardous test event id", 100);
    normalized.testIndex = nonnegativeInteger(event.testIndex, "Hazardous test index", 999);
    normalized.formationId = boundedString(event.formationId, "Hazardous formation id", 100);
    const formation = formations.byId.get(normalized.formationId);
    if (!formation) throw new Error("Hazardous damage references an unregistered formation");
    normalized.selectedSegmentId = event.selectedSegmentId
      ? boundedString(event.selectedSegmentId, "Hazardous selected segment id", 100)
      : "";
    normalized.noEligibleBearer = Boolean(event.noEligibleBearer);
    normalized.selectionReason = boundedString(
      event.selectionReason,
      "Hazardous bearer selection reason",
      300,
    ).trim();
    normalized.feelNoPainRolls = normalizeDieRolls(
      event.feelNoPainRolls ?? [],
      "Hazardous Feel No Pain rolls",
    );
    const summary = record(event.summary, "Hazardous summary must be an object");
    normalized.summary = {
      damage: nonnegativeInteger(summary.damage, "Hazardous applied damage", 3),
      modelsDestroyed: nonnegativeInteger(summary.modelsDestroyed, "Hazardous destroyed models", 1),
    };
    if (event.allocation === null || event.allocation === undefined) {
      normalized.allocation = null;
    } else {
      const allocation = record(event.allocation, "Hazardous allocation must be an object");
      const segmentId = boundedString(allocation.segmentId, "Hazardous allocation segment id", 100);
      const segment = formation.segments.find((candidate) => candidate.id === segmentId);
      if (!segment) throw new Error("Hazardous allocation references an unknown segment");
      normalized.allocation = {
        segmentId,
        before: normalizeHealth(allocation.before, segment, "Hazardous allocation before"),
        after: normalizeHealth(allocation.after, segment, "Hazardous allocation after"),
      };
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "fight_priority_passed") {
    normalized.playerId = boundedString(event.playerId, "Passing player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Passing player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Fight priority pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "counter_offensive_passed") {
    normalized.triggerActivationEventId = boundedString(
      event.triggerActivationEventId,
      "Counter-offensive trigger activation id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Counter-offensive player id", 100);
    if (!formations.players.has(normalized.playerId)) {
      throw new Error("Counter-offensive player is unknown");
    }
    normalized.reason = boundedString(event.reason, "Counter-offensive pass reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "counter_offensive_resolved") {
    normalized.triggerActivationEventId = boundedString(
      event.triggerActivationEventId,
      "Counter-offensive trigger activation id",
      100,
    );
    normalized.playerId = boundedString(event.playerId, "Counter-offensive player id", 100);
    normalized.formationId = boundedString(
      event.formationId,
      "Counter-offensive formation id",
      100,
    );
    if (
      !formations.players.has(normalized.playerId) ||
      !formations.byId.has(normalized.formationId)
    ) {
      throw new Error("Counter-offensive references an unknown player or formation");
    }
    normalized.commandPointCost = nonnegativeInteger(
      event.commandPointCost,
      "Counter-offensive Command Point cost",
      5,
    );
    normalized.commandPointsBefore = nonnegativeInteger(
      event.commandPointsBefore,
      "Command Points before Counter-offensive",
      100_000,
    );
    normalized.commandPointsAfter = nonnegativeInteger(
      event.commandPointsAfter,
      "Command Points after Counter-offensive",
      100_000,
    );
    normalized.targetInEngagementRange = Boolean(event.targetInEngagementRange);
    normalized.targetEligibilityReason = normalized.targetInEngagementRange
      ? boundedString(event.targetEligibilityReason, "Counter-offensive eligibility reason", 300)
      : "";
    normalized.fightsNextConfirmed = Boolean(event.fightsNextConfirmed);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "ranged_target_eligibility_recorded") {
    normalized.attackerFormationId = boundedString(
      event.attackerFormationId,
      "Target measurement attacker formation id",
      100,
    );
    normalized.targetFormationId = boundedString(
      event.targetFormationId,
      "Target measurement target formation id",
      100,
    );
    if (
      !formations.byId.has(normalized.attackerFormationId) ||
      !formations.byId.has(normalized.targetFormationId)
    ) {
      throw new Error("Target measurement references an unregistered formation");
    }
    normalized.weaponId = boundedString(event.weaponId, "Target measurement weapon id", 100);
    normalized.weaponName = boundedString(event.weaponName, "Target measurement weapon name", 200);
    if (stateVersion >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.weaponSourceFormationId = event.weaponSourceFormationId
        ? boundedString(
            event.weaponSourceFormationId,
            "Target measurement weapon source formation id",
            100,
          )
        : "";
      normalized.sourceSavedUnitId = event.sourceSavedUnitId
        ? boundedString(
            event.sourceSavedUnitId,
            "Target measurement weapon source saved unit id",
            100,
          )
        : "";
      normalized.weaponGroupId = event.weaponGroupId
        ? boundedString(event.weaponGroupId, "Target measurement weapon group id", 200)
        : "";
      normalized.clock = normalizeClock(event.clock, formations.players);
    }
    if (stateVersion >= RANGED_DECLARATION_BATTLE_STATE_VERSION) {
      normalized.activationEventId = event.activationEventId
        ? boundedString(event.activationEventId, "Target declaration activation id", 100)
        : "";
    }
    normalized.publishedRangeThousandths = nonnegativeInteger(
      event.publishedRangeThousandths,
      "Published weapon range thousandths",
      1_000_000,
    );
    normalized.effectiveRangeThousandths = nonnegativeInteger(
      event.effectiveRangeThousandths,
      "Effective weapon range thousandths",
      1_000_000,
    );
    normalized.measuredDistanceThousandths = nonnegativeInteger(
      event.measuredDistanceThousandths,
      "Measured target distance thousandths",
      1_000_000,
    );
    normalized.visible = Boolean(event.visible);
    normalized.fullyVisible = Boolean(event.fullyVisible);
    if (normalized.fullyVisible && !normalized.visible) {
      throw new Error("A fully visible target must also be visible");
    }
    normalized.indirectFire = Boolean(event.indirectFire);
    normalized.weaponHasIndirect = Boolean(event.weaponHasIndirect);
    if (normalized.indirectFire && normalized.visible) {
      throw new Error("Indirect Fire state applies only when the target is not visible");
    }
    normalized.eligibleWeaponCount = nonnegativeInteger(
      event.eligibleWeaponCount,
      "Eligible weapon count",
      1000,
    );
    if (stateVersion >= RANGED_DECLARATION_BATTLE_STATE_VERSION) {
      normalized.declaredWeaponCount = nonnegativeInteger(
        event.declaredWeaponCount ?? 0,
        "Declared weapon count",
        1000,
      );
      normalized.attackSnapshot =
        event.attackSnapshot == null ? null : normalizeRangedAttackSnapshot(event.attackSnapshot);
    }
    normalized.method = boundedString(event.method, "Target measurement method", 20);
    if (!TARGET_MEASUREMENT_METHODS.includes(normalized.method)) {
      throw new Error("Target measurement method is unsupported");
    }
    normalized.reviewedByPlayer = Boolean(event.reviewedByPlayer);
    normalized.reviewReason = normalized.reviewedByPlayer
      ? boundedString(event.reviewReason, "Target measurement review", 300).trim()
      : "";
    if (!normalized.reviewedByPlayer) {
      throw new Error("Target measurement must be reviewed by a player");
    }
    if (!normalized.reviewReason) {
      throw new Error("Target measurement review must explain the checked tabletop facts");
    }
    normalized.rangeOverrideReason =
      normalized.effectiveRangeThousandths !== normalized.publishedRangeThousandths
        ? boundedString(event.rangeOverrideReason, "Weapon range override reason", 300).trim()
        : "";
    if (
      normalized.effectiveRangeThousandths !== normalized.publishedRangeThousandths &&
      !normalized.rangeOverrideReason
    ) {
      throw new Error("Weapon range override must name the rule or effect changing Range");
    }
    if (stateVersion >= RANGED_GEOMETRY_BATTLE_STATE_VERSION && event.geometryDecision != null) {
      normalized.geometryDecision = normalizeRangedGeometryDecision(event.geometryDecision);
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "ranged_target_declaration_retracted") {
    normalized.activationEventId = boundedString(
      event.activationEventId,
      "Ranged declaration activation id",
      100,
    );
    normalized.declarationEventId = boundedString(
      event.declarationEventId,
      "Retracted ranged declaration event id",
      100,
    );
    normalized.reason = boundedString(event.reason, "Ranged declaration retraction reason", 300);
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "ranged_targets_declared") {
    normalized.activationEventId = boundedString(
      event.activationEventId,
      "Ranged declaration activation id",
      100,
    );
    if (
      !Array.isArray(event.declarationEventIds) ||
      event.declarationEventIds.length < 1 ||
      event.declarationEventIds.length > 256
    ) {
      throw new Error("Ranged target declaration must contain 1 to 256 attacks");
    }
    normalized.declarationEventIds = event.declarationEventIds.map((id) =>
      boundedString(id, "Ranged declaration event id", 100),
    );
    normalized.declarationCount = nonnegativeInteger(
      event.declarationCount,
      "Ranged declaration count",
      256,
    );
    normalized.uniqueDeclarationCount = nonnegativeInteger(
      event.uniqueDeclarationCount,
      "Unique ranged declaration count",
      256,
    );
    normalized.targetRunCount = nonnegativeInteger(
      event.targetRunCount,
      "Ranged declaration target run count",
      256,
    );
    normalized.uniqueTargetCount = nonnegativeInteger(
      event.uniqueTargetCount,
      "Ranged declaration unique target count",
      256,
    );
    normalized.profileRunCount = nonnegativeInteger(
      event.profileRunCount,
      "Ranged declaration profile run count",
      256,
    );
    normalized.uniqueTargetProfileCount = nonnegativeInteger(
      event.uniqueTargetProfileCount,
      "Ranged declaration unique target/profile count",
      256,
    );
    normalized.flags = nonnegativeInteger(event.flags, "Ranged declaration flags", 63);
    normalized.reactionOrder = event.reactionOrder
      ? boundedString(event.reactionOrder, "Ranged reaction order", 30)
      : "";
    if (
      normalized.reactionOrder &&
      !["go_to_ground_first", "smokescreen_first"].includes(normalized.reactionOrder)
    ) {
      throw new Error("Ranged reaction order is unknown");
    }
    normalized.clock = normalizeClock(event.clock, formations.players);
    return normalized;
  }
  if (event.type === "attack_resolved") {
    normalized.attackerFormationId = boundedString(
      event.attackerFormationId,
      "Attacker formation id",
    );
    normalized.targetFormationId = boundedString(event.targetFormationId, "Target formation id");
    if (
      stateVersion >= TIMELINE_BATTLE_STATE_VERSION &&
      !formations.byId.has(normalized.attackerFormationId)
    ) {
      throw new Error("Attack attacker formation is not registered");
    }
    const target = formations.byId.get(normalized.targetFormationId);
    if (!target) throw new Error("Attack target formation is not registered");
    normalized.summary = normalizeSummary(event.summary);
    normalized.weaponHasAssault = Boolean(event.weaponHasAssault);
    normalized.weaponType =
      event.weaponType === "Ranged" || event.weaponType === "Melee" ? event.weaponType : "";
    normalized.targetEligibilityConfirmed = Boolean(event.targetEligibilityConfirmed);
    normalized.targetEligibilityReason = normalized.targetEligibilityConfirmed
      ? boundedString(event.targetEligibilityReason, "Target eligibility confirmation", 300)
      : "";
    if (stateVersion >= TARGET_ELIGIBILITY_BATTLE_STATE_VERSION) {
      normalized.targetEligibilityEventId = event.targetEligibilityEventId
        ? boundedString(event.targetEligibilityEventId, "Target eligibility event id", 100)
        : "";
      normalized.weaponId = event.weaponId
        ? boundedString(event.weaponId, "Attack weapon id", 100)
        : "";
      normalized.declaredWeaponCount = nonnegativeInteger(
        event.declaredWeaponCount ?? 0,
        "Declared attacking weapon count",
        1000,
      );
      normalized.indirectFire = Boolean(event.indirectFire);
    }
    if (stateVersion >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.weaponSourceFormationId = event.weaponSourceFormationId
        ? boundedString(event.weaponSourceFormationId, "Attack weapon source formation id", 100)
        : "";
      normalized.sourceSavedUnitId = event.sourceSavedUnitId
        ? boundedString(event.sourceSavedUnitId, "Attack weapon source saved unit id", 100)
        : "";
      normalized.weaponGroupId = event.weaponGroupId
        ? boundedString(event.weaponGroupId, "Attack weapon group id", 200)
        : "";
      normalized.clock = event.clock
        ? normalizeClock(event.clock, formations.players)
        : setupBattleClock();
    }
    if (stateVersion >= FIRE_OVERWATCH_BATTLE_STATE_VERSION) {
      normalized.activationEventId = event.activationEventId
        ? boundedString(event.activationEventId, "Attack activation event id", 100)
        : "";
    }
    if (
      !Array.isArray(event.allocations) ||
      event.allocations.length < 1 ||
      event.allocations.length > 32
    ) {
      throw new Error("Attack must contain 1 to 32 segment allocations");
    }
    const segmentMap = new Map(target.segments.map((segment) => [segment.id, segment]));
    normalized.allocations = event.allocations.map((candidateAllocation) => {
      const allocation = record(candidateAllocation, "Each attack allocation must be an object");
      const segmentId = boundedString(allocation.segmentId, "Allocation segment id");
      const segment = segmentMap.get(segmentId);
      if (!segment) throw new Error("Attack allocation references an unknown segment");
      return {
        segmentId,
        before: normalizeHealth(allocation.before, segment, "Allocation before"),
        after: normalizeHealth(allocation.after, segment, "Allocation after"),
      };
    });
    if (
      new Set(normalized.allocations.map((allocation) => allocation.segmentId)).size !==
      normalized.allocations.length
    ) {
      throw new Error("Attack allocations must reference unique segments");
    }
    return normalized;
  }
  if (event.type === "attack_reverted") {
    normalized.revertsEventId = boundedString(event.revertsEventId, "Reverted event id", 100);
    return normalized;
  }
  throw new Error(`Unsupported battle event type: ${event.type}`);
}

export function createBattleState({
  id,
  createdAt,
  rulesSnapshot = "catalogue-current",
  players,
  ruleCoverage = null,
}) {
  return normalizeBattleState({
    version: BATTLE_STATE_VERSION,
    id,
    createdAt,
    rulesSnapshot,
    players,
    events: ruleCoverage
      ? [
          {
            version: BATTLE_EVENT_VERSION,
            id: "battle-rule-coverage-initial",
            sequence: 1,
            at: 0,
            type: "rule_coverage_configured",
            coverage: ruleCoverage,
          },
        ]
      : [],
  });
}

export function normalizeBattleState(candidate) {
  const state = record(candidate, "Battle state must be an object");
  if (
    ![
      LEGACY_BATTLE_STATE_VERSION,
      ROSTER_BATTLE_STATE_VERSION,
      TIMELINE_BATTLE_STATE_VERSION,
      TRACKER_BATTLE_STATE_VERSION,
      ACTION_BATTLE_STATE_VERSION,
      DEPLOYMENT_BATTLE_STATE_VERSION,
      TRANSPORT_BATTLE_STATE_VERSION,
      TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
      WEAPON_INVENTORY_BATTLE_STATE_VERSION,
      WEAPON_BEARER_BATTLE_STATE_VERSION,
      CHARGE_MOVE_BATTLE_STATE_VERSION,
      FIGHT_MOVE_BATTLE_STATE_VERSION,
      HEROIC_INTERVENTION_BATTLE_STATE_VERSION,
      FIRE_OVERWATCH_BATTLE_STATE_VERSION,
      HAZARDOUS_BATTLE_STATE_VERSION,
      GO_TO_GROUND_BATTLE_STATE_VERSION,
      RANGED_DECLARATION_BATTLE_STATE_VERSION,
      TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION,
      TRANSPORT_NESTING_BATTLE_STATE_VERSION,
      SETUP_RULES_BATTLE_STATE_VERSION,
      COUNTER_OFFENSIVE_BATTLE_STATE_VERSION,
      SMOKESCREEN_BATTLE_STATE_VERSION,
      RAPID_INGRESS_BATTLE_STATE_VERSION,
      RULE_COVERAGE_BATTLE_STATE_VERSION,
      TABLE_GEOMETRY_BATTLE_STATE_VERSION,
      TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION,
      MODEL_PLACEMENT_BATTLE_STATE_VERSION,
      MODEL_POSITION_BATTLE_STATE_VERSION,
      EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION,
      TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION,
      SPATIAL_FACTS_BATTLE_STATE_VERSION,
      TERRAIN_VISIBILITY_BATTLE_STATE_VERSION,
      RANGED_GEOMETRY_BATTLE_STATE_VERSION,
      CONVEX_SILHOUETTE_BATTLE_STATE_VERSION,
      BATTLE_STATE_VERSION,
    ].includes(state.version)
  ) {
    throw new Error(`Unsupported battle state version: ${String(state.version)}`);
  }
  const players = normalizePlayers(state.players, state.version);
  if (!Array.isArray(state.events) || state.events.length > 10_000) {
    throw new Error("Battle state events must contain at most 10000 entries");
  }
  const formations = { players: new Set(players.map((player) => player.id)), byId: new Map() };
  const events = state.events.map((event, index) =>
    normalizeEvent(event, index + 1, formations, state.version),
  );
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error("Battle event ids must be unique");
  }
  const normalized = {
    version: state.version,
    id: boundedString(state.id, "Battle state id", 100),
    createdAt: nonnegativeInteger(state.createdAt, "Battle createdAt", Number.MAX_SAFE_INTEGER),
    rulesSnapshot: boundedString(state.rulesSnapshot, "Battle rules snapshot"),
    players,
    events,
  };
  if (state.version >= TIMELINE_BATTLE_STATE_VERSION && state.migration !== undefined) {
    const migration = record(state.migration, "Battle migration must be an object");
    const sourceVersion = nonnegativeInteger(
      migration.sourceVersion,
      "Battle migration source version",
      state.version - 1,
    );
    if (
      ![
        LEGACY_BATTLE_STATE_VERSION,
        ROSTER_BATTLE_STATE_VERSION,
        TIMELINE_BATTLE_STATE_VERSION,
        TRACKER_BATTLE_STATE_VERSION,
        ACTION_BATTLE_STATE_VERSION,
        DEPLOYMENT_BATTLE_STATE_VERSION,
        TRANSPORT_BATTLE_STATE_VERSION,
        TARGET_ELIGIBILITY_BATTLE_STATE_VERSION,
        WEAPON_INVENTORY_BATTLE_STATE_VERSION,
        WEAPON_BEARER_BATTLE_STATE_VERSION,
        CHARGE_MOVE_BATTLE_STATE_VERSION,
        FIGHT_MOVE_BATTLE_STATE_VERSION,
        HEROIC_INTERVENTION_BATTLE_STATE_VERSION,
        FIRE_OVERWATCH_BATTLE_STATE_VERSION,
        HAZARDOUS_BATTLE_STATE_VERSION,
        GO_TO_GROUND_BATTLE_STATE_VERSION,
        RANGED_DECLARATION_BATTLE_STATE_VERSION,
        TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION,
        TRANSPORT_NESTING_BATTLE_STATE_VERSION,
        SETUP_RULES_BATTLE_STATE_VERSION,
        COUNTER_OFFENSIVE_BATTLE_STATE_VERSION,
        SMOKESCREEN_BATTLE_STATE_VERSION,
        RAPID_INGRESS_BATTLE_STATE_VERSION,
        RULE_COVERAGE_BATTLE_STATE_VERSION,
        TABLE_GEOMETRY_BATTLE_STATE_VERSION,
        TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION,
        MODEL_PLACEMENT_BATTLE_STATE_VERSION,
        MODEL_POSITION_BATTLE_STATE_VERSION,
        EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION,
        TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION,
        SPATIAL_FACTS_BATTLE_STATE_VERSION,
        TERRAIN_VISIBILITY_BATTLE_STATE_VERSION,
        RANGED_GEOMETRY_BATTLE_STATE_VERSION,
        CONVEX_SILHOUETTE_BATTLE_STATE_VERSION,
      ]
        .filter((version) => version < state.version)
        .includes(sourceVersion)
    ) {
      throw new Error("Battle migration source version is unsupported");
    }
    normalized.migration = {
      sourceVersion,
      legacyUntimedThroughSequence: nonnegativeInteger(
        migration.legacyUntimedThroughSequence,
        "Legacy untimed event sequence",
        events.length,
      ),
    };
    if (state.version >= ACTION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyUnactionedThroughSequence = nonnegativeInteger(
        migration.legacyUnactionedThroughSequence,
        "Legacy unactioned event sequence",
        events.length,
      );
    }
    if (state.version >= DEPLOYMENT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyDeploymentThroughSequence = nonnegativeInteger(
        migration.legacyDeploymentThroughSequence,
        "Legacy deployment event sequence",
        events.length,
      );
    }
    if (state.version >= TRANSPORT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTransportThroughSequence = nonnegativeInteger(
        migration.legacyTransportThroughSequence,
        "Legacy Transport event sequence",
        events.length,
      );
    }
    if (state.version >= TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTransportCompatibilityThroughSequence = nonnegativeInteger(
        migration.legacyTransportCompatibilityThroughSequence,
        "Legacy Transport compatibility event sequence",
        events.length,
      );
    }
    if (state.version >= TARGET_ELIGIBILITY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTargetEligibilityThroughSequence = nonnegativeInteger(
        migration.legacyTargetEligibilityThroughSequence,
        "Legacy target eligibility event sequence",
        events.length,
      );
    }
    if (state.version >= WEAPON_INVENTORY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyWeaponInventoryThroughSequence = nonnegativeInteger(
        migration.legacyWeaponInventoryThroughSequence,
        "Legacy weapon inventory event sequence",
        events.length,
      );
    }
    if (state.version >= WEAPON_BEARER_BATTLE_STATE_VERSION) {
      normalized.migration.legacyWeaponBearersThroughSequence = nonnegativeInteger(
        migration.legacyWeaponBearersThroughSequence,
        "Legacy weapon bearer event sequence",
        events.length,
      );
    }
    if (state.version >= CHARGE_MOVE_BATTLE_STATE_VERSION) {
      normalized.migration.legacyChargeMovementThroughSequence = nonnegativeInteger(
        migration.legacyChargeMovementThroughSequence,
        "Legacy charge movement event sequence",
        events.length,
      );
    }
    if (state.version >= FIGHT_MOVE_BATTLE_STATE_VERSION) {
      normalized.migration.legacyFightMovementThroughSequence = nonnegativeInteger(
        migration.legacyFightMovementThroughSequence,
        "Legacy Fight movement event sequence",
        events.length,
      );
    }
    if (state.version >= HEROIC_INTERVENTION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyHeroicInterventionThroughSequence = nonnegativeInteger(
        migration.legacyHeroicInterventionThroughSequence,
        "Legacy Heroic Intervention event sequence",
        events.length,
      );
    }
    if (state.version >= FIRE_OVERWATCH_BATTLE_STATE_VERSION) {
      normalized.migration.legacyFireOverwatchThroughSequence = nonnegativeInteger(
        migration.legacyFireOverwatchThroughSequence,
        "Legacy Fire Overwatch event sequence",
        events.length,
      );
    }
    if (state.version >= HAZARDOUS_BATTLE_STATE_VERSION) {
      normalized.migration.legacyHazardousThroughSequence = nonnegativeInteger(
        migration.legacyHazardousThroughSequence,
        "Legacy Hazardous event sequence",
        events.length,
      );
    }
    if (state.version >= GO_TO_GROUND_BATTLE_STATE_VERSION) {
      normalized.migration.legacyGoToGroundThroughSequence = nonnegativeInteger(
        migration.legacyGoToGroundThroughSequence,
        "Legacy Go to Ground event sequence",
        events.length,
      );
    }
    if (state.version >= RANGED_DECLARATION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyRangedDeclarationsThroughSequence = nonnegativeInteger(
        migration.legacyRangedDeclarationsThroughSequence,
        "Legacy ranged declaration event sequence",
        events.length,
      );
    }
    if (state.version >= SETUP_RULES_BATTLE_STATE_VERSION) {
      normalized.migration.legacySetupRulesThroughSequence = nonnegativeInteger(
        migration.legacySetupRulesThroughSequence,
        "Legacy setup rules event sequence",
        events.length,
      );
    }
    if (state.version >= COUNTER_OFFENSIVE_BATTLE_STATE_VERSION) {
      normalized.migration.legacyCounterOffensiveThroughSequence = nonnegativeInteger(
        migration.legacyCounterOffensiveThroughSequence,
        "Legacy Counter-offensive event sequence",
        events.length,
      );
    }
    if (state.version >= SMOKESCREEN_BATTLE_STATE_VERSION) {
      normalized.migration.legacySmokescreenThroughSequence = nonnegativeInteger(
        migration.legacySmokescreenThroughSequence,
        "Legacy Smokescreen event sequence",
        events.length,
      );
    }
    if (state.version >= RAPID_INGRESS_BATTLE_STATE_VERSION) {
      normalized.migration.legacyRapidIngressThroughSequence = nonnegativeInteger(
        migration.legacyRapidIngressThroughSequence,
        "Legacy Rapid Ingress event sequence",
        events.length,
      );
    }
    if (state.version >= RULE_COVERAGE_BATTLE_STATE_VERSION) {
      normalized.migration.legacyRuleCoverageThroughSequence = nonnegativeInteger(
        migration.legacyRuleCoverageThroughSequence,
        "Legacy rule coverage event sequence",
        events.length,
      );
    }
    if (state.version >= TABLE_GEOMETRY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTableGeometryThroughSequence = nonnegativeInteger(
        migration.legacyTableGeometryThroughSequence,
        "Legacy table geometry event sequence",
        events.length,
      );
    }
    if (state.version >= TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTerrainFootprintsThroughSequence = nonnegativeInteger(
        migration.legacyTerrainFootprintsThroughSequence,
        "Legacy terrain footprints event sequence",
        events.length,
      );
    }
    if (state.version >= MODEL_PLACEMENT_BATTLE_STATE_VERSION) {
      normalized.migration.legacyModelPlacementsThroughSequence = nonnegativeInteger(
        migration.legacyModelPlacementsThroughSequence,
        "Legacy model placements event sequence",
        events.length,
      );
    }
    if (state.version >= MODEL_POSITION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyModelPositionsThroughSequence = nonnegativeInteger(
        migration.legacyModelPositionsThroughSequence,
        "Legacy model positions event sequence",
        events.length,
      );
    }
    if (state.version >= EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyExtendedModelPositionsThroughSequence = nonnegativeInteger(
        migration.legacyExtendedModelPositionsThroughSequence,
        "Legacy extended model positions event sequence",
        events.length,
      );
    }
    if (state.version >= TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTransportModelLocationsThroughSequence = nonnegativeInteger(
        migration.legacyTransportModelLocationsThroughSequence,
        "Legacy Transport model location event sequence",
        events.length,
      );
    }
    if (state.version >= SPATIAL_FACTS_BATTLE_STATE_VERSION) {
      normalized.migration.legacySpatialFactsThroughSequence = nonnegativeInteger(
        migration.legacySpatialFactsThroughSequence,
        "Legacy spatial facts event sequence",
        events.length,
      );
    }
    if (state.version >= TERRAIN_VISIBILITY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyTerrainVisibilityThroughSequence = nonnegativeInteger(
        migration.legacyTerrainVisibilityThroughSequence,
        "Legacy terrain visibility event sequence",
        events.length,
      );
    }
    if (state.version >= RANGED_GEOMETRY_BATTLE_STATE_VERSION) {
      normalized.migration.legacyRangedGeometryThroughSequence = nonnegativeInteger(
        migration.legacyRangedGeometryThroughSequence,
        "Legacy ranged geometry event sequence",
        events.length,
      );
    }
    if (state.version >= CONVEX_SILHOUETTE_BATTLE_STATE_VERSION) {
      normalized.migration.legacyConvexSilhouettesThroughSequence = nonnegativeInteger(
        migration.legacyConvexSilhouettesThroughSequence,
        "Legacy convex silhouette event sequence",
        events.length,
      );
    }
    if (state.version >= OBJECTIVE_CONTROL_BATTLE_STATE_VERSION) {
      normalized.migration.legacyObjectiveControlThroughSequence = nonnegativeInteger(
        migration.legacyObjectiveControlThroughSequence,
        "Legacy objective control event sequence",
        events.length,
      );
    }
  }
  if (
    state.version >= WEAPON_BEARER_BATTLE_STATE_VERSION &&
    events.some(
      (event) =>
        ["formation_registered", "formation_configured"].includes(event.type) &&
        event.formation.weaponBearerTracking === "legacy_aggregate",
    ) &&
    normalized.migration?.sourceVersion !== SPATIAL_FACTS_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== CONVEX_SILHOUETTE_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== RANGED_GEOMETRY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TERRAIN_VISIBILITY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== MODEL_POSITION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== MODEL_PLACEMENT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TABLE_GEOMETRY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== RULE_COVERAGE_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== RAPID_INGRESS_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== SMOKESCREEN_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== COUNTER_OFFENSIVE_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== WEAPON_INVENTORY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRANSPORT_NESTING_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== SETUP_RULES_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TARGET_ELIGIBILITY_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== HEROIC_INTERVENTION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRANSPORT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== DEPLOYMENT_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== ACTION_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TRACKER_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== TIMELINE_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== ROSTER_BATTLE_STATE_VERSION &&
    normalized.migration?.sourceVersion !== LEGACY_BATTLE_STATE_VERSION
  ) {
    throw new Error("Legacy aggregate weapon bearers require explicit migration provenance");
  }
  replayBattleState(normalized);
  return normalized;
}

function initialHealth(formation) {
  return Object.fromEntries(
    formation.segments.map((segment) => [
      segment.id,
      { modelsRemaining: segment.startingModels, woundsLost: 0 },
    ]),
  );
}

function formationSourceModelsRemaining(formation, sourceSavedUnitId) {
  return formation.segments
    .filter((segment) => segment.savedUnitId === sourceSavedUnitId)
    .reduce((total, segment) => total + formation.health[segment.id].modelsRemaining, 0);
}

function formationSurvivingWeaponCount(formation, sourceSavedUnitId, groupId) {
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  if (!group) return 0;
  if (formation.weaponBearerTracking !== "exact") {
    return formationSourceModelsRemaining(formation, sourceSavedUnitId) > 0 ? group.count : 0;
  }
  return formation.segments.reduce((total, segment) => {
    if (segment.savedUnitId !== sourceSavedUnitId) return total;
    const copies = segment.weaponCopies.find((copy) => copy.groupId === groupId)?.count ?? 0;
    return total + copies * formation.health[segment.id].modelsRemaining;
  }, 0);
}

function formationWeaponProfile(formation, sourceSavedUnitId, groupId, weaponId) {
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  const profile = group?.profiles.find((candidate) => candidate.weaponId === weaponId);
  return group && profile ? { group, profile } : null;
}

function formationLiveModelIds(formation) {
  return formation.segments.flatMap((segment) =>
    segment.modelIds.slice(0, formation.health[segment.id].modelsRemaining),
  );
}

function rangedGeometryDecisionFlags(decision, reviewedByPlayer, weaponHasIndirect) {
  return (
    (decision.visible ? RANGED_GEOMETRY_FLAGS.directVisible : 0) |
    (decision.indirectFire ? RANGED_GEOMETRY_FLAGS.indirectFire : 0) |
    (weaponHasIndirect ? RANGED_GEOMETRY_FLAGS.weaponHasIndirect : 0) |
    (decision.visibilityResolution === "geometry_proof"
      ? RANGED_GEOMETRY_FLAGS.visibilityProof
      : 0) |
    (decision.visibilityResolution === "player_override"
      ? RANGED_GEOMETRY_FLAGS.visibilityOverride
      : 0) |
    (decision.fullyVisible ? RANGED_GEOMETRY_FLAGS.fullyVisible : 0) |
    (decision.fullVisibilityResolution === "geometry_proof"
      ? RANGED_GEOMETRY_FLAGS.fullVisibilityProof
      : 0) |
    (decision.fullVisibilityResolution === "player_override"
      ? RANGED_GEOMETRY_FLAGS.fullVisibilityOverride
      : 0) |
    (reviewedByPlayer ? RANGED_GEOMETRY_FLAGS.reviewedByPlayer : 0)
  );
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rangedGeometryDecisionMatchesState(
  decision,
  event,
  attacker,
  target,
  source,
  inventory,
  facts,
) {
  const sourceLiveModelIds = formationLiveModelIds(source);
  const sourceLiveSet = new Set(sourceLiveModelIds);
  const survivingBearerModelIds =
    source.weaponBearerTracking === "exact"
      ? inventory.bearerModelIds.filter((modelId) => sourceLiveSet.has(modelId))
      : sourceLiveModelIds;
  const declaredCount = event.declaredWeaponCount || event.eligibleWeaponCount;
  const alreadyUsed = Math.max(0, survivingBearerModelIds.length - event.eligibleWeaponCount);
  let expectedBearers = survivingBearerModelIds.slice(alreadyUsed, alreadyUsed + declaredCount);
  if (expectedBearers.length < declaredCount && sourceLiveModelIds.length > 0) {
    expectedBearers = Array.from(
      { length: declaredCount },
      (_, index) => sourceLiveModelIds[index % sourceLiveModelIds.length],
    );
  }
  const expectedObservers = [
    ...new Set(source.id === attacker.id ? expectedBearers : formationLiveModelIds(attacker)),
  ];
  const expectedTargets = formationLiveModelIds(target);
  const expectedProvenObservers = expectedObservers.filter((observerModelId) =>
    (facts?.modelPairs ?? []).some(
      (pair) => pair.observerModelId === observerModelId && pair.visible,
    ),
  );
  if (
    !sameOrderedValues(decision.declaredBearerModelIds, expectedBearers) ||
    !sameOrderedValues(decision.observerModelIds, expectedObservers) ||
    !sameOrderedValues(decision.targetModelIds, expectedTargets) ||
    !sameOrderedValues(decision.provenObserverModelIds, expectedProvenObservers) ||
    (decision.visibilityResolution === "geometry_proof") !==
      (expectedObservers.length > 0 &&
        expectedProvenObservers.length === expectedObservers.length) ||
    (decision.visibilityResolution === "player_override" && !decision.visibilityOverrideReason) ||
    (decision.fullVisibilityResolution === "geometry_proof" &&
      facts?.fullVisibility.status !== "fully_visible") ||
    (decision.fullVisibilityResolution === "player_override" &&
      !decision.fullVisibilityOverrideReason)
  ) {
    return false;
  }
  const coverYes = new Set(facts?.cover.yesModelIds ?? []);
  const coverNo = new Set(facts?.cover.noModelIds ?? []);
  for (const cover of decision.cover) {
    if (
      (coverYes.has(cover.modelId) &&
        (cover.resolution !== "geometry_proof" || !cover.benefitOfCover)) ||
      (coverNo.has(cover.modelId) &&
        (cover.resolution !== "geometry_proof" || cover.benefitOfCover)) ||
      (!coverYes.has(cover.modelId) &&
        !coverNo.has(cover.modelId) &&
        (cover.resolution !== "player_override" || !decision.coverOverrideReason))
    ) {
      return false;
    }
  }
  const expectedFlags = rangedGeometryDecisionFlags(
    {
      visible: event.visible,
      indirectFire: event.indirectFire,
      fullyVisible: event.fullyVisible,
      visibilityResolution: decision.visibilityResolution,
      fullVisibilityResolution: decision.fullVisibilityResolution,
    },
    event.reviewedByPlayer,
    event.weaponHasIndirect,
  );
  const coverProvenCount = decision.cover.filter(
    (entry) => entry.resolution === "geometry_proof",
  ).length;
  return Boolean(
    decision.flags === expectedFlags &&
      rangedGeometryResolutionIsValid(
        decision.observerModelIds.length,
        decision.provenObserverModelIds.length,
        decision.targetModelIds.length,
        coverProvenCount,
        decision.cover.length - coverProvenCount,
        decision.flags,
      ),
  );
}

export function battleRangedGeometryDecision(
  state,
  {
    attackerFormationId,
    targetFormationId,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    eligibleWeaponCount,
    declaredWeaponCount,
    requestedVisible = false,
    requestedFullyVisible = false,
    indirectFire = false,
    weaponHasIndirect = false,
    reviewedByPlayer = false,
    visibilityOverrideReason = "",
    fullVisibilityOverrideReason = "",
    coverOverrideReason = "",
    fallbackTargetCover = false,
  },
) {
  const replayed = replayBattleState(state);
  const attacker = replayed.formations.get(attackerFormationId);
  const target = replayed.formations.get(targetFormationId);
  const source = replayed.formations.get(weaponSourceFormationId);
  const inventory = source
    ? source.weaponInventory.find(
        (group) => group.sourceSavedUnitId === sourceSavedUnitId && group.groupId === weaponGroupId,
      )
    : null;
  if (!attacker || !target || !source || !inventory) {
    throw new Error("Ranged geometry requires registered attacker, target, and weapon source");
  }
  const sourceLiveModelIds = formationLiveModelIds(source);
  const sourceLiveSet = new Set(sourceLiveModelIds);
  const survivingBearerModelIds =
    source.weaponBearerTracking === "exact"
      ? inventory.bearerModelIds.filter((modelId) => sourceLiveSet.has(modelId))
      : sourceLiveModelIds;
  const alreadyUsed = Math.max(0, survivingBearerModelIds.length - eligibleWeaponCount);
  let declaredBearerModelIds = survivingBearerModelIds.slice(
    alreadyUsed,
    alreadyUsed + declaredWeaponCount,
  );
  if (declaredBearerModelIds.length < declaredWeaponCount && sourceLiveModelIds.length > 0) {
    declaredBearerModelIds = Array.from(
      { length: declaredWeaponCount },
      (_, index) => sourceLiveModelIds[index % sourceLiveModelIds.length],
    );
  }
  const observerModelIds = [
    ...new Set(
      source.id === attacker.id ? declaredBearerModelIds : formationLiveModelIds(attacker),
    ),
  ];
  const targetModelIds = formationLiveModelIds(target);
  const facts = replayed.visibilityFactsByFormation
    .get(attackerFormationId)
    ?.get(targetFormationId);
  const provenObserverModelIds = observerModelIds.filter((observerModelId) =>
    (facts?.modelPairs ?? []).some(
      (pair) => pair.observerModelId === observerModelId && pair.visible,
    ),
  );
  const visibilityProven =
    observerModelIds.length > 0 && provenObserverModelIds.length === observerModelIds.length;
  const directVisible = !indirectFire && (visibilityProven || requestedVisible);
  const visibilityResolution = indirectFire
    ? "indirect_fire"
    : visibilityProven
      ? "geometry_proof"
      : "player_override";
  const fullVisibilityProven = facts?.fullVisibility.status === "fully_visible";
  const fullyVisible = directVisible && (fullVisibilityProven || requestedFullyVisible);
  const fullVisibilityResolution = fullyVisible
    ? fullVisibilityProven
      ? "geometry_proof"
      : "player_override"
    : "not_fully_visible";
  const coverYes = new Set(facts?.cover.yesModelIds ?? []);
  const coverNo = new Set(facts?.cover.noModelIds ?? []);
  const cover = targetModelIds.map((modelId) => {
    if (coverYes.has(modelId)) {
      return { modelId, benefitOfCover: true, resolution: "geometry_proof" };
    }
    if (coverNo.has(modelId)) {
      return { modelId, benefitOfCover: false, resolution: "geometry_proof" };
    }
    return {
      modelId,
      benefitOfCover: Boolean(fallbackTargetCover),
      resolution: "player_override",
    };
  });
  const decision = {
    observerModelIds,
    declaredBearerModelIds,
    provenObserverModelIds,
    targetModelIds,
    visible: directVisible,
    fullyVisible,
    indirectFire,
    visibilityResolution,
    fullVisibilityResolution,
    visibilityOverrideReason: visibilityOverrideReason.trim(),
    fullVisibilityOverrideReason: fullVisibilityOverrideReason.trim(),
    coverOverrideReason: coverOverrideReason.trim(),
    cover,
  };
  decision.flags = rangedGeometryDecisionFlags(decision, reviewedByPlayer, weaponHasIndirect);
  const coverProvenCount = cover.filter((entry) => entry.resolution === "geometry_proof").length;
  const coverOverrideCount = coverOverrideReason.trim() ? cover.length - coverProvenCount : 0;
  decision.valid = Boolean(
    declaredBearerModelIds.length === declaredWeaponCount &&
      (!directVisible ||
        visibilityResolution !== "player_override" ||
        visibilityOverrideReason.trim()) &&
      (!fullyVisible ||
        fullVisibilityResolution !== "player_override" ||
        fullVisibilityOverrideReason.trim()) &&
      rangedGeometryResolutionIsValid(
        observerModelIds.length,
        provenObserverModelIds.length,
        targetModelIds.length,
        coverProvenCount,
        coverOverrideCount,
        decision.flags,
      ),
  );
  return decision;
}

export function buildModelLevelTargetSequence(formation, segmentIds, targets, coverDecisions) {
  if (!formation || segmentIds.length !== targets.length || !Array.isArray(coverDecisions)) {
    throw new Error("Model-level target sequence input is invalid");
  }
  const coverByModelId = new Map(
    coverDecisions.map((decision) => [decision.modelId, decision.benefitOfCover]),
  );
  const sequence = segmentIds.flatMap((segmentId, index) => {
    const segment = formation.segments.find((candidate) => candidate.id === segmentId);
    const target = targets[index];
    if (!segment || !target || target.modelCount < 1) {
      throw new Error("Model-level target sequence references an invalid segment");
    }
    return segment.modelIds
      .slice(0, target.modelCount)
      .reverse()
      .map((modelId) => ({
        segmentId,
        targetModelId: modelId,
        target: {
          ...target,
          modelCount: 1,
          benefitOfCover: Boolean(coverByModelId.get(modelId)),
        },
      }));
  });
  if (sequence.length < 1 || sequence.length > 64) {
    throw new Error("Model-level target sequence must contain 1 to 64 models");
  }
  return {
    segmentIds: sequence.map((entry) => entry.segmentId),
    targetModelIds: sequence.map((entry) => entry.targetModelId),
    targets: sequence.map((entry) => entry.target),
  };
}

function weaponProfileFlags(profile) {
  return (profile.hasAssault ? 1 : 0) | (profile.hasIndirect ? 2 : 0);
}

function sameHealth(left, right) {
  return left.modelsRemaining === right.modelsRemaining && left.woundsLost === right.woundsLost;
}

function trackerResources(players, mission) {
  return new Map(
    players.map((player) => [
      player.id,
      new Map([
        [
          "command_points",
          {
            id: "command_points",
            name: "Command Points",
            value: mission.startingCommandPoints[player.id],
            maximum: null,
          },
        ],
        [
          "victory_points",
          { id: "victory_points", name: "Victory Points", value: 0, maximum: null },
        ],
      ]),
    ]),
  );
}

function trackerObjectives(mission, players) {
  return new Map(
    mission.objectives.map((objective) => [
      objective.id,
      {
        ...objective,
        controllerPlayerId: "",
        contested: true,
        controlSource: "rules_initial",
        executable: true,
        recorded: false,
        scores: players.map((player) => ({ playerId: player.id, score: 0 })),
        contributions: [],
        unavailableReasons: [],
        resolvedAtClock: null,
      },
    ]),
  );
}

function awardCommandPhasePoints(resources, players, mission) {
  if (mission.commandPointsPerCommandPhase < 1) return;
  for (const player of players) {
    const current = resources.get(player.id).get("command_points");
    resources.get(player.id).set("command_points", {
      ...current,
      value: current.value + mission.commandPointsPerCommandPhase,
    });
  }
}

function commandPhaseStarted(clock) {
  return clock.status === "active" && clock.phase === "command" && clock.step === "start";
}

function deploymentDeclarationsComplete(formations, deploymentByFormation) {
  return formations.size > 0 && deploymentByFormation.size === formations.size;
}

function transportDeploymentChain(formationId, deploymentByFormation) {
  const formationIds = [];
  const seen = new Set();
  let currentFormationId = formationId;
  while (true) {
    if (seen.has(currentFormationId)) {
      return {
        valid: false,
        complete: true,
        formationIds,
        rootFormationId: "",
        rootDeployment: null,
        reason: "Transport deployment assignments cannot contain a cycle",
      };
    }
    seen.add(currentFormationId);
    formationIds.push(currentFormationId);
    const deployment = deploymentByFormation.get(currentFormationId);
    if (!deployment) {
      return {
        valid: true,
        complete: false,
        formationIds,
        rootFormationId: currentFormationId,
        rootDeployment: null,
        reason: "Transport deployment chain is not fully declared",
      };
    }
    if (deployment.location !== "embarked") {
      const rootLocation = DEPLOYMENT_ROOT_LOCATION[deployment.location] ?? 0;
      const reserveEligibilityCount = formationIds.filter(
        (id) => deploymentByFormation.get(id)?.eligibilityConfirmed,
      ).length;
      const valid = transportDeploymentChainIsValid(
        formationIds.length,
        seen.size,
        rootLocation,
        reserveEligibilityCount,
      );
      return {
        valid,
        complete: true,
        formationIds,
        rootFormationId: currentFormationId,
        rootDeployment: deployment,
        reason: valid
          ? "Transport deployment chain is valid"
          : rootLocation === 0
            ? "Transport deployment chain must end on the battlefield or in Reserves"
            : rootLocation !== DEPLOYMENT_ROOT_LOCATION.battlefield &&
                reserveEligibilityCount !== formationIds.length
              ? "Every unit in a Reserve Transport chain requires explicit Reserve eligibility"
              : "Transport deployment chain is invalid",
      };
    }
    currentFormationId = deployment.transportFormationId;
  }
}

function validateDeclaredTransportChains(deploymentByFormation, requireComplete = false) {
  for (const formationId of deploymentByFormation.keys()) {
    const chain = transportDeploymentChain(formationId, deploymentByFormation);
    if (!chain.valid || (requireComplete && !chain.complete)) {
      throw new Error(chain.reason);
    }
  }
}

function initialDeploymentReportForFormation(
  formationId,
  formations,
  deploymentByFormation,
  embarkedByFormation,
) {
  const formation = formations.get(formationId);
  const chain = transportDeploymentChain(formationId, deploymentByFormation);
  const traits = formation?.deploymentTraits ?? {
    dedicatedTransport: formation?.keywords.includes("dedicated transport") ?? false,
    aircraft: formation?.keywords.includes("aircraft") ?? false,
    hover: false,
  };
  const startingPassengerCount = [...embarkedByFormation.values()].filter(
    (transportFormationId) => transportFormationId === formationId,
  ).length;
  const rootLocation = chain.rootDeployment?.location ?? "";
  const aircraftMode = deploymentByFormation.get(formationId)?.aircraftMode ?? "";
  const values = [
    traits.dedicatedTransport ? 1 : 0,
    startingPassengerCount,
    traits.aircraft ? 1 : 0,
    traits.hover ? 1 : 0,
    AIRCRAFT_MODE[aircraftMode] ?? -1,
    DEPLOYMENT_ROOT_LOCATION[rootLocation] ?? -1,
  ];
  const valid = chain.complete && initialDeploymentIsValid(...values);
  let reason = valid ? "Initial deployment follows the locked setup rules" : chain.reason;
  if (!valid && chain.complete) {
    if (traits.dedicatedTransport && startingPassengerCount === 0) {
      reason =
        rootLocation === "not_deployed"
          ? "Empty Dedicated Transport setup is valid"
          : "An empty Dedicated Transport cannot be deployed and is destroyed in round one";
    } else if (rootLocation === "not_deployed") {
      reason = "Only an empty Dedicated Transport can be marked not deployed";
    } else if (!traits.aircraft && aircraftMode) {
      reason = "Only an Aircraft formation can declare an Aircraft setup mode";
    } else if (traits.aircraft && aircraftMode === "hover" && !traits.hover) {
      reason = "This Aircraft does not have the Hover ability";
    } else if (traits.aircraft && aircraftMode === "aircraft") {
      reason = "An Aircraft that is not in Hover mode must start in Reserves";
    } else if (traits.aircraft && aircraftMode === "hover") {
      reason = "A Hover model must start on the battlefield or in Strategic Reserves";
    } else if (traits.aircraft) {
      reason = "Aircraft setup mode must be declared before deployment";
    } else {
      reason = "Initial deployment is invalid";
    }
  }
  return {
    formationId,
    dedicatedTransport: traits.dedicatedTransport,
    aircraft: traits.aircraft,
    hasHover: traits.hover,
    aircraftMode,
    startingPassengerCount,
    rootFormationId: chain.rootFormationId,
    rootLocation,
    rootLocationCode: DEPLOYMENT_ROOT_LOCATION[rootLocation] ?? -1,
    complete: chain.complete,
    valid,
    reason,
    values,
  };
}

function validateInitialDeploymentRules(
  formations,
  deploymentByFormation,
  embarkedByFormation,
  legacySetupRulesThroughSequence = 0,
) {
  for (const formationId of formations.keys()) {
    const deployment = deploymentByFormation.get(formationId);
    if (
      legacySetupRulesThroughSequence > 0 &&
      (deployment?.legacyAssumed ||
        (Number.isSafeInteger(deployment?.sequence) &&
          deployment.sequence <= legacySetupRulesThroughSequence))
    ) {
      continue;
    }
    const report = initialDeploymentReportForFormation(
      formationId,
      formations,
      deploymentByFormation,
      embarkedByFormation,
    );
    if (!report.valid) throw new Error(report.reason);
  }
}

function deployedFormationTree(formationId, embarkedByFormation) {
  const deployed = new Set([formationId]);
  const pending = [formationId];
  while (pending.length > 0) {
    const transportFormationId = pending.shift();
    for (const [passengerFormationId, carrierFormationId] of embarkedByFormation) {
      if (carrierFormationId !== transportFormationId || deployed.has(passengerFormationId)) {
        continue;
      }
      deployed.add(passengerFormationId);
      pending.push(passengerFormationId);
    }
  }
  return deployed;
}

function undeployedBattlefieldFormations(
  formations,
  deploymentByFormation,
  deployedFormationIds,
  playerId,
) {
  return [...formations.values()].filter(
    (formation) =>
      formation.playerId === playerId &&
      deploymentByFormation.get(formation.id)?.location === "battlefield" &&
      !deployedFormationIds.has(formation.id),
  );
}

function nextDeploymentPlayer(
  players,
  preferredPlayerId,
  formations,
  deploymentByFormation,
  deployedFormationIds,
) {
  if (
    undeployedBattlefieldFormations(
      formations,
      deploymentByFormation,
      deployedFormationIds,
      preferredPlayerId,
    ).length > 0
  ) {
    return preferredPlayerId;
  }
  const other = otherPlayerId(players, preferredPlayerId);
  return undeployedBattlefieldFormations(
    formations,
    deploymentByFormation,
    deployedFormationIds,
    other,
  ).length > 0
    ? other
    : "";
}

function formationIsOnBattlefield(
  formationId,
  deploymentByFormation,
  deployedFormationIds,
  embarkedByFormation = new Map(),
) {
  const deployment = deploymentByFormation.get(formationId);
  return Boolean(
    deployment && deployedFormationIds.has(formationId) && !embarkedByFormation.has(formationId),
  );
}

function liveModelCount(formation) {
  return Object.values(formation.health).reduce(
    (total, health) => total + health.modelsRemaining,
    0,
  );
}

function liveSavedUnitModelCount(formation, savedUnitId) {
  return formation.segments
    .filter((segment) => segment.savedUnitId === savedUnitId)
    .reduce((total, segment) => total + formation.health[segment.id].modelsRemaining, 0);
}

function transportOptionFor(formation, transportFormationId) {
  return formation.transportOptions.find(
    (option) => option.transportFormationId === transportFormationId,
  );
}

function transportOccupancyReport(
  formations,
  embarkedByFormation,
  transportFormationId,
  candidateFormationId = "",
) {
  const transport = formations.get(transportFormationId);
  if (!transport || !transport.keywords.includes("transport") || formationDestroyed(transport)) {
    return { valid: false, reason: "Selected carrier is not a surviving Transport" };
  }
  const occupantFormationIds = [
    ...new Set([
      ...[...embarkedByFormation.entries()]
        .filter(([, carrierId]) => carrierId === transportFormationId)
        .map(([formationId]) => formationId),
      ...(candidateFormationId ? [candidateFormationId] : []),
    ]),
  ];
  const pools = new Map();
  const allowances = new Map();
  const modes = new Set();
  for (const formationId of occupantFormationIds) {
    const formation = formations.get(formationId);
    if (!formation || formation.playerId !== transport.playerId) {
      return { valid: false, reason: "Transport occupants must be friendly registered formations" };
    }
    const option = transportOptionFor(formation, transportFormationId);
    if (!option) {
      return {
        valid: false,
        reason: `${formation.name} is not source-compatible with ${transport.name}`,
      };
    }
    for (const assignment of option.assignments) {
      const models = liveSavedUnitModelCount(formation, assignment.sourceSavedUnitId);
      if (models < 1) continue;
      const used = models * assignment.modelCost;
      const poolKey =
        assignment.poolKind === "alternative"
          ? `alternative:${assignment.poolPosition}`
          : String(assignment.poolPosition);
      const previousPool = pools.get(poolKey);
      if (
        previousPool &&
        (previousPool.capacity !== assignment.poolCapacity ||
          previousPool.kind !== assignment.poolKind)
      ) {
        return { valid: false, reason: "Transport source contains inconsistent capacity facts" };
      }
      pools.set(poolKey, {
        position: assignment.poolPosition,
        kind: assignment.poolKind,
        label: assignment.poolLabel,
        capacity: assignment.poolCapacity,
        used: (previousPool?.used ?? 0) + used,
      });
      modes.add(
        assignment.poolKind === "alternative"
          ? `alternative:${assignment.poolPosition}`
          : "primary",
      );
      if (assignment.sharedAllowancePosition !== null) {
        const allowanceKey = String(assignment.sharedAllowancePosition);
        const previousAllowance = allowances.get(allowanceKey);
        if (
          previousAllowance &&
          (previousAllowance.maximumModels !== assignment.sharedAllowanceMaximumModels ||
            previousAllowance.primaryCapacityWhileUsed !==
              assignment.sharedAllowancePrimaryCapacityWhileUsed)
        ) {
          return { valid: false, reason: "Transport source contains inconsistent allowance facts" };
        }
        allowances.set(allowanceKey, {
          position: assignment.sharedAllowancePosition,
          maximumModels: assignment.sharedAllowanceMaximumModels,
          primaryCapacityWhileUsed: assignment.sharedAllowancePrimaryCapacityWhileUsed,
          models: (previousAllowance?.models ?? 0) + models,
        });
      }
    }
  }
  const primaryCapacityLimit = [...allowances.values()].reduce(
    (capacity, allowance) =>
      allowance.models > 0 && allowance.primaryCapacityWhileUsed !== null
        ? Math.min(capacity, allowance.primaryCapacityWhileUsed)
        : capacity,
    Number.MAX_SAFE_INTEGER,
  );
  const poolLoads = [...pools.values()].map((pool) => ({
    ...pool,
    capacity:
      pool.kind === "primary" ? Math.min(pool.capacity, primaryCapacityLimit) : pool.capacity,
  }));
  const allowanceLoads = [...allowances.values()];
  const modeCount = modes.size;
  const invalidPool = poolLoads.find(
    (pool) => !transportLoadIsValid(pool.used, pool.capacity, 0, 0, modeCount),
  );
  if (invalidPool) {
    return {
      valid: false,
      reason:
        modeCount > 1
          ? `${transport.name} cannot mix mutually exclusive Transport modes`
          : `${transport.name} would use ${invalidPool.used} of ${invalidPool.capacity} spaces in its ${invalidPool.label} pool`,
      occupantFormationIds,
      poolLoads,
      allowanceLoads,
      modeCount,
    };
  }
  const invalidAllowance = allowanceLoads.find(
    (allowance) =>
      !transportLoadIsValid(0, 1, allowance.models, allowance.maximumModels ?? 0, modeCount),
  );
  if (invalidAllowance) {
    return {
      valid: false,
      reason: `${transport.name} would carry ${invalidAllowance.models} models in an allowance limited to ${invalidAllowance.maximumModels}`,
      occupantFormationIds,
      poolLoads,
      allowanceLoads,
      modeCount,
    };
  }
  return {
    valid: true,
    reason: "",
    occupantFormationIds,
    poolLoads,
    allowanceLoads,
    modeCount,
  };
}

function secureRandomUint32() {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}

function randomDie(sides, randomUint32 = secureRandomUint32) {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  let value;
  do {
    value = randomUint32();
  } while (!Number.isSafeInteger(value) || value < 0 || value >= limit);
  return (value % sides) + 1;
}

function hazardousFinalRoll(test) {
  return test.reroll || test.initialRoll;
}

function hazardousWeaponGroupIds(formation) {
  return new Set(
    formation.weaponInventory
      .filter((group) => group.profiles.some((profile) => profile.hasHazardous))
      .map((group) => group.groupId),
  );
}

function segmentHasHazardousBearer(segment, hazardousGroupIds) {
  return (segment.weaponCopies ?? []).some(
    (copy) => hazardousGroupIds.has(copy.groupId) && copy.count > 0,
  );
}

function hazardousSelectionOptions(formation) {
  const hazardousGroupIds = hazardousWeaponGroupIds(formation);
  const eligible = formation.segments.filter(
    (segment) =>
      formation.health[segment.id].modelsRemaining > 0 &&
      segmentHasHazardousBearer(segment, hazardousGroupIds),
  );
  const wounded = eligible.filter((segment) => formation.health[segment.id].woundsLost > 0);
  if (wounded.length > 0) return wounded;
  const nonCharacters = eligible.filter(
    (segment) => !(segment.keywords ?? []).includes("character"),
  );
  return nonCharacters.length > 0 ? nonCharacters : eligible;
}

function hazardousHealthAfter(segment, before, feelNoPainRolls) {
  const remainingWounds = segment.wounds - before.woundsLost;
  let damage = 0;
  let ignored = 0;
  if (segment.feelNoPain === 0) {
    damage = Math.min(3, remainingWounds);
  } else {
    for (const roll of feelNoPainRolls) {
      if (roll >= segment.feelNoPain) ignored += 1;
      else damage += 1;
      if (damage === remainingWounds) break;
    }
  }
  const destroyed = damage === remainingWounds;
  return {
    remainingWounds,
    ignored,
    damage,
    destroyed,
    after: destroyed
      ? { modelsRemaining: before.modelsRemaining - 1, woundsLost: 0 }
      : { modelsRemaining: before.modelsRemaining, woundsLost: before.woundsLost + damage },
  };
}

export function rollChargeDice(randomUint32 = secureRandomUint32) {
  return [randomDie(6, randomUint32), randomDie(6, randomUint32)];
}

export function rollHazardousTests(count, randomUint32 = secureRandomUint32) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
    throw new Error("Hazardous test count must be from 1 to 1000");
  }
  return Array.from({ length: count }, () => ({
    initialRoll: randomDie(6, randomUint32),
    reroll: 0,
    rerollReason: "",
  }));
}

function transportAllocationOrder(formation, health, firstSegmentId = "") {
  const wounded = formation.segments.find((segment) => health[segment.id].woundsLost > 0);
  if (wounded) {
    return [wounded, ...formation.segments.filter((segment) => segment.id !== wounded.id)];
  }
  if (!firstSegmentId) return formation.segments;
  const first = formation.segments.find((segment) => segment.id === firstSegmentId);
  if (!first) throw new Error("Destroyed Transport allocation profile is unknown");
  return [first, ...formation.segments.filter((segment) => segment.id !== first.id)];
}

function nextTransportAllocationSegment(formation, health, firstSegmentId = "") {
  return transportAllocationOrder(formation, health, firstSegmentId).find(
    (segment) => health[segment.id].modelsRemaining > 0,
  );
}

function replayDestroyedPassengerResolution(formation, passenger, randomUint32 = null) {
  const before = Object.fromEntries(
    formation.segments.map((segment) => [segment.id, { ...formation.health[segment.id] }]),
  );
  const after = structuredClone(before);
  const startingLiveModels = liveModelCount(formation);
  const firstSegment = formation.segments.find(
    (segment) => segment.id === passenger.firstSegmentId,
  );
  if (!firstSegment || before[firstSegment.id].modelsRemaining < 1) {
    throw new Error("Destroyed Transport allocation must select a surviving model profile");
  }
  const wounded = formation.segments.find((segment) => before[segment.id].woundsLost > 0);
  if (wounded && firstSegment.id !== wounded.id) {
    throw new Error("Destroyed Transport damage must remain allocated to the wounded model");
  }
  if (!passenger.emergency && passenger.unplacedModels > 0) {
    throw new Error(
      "Models that cannot disembark within 3 inches require Emergency Disembarkation",
    );
  }
  if (passenger.rolls.length + passenger.unplacedModels !== startingLiveModels) {
    throw new Error("Destroyed Transport rolls must cover every model that disembarks");
  }
  let unplacedRemaining = passenger.unplacedModels;
  while (unplacedRemaining > 0) {
    const segment = nextTransportAllocationSegment(formation, after, passenger.firstSegmentId);
    if (!segment) throw new Error("Unplaced passenger count exceeds the surviving unit");
    const health = after[segment.id];
    health.modelsRemaining -= 1;
    health.woundsLost = 0;
    unplacedRemaining -= 1;
  }
  const failedRolls = passenger.rolls.filter((roll) =>
    passenger.emergency ? roll <= 3 : roll === 1,
  );
  if (!randomUint32 && passenger.feelNoPainRolls.length !== failedRolls.length) {
    throw new Error("Destroyed Transport Feel No Pain rolls must match its mortal wounds");
  }
  const feelNoPainRolls = [];
  failedRolls.forEach((_roll, index) => {
    const segment = nextTransportAllocationSegment(formation, after, passenger.firstSegmentId);
    const threshold = segment?.feelNoPain ?? 0;
    const feelNoPainRoll =
      randomUint32 && threshold > 0
        ? randomDie(6, randomUint32)
        : randomUint32
          ? 0
          : passenger.feelNoPainRolls[index];
    feelNoPainRolls.push(feelNoPainRoll);
    if (!segment) {
      if (feelNoPainRoll !== 0) {
        throw new Error("Feel No Pain cannot be rolled after the passenger unit is destroyed");
      }
      return;
    }
    if ((threshold === 0 && feelNoPainRoll !== 0) || (threshold > 0 && feelNoPainRoll === 0)) {
      throw new Error("Destroyed Transport Feel No Pain roll does not match the allocated model");
    }
    if (threshold > 0 && feelNoPainRoll >= threshold) return;
    const health = after[segment.id];
    health.woundsLost += 1;
    if (health.woundsLost === segment.wounds) {
      health.modelsRemaining -= 1;
      health.woundsLost = 0;
    }
  });
  let damage = 0;
  let modelsDestroyed = 0;
  for (const segment of formation.segments) {
    const previous = before[segment.id];
    const current = after[segment.id];
    damage +=
      (previous.modelsRemaining - current.modelsRemaining) * segment.wounds +
      current.woundsLost -
      previous.woundsLost;
    modelsDestroyed += previous.modelsRemaining - current.modelsRemaining;
  }
  return {
    feelNoPainRolls,
    summary: { damage, modelsDestroyed },
    allocations: formation.segments.map((segment) => ({
      segmentId: segment.id,
      before: before[segment.id],
      after: after[segment.id],
    })),
  };
}

export function replayBattleState(state) {
  const formations = new Map();
  const attacks = new Map();
  const activeAttackIds = [];
  const targetedFormationIds = new Set();
  const pendingChoices = new Map();
  const resolvedChoices = new Map();
  const effects = new Map();
  const battleShockedFormations = new Map();
  const scoringEvents = [];
  const movementByFormation = new Map();
  const chargeByFormation = new Map();
  const deploymentByFormation = new Map();
  const deployedFormationIds = new Set();
  const modelPlacementsByFormation = new Map();
  const modelPositionHistoryByFormation = new Map();
  const modelLocationHistoryByFormation = new Map();
  const currentModelPositionsByFormation = new Map();
  const geometryStaleFormationIds = new Set();
  const setupDestroyedFormationIds = new Set();
  const reserveArrivals = new Map();
  const embarkedByFormation = new Map();
  const disembarkedByFormation = new Map();
  const movementPhaseStartEmbarkedFormationIds = new Set();
  const pendingTransportDestructions = new Map();
  const transportDestructionResolutions = new Map();
  const targetEligibilityFacts = new Map();
  const fightMovementsByActivation = new Map();
  const movementStartsByFormation = new Map();
  const chargeDeclarationsByFormation = new Map();
  const fireOverwatches = [];
  const fireOverwatchPasses = [];
  const usedFireOverwatchKeys = new Set();
  const heroicInterventions = [];
  const heroicInterventionPasses = [];
  const usedHeroicInterventionKeys = new Set();
  const completedActivations = new Set();
  const hazardousTests = [];
  const hazardousDamageResolutions = [];
  const goToGrounds = [];
  const goToGroundPasses = [];
  const usedGoToGroundKeys = new Set();
  const smokescreens = [];
  const smokescreenPasses = [];
  const usedSmokescreenKeys = new Set();
  const rapidIngresses = [];
  const rapidIngressPasses = [];
  const usedRapidIngressKeys = new Set();
  const counterOffensives = [];
  const counterOffensivePasses = [];
  const usedCounterOffensiveKeys = new Set();
  const rangedDeclarationRetractions = [];
  const rangedDeclarationSets = [];
  const resolvedRangedDeclarationIds = new Set();
  let activeActivation = null;
  let pendingFireOverwatch = null;
  let pendingHeroicIntervention = null;
  let pendingHazardous = null;
  let pendingGoToGround = null;
  let pendingSmokescreen = null;
  let pendingRapidIngress = null;
  let pendingCounterOffensive = null;
  let forcedFightFormationId = "";
  let readyRangedAttack = null;
  let rangedDeclarationDraft = [];
  let activeRangedDeclarationSet = null;
  let readyRangedAttacks = [];
  let deploymentPriorityPlayerId = "";
  let pendingDeploymentPlacement = null;
  let pendingModelPosition = null;
  const queuedModelPositions = [];
  let ruleCoverage = null;
  let tableGeometry = null;
  let terrainFootprints = null;
  let terrainVisibility = null;
  let clock = setupBattleClock();
  let mission = defaultMission(state.players);
  let resources = trackerResources(state.players, mission);
  let objectives = trackerObjectives(mission, state.players);
  const legacyUntimedThroughSequence =
    state.version < TIMELINE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyUntimedThroughSequence ?? 0);
  const legacyUnactionedThroughSequence =
    state.version < ACTION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyUnactionedThroughSequence ?? 0);
  const legacySetupRulesThroughSequence =
    state.version < SETUP_RULES_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacySetupRulesThroughSequence ?? 0);
  const legacyChargeMovementThroughSequence =
    state.version < CHARGE_MOVE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyChargeMovementThroughSequence ?? 0);
  const legacyFightMovementThroughSequence =
    state.version < FIGHT_MOVE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyFightMovementThroughSequence ?? 0);
  const legacyHeroicInterventionThroughSequence =
    state.version < HEROIC_INTERVENTION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyHeroicInterventionThroughSequence ?? 0);
  const legacyFireOverwatchThroughSequence =
    state.version < FIRE_OVERWATCH_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyFireOverwatchThroughSequence ?? 0);
  const legacyHazardousThroughSequence =
    state.version < HAZARDOUS_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyHazardousThroughSequence ?? 0);
  const legacyGoToGroundThroughSequence =
    state.version < GO_TO_GROUND_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyGoToGroundThroughSequence ?? 0);
  const legacyRangedDeclarationsThroughSequence =
    state.version < RANGED_DECLARATION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyRangedDeclarationsThroughSequence ?? 0);
  const legacyCounterOffensiveThroughSequence =
    state.version < COUNTER_OFFENSIVE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyCounterOffensiveThroughSequence ?? 0);
  const legacySmokescreenThroughSequence =
    state.version < SMOKESCREEN_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacySmokescreenThroughSequence ?? 0);
  const legacyRapidIngressThroughSequence =
    state.version < RAPID_INGRESS_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyRapidIngressThroughSequence ?? 0);
  const legacyRuleCoverageThroughSequence =
    state.version < RULE_COVERAGE_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyRuleCoverageThroughSequence ?? 0);
  const legacyTableGeometryThroughSequence =
    state.version < TABLE_GEOMETRY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTableGeometryThroughSequence ?? 0);
  const legacyTerrainFootprintsThroughSequence =
    state.version < TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTerrainFootprintsThroughSequence ?? 0);
  const legacyModelPlacementsThroughSequence =
    state.version < MODEL_PLACEMENT_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyModelPlacementsThroughSequence ?? 0);
  const legacyModelPositionsThroughSequence =
    state.version < MODEL_POSITION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyModelPositionsThroughSequence ?? 0);
  const legacyExtendedModelPositionsThroughSequence =
    state.version < EXTENDED_MODEL_POSITION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyExtendedModelPositionsThroughSequence ?? 0);
  const legacyTransportModelLocationsThroughSequence =
    state.version < TRANSPORT_MODEL_LOCATION_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTransportModelLocationsThroughSequence ?? 0);
  const legacySpatialFactsThroughSequence =
    state.version < SPATIAL_FACTS_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacySpatialFactsThroughSequence ?? 0);
  const legacyTerrainVisibilityThroughSequence =
    state.version < TERRAIN_VISIBILITY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTerrainVisibilityThroughSequence ?? 0);
  const legacyRangedGeometryThroughSequence =
    state.version < RANGED_GEOMETRY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyRangedGeometryThroughSequence ?? 0);
  const legacyTargetEligibilityThroughSequence =
    state.version < TARGET_ELIGIBILITY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyTargetEligibilityThroughSequence ?? 0);
  const legacyWeaponInventoryThroughSequence =
    state.version < WEAPON_INVENTORY_BATTLE_STATE_VERSION
      ? Number.MAX_SAFE_INTEGER
      : (state.migration?.legacyWeaponInventoryThroughSequence ?? 0);

  const declarationWeaponKey = (declaration) =>
    [
      declaration.weaponSourceFormationId,
      declaration.sourceSavedUnitId,
      declaration.weaponGroupId,
    ].join(":");
  const declarationProfileKey = (declaration) =>
    `${declaration.targetFormationId}:${declaration.weaponId}`;
  const canonicalRangedDeclarationOrder = (declarations) => {
    const targetOrder = [
      ...new Set(declarations.map((declaration) => declaration.targetFormationId)),
    ];
    return targetOrder.flatMap((targetFormationId) => {
      const targetDeclarations = declarations.filter(
        (declaration) => declaration.targetFormationId === targetFormationId,
      );
      const profileOrder = [
        ...new Set(targetDeclarations.map((declaration) => declaration.weaponId)),
      ];
      return profileOrder.flatMap((weaponId) =>
        targetDeclarations.filter((declaration) => declaration.weaponId === weaponId),
      );
    });
  };
  const rangedDeclarationStats = (declarations) => {
    const targetRuns = [];
    const profileRuns = [];
    for (const declaration of declarations) {
      if (targetRuns.at(-1) !== declaration.targetFormationId) {
        targetRuns.push(declaration.targetFormationId);
      }
      const profileKey = declarationProfileKey(declaration);
      if (profileRuns.at(-1) !== profileKey) profileRuns.push(profileKey);
    }
    return {
      declarationCount: declarations.length,
      uniqueDeclarationCount: new Set(declarations.map((declaration) => declaration.id)).size,
      targetRunCount: targetRuns.length,
      uniqueTargetCount: new Set(declarations.map((declaration) => declaration.targetFormationId))
        .size,
      profileRunCount: profileRuns.length,
      uniqueTargetProfileCount: new Set(declarations.map(declarationProfileKey)).size,
    };
  };
  const declarationFlags = ({ sameActivation, beforeAttacks, allEligible, weaponCountsValid }) =>
    (sameActivation ? RANGED_DECLARATION_FLAGS.sameActivation : 0) |
    (beforeAttacks ? RANGED_DECLARATION_FLAGS.beforeAttacks : 0) |
    (allEligible ? RANGED_DECLARATION_FLAGS.allEligible : 0) |
    (weaponCountsValid ? RANGED_DECLARATION_FLAGS.weaponCountsValid : 0) |
    RANGED_DECLARATION_FLAGS.targetsContiguous |
    RANGED_DECLARATION_FLAGS.profilesContiguous;
  const refreshReadyRangedAttacks = () => {
    if (!activeRangedDeclarationSet || pendingGoToGround || pendingSmokescreen) {
      readyRangedAttacks = [];
      return;
    }
    readyRangedAttacks = activeRangedDeclarationSet.declarations
      .filter(
        (declaration) =>
          !resolvedRangedDeclarationIds.has(declaration.id) &&
          !formationDestroyed(formations.get(declaration.targetFormationId)),
      )
      .map((declaration) => ({
        ...declaration,
        triggerEventId: declaration.id,
        declarationSetEventId: activeRangedDeclarationSet.id,
        activationEventId: activeRangedDeclarationSet.activationEventId,
        goToGroundEffectId:
          goToGrounds.find(
            (effect) =>
              effect.targetFormationId === declaration.targetFormationId &&
              samePhase(effect.appliedAt, clock),
          )?.id ?? "",
        smokescreenEffectId:
          smokescreens.find(
            (effect) =>
              effect.targetFormationId === declaration.targetFormationId &&
              samePhase(effect.appliedAt, clock),
          )?.id ?? "",
      }));
  };
  const declaredTargetFormationIds = () => [
    ...new Set(
      activeRangedDeclarationSet?.declarations.map(
        (declaration) => declaration.targetFormationId,
      ) ?? [],
    ),
  ];
  const goToGroundCandidateTargetFormationIds = () =>
    declaredTargetFormationIds().filter((targetFormationId) => {
      const target = formations.get(targetFormationId);
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${target.playerId}:go_to_ground`;
      const commandPoints = resources.get(target.playerId).get("command_points")?.value ?? 0;
      const activeEffect = goToGrounds.some(
        (effect) => effect.targetFormationId === target.id && samePhase(effect.appliedAt, clock),
      );
      return (
        target.playerId !== clock.activePlayerId &&
        target.keywords.includes("infantry") &&
        !battleShockedFormations.has(target.id) &&
        commandPoints >= 1 &&
        !usedGoToGroundKeys.has(usageKey) &&
        !activeEffect
      );
    });
  const smokescreenCandidateTargetFormationIds = () =>
    declaredTargetFormationIds().filter((targetFormationId) => {
      const target = formations.get(targetFormationId);
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${target.playerId}:smokescreen`;
      const commandPoints = resources.get(target.playerId).get("command_points")?.value ?? 0;
      const activeEffect = smokescreens.some(
        (effect) => effect.targetFormationId === target.id && samePhase(effect.appliedAt, clock),
      );
      return (
        target.playerId !== clock.activePlayerId &&
        target.keywords.includes("smoke") &&
        !battleShockedFormations.has(target.id) &&
        commandPoints >= 1 &&
        !usedSmokescreenKeys.has(usageKey) &&
        !activeEffect
      );
    });
  const openGoToGroundWindow = () => {
    if (
      !activeRangedDeclarationSet ||
      activeRangedDeclarationSet.goToGroundWindowHandled ||
      activeRangedDeclarationSet.sequence <= legacyGoToGroundThroughSequence
    ) {
      return;
    }
    const candidateTargetFormationIds = goToGroundCandidateTargetFormationIds();
    activeRangedDeclarationSet = {
      ...activeRangedDeclarationSet,
      goToGroundWindowHandled: true,
    };
    if (candidateTargetFormationIds.length < 1) return;
    const responderPlayerId = formations.get(candidateTargetFormationIds[0]).playerId;
    if (
      candidateTargetFormationIds.some(
        (targetFormationId) => formations.get(targetFormationId).playerId !== responderPlayerId,
      )
    ) {
      throw new Error("Go to Ground candidates must belong to one defending player");
    }
    pendingGoToGround = {
      activationWide: true,
      triggerEventId: activeRangedDeclarationSet.id,
      activationEventId: activeRangedDeclarationSet.activationEventId,
      attackerFormationId: activeActivation.formationId,
      targetFormationId: candidateTargetFormationIds[0],
      candidateTargetFormationIds,
      responderPlayerId,
      clock: { ...clock },
    };
  };
  const openSmokescreenWindow = () => {
    if (
      !activeRangedDeclarationSet ||
      activeRangedDeclarationSet.smokescreenWindowHandled ||
      activeRangedDeclarationSet.sequence <= legacySmokescreenThroughSequence
    ) {
      return;
    }
    const candidateTargetFormationIds = smokescreenCandidateTargetFormationIds();
    activeRangedDeclarationSet = {
      ...activeRangedDeclarationSet,
      smokescreenWindowHandled: true,
    };
    if (candidateTargetFormationIds.length < 1) return;
    const responderPlayerId = formations.get(candidateTargetFormationIds[0]).playerId;
    if (
      candidateTargetFormationIds.some(
        (targetFormationId) => formations.get(targetFormationId).playerId !== responderPlayerId,
      )
    ) {
      throw new Error("Smokescreen candidates must belong to one defending player");
    }
    pendingSmokescreen = {
      activationWide: true,
      triggerEventId: activeRangedDeclarationSet.id,
      activationEventId: activeRangedDeclarationSet.activationEventId,
      attackerFormationId: activeActivation.formationId,
      targetFormationId: candidateTargetFormationIds[0],
      candidateTargetFormationIds,
      responderPlayerId,
      clock: { ...clock },
    };
  };
  const openRapidIngressWindow = (triggerEvent) => {
    if (
      triggerEvent.sequence <= legacyRapidIngressThroughSequence ||
      clock.status !== "active" ||
      clock.phase !== "movement" ||
      clock.step !== "end" ||
      pendingRapidIngress
    ) {
      return;
    }
    const responderPlayerId = otherPlayerId(state.players, clock.activePlayerId);
    const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${responderPlayerId}:rapid_ingress`;
    const commandPoints = resources.get(responderPlayerId).get("command_points")?.value ?? 0;
    if (commandPoints < 1 || usedRapidIngressKeys.has(usageKey)) return;
    const candidateFormationIds = [...formations.values()]
      .filter((formation) => {
        const deployment = deploymentByFormation.get(formation.id);
        return (
          formation.playerId === responderPlayerId &&
          !formationDestroyed(formation) &&
          ["reserves", "strategic_reserves"].includes(deployment?.location) &&
          !deployedFormationIds.has(formation.id) &&
          !reserveArrivals.has(formation.id) &&
          !battleShockedFormations.has(formation.id) &&
          clock.battleRound >= deployment.earliestBattleRound
        );
      })
      .map((formation) => formation.id)
      .sort();
    if (candidateFormationIds.length < 1) return;
    pendingRapidIngress = {
      triggerEventId: triggerEvent.id,
      responderPlayerId,
      candidateFormationIds,
      clock: { ...clock },
    };
  };
  const refreshGeometryStaleness = (formationId) => {
    const formation = formations.get(formationId);
    const current = currentModelPositionsByFormation.get(formationId);
    if (!formation || !current) return;
    const currentIds = new Set(current.models.map((model) => model.modelId));
    const exact = formation.segments.every(
      (segment) =>
        segment.modelIds.filter((modelId) => currentIds.has(modelId)).length ===
        formation.health[segment.id].modelsRemaining,
    );
    if (exact && currentIds.size === current.models.length) {
      geometryStaleFormationIds.delete(formationId);
    } else {
      geometryStaleFormationIds.add(formationId);
    }
  };
  const requireExecutableCoherency = (formationId, sequence) => {
    if (sequence <= legacySpatialFactsThroughSequence) return;
    const formation = formations.get(formationId);
    const position = currentModelPositionsByFormation.get(formationId);
    if (!formation || !position) return;
    const fact = deriveSpatialFacts({
      formations: new Map([[formationId, formation]]),
      positions: new Map([[formationId, position]]),
      staleFormationIds: geometryStaleFormationIds,
      objectives: [],
    }).get(formationId);
    if (fact?.executable && fact.coherency.status !== "coherent") {
      throw new Error("Reviewed model positions do not end in executable unit coherency");
    }
  };
  const recordModelLocation = (
    formationId,
    { context, referenceEventId, sequence, location, transportFormationId = "" },
  ) => {
    const history = modelLocationHistoryByFormation.get(formationId) ?? [];
    modelLocationHistoryByFormation.set(formationId, [
      ...history,
      {
        context,
        referenceEventId,
        sequence,
        location,
        transportFormationId,
      },
    ]);
  };
  const enqueueModelPosition = (pending) => {
    if (pendingModelPosition) queuedModelPositions.push(pending);
    else pendingModelPosition = pending;
  };
  const settleObjectiveControl = (resolvedAtClock) => {
    const spatialFacts = deriveSpatialFacts({
      formations,
      positions: currentModelPositionsByFormation,
      staleFormationIds: geometryStaleFormationIds,
      objectives: tableGeometry?.objectivePositions ?? [],
    });
    const eligibleFormationIds = new Set(
      [...formations.keys()].filter(
        (formationId) =>
          formationIsOnBattlefield(
            formationId,
            deploymentByFormation,
            deployedFormationIds,
            embarkedByFormation,
          ) && !formationDestroyed(formations.get(formationId)),
      ),
    );
    const facts = deriveObjectiveControlFacts({
      players: state.players,
      objectives: tableGeometry?.objectivePositions ?? [],
      formations,
      eligibleFormationIds,
      spatialFactsByFormation: spatialFacts,
      battleShockedFormationIds: new Set(battleShockedFormations.keys()),
    });
    for (const [objectiveId, tracked] of objectives) {
      if (tracked.recorded) continue;
      const fact = facts.get(objectiveId);
      objectives.set(objectiveId, {
        ...tracked,
        controllerPlayerId: fact?.executable ? fact.controllerPlayerId : "",
        contested: fact?.executable ? fact.contested : false,
        controlSource: fact?.executable ? "geometry" : "unknown",
        executable: Boolean(fact?.executable),
        scores: fact?.executable ? fact.scores : [],
        contributions: fact?.executable ? fact.contributions : [],
        unavailableReasons: fact?.unavailableReasons ?? ["objective_geometry_unavailable"],
        resolvedAtClock: { ...resolvedAtClock },
      });
    }
  };
  for (const event of state.events) {
    if (
      pendingModelPosition &&
      event.type !== "model_positions_recorded" &&
      !(pendingTransportDestructions.size > 0 && event.type === "transport_destroyed_resolved")
    ) {
      throw new Error("Record the pending per-model position snapshot before continuing");
    }
    const resolvesPendingModelPosition =
      Boolean(pendingModelPosition) && event.type === "model_positions_recorded";
    if (pendingTransportDestructions.size > 0 && event.type !== "transport_destroyed_resolved") {
      throw new Error("Destroyed Transport passengers must disembark immediately");
    }
    if (
      !resolvesPendingModelPosition &&
      pendingHazardous &&
      ((pendingHazardous.due &&
        event.type !== "hazardous_damage_resolved" &&
        !(
          pendingHeroicIntervention &&
          ["heroic_intervention_resolved", "heroic_intervention_passed"].includes(event.type)
        )) ||
        (!pendingHazardous.due &&
          ![
            activeActivation?.id === pendingHazardous.activationEventId
              ? "activation_completed"
              : "charge_recorded",
          ].includes(event.type)))
    ) {
      throw new Error(
        pendingHazardous.due
          ? "Resolve the pending Hazardous mortal wounds first"
          : "Hazardous mortal wounds remain deferred until the charging unit ends its Charge move",
      );
    }
    if (
      !resolvesPendingModelPosition &&
      pendingHeroicIntervention &&
      !["heroic_intervention_resolved", "heroic_intervention_passed"].includes(event.type) &&
      !(pendingHazardous?.due && event.type === "hazardous_damage_resolved")
    ) {
      throw new Error("Resolve or pass the pending Heroic Intervention window first");
    }
    if (
      !resolvesPendingModelPosition &&
      pendingFireOverwatch &&
      !["fire_overwatch_started", "fire_overwatch_passed"].includes(event.type)
    ) {
      throw new Error("Resolve or pass the pending Fire Overwatch window first");
    }
    if (
      pendingGoToGround &&
      !["go_to_ground_resolved", "go_to_ground_passed"].includes(event.type)
    ) {
      throw new Error("Resolve or pass the pending Go to Ground window first");
    }
    if (
      pendingSmokescreen &&
      !["smokescreen_resolved", "smokescreen_passed"].includes(event.type)
    ) {
      throw new Error("Resolve or pass the pending Smokescreen window first");
    }
    if (
      pendingRapidIngress &&
      !["rapid_ingress_resolved", "rapid_ingress_passed"].includes(event.type)
    ) {
      throw new Error("Resolve or pass the pending Rapid Ingress window first");
    }
    if (
      pendingCounterOffensive &&
      !["counter_offensive_resolved", "counter_offensive_passed"].includes(event.type)
    ) {
      throw new Error("Resolve or pass the pending Counter-offensive window first");
    }
    if (
      (readyRangedAttack || readyRangedAttacks.length > 0) &&
      !["attack_resolved", "attack_reverted"].includes(event.type)
    ) {
      throw new Error("Resolve every declared ranged attack before continuing the battle");
    }
    if (
      rangedDeclarationDraft.length > 0 &&
      ![
        "ranged_target_eligibility_recorded",
        "ranged_target_declaration_retracted",
        "ranged_targets_declared",
      ].includes(event.type)
    ) {
      throw new Error("Finish or retract the activation's ranged target declarations first");
    }
    if (
      !resolvesPendingModelPosition &&
      activeActivation?.source === "fire_overwatch" &&
      ![
        "ranged_target_eligibility_recorded",
        "attack_resolved",
        "attack_reverted",
        "transport_destroyed_resolved",
        "hazardous_tests_recorded",
        "hazardous_damage_resolved",
        "activation_completed",
      ].includes(event.type)
    ) {
      throw new Error("Finish the Fire Overwatch activation before continuing the trigger");
    }
    if (
      activeActivation?.hazardousTestsRecorded &&
      !["hazardous_damage_resolved", "activation_completed"].includes(event.type)
    ) {
      throw new Error("Hazardous tests close this activation's attack sequence");
    }
    if (event.type === "formation_registered") {
      if (state.version >= TIMELINE_BATTLE_STATE_VERSION && clock.status !== "setup") {
        throw new Error("Formations must be registered during battle setup");
      }
      if (formations.has(event.formation.id)) throw new Error("Formation is already registered");
      formations.set(event.formation.id, {
        ...event.formation,
        health: initialHealth(event.formation),
      });
      continue;
    }
    if (event.type === "formation_configured") {
      if (state.version >= TIMELINE_BATTLE_STATE_VERSION && clock.status !== "setup") {
        throw new Error("Formation equipment is locked after the battle starts");
      }
      if (targetedFormationIds.has(event.formation.id)) {
        throw new Error("Formation cannot be configured after it has been attacked");
      }
      formations.set(event.formation.id, {
        ...event.formation,
        health: initialHealth(event.formation),
      });
      continue;
    }
    if (event.type === "table_geometry_recorded") {
      if (clock.status !== "setup") {
        throw new Error("Table geometry is locked after the battle starts");
      }
      if (tableGeometry) throw new Error("Table geometry has already been recorded");
      const migratedInitialGeometry =
        state.migration && event.sequence === legacyTableGeometryThroughSequence + 1;
      if (deploymentByFormation.size > 0 && !migratedInitialGeometry) {
        throw new Error("Table geometry is locked after deployment declarations begin");
      }
      if (!ruleCoverage?.report.permitted) {
        throw new Error("Source-locked rule selections are required before table geometry");
      }
      if (
        event.geometry.missionSourceId !== ruleCoverage.plan.mission.sourceId ||
        event.geometry.terrainSourceId !== ruleCoverage.plan.terrain.sourceId
      ) {
        throw new Error("Table geometry does not match the selected mission and terrain layout");
      }
      const sourceBinding = chapterApprovedTableBinding(
        event.geometry.missionSourceId,
        event.geometry.terrainSourceId,
      );
      if (!sourceBinding || event.geometry.deploymentName !== sourceBinding.deploymentName) {
        throw new Error("Table geometry does not match the source-locked deployment map");
      }
      const objectiveIds = mission.objectives.map((objective) => objective.id).sort();
      const positionedIds = event.geometry.objectivePositions
        .map((objective) => objective.objectiveId)
        .sort();
      if (JSON.stringify(positionedIds) !== JSON.stringify(objectiveIds)) {
        throw new Error(
          "Table geometry must position every configured mission objective exactly once",
        );
      }
      tableGeometry = event.geometry;
      continue;
    }
    if (event.type === "terrain_footprints_recorded") {
      if (clock.status !== "setup") {
        throw new Error("Terrain footprints are locked after the battle starts");
      }
      if (terrainFootprints) throw new Error("Terrain footprints have already been recorded");
      const postMigrationEvents = state.events.slice(
        legacyTerrainFootprintsThroughSequence,
        event.sequence - 1,
      );
      const migratedInitialFootprints =
        state.migration &&
        postMigrationEvents.every((candidate) => candidate.type === "table_geometry_recorded");
      if (deploymentByFormation.size > 0 && !migratedInitialFootprints) {
        throw new Error("Terrain footprints are locked after deployment declarations begin");
      }
      if (!tableGeometry) {
        throw new Error("Record reviewed table geometry before terrain footprints");
      }
      if (
        event.terrainFootprints.missionSourceId !== tableGeometry.missionSourceId ||
        event.terrainFootprints.terrainSourceId !== tableGeometry.terrainSourceId ||
        event.terrainFootprints.battlefieldWidthThousandths !==
          tableGeometry.battlefieldWidthThousandths ||
        event.terrainFootprints.battlefieldHeightThousandths !==
          tableGeometry.battlefieldHeightThousandths ||
        event.terrainFootprints.origin !== tableGeometry.origin ||
        event.terrainFootprints.sourcePage !== tableGeometry.terrainProfile.sourcePage
      ) {
        throw new Error("Terrain footprints do not match the reviewed table geometry");
      }
      terrainFootprints = event.terrainFootprints;
      continue;
    }
    if (event.type === "terrain_visibility_recorded") {
      if (clock.status !== "setup") {
        throw new Error("Terrain visibility geometry is locked after the battle starts");
      }
      if (terrainVisibility) {
        throw new Error("Terrain visibility geometry has already been recorded");
      }
      const migratedInitialVisibility = Boolean(
        state.migration && event.sequence > legacyTerrainVisibilityThroughSequence,
      );
      if (deploymentByFormation.size > 0 && !migratedInitialVisibility) {
        throw new Error(
          "Terrain visibility geometry is locked after deployment declarations begin",
        );
      }
      if (!terrainFootprints) {
        throw new Error("Record reviewed terrain footprints before visibility geometry");
      }
      if (
        event.terrainVisibility.missionSourceId !== terrainFootprints.missionSourceId ||
        event.terrainVisibility.terrainSourceId !== terrainFootprints.terrainSourceId
      ) {
        throw new Error("Terrain visibility geometry does not match the reviewed terrain layout");
      }
      if (!terrainVisibilityGeometryIsValid(event.terrainVisibility, terrainFootprints)) {
        throw new Error("Terrain visibility geometry is structurally invalid or unreviewed");
      }
      terrainVisibility = event.terrainVisibility;
      continue;
    }
    if (event.type === "deployment_declared") {
      if (clock.status !== "setup") {
        throw new Error("Deployment declarations are locked after the battle starts");
      }
      if (
        state.version >= TABLE_GEOMETRY_BATTLE_STATE_VERSION &&
        event.sequence > legacyTableGeometryThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        !tableGeometry
      ) {
        throw new Error("Record reviewed table geometry before declaring deployment");
      }
      if (
        state.version >= TERRAIN_FOOTPRINT_BATTLE_STATE_VERSION &&
        event.sequence > legacyTerrainFootprintsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        !terrainFootprints
      ) {
        throw new Error("Record reviewed terrain footprints before declaring deployment");
      }
      if (
        state.version >= TERRAIN_VISIBILITY_BATTLE_STATE_VERSION &&
        event.sequence > legacyTerrainVisibilityThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        !terrainVisibility
      ) {
        throw new Error("Record reviewed terrain visibility geometry before declaring deployment");
      }
      if (deployedFormationIds.size > 0) {
        throw new Error("Deployment declarations are locked after deployment begins");
      }
      const formation = formations.get(event.formationId);
      if (!formation) throw new Error("Deployment formation is not registered");
      if (deploymentByFormation.has(event.formationId)) {
        throw new Error("Formation deployment has already been declared");
      }
      if (event.location === "embarked") {
        const transport = formations.get(event.transportFormationId);
        if (!transport || transport.playerId !== formation.playerId) {
          throw new Error("A formation can start embarked only in a friendly Transport");
        }
        if (!transport.keywords.includes("transport")) {
          throw new Error("Selected carrier does not have the Transport keyword");
        }
        if (state.version >= TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION) {
          const occupancy = transportOccupancyReport(
            formations,
            embarkedByFormation,
            transport.id,
            formation.id,
          );
          if (!occupancy.valid) throw new Error(occupancy.reason);
        } else if (formation.assignedTransportFormationId !== transport.id) {
          throw new Error("Formation is not assigned to that Transport in the locked roster");
        }
        embarkedByFormation.set(event.formationId, event.transportFormationId);
        if (event.sequence > legacyTransportModelLocationsThroughSequence) {
          recordModelLocation(event.formationId, {
            context: "deployment_embarked",
            referenceEventId: event.id,
            sequence: event.sequence,
            location: "embarked",
            transportFormationId: event.transportFormationId,
          });
        }
      }
      if (
        event.location === "strategic_reserves" &&
        formation.keywords.some((keyword) => ["fortification", "fortifications"].includes(keyword))
      ) {
        throw new Error("Fortifications cannot be placed into Strategic Reserves");
      }
      deploymentByFormation.set(event.formationId, event);
      if (state.version >= TRANSPORT_NESTING_BATTLE_STATE_VERSION) {
        validateDeclaredTransportChains(deploymentByFormation);
      }
      for (const [passengerId] of embarkedByFormation) {
        const passengerDeployment = deploymentByFormation.get(passengerId);
        const chain = transportDeploymentChain(passengerId, deploymentByFormation);
        const transportDeployment = chain.complete ? chain.rootDeployment : null;
        if (
          passengerDeployment &&
          transportDeployment &&
          ["reserves", "strategic_reserves"].includes(transportDeployment.location) &&
          !passengerDeployment.eligibilityConfirmed
        ) {
          throw new Error(
            "A unit starting embarked in a Reserve Transport requires explicit Reserve eligibility",
          );
        }
        if (
          passengerDeployment &&
          transportDeployment?.location === "strategic_reserves" &&
          passengerDeployment.points < 1
        ) {
          throw new Error(
            "A unit embarked in Strategic Reserves must include its points in the limit",
          );
        }
      }
      const strategicPoints = [...deploymentByFormation.values()]
        .filter((deployment) => {
          const chain = transportDeploymentChain(deployment.formationId, deploymentByFormation);
          return (
            chain.complete &&
            chain.rootDeployment?.location === "strategic_reserves" &&
            formations.get(deployment.formationId)?.playerId === formation.playerId
          );
        })
        .reduce((total, deployment) => total + deployment.points, 0);
      if (strategicPoints > Math.floor(mission.pointsLimit / 4)) {
        throw new Error(
          `Strategic Reserves exceed the ${Math.floor(mission.pointsLimit / 4)} point limit`,
        );
      }
      deploymentPriorityPlayerId = deploymentDeclarationsComplete(formations, deploymentByFormation)
        ? nextDeploymentPlayer(
            state.players,
            mission.deploymentFirstPlayerId,
            formations,
            deploymentByFormation,
            deployedFormationIds,
          )
        : "";
      continue;
    }
    if (event.type === "formation_deployed") {
      if (clock.status !== "setup") throw new Error("Formation deployment is locked after start");
      if (pendingDeploymentPlacement) {
        throw new Error("Record the deployed formation's model placements before continuing");
      }
      if (!deploymentDeclarationsComplete(formations, deploymentByFormation)) {
        throw new Error("Declare every formation before deploying armies");
      }
      const formation = formations.get(event.formationId);
      const deployment = deploymentByFormation.get(event.formationId);
      if (deployment?.location !== "battlefield") {
        throw new Error("Only a battlefield formation can be deployed");
      }
      if (deployedFormationIds.has(event.formationId)) {
        throw new Error("Formation has already been deployed");
      }
      const expectedPlayerId = nextDeploymentPlayer(
        state.players,
        deploymentPriorityPlayerId || mission.deploymentFirstPlayerId,
        formations,
        deploymentByFormation,
        deployedFormationIds,
      );
      if (!expectedPlayerId || formation.playerId !== expectedPlayerId) {
        throw new Error("Formation was deployed out of alternating player order");
      }
      const deployedTree =
        state.version >= TRANSPORT_NESTING_BATTLE_STATE_VERSION
          ? deployedFormationTree(event.formationId, embarkedByFormation)
          : new Set([
              event.formationId,
              ...[...embarkedByFormation]
                .filter(([, transportId]) => transportId === event.formationId)
                .map(([passengerId]) => passengerId),
            ]);
      for (const deployedFormationId of deployedTree) {
        deployedFormationIds.add(deployedFormationId);
      }
      if (
        event.sequence > legacyModelPlacementsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage)
      ) {
        pendingDeploymentPlacement = {
          formationId: event.formationId,
          referenceEventId: event.id,
        };
      }
      deploymentPriorityPlayerId = nextDeploymentPlayer(
        state.players,
        otherPlayerId(state.players, expectedPlayerId),
        formations,
        deploymentByFormation,
        deployedFormationIds,
      );
      continue;
    }
    if (event.type === "model_placements_recorded") {
      if (clock.status !== "setup") {
        throw new Error("Deployment model placements are locked after the battle starts");
      }
      if (!tableGeometry) {
        throw new Error("Record reviewed table geometry before model placements");
      }
      if (modelPlacementsByFormation.has(event.formationId)) {
        throw new Error("Deployment model placements have already been recorded");
      }
      const reference = state.events.find(
        (candidate) => candidate.id === event.placement.referenceEventId,
      );
      if (
        !reference ||
        reference.type !== "formation_deployed" ||
        reference.formationId !== event.formationId ||
        reference.sequence >= event.sequence
      ) {
        throw new Error("Model placement must reference that formation's deployment event");
      }
      const migratedPlacement = Boolean(
        state.migration &&
          reference.sequence <= legacyModelPlacementsThroughSequence &&
          event.sequence > legacyModelPlacementsThroughSequence,
      );
      if (
        (!pendingDeploymentPlacement ||
          pendingDeploymentPlacement.formationId !== event.formationId ||
          pendingDeploymentPlacement.referenceEventId !== event.placement.referenceEventId) &&
        !migratedPlacement
      ) {
        throw new Error("Model placement does not resolve the pending deployment placement");
      }
      if (
        event.placement.missionSourceId !== tableGeometry.missionSourceId ||
        event.placement.terrainSourceId !== tableGeometry.terrainSourceId ||
        event.placement.battlefieldWidthThousandths !== tableGeometry.battlefieldWidthThousandths ||
        event.placement.battlefieldHeightThousandths !==
          tableGeometry.battlefieldHeightThousandths ||
        event.placement.origin !== tableGeometry.origin
      ) {
        throw new Error("Model placement does not match the reviewed table geometry");
      }
      if (
        event.sequence > legacyTerrainVisibilityThroughSequence &&
        event.placement.models.some((model) => !silhouetteReady(model))
      ) {
        throw new Error(
          "Current model placements require reviewed 3D silhouettes and physical sight points",
        );
      }
      modelPlacementsByFormation.set(event.formationId, event.placement);
      const deploymentSnapshot = { ...event.placement, context: "deployment" };
      modelPositionHistoryByFormation.set(event.formationId, [deploymentSnapshot]);
      currentModelPositionsByFormation.set(event.formationId, deploymentSnapshot);
      if (event.sequence > legacyTransportModelLocationsThroughSequence) {
        recordModelLocation(event.formationId, {
          context: "deployment",
          referenceEventId: event.placement.referenceEventId,
          sequence: event.sequence,
          location: "battlefield",
        });
      }
      geometryStaleFormationIds.delete(event.formationId);
      requireExecutableCoherency(event.formationId, event.sequence);
      if (!migratedPlacement) pendingDeploymentPlacement = null;
      continue;
    }
    if (event.type === "model_positions_recorded") {
      if (!tableGeometry) {
        throw new Error("Record reviewed table geometry before model positions");
      }
      if (
        !pendingModelPosition ||
        pendingModelPosition.formationId !== event.formationId ||
        pendingModelPosition.context !== event.position.context ||
        pendingModelPosition.referenceEventId !== event.position.referenceEventId
      ) {
        throw new Error("Model positions do not resolve the pending position snapshot");
      }
      const reference = state.events.find(
        (candidate) => candidate.id === event.position.referenceEventId,
      );
      const expectedReferenceType = {
        movement: "movement_recorded",
        reserve_arrival: "reserve_arrived",
        rapid_ingress: "rapid_ingress_resolved",
        disembarkation: "formation_disembarked",
        destroyed_transport_disembarkation: "transport_destroyed_resolved",
        emergency_disembarkation: "transport_destroyed_resolved",
        charge: "charge_recorded",
        heroic_intervention: "heroic_intervention_resolved",
        pile_in: "fight_move_recorded",
        consolidation: "fight_move_recorded",
      }[event.position.context];
      const destroyedTransportPassenger = reference?.passengers?.find(
        (passenger) => passenger.formationId === event.formationId,
      );
      const referenceMatchesFormation =
        reference?.type === "transport_destroyed_resolved"
          ? Boolean(destroyedTransportPassenger)
          : reference?.formationId === event.formationId;
      if (
        !reference ||
        reference.type !== expectedReferenceType ||
        !referenceMatchesFormation ||
        reference.sequence >= event.sequence
      ) {
        throw new Error("Model positions reference the wrong formation action");
      }
      if (
        (["destroyed_transport_disembarkation", "emergency_disembarkation"].includes(
          event.position.context,
        ) &&
          Boolean(destroyedTransportPassenger.emergency) !==
            (event.position.context === "emergency_disembarkation")) ||
        (event.position.context === "destroyed_transport_disembarkation" &&
          destroyedTransportPassenger.unplacedModels > 0)
      ) {
        throw new Error("Model positions do not match the destroyed Transport placement mode");
      }
      if (
        (["charge", "heroic_intervention"].includes(event.position.context) &&
          !reference.successful) ||
        (["pile_in", "consolidation"].includes(event.position.context) &&
          reference.stage !== event.position.context) ||
        (["pile_in", "consolidation"].includes(event.position.context) &&
          reference.destination === "none")
      ) {
        throw new Error("Model positions do not match the referenced physical movement");
      }
      const referencedMaximum = modelPositionContextUsesPath(event.position.context)
        ? reference.maximumModelMoveThousandths
        : 0;
      if (
        event.position.context !== "movement" &&
        event.position.models.some(
          (model) => model.maximumDistanceThousandths !== referencedMaximum,
        )
      ) {
        throw new Error("Model positions do not match the referenced movement allowance");
      }
      if (
        event.position.missionSourceId !== tableGeometry.missionSourceId ||
        event.position.terrainSourceId !== tableGeometry.terrainSourceId ||
        event.position.battlefieldWidthThousandths !== tableGeometry.battlefieldWidthThousandths ||
        event.position.battlefieldHeightThousandths !==
          tableGeometry.battlefieldHeightThousandths ||
        event.position.origin !== tableGeometry.origin
      ) {
        throw new Error("Model positions do not match the reviewed table geometry");
      }
      if (
        event.sequence > legacyTerrainVisibilityThroughSequence &&
        event.position.models.some((model) => !silhouetteReady(model))
      ) {
        throw new Error(
          "Current model positions require reviewed 3D silhouettes and physical sight points",
        );
      }
      const formation = formations.get(event.formationId);
      const previous = currentModelPositionsByFormation.get(event.formationId) ?? null;
      if (
        event.position.reconcilesStaleStart !== Boolean(pendingModelPosition.reconcilesStaleStart)
      ) {
        throw new Error("Model positions do not match the pending stale-geometry reconciliation");
      }
      if (!modelPositionSetIsValid(event.position, formation, previous, true)) {
        throw new Error("Model positions do not match the live formation and reviewed action");
      }
      const history = modelPositionHistoryByFormation.get(event.formationId) ?? [];
      modelPositionHistoryByFormation.set(event.formationId, [...history, event.position]);
      currentModelPositionsByFormation.set(event.formationId, event.position);
      const completed = pendingModelPosition;
      if (
        event.sequence > legacyTransportModelLocationsThroughSequence &&
        MODEL_SETUP_POSITION_CONTEXTS.includes(event.position.context)
      ) {
        recordModelLocation(event.formationId, {
          context: event.position.context,
          referenceEventId: event.position.referenceEventId,
          sequence: event.sequence,
          location: "battlefield",
          transportFormationId: completed.transportFormationId ?? "",
        });
      }
      geometryStaleFormationIds.delete(event.formationId);
      requireExecutableCoherency(event.formationId, event.sequence);
      pendingModelPosition = queuedModelPositions.shift() ?? null;
      if (completed.fireOverwatchTrigger) {
        pendingFireOverwatch = {
          triggerEventId: completed.referenceEventId,
          trigger: completed.fireOverwatchTrigger,
          targetFormationId: event.formationId,
          responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
          clock: { ...clock },
        };
      }
      continue;
    }
    if (event.type === "rule_coverage_configured") {
      if (clock.status !== "setup") {
        throw new Error("Battle rule selections are locked after the battle starts");
      }
      const migratedInitialBinding =
        state.migration &&
        !ruleCoverage &&
        event.sequence === legacyRuleCoverageThroughSequence + 1;
      if (deploymentByFormation.size > 0 && !migratedInitialBinding) {
        throw new Error("Battle rule selections are locked after deployment declarations begin");
      }
      if (
        battleRuleCoverageRequiresTableGeometry(event.coverage) &&
        !chapterApprovedTableBinding(
          event.coverage.plan.mission.sourceId,
          event.coverage.plan.terrain.sourceId,
        )
      ) {
        throw new Error("The selected mission and terrain layout are not source-compatible");
      }
      ruleCoverage = event.coverage;
      continue;
    }
    if (event.type === "battle_started") {
      if (clock.status !== "setup") throw new Error("Battle has already started");
      if (pendingChoices.size > 0) throw new Error("Pending choices block the battle start");
      if (
        event.sequence > legacyRuleCoverageThroughSequence &&
        (!ruleCoverage || !ruleCoverage.report.permitted)
      ) {
        throw new Error(
          "Every selected battle rule must pass source-locked coverage before battle start",
        );
      }
      if (
        event.sequence > legacyTableGeometryThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        !tableGeometry
      ) {
        throw new Error("Reviewed table geometry is required before battle start");
      }
      if (
        event.sequence > legacyTerrainFootprintsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        !terrainFootprints
      ) {
        throw new Error("Reviewed terrain footprints are required before battle start");
      }
      if (
        event.sequence > legacyModelPlacementsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        (pendingDeploymentPlacement ||
          [...deploymentByFormation.values()].some(
            (deployment) =>
              deployment.location === "battlefield" &&
              deployedFormationIds.has(deployment.formationId) &&
              !modelPlacementsByFormation.has(deployment.formationId),
          ))
      ) {
        throw new Error("Reviewed model placements are required before battle start");
      }
      if (
        (state.version < DEPLOYMENT_BATTLE_STATE_VERSION || state.migration) &&
        deploymentByFormation.size === 0
      ) {
        for (const formation of formations.values()) {
          deploymentByFormation.set(formation.id, {
            formationId: formation.id,
            location: "battlefield",
            points: 0,
            earliestBattleRound: 1,
            eligibilityConfirmed: true,
            eligibilityReason: "Migrated battle assumed deployed on battlefield",
            legacyAssumed: true,
          });
          deployedFormationIds.add(formation.id);
        }
      }
      if (!deploymentDeclarationsComplete(formations, deploymentByFormation)) {
        throw new Error("Every formation must have a deployment declaration before battle start");
      }
      if (state.version >= TRANSPORT_NESTING_BATTLE_STATE_VERSION) {
        validateDeclaredTransportChains(deploymentByFormation, true);
      }
      validateInitialDeploymentRules(
        formations,
        deploymentByFormation,
        embarkedByFormation,
        legacySetupRulesThroughSequence,
      );
      if (
        [...deploymentByFormation.values()].some(
          (deployment) =>
            deployment.location === "battlefield" &&
            !deployedFormationIds.has(deployment.formationId),
        )
      ) {
        throw new Error("Every battlefield formation must be deployed before battle start");
      }
      for (const [passengerId, transportId] of embarkedByFormation) {
        const passenger = formations.get(passengerId);
        const transport = formations.get(transportId);
        if (!passenger || !transport || passenger.playerId !== transport.playerId) {
          throw new Error("Starting Transport occupancy is invalid");
        }
        const transportDeployment = deploymentByFormation.get(transportId);
        if (!transportDeployment) {
          throw new Error("Starting Transport occupancy is invalid");
        }
        if (
          state.version < TRANSPORT_NESTING_BATTLE_STATE_VERSION &&
          transportDeployment.location === "embarked"
        ) {
          throw new Error("A starting Transport cannot itself be embarked in this guided workflow");
        }
      }
      const expected = startBattleClock(state.players, event.firstPlayerId);
      if (!sameBattleClock(event.clock, expected)) {
        throw new Error("Battle start clock is not canonical");
      }
      clock = expected;
      if (event.sequence > legacySetupRulesThroughSequence) {
        for (const deployment of deploymentByFormation.values()) {
          if (deployment.location !== "not_deployed") continue;
          const formation = formations.get(deployment.formationId);
          for (const health of Object.values(formation?.health ?? {})) {
            health.modelsRemaining = 0;
            health.woundsLost = 0;
          }
          setupDestroyedFormationIds.add(deployment.formationId);
        }
      }
      if (state.version >= TRACKER_BATTLE_STATE_VERSION) {
        awardCommandPhasePoints(resources, state.players, mission);
      }
      continue;
    }
    if (event.type === "clock_advanced") {
      if (pendingChoices.size > 0) {
        throw new Error("Pending choices must be resolved before advancing the battle");
      }
      if (activeActivation) {
        throw new Error("The active formation must finish its activation before advancing");
      }
      if (!sameBattleClock(event.from, clock)) {
        throw new Error("Battle clock advance does not match replayed state");
      }
      const expected = nextBattleClock(clock, state.players);
      if (!sameBattleClock(event.to, expected)) {
        throw new Error("Battle clock advance is not canonical");
      }
      if (expected.status === "complete" || expected.phase !== clock.phase) {
        settleObjectiveControl(clock);
      }
      const expiredEffectIds = [...effects.values()]
        .filter((effect) => effectExpiresOnAdvance(effect, clock, expected))
        .map((effect) => effect.id)
        .sort();
      const recordedExpiredEffectIds = [...event.expiredEffectIds].sort();
      if (
        expiredEffectIds.length !== recordedExpiredEffectIds.length ||
        expiredEffectIds.some((id, index) => id !== recordedExpiredEffectIds[index])
      ) {
        throw new Error("Battle clock advance has an incorrect effect-expiry set");
      }
      for (const id of expiredEffectIds) effects.delete(id);
      if (state.version >= TRACKER_BATTLE_STATE_VERSION && commandPhaseStarted(expected)) {
        awardCommandPhasePoints(resources, state.players, mission);
        for (const [formationId] of battleShockedFormations) {
          if (formations.get(formationId)?.playerId === expected.activePlayerId) {
            battleShockedFormations.delete(formationId);
          }
        }
      }
      if (
        expected.status === "active" &&
        expected.phase === "movement" &&
        expected.step === "start"
      ) {
        movementPhaseStartEmbarkedFormationIds.clear();
        for (const formationId of embarkedByFormation.keys()) {
          if (formations.get(formationId)?.playerId === expected.activePlayerId) {
            movementPhaseStartEmbarkedFormationIds.add(formationId);
          }
        }
      }
      clock = expected;
      openRapidIngressWindow(event);
      continue;
    }
    if (event.type === "choice_opened") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Pending choice was opened outside its battle timing window");
      }
      if (pendingChoices.has(event.choice.id) || resolvedChoices.has(event.choice.id)) {
        throw new Error("Pending choice id has already been used");
      }
      pendingChoices.set(event.choice.id, event.choice);
      continue;
    }
    if (event.type === "choice_resolved") {
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Pending choice was resolved outside its battle timing window");
      }
      const choice = pendingChoices.get(event.choiceId);
      if (!choice) throw new Error("Resolved choice is not pending");
      const options = new Set(choice.options.map((option) => option.id));
      if (
        event.selectedOptionIds.length < choice.minimumSelections ||
        event.selectedOptionIds.length > choice.maximumSelections ||
        event.selectedOptionIds.some((id) => !options.has(id))
      ) {
        throw new Error("Resolved choice selections are invalid");
      }
      pendingChoices.delete(event.choiceId);
      resolvedChoices.set(event.choiceId, [...event.selectedOptionIds]);
      continue;
    }
    if (event.type === "effect_applied") {
      if (clock.status !== "active" || !sameBattleClock(event.effect.appliedAt, clock)) {
        throw new Error("Battle effect was applied outside its timing window");
      }
      if (effects.has(event.effect.id)) throw new Error("Battle effect id has already been used");
      if (event.effect.sourceFormationId && !formations.has(event.effect.sourceFormationId)) {
        throw new Error("Battle effect source formation is not registered");
      }
      effects.set(event.effect.id, event.effect);
      continue;
    }
    if (event.type === "mission_configured") {
      if (clock.status !== "setup") throw new Error("Mission setup is locked after battle start");
      if (tableGeometry) {
        throw new Error("Mission setup is locked after table geometry is recorded");
      }
      if (deploymentByFormation.size > 0) {
        throw new Error("Mission setup is locked after deployment declarations begin");
      }
      const customResources = new Map(
        state.players.map((player) => [
          player.id,
          [...resources.get(player.id).values()].filter(
            (resource) => resource.id !== "command_points" && resource.id !== "victory_points",
          ),
        ]),
      );
      mission = event.mission;
      resources = trackerResources(state.players, mission);
      for (const player of state.players) {
        for (const resource of customResources.get(player.id)) {
          resources.get(player.id).set(resource.id, resource);
        }
      }
      objectives = trackerObjectives(mission, state.players);
      continue;
    }
    if (event.type === "resource_changed") {
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Resource change does not match the replayed battle clock");
      }
      if (event.resourceId === "victory_points") {
        throw new Error("Victory Points must be changed by a scoring event");
      }
      const playerResources = resources.get(event.playerId);
      const previous = playerResources.get(event.resourceId);
      if ((previous?.value ?? 0) !== event.before) {
        throw new Error("Resource change does not match the replayed value");
      }
      if (previous && (previous.name !== event.name || previous.maximum !== event.maximum)) {
        throw new Error("Resource identity cannot change during a battle");
      }
      playerResources.set(event.resourceId, {
        id: event.resourceId,
        name: event.name,
        value: event.after,
        maximum: event.maximum,
      });
      continue;
    }
    if (event.type === "score_recorded") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Score was recorded outside its battle timing window");
      }
      const playerResources = resources.get(event.playerId);
      const previous = playerResources.get("victory_points");
      if (previous.value !== event.before || event.after !== event.before + event.points) {
        throw new Error("Scoring event does not match the replayed Victory Points");
      }
      playerResources.set("victory_points", { ...previous, value: event.after });
      scoringEvents.push(event);
      continue;
    }
    if (event.type === "objective_control_changed") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Objective control changed outside its battle timing window");
      }
      const objective = objectives.get(event.objectiveId);
      if (!objective) throw new Error("Objective control references an unknown objective");
      objectives.set(event.objectiveId, {
        ...objective,
        controllerPlayerId: event.controllerPlayerId,
        contested: event.contested,
        controlSource: "player_recorded",
        executable: false,
        recorded: true,
        unavailableReasons: ["player_recorded_override"],
      });
      continue;
    }
    if (event.type === "objective_control_override_cleared") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Objective control override cleared outside its battle timing window");
      }
      const objective = objectives.get(event.objectiveId);
      if (!objective) throw new Error("Objective control override references an unknown objective");
      objectives.set(event.objectiveId, {
        ...objective,
        controllerPlayerId: "",
        contested: false,
        controlSource: "unknown",
        executable: false,
        recorded: false,
        scores: [],
        contributions: [],
        unavailableReasons: ["awaiting_objective_control_checkpoint"],
        resolvedAtClock: null,
      });
      continue;
    }
    if (event.type === "battleshock_changed") {
      if (clock.status !== "active" || !sameBattleClock(event.clock, clock)) {
        throw new Error("Battle-shock changed outside its battle timing window");
      }
      if (event.battleShocked) {
        battleShockedFormations.set(event.formationId, {
          formationId: event.formationId,
          reason: event.reason,
          appliedAt: event.clock,
        });
      } else {
        if (!battleShockedFormations.has(event.formationId)) {
          throw new Error("Formation is not currently Battle-shocked");
        }
        battleShockedFormations.delete(event.formationId);
      }
      continue;
    }
    if (event.type === "reserve_arrived") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "reinforcements" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Reserves can only arrive in the Reinforcements step");
      }
      const formation = formations.get(event.formationId);
      const deployment = deploymentByFormation.get(event.formationId);
      if (!formation || !["reserves", "strategic_reserves"].includes(deployment?.location)) {
        throw new Error("Formation did not start the battle in Reserves");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's Reserves can arrive");
      }
      if (deployedFormationIds.has(event.formationId) || reserveArrivals.has(event.formationId)) {
        throw new Error("Reserve formation is already on the battlefield");
      }
      if (clock.battleRound < deployment.earliestBattleRound) {
        throw new Error(
          `This Reserve formation cannot arrive before battle round ${deployment.earliestBattleRound}`,
        );
      }
      const deployedTree =
        state.version >= TRANSPORT_NESTING_BATTLE_STATE_VERSION
          ? deployedFormationTree(event.formationId, embarkedByFormation)
          : new Set([
              event.formationId,
              ...[...embarkedByFormation]
                .filter(([, transportId]) => transportId === event.formationId)
                .map(([passengerId]) => passengerId),
            ]);
      for (const deployedFormationId of deployedTree) {
        deployedFormationIds.add(deployedFormationId);
      }
      reserveArrivals.set(event.formationId, event);
      movementByFormation.set(event.formationId, {
        formationId: event.formationId,
        movement: "normal",
        clock: event.clock,
        fromReserves: true,
      });
      const requiresModelPosition =
        event.sequence > legacyModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        pendingModelPosition = {
          formationId: event.formationId,
          context: "reserve_arrival",
          referenceEventId: event.id,
          fireOverwatchTrigger: event.sequence > legacyFireOverwatchThroughSequence ? "set_up" : "",
          reconcilesStaleStart: false,
        };
      } else if (event.sequence > legacyFireOverwatchThroughSequence) {
        pendingFireOverwatch = {
          triggerEventId: event.id,
          trigger: "set_up",
          targetFormationId: event.formationId,
          responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
          clock: { ...clock },
        };
      }
      continue;
    }
    if (event.type === "rapid_ingress_passed") {
      if (
        !pendingRapidIngress ||
        event.triggerEventId !== pendingRapidIngress.triggerEventId ||
        event.playerId !== pendingRapidIngress.responderPlayerId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Rapid Ingress pass does not match the pending reaction window");
      }
      rapidIngressPasses.push({ ...event, ...pendingRapidIngress });
      pendingRapidIngress = null;
      continue;
    }
    if (event.type === "rapid_ingress_resolved") {
      if (
        !pendingRapidIngress ||
        event.triggerEventId !== pendingRapidIngress.triggerEventId ||
        event.playerId !== pendingRapidIngress.responderPlayerId ||
        !pendingRapidIngress.candidateFormationIds.includes(event.formationId) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Rapid Ingress does not match the pending reaction window");
      }
      const formation = formations.get(event.formationId);
      const deployment = deploymentByFormation.get(event.formationId);
      const targetInReserves = Boolean(
        ["reserves", "strategic_reserves"].includes(deployment?.location) &&
          !deployedFormationIds.has(event.formationId) &&
          !reserveArrivals.has(event.formationId),
      );
      const respondingPlayer = formation.playerId === pendingRapidIngress.responderPlayerId;
      const placementLegal = rapidIngressPlacementIsLegal(event, deployment);
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.playerId}:rapid_ingress`;
      const commandPoints = resources.get(event.playerId).get("command_points");
      if (
        event.commandPointsBefore !== commandPoints.value ||
        !rapidIngressIsValid(
          clock.phase,
          clock.step,
          clock.battleRound,
          deployment.earliestBattleRound,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          usedRapidIngressKeys.has(usageKey),
          battleShockedFormations.has(formation.id),
          event.firstRoundOutOfPhaseAllowed,
          rapidIngressFlags(event, targetInReserves, respondingPlayer, placementLegal),
        )
      ) {
        throw new Error("Rapid Ingress facts or Command Point spending are inconsistent");
      }
      resources.get(event.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedRapidIngressKeys.add(usageKey);
      const deployedTree = deployedFormationTree(event.formationId, embarkedByFormation);
      for (const deployedFormationId of deployedTree) {
        deployedFormationIds.add(deployedFormationId);
      }
      reserveArrivals.set(event.formationId, event);
      movementByFormation.set(event.formationId, {
        formationId: event.formationId,
        movement: "normal",
        clock: event.clock,
        fromReserves: true,
        rapidIngress: true,
      });
      rapidIngresses.push({
        ...event,
        deployedFormationIds: [...deployedTree].sort(),
        passengersCannotDisembarkThisPhase: true,
        largeModelRestrictedThisTurn: Boolean(event.largeModelEdgeException),
      });
      pendingRapidIngress = null;
      if (
        event.sequence > legacyModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact"
      ) {
        pendingModelPosition = {
          formationId: event.formationId,
          context: "rapid_ingress",
          referenceEventId: event.id,
          fireOverwatchTrigger: "",
          reconcilesStaleStart: false,
        };
      }
      continue;
    }
    if (event.type === "formation_embarked") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("A formation can embark only in the Move Units step");
      }
      const formation = formations.get(event.formationId);
      const transport = formations.get(event.transportFormationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        !formationIsOnBattlefield(
          event.transportFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Both the passenger and Transport must be on the battlefield");
      }
      if (
        formation.playerId !== clock.activePlayerId ||
        transport.playerId !== formation.playerId
      ) {
        throw new Error("Only the active player's formation can embark in a friendly Transport");
      }
      if (!transport.keywords.includes("transport") || formationDestroyed(transport)) {
        throw new Error("A formation can embark only in a surviving Transport");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot embark");
      if (state.version >= TRANSPORT_COMPATIBILITY_BATTLE_STATE_VERSION) {
        const occupancy = transportOccupancyReport(
          formations,
          embarkedByFormation,
          transport.id,
          formation.id,
        );
        if (!occupancy.valid) throw new Error(occupancy.reason);
      } else if (formation.assignedTransportFormationId !== transport.id) {
        throw new Error("Formation is not assigned to that Transport in the locked roster");
      }
      const movement = movementByFormation.get(event.formationId);
      if (
        !movement ||
        !sameTurn(movement.clock, clock) ||
        !["normal", "advance", "fall_back"].includes(movement.movement)
      ) {
        throw new Error("Embarkation requires a completed Normal, Advance, or Fall Back move");
      }
      const disembarkation = disembarkedByFormation.get(event.formationId);
      if (disembarkation && samePhase(disembarkation.clock, clock)) {
        throw new Error("A formation cannot embark after disembarking in the same phase");
      }
      embarkedByFormation.set(event.formationId, event.transportFormationId);
      if (event.sequence > legacyTransportModelLocationsThroughSequence) {
        recordModelLocation(event.formationId, {
          context: "embarkation",
          referenceEventId: event.id,
          sequence: event.sequence,
          location: "embarked",
          transportFormationId: event.transportFormationId,
        });
        currentModelPositionsByFormation.delete(event.formationId);
        geometryStaleFormationIds.delete(event.formationId);
      } else if (currentModelPositionsByFormation.has(event.formationId)) {
        geometryStaleFormationIds.add(event.formationId);
      }
      continue;
    }
    if (event.type === "formation_disembarked") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("A formation can disembark only in the Move Units step");
      }
      const formation = formations.get(event.formationId);
      const transport = formations.get(event.transportFormationId);
      if (
        formation.playerId !== clock.activePlayerId ||
        transport.playerId !== formation.playerId
      ) {
        throw new Error("Only the active player's formation can disembark");
      }
      if (embarkedByFormation.get(event.formationId) !== event.transportFormationId) {
        throw new Error("Formation is not embarked in the selected Transport");
      }
      if (!movementPhaseStartEmbarkedFormationIds.has(event.formationId)) {
        throw new Error("Only a unit that started the Movement phase embarked can disembark");
      }
      if (formationDestroyed(transport)) {
        throw new Error("Destroyed Transport passengers require immediate forced disembarkation");
      }
      const transportMovement = movementByFormation.get(event.transportFormationId);
      const currentTransportMovement =
        transportMovement && sameTurn(transportMovement.clock, clock) ? transportMovement : null;
      if (["advance", "fall_back"].includes(currentTransportMovement?.movement)) {
        throw new Error("A unit cannot disembark after its Transport Advanced or Fell Back");
      }
      embarkedByFormation.delete(event.formationId);
      deployedFormationIds.add(event.formationId);
      disembarkedByFormation.set(event.formationId, event);
      const requiresModelPosition =
        event.sequence > legacyExtendedModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        pendingModelPosition = {
          formationId: event.formationId,
          context: "disembarkation",
          referenceEventId: event.id,
          fireOverwatchTrigger: "",
          reconcilesStaleStart: false,
          maximumDistanceThousandths: 0,
          transportFormationId: event.transportFormationId,
          placementRadiusThousandths: 3000,
          emergency: false,
          destroyedTransport: false,
        };
        geometryStaleFormationIds.add(event.formationId);
      } else if (currentModelPositionsByFormation.has(event.formationId)) {
        geometryStaleFormationIds.add(event.formationId);
      }
      if (currentTransportMovement?.movement === "normal") {
        movementByFormation.set(event.formationId, {
          formationId: event.formationId,
          movement: "normal",
          clock: event.clock,
          fromMovedTransport: true,
        });
      }
      if (event.sequence > legacyFireOverwatchThroughSequence) {
        pendingFireOverwatch = {
          triggerEventId: event.id,
          trigger: "set_up",
          targetFormationId: event.formationId,
          responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
          clock: { ...clock },
        };
      }
      continue;
    }
    if (event.type === "transport_destroyed_resolved") {
      const pending = pendingTransportDestructions.get(event.transportFormationId);
      if (
        !pending ||
        pending.causeEventId !== event.causeEventId ||
        !sameBattleClock(event.clock, pending.clock)
      ) {
        throw new Error("Destroyed Transport resolution does not match the pending destruction");
      }
      const expectedPassengerIds = [...pending.passengerFormationIds].sort();
      const recordedPassengerIds = event.passengers
        .map((passenger) => passenger.formationId)
        .sort();
      if (
        expectedPassengerIds.length !== recordedPassengerIds.length ||
        expectedPassengerIds.some((id, index) => id !== recordedPassengerIds[index])
      ) {
        throw new Error("Destroyed Transport resolution does not contain every passenger");
      }
      pendingTransportDestructions.delete(event.transportFormationId);
      for (const passenger of event.passengers) {
        const formation = formations.get(passenger.formationId);
        const expected = replayDestroyedPassengerResolution(formation, passenger);
        if (
          expected.summary.damage !== passenger.summary.damage ||
          expected.summary.modelsDestroyed !== passenger.summary.modelsDestroyed ||
          expected.allocations.some((allocation, index) => {
            const recorded = passenger.allocations[index];
            return (
              !recorded ||
              allocation.segmentId !== recorded.segmentId ||
              !sameHealth(allocation.before, recorded.before) ||
              !sameHealth(allocation.after, recorded.after)
            );
          })
        ) {
          throw new Error("Destroyed Transport passenger health does not match its recorded rolls");
        }
        for (const allocation of passenger.allocations) {
          formation.health[allocation.segmentId] = { ...allocation.after };
        }
        refreshGeometryStaleness(passenger.formationId);
        embarkedByFormation.delete(passenger.formationId);
        deployedFormationIds.add(passenger.formationId);
        disembarkedByFormation.set(passenger.formationId, {
          ...passenger,
          transportFormationId: event.transportFormationId,
          destroyedTransport: true,
          clock: event.clock,
        });
        const requiresModelPosition =
          event.sequence > legacyTransportModelLocationsThroughSequence &&
          battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
          formation.weaponBearerTracking === "exact" &&
          !formationDestroyed(formation);
        if (event.sequence > legacyTransportModelLocationsThroughSequence) {
          currentModelPositionsByFormation.delete(passenger.formationId);
          if (formationDestroyed(formation)) {
            geometryStaleFormationIds.delete(passenger.formationId);
            recordModelLocation(passenger.formationId, {
              context: "destroyed_transport_disembarkation",
              referenceEventId: event.id,
              sequence: event.sequence,
              location: "destroyed",
              transportFormationId: event.transportFormationId,
            });
          } else if (requiresModelPosition) {
            enqueueModelPosition({
              formationId: passenger.formationId,
              context: passenger.emergency
                ? "emergency_disembarkation"
                : "destroyed_transport_disembarkation",
              referenceEventId: event.id,
              fireOverwatchTrigger: "",
              reconcilesStaleStart: false,
              maximumDistanceThousandths: 0,
              transportFormationId: event.transportFormationId,
              placementRadiusThousandths: passenger.emergency ? 6000 : 3000,
              emergency: passenger.emergency,
              destroyedTransport: true,
            });
            geometryStaleFormationIds.add(passenger.formationId);
          } else {
            recordModelLocation(passenger.formationId, {
              context: passenger.emergency
                ? "emergency_disembarkation"
                : "destroyed_transport_disembarkation",
              referenceEventId: event.id,
              sequence: event.sequence,
              location: "battlefield",
              transportFormationId: event.transportFormationId,
            });
            geometryStaleFormationIds.delete(passenger.formationId);
          }
        }
        movementByFormation.set(passenger.formationId, {
          formationId: passenger.formationId,
          movement: "normal",
          clock: event.clock,
          fromDestroyedTransport: true,
        });
        if (!formationDestroyed(formation)) {
          battleShockedFormations.set(passenger.formationId, {
            formationId: passenger.formationId,
            reason: "Disembarked from a destroyed Transport",
            appliedAt: event.clock,
          });
        }
        const nestedPassengers = [...embarkedByFormation]
          .filter(([, transportId]) => transportId === passenger.formationId)
          .map(([formationId]) => formationId)
          .sort();
        if (formationDestroyed(formation) && nestedPassengers.length > 0) {
          pendingTransportDestructions.set(passenger.formationId, {
            transportFormationId: passenger.formationId,
            causeEventId: event.id,
            passengerFormationIds: nestedPassengers,
            clock: event.clock,
          });
        }
      }
      transportDestructionResolutions.set(event.transportFormationId, event);
      continue;
    }
    if (event.type === "movement_started") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Movement started outside the Move Units step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        formation.playerId !== clock.activePlayerId ||
        formationDestroyed(formation)
      ) {
        throw new Error(
          "Only a living active-player formation on the battlefield can start a move",
        );
      }
      const previous = movementByFormation.get(event.formationId);
      if (previous && sameTurn(previous.clock, clock)) {
        throw new Error("Formation movement has already been recorded this turn");
      }
      const started = movementStartsByFormation.get(event.formationId);
      if (started && sameTurn(started.clock, clock)) {
        throw new Error("Formation movement has already started this turn");
      }
      movementStartsByFormation.set(event.formationId, event);
      pendingFireOverwatch = {
        triggerEventId: event.id,
        trigger: `${event.movement === "normal" ? "normal_move" : event.movement}_start`,
        targetFormationId: event.formationId,
        responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
        clock: { ...clock },
      };
      continue;
    }
    if (event.type === "movement_recorded") {
      if (
        clock.status !== "active" ||
        clock.phase !== "movement" ||
        clock.step !== "move_units" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Movement was recorded outside the Move Units step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation that is not on the battlefield cannot move");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's formation can move");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot move");
      const disembarkation = disembarkedByFormation.get(event.formationId);
      if (
        event.movement === "stationary" &&
        disembarkation &&
        sameTurn(disembarkation.clock, clock)
      ) {
        throw new Error("A unit that disembarked this turn cannot Remain Stationary");
      }
      const previous = movementByFormation.get(event.formationId);
      if (previous && sameTurn(previous.clock, clock)) {
        throw new Error("Formation movement has already been recorded this turn");
      }
      if (event.sequence > legacyFireOverwatchThroughSequence && event.movement !== "stationary") {
        const started = movementStartsByFormation.get(event.formationId);
        if (
          !started ||
          started.movement !== event.movement ||
          !sameBattleClock(started.clock, clock)
        ) {
          throw new Error("Complete the declared move after its start Fire Overwatch window");
        }
        movementStartsByFormation.delete(event.formationId);
      }
      movementByFormation.set(event.formationId, event);
      const requiresModelPosition =
        event.movement !== "stationary" &&
        event.sequence > legacyModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        if (!currentModelPositionsByFormation.has(event.formationId)) {
          throw new Error("Movement requires a prior per-model position snapshot");
        }
        const reconcilesStaleStart = geometryStaleFormationIds.has(event.formationId);
        pendingModelPosition = {
          formationId: event.formationId,
          context: "movement",
          referenceEventId: event.id,
          fireOverwatchTrigger:
            event.sequence > legacyFireOverwatchThroughSequence
              ? `${event.movement === "normal" ? "normal_move" : event.movement}_end`
              : "",
          reconcilesStaleStart,
        };
        geometryStaleFormationIds.add(event.formationId);
      } else if (
        event.sequence > legacyFireOverwatchThroughSequence &&
        event.movement !== "stationary"
      ) {
        pendingFireOverwatch = {
          triggerEventId: event.id,
          trigger: `${event.movement === "normal" ? "normal_move" : event.movement}_end`,
          targetFormationId: event.formationId,
          responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
          clock: { ...clock },
        };
      }
      continue;
    }
    if (event.type === "charge_declared") {
      if (
        clock.status !== "active" ||
        clock.phase !== "charge" ||
        clock.step !== "charge_moves" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Charge was declared outside the Charge Moves step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        formation.playerId !== clock.activePlayerId ||
        formationDestroyed(formation)
      ) {
        throw new Error(
          "Only a living active-player formation on the battlefield can declare a charge",
        );
      }
      const priorCharge = chargeByFormation.get(event.formationId);
      const priorDeclaration = chargeDeclarationsByFormation.get(event.formationId);
      if (
        (priorCharge && sameTurn(priorCharge.clock, clock)) ||
        (priorDeclaration && sameTurn(priorDeclaration.clock, clock))
      ) {
        throw new Error("Formation has already declared or attempted a charge this turn");
      }
      for (const targetFormationId of event.targetFormationIds) {
        const target = formations.get(targetFormationId);
        if (
          !formationIsOnBattlefield(
            targetFormationId,
            deploymentByFormation,
            deployedFormationIds,
            embarkedByFormation,
          ) ||
          target.playerId === formation.playerId ||
          formationDestroyed(target)
        ) {
          throw new Error("A charge declaration requires a living enemy target on the battlefield");
        }
      }
      if (!event.phaseStartEligibilityConfirmed || !event.startedOutsideEngagementRange) {
        throw new Error(
          "Charge declaration requires reviewed phase-start and Engagement Range eligibility",
        );
      }
      if (
        formation.keywords.some((keyword) => keyword.toLowerCase() === "aircraft") &&
        !event.eligibilityOverride
      ) {
        throw new Error("An Aircraft formation requires an explicit rule override to charge");
      }
      const movement = movementByFormation.get(event.formationId);
      const currentMovement = movement && sameTurn(movement.clock, clock) ? movement : null;
      if (!currentMovement && !event.eligibilityOverride) {
        throw new Error("Record this formation's movement before declaring a charge");
      }
      if (
        ["advance", "fall_back"].includes(currentMovement?.movement) &&
        !event.eligibilityOverride
      ) {
        throw new Error("A formation that Advanced or Fell Back requires a charge rule override");
      }
      if (
        (currentMovement?.fromMovedTransport || currentMovement?.fromDestroyedTransport) &&
        !event.eligibilityOverride
      ) {
        throw new Error("A unit that disembarked after movement cannot declare a charge this turn");
      }
      chargeDeclarationsByFormation.set(event.formationId, event);
      pendingFireOverwatch = {
        triggerEventId: event.id,
        trigger: "charge_declared",
        targetFormationId: event.formationId,
        responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
        clock: { ...clock },
      };
      continue;
    }
    if (event.type === "charge_recorded") {
      if (
        clock.status !== "active" ||
        clock.phase !== "charge" ||
        clock.step !== "charge_moves" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Charge was recorded outside the Charge Moves step");
      }
      const formation = formations.get(event.formationId);
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation that is not on the battlefield cannot charge");
      }
      if (formation.playerId !== clock.activePlayerId) {
        throw new Error("Only the active player's formation can charge");
      }
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot charge");
      const declaration =
        event.sequence > legacyFireOverwatchThroughSequence
          ? chargeDeclarationsByFormation.get(event.formationId)
          : null;
      if (event.sequence > legacyFireOverwatchThroughSequence) {
        if (
          !declaration ||
          !sameBattleClock(declaration.clock, clock) ||
          declaration.targetFormationIds.length !== event.targetFormationIds.length ||
          declaration.targetFormationIds.some(
            (targetId, index) => targetId !== event.targetFormationIds[index],
          ) ||
          declaration.targetFacts.some((declaredFact) => {
            const resolvedFact = event.targetFacts.find(
              (candidate) => candidate.formationId === declaredFact.formationId,
            );
            return (
              !resolvedFact ||
              resolvedFact.startDistanceThousandths !== declaredFact.startDistanceThousandths
            );
          })
        ) {
          throw new Error("Resolve the declared charge's Fire Overwatch window before rolling");
        }
        chargeDeclarationsByFormation.delete(event.formationId);
      }
      if (
        formation.keywords.some((keyword) => keyword.toLowerCase() === "aircraft") &&
        !event.eligibilityOverride
      ) {
        throw new Error("An Aircraft formation requires an explicit rule override to charge");
      }
      const previous = chargeByFormation.get(event.formationId);
      if (previous && sameTurn(previous.clock, clock)) {
        throw new Error("Formation has already attempted a charge this turn");
      }
      for (const targetFormationId of event.targetFormationIds) {
        const target = formations.get(targetFormationId);
        if (
          !formationIsOnBattlefield(
            targetFormationId,
            deploymentByFormation,
            deployedFormationIds,
            embarkedByFormation,
          )
        ) {
          throw new Error("A formation cannot charge a target outside the battlefield");
        }
        if (target.playerId === formation.playerId) {
          throw new Error("A formation cannot charge a friendly formation");
        }
        if (formationDestroyed(target))
          throw new Error("A formation cannot charge a destroyed target");
      }
      const legacyChargeMovement = event.sequence <= legacyChargeMovementThroughSequence;
      if (legacyChargeMovement) {
        if (!event.targetEligibilityConfirmed) {
          throw new Error(
            "Charge eligibility requires an explicit confirmation of range and table state",
          );
        }
      } else {
        if (!Array.isArray(event.targetFacts)) {
          throw new Error("New battle histories require structured charge movement facts");
        }
        const maximumTargetDistanceThousandths = Math.max(
          ...event.targetFacts.map((fact) => fact.startDistanceThousandths),
        );
        const flags = chargeResolutionFlags(event);
        if (
          !chargeResolutionIsValid(
            event.rolls[0],
            event.rolls[1],
            event.rollModifier,
            event.chargeDistanceThousandths,
            maximumTargetDistanceThousandths,
            event.maximumModelMoveThousandths,
            event.targetFacts.length,
            event.successful,
            flags,
          )
        ) {
          throw new Error("Charge roll and movement facts do not form a legal resolution");
        }
      }
      const movement = movementByFormation.get(event.formationId);
      const currentMovement = movement && sameTurn(movement.clock, clock) ? movement : null;
      if (!currentMovement && !event.eligibilityOverride) {
        throw new Error(
          "Record this formation's movement or confirm a charge eligibility override",
        );
      }
      if (
        ["advance", "fall_back"].includes(currentMovement?.movement) &&
        !event.eligibilityOverride
      ) {
        throw new Error(
          `A formation that ${currentMovement.movement === "advance" ? "Advanced" : "Fell Back"} requires an explicit charge eligibility override`,
        );
      }
      if (
        (currentMovement?.fromMovedTransport || currentMovement?.fromDestroyedTransport) &&
        !event.eligibilityOverride
      ) {
        throw new Error("A unit that disembarked after movement cannot declare a charge this turn");
      }
      chargeByFormation.set(event.formationId, event);
      const requiresModelPosition =
        event.successful &&
        event.sequence > legacyExtendedModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        if (!currentModelPositionsByFormation.has(event.formationId)) {
          throw new Error("Charge movement requires a prior per-model position snapshot");
        }
        const reconcilesStaleStart = geometryStaleFormationIds.has(event.formationId);
        pendingModelPosition = {
          formationId: event.formationId,
          context: "charge",
          referenceEventId: event.id,
          fireOverwatchTrigger: "",
          reconcilesStaleStart,
          maximumDistanceThousandths: event.maximumModelMoveThousandths,
        };
        geometryStaleFormationIds.add(event.formationId);
      } else if (event.successful && currentModelPositionsByFormation.has(event.formationId)) {
        geometryStaleFormationIds.add(event.formationId);
      }
      const deferredHazardousNowDue = Boolean(
        pendingHazardous &&
          !pendingHazardous.due &&
          pendingHazardous.triggerChargeEventId === declaration?.id &&
          event.formationId === declaration?.formationId,
      );
      if (deferredHazardousNowDue) {
        pendingHazardous = { ...pendingHazardous, due: true, chargeResolutionEventId: event.id };
      }
      if (event.successful && event.sequence > legacyHeroicInterventionThroughSequence) {
        const reaction = {
          triggerChargeEventId: event.id,
          chargingFormationId: event.formationId,
          responderPlayerId: otherPlayerId(state.players, clock.activePlayerId),
          clock: { ...clock },
        };
        pendingHeroicIntervention = reaction;
      }
      continue;
    }
    if (event.type === "fire_overwatch_passed") {
      if (
        !pendingFireOverwatch ||
        event.triggerEventId !== pendingFireOverwatch.triggerEventId ||
        event.playerId !== pendingFireOverwatch.responderPlayerId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Fire Overwatch pass does not match the pending reaction window");
      }
      fireOverwatchPasses.push({ ...event, ...pendingFireOverwatch });
      pendingFireOverwatch = null;
      continue;
    }
    if (event.type === "fire_overwatch_started") {
      if (
        !pendingFireOverwatch ||
        event.triggerEventId !== pendingFireOverwatch.triggerEventId ||
        event.targetFormationId !== pendingFireOverwatch.targetFormationId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Fire Overwatch does not match the pending reaction window");
      }
      const formation = formations.get(event.formationId);
      const target = formations.get(event.targetFormationId);
      if (
        formation.playerId !== pendingFireOverwatch.responderPlayerId ||
        target.playerId === formation.playerId
      ) {
        throw new Error("Fire Overwatch must use the responding player's formation");
      }
      if (
        !formationIsOnBattlefield(
          formation.id,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        formationDestroyed(formation) ||
        formationDestroyed(target)
      ) {
        throw new Error("Fire Overwatch requires living formations on the battlefield");
      }
      const hasSurvivingRangedWeapon = formation.weaponInventory.some(
        (group) =>
          group.profiles.some((profile) => profile.type === "Ranged") &&
          formationSurvivingWeaponCount(formation, group.sourceSavedUnitId, group.groupId) > 0,
      );
      if (
        rapidIngresses.some(
          (arrival) =>
            arrival.formationId === formation.id &&
            arrival.largeModelEdgeException &&
            sameTurn(arrival.clock, clock),
        )
      ) {
        throw new Error(
          "A large model using the Strategic Reserves edge exception cannot shoot this turn",
        );
      }
      if (!hasSurvivingRangedWeapon) {
        throw new Error("Fire Overwatch requires a surviving ranged weapon");
      }
      const lowerKeywords = formation.keywords.map((keyword) => keyword.toLowerCase());
      const titanicRestrictionSatisfied = !lowerKeywords.includes("titanic");
      if (!titanicRestrictionSatisfied || !event.titanicRestrictionSatisfied) {
        throw new Error("A Titanic formation cannot be selected for Fire Overwatch");
      }
      if (battleShockedFormations.has(formation.id) && !event.stratagemEligibilityOverrideReason) {
        throw new Error(
          "A Battle-shocked formation cannot use Fire Overwatch without a source override",
        );
      }
      if (
        !fireOverwatchIsValid(
          pendingFireOverwatch.trigger,
          clock.phase,
          event.distanceThousandths,
          fireOverwatchFlags(event),
        )
      ) {
        throw new Error("Fire Overwatch facts do not form a legal reviewed reaction");
      }
      if (event.commandPointCost !== 1 && !event.costOverrideReason) {
        throw new Error("A non-canonical Fire Overwatch cost requires a source-rule reason");
      }
      const usageKey = `${clock.battleRound}:${clock.turn}:fire_overwatch`;
      if (usedFireOverwatchKeys.has(usageKey) && !event.usageOverrideReason) {
        throw new Error("Fire Overwatch has already been used this turn");
      }
      const commandPoints = resources.get(formation.playerId).get("command_points");
      if (
        event.commandPointsBefore !== commandPoints.value ||
        event.commandPointsAfter !== event.commandPointsBefore - event.commandPointCost ||
        event.commandPointsAfter < 0
      ) {
        throw new Error("Fire Overwatch Command Point spending is inconsistent");
      }
      resources.get(formation.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedFireOverwatchKeys.add(usageKey);
      const overwatch = {
        ...event,
        trigger: pendingFireOverwatch.trigger,
        responderPlayerId: pendingFireOverwatch.responderPlayerId,
        source: "fire_overwatch",
      };
      fireOverwatches.push(overwatch);
      activeActivation = {
        ...overwatch,
        activationType: "shooting",
        weaponRestriction: "all",
        attackCount: 0,
        hazardousTestCount: 0,
        hazardousGroupIds: [],
        hazardousTestsRecorded: false,
        pileIn: null,
        consolidation: null,
      };
      rangedDeclarationDraft = [];
      activeRangedDeclarationSet = null;
      readyRangedAttacks = [];
      pendingFireOverwatch = null;
      continue;
    }
    if (event.type === "heroic_intervention_passed") {
      if (
        !pendingHeroicIntervention ||
        event.triggerChargeEventId !== pendingHeroicIntervention.triggerChargeEventId ||
        event.playerId !== pendingHeroicIntervention.responderPlayerId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Heroic Intervention pass does not match the pending reaction window");
      }
      heroicInterventionPasses.push(event);
      pendingHeroicIntervention = null;
      continue;
    }
    if (event.type === "heroic_intervention_resolved") {
      if (
        !pendingHeroicIntervention ||
        event.triggerChargeEventId !== pendingHeroicIntervention.triggerChargeEventId ||
        event.targetFormationId !== pendingHeroicIntervention.chargingFormationId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Heroic Intervention does not match the pending reaction window");
      }
      const formation = formations.get(event.formationId);
      const target = formations.get(event.targetFormationId);
      if (
        formation.playerId !== pendingHeroicIntervention.responderPlayerId ||
        target.playerId === formation.playerId
      ) {
        throw new Error("Heroic Intervention must use the responding player's formation");
      }
      if (
        !formationIsOnBattlefield(
          formation.id,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        formationDestroyed(formation)
      ) {
        throw new Error("Heroic Intervention requires a living formation on the battlefield");
      }
      const lowerKeywords = formation.keywords.map((keyword) => keyword.toLowerCase());
      const vehicleRestrictionSatisfied =
        !lowerKeywords.includes("vehicle") || lowerKeywords.includes("walker");
      if (!vehicleRestrictionSatisfied || !event.vehicleRestrictionSatisfied) {
        throw new Error("Only a Walker Vehicle can use Heroic Intervention");
      }
      if (
        (lowerKeywords.includes("aircraft") || battleShockedFormations.has(formation.id)) &&
        !event.stratagemEligibilityOverrideReason
      ) {
        throw new Error(
          "This formation requires an explicit source-rule override for Heroic Intervention",
        );
      }
      if (
        rapidIngresses.some(
          (arrival) =>
            arrival.formationId === formation.id &&
            arrival.largeModelEdgeException &&
            sameTurn(arrival.clock, clock),
        ) &&
        !event.stratagemEligibilityOverrideReason
      ) {
        throw new Error(
          "The large-model Rapid Ingress exception prevents this formation from charging this turn",
        );
      }
      const chargeFlags = heroicInterventionChargeFlags(event);
      const heroicFlags = heroicInterventionFlags(event);
      if (
        !heroicInterventionIsValid(
          event.rolls[0],
          event.rolls[1],
          event.rollModifier,
          event.chargeDistanceThousandths,
          event.startDistanceThousandths,
          event.maximumModelMoveThousandths,
          event.successful,
          chargeFlags,
          heroicFlags,
        )
      ) {
        throw new Error("Heroic Intervention facts do not form a legal reviewed reaction");
      }
      if (event.commandPointCost !== 1 && !event.costOverrideReason) {
        throw new Error("A non-canonical Heroic Intervention cost requires a source-rule reason");
      }
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${formation.playerId}:heroic_intervention`;
      if (usedHeroicInterventionKeys.has(usageKey) && !event.usageOverrideReason) {
        throw new Error("Heroic Intervention has already been used by this player this phase");
      }
      const commandPoints = resources.get(formation.playerId).get("command_points");
      if (
        event.commandPointsBefore !== commandPoints.value ||
        event.commandPointsAfter !== event.commandPointsBefore - event.commandPointCost ||
        event.commandPointsAfter < 0
      ) {
        throw new Error("Heroic Intervention Command Point spending is inconsistent");
      }
      const priorCharge = chargeByFormation.get(formation.id);
      if (priorCharge && sameTurn(priorCharge.clock, clock)) {
        throw new Error("The intervening formation has already attempted a charge this turn");
      }
      resources.get(formation.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedHeroicInterventionKeys.add(usageKey);
      const chargeEvent = {
        ...event,
        source: "heroic_intervention",
        receivesChargeBonus: false,
        targetFormationIds: [event.targetFormationId],
        targetFacts: [
          {
            formationId: event.targetFormationId,
            startDistanceThousandths: event.startDistanceThousandths,
            endsWithinEngagementRange: event.successful && event.endsWithinEngagementRange,
          },
        ],
        phaseStartEligibilityConfirmed: event.targetEligibilityConfirmed,
        phaseStartEligibilityReason: event.targetEligibilityReason,
        eligibilityOverride: Boolean(event.stratagemEligibilityOverrideReason),
        overrideReason: event.stratagemEligibilityOverrideReason,
      };
      chargeByFormation.set(formation.id, chargeEvent);
      const requiresModelPosition =
        event.successful &&
        event.sequence > legacyExtendedModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formation.weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        if (!currentModelPositionsByFormation.has(formation.id)) {
          throw new Error("Heroic Intervention requires a prior per-model position snapshot");
        }
        const reconcilesStaleStart = geometryStaleFormationIds.has(formation.id);
        pendingModelPosition = {
          formationId: formation.id,
          context: "heroic_intervention",
          referenceEventId: event.id,
          fireOverwatchTrigger: "",
          reconcilesStaleStart,
          maximumDistanceThousandths: event.maximumModelMoveThousandths,
        };
        geometryStaleFormationIds.add(formation.id);
      } else if (event.successful && currentModelPositionsByFormation.has(formation.id)) {
        geometryStaleFormationIds.add(formation.id);
      }
      heroicInterventions.push(chargeEvent);
      pendingHeroicIntervention = null;
      continue;
    }
    if (event.type === "counter_offensive_passed") {
      if (
        !pendingCounterOffensive ||
        event.triggerActivationEventId !== pendingCounterOffensive.triggerActivationEventId ||
        event.playerId !== pendingCounterOffensive.responderPlayerId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Counter-offensive pass does not match the pending reaction window");
      }
      counterOffensivePasses.push({ ...event, ...pendingCounterOffensive });
      pendingCounterOffensive = null;
      continue;
    }
    if (event.type === "counter_offensive_resolved") {
      if (
        !pendingCounterOffensive ||
        event.triggerActivationEventId !== pendingCounterOffensive.triggerActivationEventId ||
        event.playerId !== pendingCounterOffensive.responderPlayerId ||
        !pendingCounterOffensive.candidateFormationIds.includes(event.formationId) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Counter-offensive does not match the pending reaction window");
      }
      const formation = formations.get(event.formationId);
      const activationKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.formationId}`;
      const targetNotFought = !completedActivations.has(activationKey);
      const respondingPlayer = formation.playerId === pendingCounterOffensive.responderPlayerId;
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.playerId}:counter_offensive`;
      const commandPoints = resources.get(event.playerId).get("command_points");
      if (
        formationDestroyed(formation) ||
        !formationIsOnBattlefield(
          formation.id,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        event.commandPointsBefore !== commandPoints.value ||
        !counterOffensiveIsValid(
          clock.phase,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          usedCounterOffensiveKeys.has(usageKey),
          battleShockedFormations.has(formation.id),
          counterOffensiveFlags(event, targetNotFought, respondingPlayer),
        )
      ) {
        throw new Error("Counter-offensive facts or Command Point spending are inconsistent");
      }
      resources.get(event.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedCounterOffensiveKeys.add(usageKey);
      counterOffensives.push({ ...event });
      forcedFightFormationId = event.formationId;
      pendingCounterOffensive = null;
      continue;
    }
    if (event.type === "fight_priority_passed") {
      if (
        !battleAttackWindow(clock) ||
        clock.phase !== "fight" ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Fight priority can only pass during a Fight selection step");
      }
      if (activeActivation) throw new Error("Fight priority cannot pass during an activation");
      if (forcedFightFormationId) {
        throw new Error("The Counter-offensive formation must fight next");
      }
      if (pendingChoices.size > 0) throw new Error("Pending choices block Fight priority");
      if (event.playerId !== clock.priorityPlayerId) {
        throw new Error("Only the player with Fight priority can pass");
      }
      clock = { ...clock, priorityPlayerId: otherPlayerId(state.players, event.playerId) };
      continue;
    }
    if (event.type === "activation_started") {
      if (!battleAttackWindow(clock) || !sameBattleClock(event.clock, clock)) {
        throw new Error("Formation activation started outside an attack step");
      }
      if (pendingChoices.size > 0) throw new Error("Pending choices block formation activation");
      if (activeActivation) throw new Error("Another formation activation is already in progress");
      if (forcedFightFormationId && event.formationId !== forcedFightFormationId) {
        throw new Error("The Counter-offensive formation must fight next");
      }
      const counterOffensiveActivation = forcedFightFormationId === event.formationId;
      const formation = formations.get(event.formationId);
      if (formationDestroyed(formation)) throw new Error("A destroyed formation cannot activate");
      if (
        !formationIsOnBattlefield(
          event.formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("A formation outside the battlefield cannot activate");
      }
      const expectedType = clock.phase === "shooting" ? "shooting" : "fight";
      if (event.activationType !== expectedType) {
        throw new Error(`Only a ${expectedType} activation can start in this step`);
      }
      const activationKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.formationId}`;
      if (completedActivations.has(activationKey)) {
        throw new Error("Formation has already completed an activation this phase");
      }
      let weaponRestriction = "all";
      if (event.activationType === "shooting") {
        if (formation.playerId !== clock.activePlayerId) {
          throw new Error("Only the active player's formation can shoot");
        }
        const movement = movementByFormation.get(event.formationId);
        const currentMovement = movement && sameTurn(movement.clock, clock) ? movement : null;
        if (!currentMovement && !event.eligibilityOverride) {
          throw new Error(
            "Record this formation's movement or confirm a shooting eligibility override",
          );
        }
        if (
          currentMovement?.movement === "advance" &&
          !event.weaponHasAssault &&
          !event.eligibilityOverride
        ) {
          throw new Error("An Advanced formation requires an Assault weapon or explicit override");
        }
        if (currentMovement?.movement === "fall_back" && !event.eligibilityOverride) {
          throw new Error(
            "A formation that Fell Back requires an explicit shooting eligibility override",
          );
        }
        if (currentMovement?.movement === "advance" && !event.eligibilityOverride) {
          weaponRestriction = "assault_only";
        }
      } else {
        if (formation.playerId !== clock.priorityPlayerId) {
          throw new Error("Only the player with Fight priority can activate a formation");
        }
        const charge = chargeByFormation.get(event.formationId);
        const charged = Boolean(charge?.successful && sameTurn(charge.clock, clock));
        const hasChargeBonus = charged && charge.receivesChargeBonus !== false;
        if (!charged && !event.eligibilityOverride) {
          throw new Error(
            "Confirm Engagement Range eligibility for a formation that did not charge",
          );
        }
        if (
          clock.step === "fights_first" &&
          !hasChargeBonus &&
          !event.fightsFirst &&
          !counterOffensiveActivation
        ) {
          throw new Error("Formation is not confirmed to have Fights First");
        }
      }
      activeActivation = {
        ...event,
        source: counterOffensiveActivation ? "counter_offensive" : "normal",
        weaponRestriction,
        attackCount: 0,
        hazardousTestCount: 0,
        hazardousGroupIds: [],
        hazardousTestsRecorded: false,
        pileIn: null,
        consolidation: null,
      };
      if (event.activationType === "fight" && counterOffensiveActivation) {
        forcedFightFormationId = "";
      }
      rangedDeclarationDraft = [];
      activeRangedDeclarationSet = null;
      readyRangedAttacks = [];
      continue;
    }
    if (event.type === "fight_move_recorded") {
      if (
        !activeActivation ||
        activeActivation.activationType !== "fight" ||
        activeActivation.id !== event.activationEventId ||
        activeActivation.formationId !== event.formationId
      ) {
        throw new Error("Fight movement does not belong to the active Fight activation");
      }
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Fight movement is outside its activation timing window");
      }
      const stage = FIGHT_MOVE_STAGES.indexOf(event.stage) + 1;
      const destination = FIGHT_MOVE_DESTINATIONS.indexOf(event.destination);
      const rapidIngressMovementRestricted = rapidIngresses.some(
        (arrival) =>
          arrival.formationId === event.formationId &&
          arrival.largeModelEdgeException &&
          sameTurn(arrival.clock, clock),
      );
      if (
        event.movementRuleRestricted !== rapidIngressMovementRestricted ||
        (rapidIngressMovementRestricted &&
          (event.destination !== "none" || event.maximumModelMoveThousandths !== 0))
      ) {
        throw new Error(
          "The large-model Rapid Ingress exception prevents Pile-in and Consolidation moves this turn",
        );
      }
      if (
        !fightMoveIsValid(
          stage,
          destination,
          event.maximumModelMoveThousandths,
          fightMoveFlags(event),
        )
      ) {
        throw new Error("Fight movement facts do not form a legal reviewed movement");
      }
      if (event.destination === "objective" && !objectives.has(event.objectiveId)) {
        throw new Error("Consolidation references an unknown objective marker");
      }
      if (event.stage === "pile_in") {
        if (activeActivation.pileIn || activeActivation.attackCount > 0) {
          throw new Error("Pile In must be recorded once before melee attacks");
        }
        activeActivation = { ...activeActivation, pileIn: event };
      } else {
        if (!activeActivation.pileIn) {
          throw new Error("Consolidation requires a recorded Pile In first");
        }
        if (activeActivation.consolidation) {
          throw new Error("Consolidation has already been recorded for this activation");
        }
        activeActivation = { ...activeActivation, consolidation: event };
      }
      fightMovementsByActivation.set(event.activationEventId, {
        formationId: event.formationId,
        pileIn: activeActivation.pileIn,
        consolidation: activeActivation.consolidation,
        attackCount: activeActivation.attackCount,
      });
      const requiresModelPosition =
        event.destination !== "none" &&
        event.sequence > legacyExtendedModelPositionsThroughSequence &&
        battleRuleCoverageRequiresTableGeometry(ruleCoverage) &&
        formations.get(event.formationId).weaponBearerTracking === "exact";
      if (requiresModelPosition) {
        if (!currentModelPositionsByFormation.has(event.formationId)) {
          throw new Error("Fight movement requires a prior per-model position snapshot");
        }
        const reconcilesStaleStart = geometryStaleFormationIds.has(event.formationId);
        pendingModelPosition = {
          formationId: event.formationId,
          context: event.stage,
          referenceEventId: event.id,
          fireOverwatchTrigger: "",
          reconcilesStaleStart,
          maximumDistanceThousandths: event.maximumModelMoveThousandths,
        };
        geometryStaleFormationIds.add(event.formationId);
      } else if (
        event.destination !== "none" &&
        currentModelPositionsByFormation.has(event.formationId)
      ) {
        geometryStaleFormationIds.add(event.formationId);
      }
      continue;
    }
    if (event.type === "hazardous_tests_recorded") {
      if (
        !activeActivation ||
        activeActivation.id !== event.activationEventId ||
        activeActivation.formationId !== event.formationId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Hazardous tests do not belong to the active formation activation");
      }
      if (activeActivation.hazardousTestsRecorded) {
        throw new Error("Hazardous tests have already been recorded for this activation");
      }
      if (
        activeActivation.hazardousTestCount < 1 ||
        event.tests.length !== activeActivation.hazardousTestCount
      ) {
        throw new Error("Hazardous test count must equal the Hazardous weapons used");
      }
      const deferredUntilChargeMove =
        activeActivation.source === "fire_overwatch" &&
        activeActivation.trigger === "charge_declared";
      if (
        event.deferredUntilChargeMove !== deferredUntilChargeMove ||
        event.triggerChargeEventId !==
          (deferredUntilChargeMove ? activeActivation.triggerEventId : "")
      ) {
        throw new Error("Hazardous Fire Overwatch deferral does not match its Charge trigger");
      }
      const failedTestIndices = event.tests
        .map((test, index) => (hazardousFinalRoll(test) === 1 ? index : -1))
        .filter((index) => index >= 0);
      hazardousTests.push({
        ...event,
        hazardousGroupIds: [...activeActivation.hazardousGroupIds],
        failedTestIndices,
      });
      activeActivation = {
        ...activeActivation,
        hazardousTestsRecorded: true,
        hazardousTestEventId: event.id,
      };
      if (failedTestIndices.length > 0) {
        pendingHazardous = {
          testEventId: event.id,
          activationEventId: event.activationEventId,
          formationId: event.formationId,
          hazardousGroupIds: [...activeActivation.hazardousGroupIds],
          failedTestIndices,
          resolvedTestIndices: [],
          deferredUntilChargeMove,
          triggerChargeEventId: event.triggerChargeEventId,
          due: !deferredUntilChargeMove,
          clock: { ...clock },
        };
      }
      continue;
    }
    if (event.type === "hazardous_damage_resolved") {
      if (
        !pendingHazardous ||
        !pendingHazardous.due ||
        event.testEventId !== pendingHazardous.testEventId ||
        event.formationId !== pendingHazardous.formationId ||
        event.testIndex !== pendingHazardous.failedTestIndices[0] ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Hazardous damage does not match the next pending failed test");
      }
      const formation = formations.get(event.formationId);
      const testEvent = hazardousTests.find((candidate) => candidate.id === event.testEventId);
      const test = testEvent?.tests[event.testIndex];
      if (!formation || !test || hazardousFinalRoll(test) !== 1) {
        throw new Error("Hazardous damage references an invalid failed test");
      }
      const options = hazardousSelectionOptions(formation);
      if (options.length === 0) {
        if (
          !event.noEligibleBearer ||
          event.selectedSegmentId ||
          event.allocation ||
          event.feelNoPainRolls.length > 0 ||
          event.summary.damage !== 0 ||
          event.summary.modelsDestroyed !== 0 ||
          !event.selectionReason
        ) {
          throw new Error("Hazardous failure with no surviving bearer must record no damage");
        }
      } else {
        const segment = options.find((candidate) => candidate.id === event.selectedSegmentId);
        if (
          !segment ||
          event.noEligibleBearer ||
          !event.allocation ||
          event.allocation.segmentId !== segment.id ||
          !event.selectionReason
        ) {
          throw new Error("Hazardous bearer selection violates the mandatory priority order");
        }
        const before = formation.health[segment.id];
        if (!sameHealth(before, event.allocation.before)) {
          throw new Error("Hazardous allocation does not match replayed bearer health");
        }
        const outcome = hazardousHealthAfter(segment, before, event.feelNoPainRolls);
        if (
          !hazardousResolutionIsValid(
            test.initialRoll,
            test.reroll,
            Boolean(test.rerollReason),
            outcome.remainingWounds,
            segment.feelNoPain,
            event.feelNoPainRolls.length,
            outcome.ignored,
            outcome.damage,
            outcome.destroyed,
            HAZARDOUS_FLAGS.mask,
          ) ||
          !sameHealth(event.allocation.after, outcome.after) ||
          event.summary.damage !== outcome.damage ||
          event.summary.modelsDestroyed !== (outcome.destroyed ? 1 : 0)
        ) {
          throw new Error("Hazardous mortal wounds do not match the rolls and selected bearer");
        }
        formation.health[segment.id] = { ...outcome.after };
      }
      refreshGeometryStaleness(event.formationId);
      hazardousDamageResolutions.push(event);
      const resolvedTestIndices = [...pendingHazardous.resolvedTestIndices, event.testIndex];
      const failedTestIndices = pendingHazardous.failedTestIndices.slice(1);
      pendingHazardous =
        failedTestIndices.length > 0
          ? { ...pendingHazardous, failedTestIndices, resolvedTestIndices }
          : null;
      continue;
    }
    if (event.type === "activation_completed") {
      if (!activeActivation) throw new Error("No formation activation is in progress");
      const completedActivation = activeActivation;
      if (!sameBattleClock(event.clock, clock)) {
        throw new Error("Formation activation completed outside its timing window");
      }
      if (
        event.formationId !== activeActivation.formationId ||
        event.activationType !== activeActivation.activationType
      ) {
        throw new Error("Completed activation does not match the active formation");
      }
      if (
        event.activationType === "fight" &&
        activeActivation.sequence > legacyFightMovementThroughSequence &&
        (!activeActivation.pileIn || !activeActivation.consolidation)
      ) {
        throw new Error(
          "A Fight activation must record Pile In and Consolidation before completion",
        );
      }
      if (activeActivation.hazardousTestCount > 0 && !activeActivation.hazardousTestsRecorded) {
        throw new Error("Resolve every required Hazardous test before finishing the activation");
      }
      if (pendingHazardous && !pendingHazardous.deferredUntilChargeMove) {
        throw new Error("Resolve Hazardous mortal wounds before finishing the activation");
      }
      if (rangedDeclarationDraft.length > 0 || readyRangedAttacks.length > 0) {
        throw new Error("Resolve or retract every ranged declaration before finishing activation");
      }
      if (event.activationType === "fight") {
        fightMovementsByActivation.set(activeActivation.id, {
          formationId: activeActivation.formationId,
          pileIn: activeActivation.pileIn,
          consolidation: activeActivation.consolidation,
          attackCount: activeActivation.attackCount,
        });
      }
      completedActivations.add(
        `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.formationId}`,
      );
      if (activeActivation.source === "fire_overwatch") {
        const target = formations.get(activeActivation.targetFormationId);
        if (formationDestroyed(target)) {
          movementStartsByFormation.delete(activeActivation.targetFormationId);
          chargeDeclarationsByFormation.delete(activeActivation.targetFormationId);
          if (pendingHazardous?.activationEventId === activeActivation.id) {
            pendingHazardous = { ...pendingHazardous, due: true };
          }
        }
      }
      activeActivation = null;
      activeRangedDeclarationSet = null;
      rangedDeclarationDraft = [];
      readyRangedAttacks = [];
      if (event.activationType === "fight") {
        clock = {
          ...clock,
          priorityPlayerId: otherPlayerId(state.players, clock.priorityPlayerId),
        };
        if (event.sequence > legacyCounterOffensiveThroughSequence) {
          const responderPlayerId = otherPlayerId(
            state.players,
            formations.get(event.formationId).playerId,
          );
          const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${responderPlayerId}:counter_offensive`;
          const commandPoints = resources.get(responderPlayerId).get("command_points").value;
          const candidateFormationIds = [...formations.values()]
            .filter(
              (formation) =>
                formation.playerId === responderPlayerId &&
                !formationDestroyed(formation) &&
                formationIsOnBattlefield(
                  formation.id,
                  deploymentByFormation,
                  deployedFormationIds,
                  embarkedByFormation,
                ) &&
                !battleShockedFormations.has(formation.id) &&
                !completedActivations.has(
                  `${clock.battleRound}:${clock.turn}:${clock.phase}:${formation.id}`,
                ),
            )
            .map((formation) => formation.id)
            .sort();
          if (
            commandPoints >= 2 &&
            candidateFormationIds.length > 0 &&
            !usedCounterOffensiveKeys.has(usageKey)
          ) {
            pendingCounterOffensive = {
              triggerActivationEventId: completedActivation.id,
              triggerFormationId: event.formationId,
              responderPlayerId,
              candidateFormationIds,
              clock: { ...clock },
            };
          }
        }
      }
      continue;
    }
    if (event.type === "go_to_ground_passed") {
      if (
        !pendingGoToGround ||
        event.triggerEventId !== pendingGoToGround.triggerEventId ||
        event.playerId !== pendingGoToGround.responderPlayerId ||
        (!pendingGoToGround.activationWide &&
          event.targetFormationId !== pendingGoToGround.targetFormationId) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Go to Ground pass does not match the pending reaction window");
      }
      goToGroundPasses.push({ ...event, ...pendingGoToGround });
      if (pendingGoToGround.activationWide) {
        activeRangedDeclarationSet = {
          ...activeRangedDeclarationSet,
          reactionResolved: false,
        };
      } else {
        readyRangedAttack = { ...pendingGoToGround, goToGroundEffectId: "" };
      }
      const activationWide = pendingGoToGround.activationWide;
      pendingGoToGround = null;
      if (activationWide) {
        openSmokescreenWindow();
        activeRangedDeclarationSet = {
          ...activeRangedDeclarationSet,
          reactionResolved: !pendingSmokescreen,
        };
      }
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type === "go_to_ground_resolved") {
      if (
        !pendingGoToGround ||
        event.triggerEventId !== pendingGoToGround.triggerEventId ||
        event.playerId !== pendingGoToGround.responderPlayerId ||
        (pendingGoToGround.activationWide
          ? !pendingGoToGround.candidateTargetFormationIds.includes(event.targetFormationId)
          : event.targetFormationId !== pendingGoToGround.targetFormationId) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Go to Ground does not match the pending reaction window");
      }
      const target = formations.get(event.targetFormationId);
      const targetIsInfantry = target.keywords.includes("infantry");
      const respondingPlayer = target.playerId === pendingGoToGround.responderPlayerId;
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.playerId}:go_to_ground`;
      const commandPoints = resources.get(event.playerId).get("command_points");
      if (
        event.commandPointsBefore !== commandPoints.value ||
        !goToGroundIsValid(
          clock.phase,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          usedGoToGroundKeys.has(usageKey),
          battleShockedFormations.has(target.id),
          goToGroundFlags(event, targetIsInfantry, respondingPlayer),
        )
      ) {
        throw new Error("Go to Ground facts or Command Point spending are inconsistent");
      }
      resources.get(event.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedGoToGroundKeys.add(usageKey);
      const effect = {
        id: event.id,
        name: "Go to Ground",
        targetFormationId: event.targetFormationId,
        ownerPlayerId: event.playerId,
        triggerEventId: event.triggerEventId,
        duration: "end_of_phase",
        appliedAt: { ...clock },
        invulnerableSave: 6,
        benefitOfCover: true,
      };
      goToGrounds.push(effect);
      if (pendingGoToGround.activationWide) {
        activeRangedDeclarationSet = {
          ...activeRangedDeclarationSet,
          reactionResolved: false,
          goToGroundEffectId: effect.id,
        };
      } else {
        readyRangedAttack = { ...pendingGoToGround, goToGroundEffectId: effect.id };
      }
      const activationWide = pendingGoToGround.activationWide;
      pendingGoToGround = null;
      if (activationWide) {
        openSmokescreenWindow();
        activeRangedDeclarationSet = {
          ...activeRangedDeclarationSet,
          reactionResolved: !pendingSmokescreen,
        };
      }
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type === "smokescreen_passed") {
      if (
        !pendingSmokescreen ||
        event.triggerEventId !== pendingSmokescreen.triggerEventId ||
        event.playerId !== pendingSmokescreen.responderPlayerId ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Smokescreen pass does not match the pending reaction window");
      }
      smokescreenPasses.push({ ...event, ...pendingSmokescreen });
      pendingSmokescreen = null;
      openGoToGroundWindow();
      activeRangedDeclarationSet = {
        ...activeRangedDeclarationSet,
        reactionResolved: !pendingGoToGround,
      };
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type === "smokescreen_resolved") {
      if (
        !pendingSmokescreen ||
        event.triggerEventId !== pendingSmokescreen.triggerEventId ||
        event.playerId !== pendingSmokescreen.responderPlayerId ||
        !pendingSmokescreen.candidateTargetFormationIds.includes(event.targetFormationId) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Smokescreen does not match the pending reaction window");
      }
      const target = formations.get(event.targetFormationId);
      const targetIsSmoke = target.keywords.includes("smoke");
      const respondingPlayer = target.playerId === pendingSmokescreen.responderPlayerId;
      const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${event.playerId}:smokescreen`;
      const commandPoints = resources.get(event.playerId).get("command_points");
      if (
        event.commandPointsBefore !== commandPoints.value ||
        !smokescreenIsValid(
          clock.phase,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          usedSmokescreenKeys.has(usageKey),
          battleShockedFormations.has(target.id),
          smokescreenFlags(event, targetIsSmoke, respondingPlayer),
        )
      ) {
        throw new Error("Smokescreen facts or Command Point spending are inconsistent");
      }
      resources.get(event.playerId).set("command_points", {
        ...commandPoints,
        value: event.commandPointsAfter,
      });
      usedSmokescreenKeys.add(usageKey);
      const effect = {
        id: event.id,
        name: "Smokescreen",
        targetFormationId: event.targetFormationId,
        ownerPlayerId: event.playerId,
        triggerEventId: event.triggerEventId,
        duration: "end_of_phase",
        appliedAt: { ...clock },
        benefitOfCover: true,
        stealth: true,
      };
      smokescreens.push(effect);
      pendingSmokescreen = null;
      openGoToGroundWindow();
      activeRangedDeclarationSet = {
        ...activeRangedDeclarationSet,
        reactionResolved: !pendingGoToGround,
        smokescreenEffectId: effect.id,
      };
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type === "ranged_target_declaration_retracted") {
      if (
        !activeActivation ||
        activeActivation.activationType !== "shooting" ||
        activeActivation.source === "fire_overwatch" ||
        activeActivation.id !== event.activationEventId ||
        activeActivation.attackCount !== 0 ||
        activeRangedDeclarationSet ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Ranged declaration retraction is outside its open activation window");
      }
      const declaration = rangedDeclarationDraft.find(
        (candidate) => candidate.id === event.declarationEventId,
      );
      if (!declaration) throw new Error("Ranged declaration retraction is not active");
      rangedDeclarationDraft = rangedDeclarationDraft.filter(
        (candidate) => candidate.id !== event.declarationEventId,
      );
      rangedDeclarationRetractions.push({ ...event, declaration });
      continue;
    }
    if (event.type === "ranged_targets_declared") {
      if (
        !activeActivation ||
        activeActivation.activationType !== "shooting" ||
        activeActivation.source === "fire_overwatch" ||
        activeActivation.id !== event.activationEventId ||
        activeActivation.attackCount !== 0 ||
        activeRangedDeclarationSet ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Ranged targets must close once before attacks in their activation");
      }
      const ordered = canonicalRangedDeclarationOrder(rangedDeclarationDraft);
      if (
        event.declarationEventIds.length !== ordered.length ||
        event.declarationEventIds.some((id, index) => id !== ordered[index]?.id)
      ) {
        throw new Error("Ranged declaration order must group each target and weapon profile");
      }
      const stats = rangedDeclarationStats(ordered);
      const sameActivation = ordered.every(
        (declaration) => declaration.activationEventId === activeActivation.id,
      );
      const beforeAttacks = activeActivation.attackCount === 0;
      const allEligible = ordered.every((declaration) =>
        rangedTargetEligibilityIsValid(declaration, declaration.declaredWeaponCount),
      );
      const totals = new Map();
      for (const declaration of ordered) {
        const key = declarationWeaponKey(declaration);
        totals.set(key, (totals.get(key) ?? 0) + declaration.declaredWeaponCount);
      }
      const weaponCountsValid = [...totals].every(([key, count]) => {
        const declaration = ordered.find((candidate) => declarationWeaponKey(candidate) === key);
        const source = formations.get(declaration.weaponSourceFormationId);
        return (
          source &&
          count <=
            formationSurvivingWeaponCount(
              source,
              declaration.sourceSavedUnitId,
              declaration.weaponGroupId,
            )
        );
      });
      const flags = declarationFlags({
        sameActivation,
        beforeAttacks,
        allEligible,
        weaponCountsValid,
      });
      if (
        event.declarationCount !== stats.declarationCount ||
        event.uniqueDeclarationCount !== stats.uniqueDeclarationCount ||
        event.targetRunCount !== stats.targetRunCount ||
        event.uniqueTargetCount !== stats.uniqueTargetCount ||
        event.profileRunCount !== stats.profileRunCount ||
        event.uniqueTargetProfileCount !== stats.uniqueTargetProfileCount ||
        event.flags !== flags ||
        !rangedDeclarationIsValid(
          stats.declarationCount,
          stats.uniqueDeclarationCount,
          stats.targetRunCount,
          stats.uniqueTargetCount,
          stats.profileRunCount,
          stats.uniqueTargetProfileCount,
          flags,
        )
      ) {
        throw new Error("Ranged declaration set is structurally inconsistent");
      }
      const hazardousDeclarations = ordered.filter((declaration) => {
        const source = formations.get(declaration.weaponSourceFormationId);
        return Boolean(
          source &&
            formationWeaponProfile(
              source,
              declaration.sourceSavedUnitId,
              declaration.weaponGroupId,
              declaration.weaponId,
            )?.profile.hasHazardous,
        );
      });
      activeActivation = {
        ...activeActivation,
        rangedDeclarationsClosed: true,
        rangedDeclarationEventId: event.id,
        rangedDeclarationCount: ordered.length,
        hazardousTestCount: hazardousDeclarations.reduce(
          (total, declaration) => total + declaration.declaredWeaponCount,
          0,
        ),
        hazardousGroupIds: [
          ...new Set(hazardousDeclarations.map((entry) => entry.weaponGroupId)),
        ].sort(),
      };
      activeRangedDeclarationSet = {
        ...event,
        declarations: ordered,
        reactionResolved: false,
        goToGroundWindowHandled: false,
        smokescreenWindowHandled: false,
      };
      rangedDeclarationSets.push(activeRangedDeclarationSet);
      rangedDeclarationDraft = [];
      const goToGroundCandidates = goToGroundCandidateTargetFormationIds();
      const smokescreenCandidates = smokescreenCandidateTargetFormationIds();
      if (
        goToGroundCandidates.length > 0 &&
        smokescreenCandidates.length > 0 &&
        !["go_to_ground_first", "smokescreen_first"].includes(event.reactionOrder)
      ) {
        throw new Error(
          "The active player must choose whether Go to Ground or Smokescreen resolves first",
        );
      }
      if (event.reactionOrder === "smokescreen_first") {
        openSmokescreenWindow();
        if (!pendingSmokescreen) openGoToGroundWindow();
      } else {
        openGoToGroundWindow();
        if (!pendingGoToGround) openSmokescreenWindow();
      }
      activeRangedDeclarationSet = {
        ...activeRangedDeclarationSet,
        reactionResolved: !pendingGoToGround && !pendingSmokescreen,
      };
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type === "ranged_target_eligibility_recorded") {
      const resolvingFireOverwatch = activeActivation?.source === "fire_overwatch";
      if (
        (!resolvingFireOverwatch && (!battleAttackWindow(clock) || clock.phase !== "shooting")) ||
        !sameBattleClock(event.clock, clock)
      ) {
        throw new Error("Ranged target eligibility must be recorded in a Shooting attack step");
      }
      if (!activeActivation || activeActivation.formationId !== event.attackerFormationId) {
        throw new Error("Target eligibility does not belong to the active formation");
      }
      const attacker = formations.get(event.attackerFormationId);
      const target = formations.get(event.targetFormationId);
      if (attacker.playerId === target.playerId) {
        throw new Error("A ranged target must be an enemy formation");
      }
      if (
        !formationIsOnBattlefield(
          event.attackerFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ) ||
        !formationIsOnBattlefield(
          event.targetFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Ranged target eligibility requires both formations on the battlefield");
      }
      if (formationDestroyed(attacker) || formationDestroyed(target)) {
        throw new Error("Ranged target eligibility cannot reference a destroyed formation");
      }
      if (
        resolvingFireOverwatch &&
        (event.targetFormationId !== activeActivation.targetFormationId ||
          !event.visible ||
          event.indirectFire ||
          event.measuredDistanceThousandths > 24000)
      ) {
        throw new Error("Fire Overwatch requires its visible triggering target within 24 inches");
      }
      if (event.sequence > legacyWeaponInventoryThroughSequence) {
        const source = formations.get(event.weaponSourceFormationId);
        if (!source) throw new Error("Target eligibility weapon source is not registered");
        if (resolvingFireOverwatch && source.id !== attacker.id) {
          throw new Error("Firing Deck cannot be used for out-of-phase Fire Overwatch shooting");
        }
        if (source.id !== attacker.id && embarkedByFormation.get(source.id) !== attacker.id) {
          throw new Error("Target eligibility weapon source is not the attacker or its passenger");
        }
        const inventory = formationWeaponProfile(
          source,
          event.sourceSavedUnitId,
          event.weaponGroupId,
          event.weaponId,
        );
        if (!inventory || inventory.profile.type !== "Ranged") {
          throw new Error("Target eligibility weapon is absent from the locked ranged inventory");
        }
        if (
          inventory.profile.name !== event.weaponName ||
          inventory.profile.publishedRangeThousandths !== event.publishedRangeThousandths ||
          inventory.profile.hasIndirect !== event.weaponHasIndirect
        ) {
          throw new Error("Target eligibility weapon facts differ from the locked inventory");
        }
        if (
          formationSurvivingWeaponCount(source, event.sourceSavedUnitId, event.weaponGroupId) < 1 ||
          event.eligibleWeaponCount >
            formationSurvivingWeaponCount(source, event.sourceSavedUnitId, event.weaponGroupId)
        ) {
          throw new Error("Target eligibility exceeds the surviving locked weapon inventory");
        }
      }
      if (event.sequence > legacyRangedGeometryThroughSequence) {
        const source = formations.get(event.weaponSourceFormationId);
        const inventory = source
          ? formationWeaponProfile(
              source,
              event.sourceSavedUnitId,
              event.weaponGroupId,
              event.weaponId,
            )
          : null;
        const visibilityFacts = deriveVisibilityFacts({
          formations,
          positions: currentModelPositionsByFormation,
          staleFormationIds: geometryStaleFormationIds,
          terrainFootprints,
          terrainVisibility,
        })
          .get(event.attackerFormationId)
          ?.get(event.targetFormationId);
        if (
          !event.geometryDecision ||
          !source ||
          !inventory ||
          !rangedGeometryDecisionMatchesState(
            event.geometryDecision,
            event,
            attacker,
            target,
            source,
            inventory.group,
            visibilityFacts,
          )
        ) {
          throw new Error("Ranged geometry decision does not match replayed battlefield facts");
        }
        if (event.attackSnapshot) {
          const snapshotModelIds = event.attackSnapshot.targetModelIds;
          const coverByModelId = new Map(
            event.geometryDecision.cover.map((entry) => [entry.modelId, entry.benefitOfCover]),
          );
          if (
            !Array.isArray(snapshotModelIds) ||
            snapshotModelIds.length !== event.attackSnapshot.targets.length ||
            snapshotModelIds.some(
              (modelId, index) =>
                event.attackSnapshot.targets[index].benefitOfCover !==
                Boolean(coverByModelId.get(modelId)),
            )
          ) {
            throw new Error("Ranged attack cover sequence does not match its geometry decision");
          }
        }
      }
      if (
        event.sequence > legacyGoToGroundThroughSequence &&
        event.sequence <= legacyRangedDeclarationsThroughSequence &&
        (pendingGoToGround || readyRangedAttack)
      ) {
        throw new Error("Resolve the previously declared ranged attack before selecting a target");
      }
      targetEligibilityFacts.set(event.id, event);
      if (event.sequence > legacyRangedDeclarationsThroughSequence && !resolvingFireOverwatch) {
        if (
          event.activationEventId !== activeActivation.id ||
          activeActivation.attackCount !== 0 ||
          activeRangedDeclarationSet ||
          event.declaredWeaponCount < 1 ||
          !event.attackSnapshot ||
          !rangedTargetEligibilityIsValid(event, event.declaredWeaponCount)
        ) {
          throw new Error("Ranged attack must be declared exactly before any attack is resolved");
        }
        const duplicateKey = [
          event.targetFormationId,
          event.weaponSourceFormationId,
          event.sourceSavedUnitId,
          event.weaponGroupId,
          event.weaponId,
        ].join(":");
        if (
          rangedDeclarationDraft.some(
            (declaration) =>
              [
                declaration.targetFormationId,
                declaration.weaponSourceFormationId,
                declaration.sourceSavedUnitId,
                declaration.weaponGroupId,
                declaration.weaponId,
              ].join(":") === duplicateKey,
          )
        ) {
          throw new Error("Combine matching weapon copies into one target declaration");
        }
        const profileWeaponCount = event.attackSnapshot.attackProfiles.reduce(
          (total, profile) =>
            total + (Number.isSafeInteger(profile.weaponCount) ? profile.weaponCount : 0),
          0,
        );
        if (profileWeaponCount !== event.declaredWeaponCount) {
          throw new Error("Ranged attack snapshot weapon count differs from its declaration");
        }
        const snapshotHealthValid = event.attackSnapshot.targetModelIds
          ? target.segments.every((segment) => {
              const indices = event.attackSnapshot.segmentIds.flatMap((segmentId, index) =>
                segmentId === segment.id ? [index] : [],
              );
              const health = target.health[segment.id];
              const liveModelIds = new Set(segment.modelIds.slice(0, health.modelsRemaining));
              return (
                indices.reduce(
                  (total, index) => total + event.attackSnapshot.targets[index].modelCount,
                  0,
                ) === health.modelsRemaining &&
                indices.every(
                  (index) =>
                    event.attackSnapshot.targets[index].modelCount === 1 &&
                    liveModelIds.has(event.attackSnapshot.targetModelIds[index]),
                )
              );
            })
          : event.attackSnapshot.segmentIds.every((segmentId, index) => {
              const health = target.health[segmentId];
              return (
                health && health.modelsRemaining === event.attackSnapshot.targets[index].modelCount
              );
            });
        if (
          !snapshotHealthValid ||
          target.health[event.attackSnapshot.segmentIds[0]]?.woundsLost !==
            event.attackSnapshot.initialWoundsLost
        ) {
          throw new Error("Ranged attack snapshot does not match declared target health");
        }
        const source = formations.get(event.weaponSourceFormationId);
        const alreadyDeclared = rangedDeclarationDraft
          .filter(
            (declaration) => declarationWeaponKey(declaration) === declarationWeaponKey(event),
          )
          .reduce((total, declaration) => total + declaration.declaredWeaponCount, 0);
        if (
          !source ||
          alreadyDeclared + event.declaredWeaponCount >
            formationSurvivingWeaponCount(source, event.sourceSavedUnitId, event.weaponGroupId)
        ) {
          throw new Error("Ranged declarations exceed surviving weapon copies");
        }
        rangedDeclarationDraft.push(event);
        continue;
      }
      if (
        event.sequence > legacyGoToGroundThroughSequence &&
        (event.sequence <= legacyRangedDeclarationsThroughSequence || resolvingFireOverwatch)
      ) {
        const usageKey = `${clock.battleRound}:${clock.turn}:${clock.phase}:${target.playerId}:go_to_ground`;
        const commandPoints = resources.get(target.playerId).get("command_points")?.value ?? 0;
        const activeEffect = goToGrounds.find(
          (effect) => effect.targetFormationId === target.id && samePhase(effect.appliedAt, clock),
        );
        const declaration = {
          triggerEventId: event.id,
          activationEventId: activeActivation.id,
          attackerFormationId: event.attackerFormationId,
          targetFormationId: event.targetFormationId,
          weaponId: event.weaponId,
          weaponSourceFormationId: event.weaponSourceFormationId,
          sourceSavedUnitId: event.sourceSavedUnitId,
          weaponGroupId: event.weaponGroupId,
          responderPlayerId: target.playerId,
          clock: { ...clock },
        };
        if (
          !resolvingFireOverwatch &&
          clock.phase === "shooting" &&
          activeActivation.attackCount === 0 &&
          rangedTargetEligibilityIsValid(event, event.eligibleWeaponCount) &&
          attacker.playerId === clock.activePlayerId &&
          target.playerId !== clock.activePlayerId &&
          target.keywords.includes("infantry") &&
          !battleShockedFormations.has(target.id) &&
          commandPoints >= 1 &&
          !usedGoToGroundKeys.has(usageKey) &&
          !activeEffect
        ) {
          pendingGoToGround = declaration;
        } else {
          readyRangedAttack = {
            ...declaration,
            goToGroundEffectId: activeEffect?.id ?? "",
          };
        }
      }
      continue;
    }
    if (event.type === "attack_resolved") {
      let resolvedRangedDeclarationId = "";
      const resolvingFireOverwatch = activeActivation?.source === "fire_overwatch";
      if (
        state.version >= TIMELINE_BATTLE_STATE_VERSION &&
        event.sequence > legacyUntimedThroughSequence
      ) {
        if (!battleAttackWindow(clock) && !resolvingFireOverwatch) {
          throw new Error("Attacks can only resolve in a Shooting or Fight attack step");
        }
        if (pendingChoices.size > 0) {
          throw new Error("Pending choices must be resolved before resolving attacks");
        }
        if (event.sequence <= legacyUnactionedThroughSequence) {
          if (formations.get(event.attackerFormationId)?.playerId !== clock.activePlayerId) {
            throw new Error("Only the active player's formation can resolve an attack");
          }
        } else {
          if (!activeActivation || activeActivation.formationId !== event.attackerFormationId) {
            throw new Error("Attack does not belong to the active formation");
          }
          if (
            state.version >= FIRE_OVERWATCH_BATTLE_STATE_VERSION &&
            event.activationEventId !== activeActivation.id
          ) {
            throw new Error("Attack does not reference its active formation activation");
          }
          if (
            resolvingFireOverwatch &&
            event.targetFormationId !== activeActivation.targetFormationId
          ) {
            throw new Error("Fire Overwatch can attack only the triggering enemy formation");
          }
          if (
            clock.phase === "shooting" &&
            activeActivation.weaponRestriction === "assault_only" &&
            !event.weaponHasAssault
          ) {
            throw new Error("Only Assault weapons can fire after this formation Advanced");
          }
          const expectedWeaponType =
            activeActivation.activationType === "shooting" ? "Ranged" : "Melee";
          if (event.weaponType !== expectedWeaponType) {
            throw new Error(`${expectedWeaponType} weapons are required in this attack step`);
          }
          if (
            event.weaponType === "Melee" &&
            activeActivation.sequence > legacyFightMovementThroughSequence
          ) {
            if (!activeActivation.pileIn) {
              throw new Error("Record Pile In before resolving melee attacks");
            }
            if (activeActivation.pileIn.destination === "none") {
              throw new Error("A unit with no legal Pile-in endpoint has no eligible melee target");
            }
            if (activeActivation.consolidation) {
              throw new Error("Melee attacks cannot resolve after Consolidation");
            }
          }
          if (
            event.weaponType === "Ranged" &&
            event.sequence > legacyTargetEligibilityThroughSequence
          ) {
            const eligibility = targetEligibilityFacts.get(event.targetEligibilityEventId);
            if (!eligibility) {
              throw new Error("Ranged attack requires a replayed target eligibility measurement");
            }
            if (
              eligibility.attackerFormationId !== event.attackerFormationId ||
              eligibility.targetFormationId !== event.targetFormationId ||
              eligibility.weaponId !== event.weaponId ||
              !sameBattleClock(eligibility.clock, clock)
            ) {
              throw new Error("Ranged attack does not match its target eligibility measurement");
            }
            if (event.sequence > legacyWeaponInventoryThroughSequence) {
              if (!sameBattleClock(event.clock, clock)) {
                throw new Error("Ranged attack weapon declaration is outside its recorded phase");
              }
              if (
                eligibility.weaponSourceFormationId !== event.weaponSourceFormationId ||
                eligibility.sourceSavedUnitId !== event.sourceSavedUnitId ||
                eligibility.weaponGroupId !== event.weaponGroupId
              ) {
                throw new Error("Ranged attack does not match its locked weapon source");
              }
              const source = formations.get(event.weaponSourceFormationId);
              const inventory = source
                ? formationWeaponProfile(
                    source,
                    event.sourceSavedUnitId,
                    event.weaponGroupId,
                    event.weaponId,
                  )
                : null;
              if (!source || !inventory || inventory.profile.type !== "Ranged") {
                throw new Error("Ranged attack weapon is absent from the locked inventory");
              }
              const usedCount = activeAttackIds
                .map((id) => attacks.get(id))
                .filter(
                  (attack) =>
                    attack?.weaponType === "Ranged" &&
                    attack.weaponSourceFormationId === event.weaponSourceFormationId &&
                    attack.sourceSavedUnitId === event.sourceSavedUnitId &&
                    attack.weaponGroupId === event.weaponGroupId &&
                    (state.version >= FIRE_OVERWATCH_BATTLE_STATE_VERSION
                      ? attack.activationEventId === activeActivation.id
                      : sameBattleClock(attack.clock ?? eligibility.clock, clock)),
                )
                .reduce((total, attack) => total + attack.declaredWeaponCount, 0);
              const declaredFlags = (event.weaponHasAssault ? 1 : 0) | (event.indirectFire ? 2 : 0);
              const activationWideDeclaration =
                event.sequence > legacyRangedDeclarationsThroughSequence && !resolvingFireOverwatch;
              if (
                !activationWideDeclaration &&
                (!(source.weaponBearerTracking === "exact"
                  ? weaponBearerDeclarationIsValid(
                      inventory.group.count,
                      formationSurvivingWeaponCount(
                        source,
                        event.sourceSavedUnitId,
                        event.weaponGroupId,
                      ),
                      usedCount,
                      event.declaredWeaponCount,
                      weaponProfileFlags(inventory.profile),
                      declaredFlags,
                    )
                  : weaponInventoryDeclarationIsValid(
                      inventory.group.count,
                      formationSourceModelsRemaining(source, event.sourceSavedUnitId),
                      usedCount,
                      event.declaredWeaponCount,
                      weaponProfileFlags(inventory.profile),
                      declaredFlags,
                    )) ||
                  eligibility.eligibleWeaponCount >
                    formationSurvivingWeaponCount(
                      source,
                      event.sourceSavedUnitId,
                      event.weaponGroupId,
                    ) -
                      usedCount)
              ) {
                throw new Error("Ranged attack exceeds its surviving unused weapon inventory");
              }
            }
            if (eligibility.indirectFire !== event.indirectFire) {
              throw new Error("Ranged attack Indirect Fire state does not match its measurement");
            }
            if (!rangedTargetEligibilityIsValid(eligibility, event.declaredWeaponCount)) {
              throw new Error(
                "Ranged attack does not satisfy its reviewed target eligibility facts",
              );
            }
            if (
              event.sequence > legacyRangedDeclarationsThroughSequence &&
              !resolvingFireOverwatch
            ) {
              const ready = readyRangedAttacks[0];
              if (
                !ready ||
                ready.id !== event.targetEligibilityEventId ||
                ready.activationEventId !== event.activationEventId ||
                ready.attackerFormationId !== event.attackerFormationId ||
                ready.targetFormationId !== event.targetFormationId ||
                ready.weaponId !== event.weaponId ||
                ready.weaponSourceFormationId !== event.weaponSourceFormationId ||
                ready.sourceSavedUnitId !== event.sourceSavedUnitId ||
                ready.weaponGroupId !== event.weaponGroupId ||
                ready.declaredWeaponCount !== event.declaredWeaponCount
              ) {
                throw new Error("Ranged attack is not the next activation-wide declared attack");
              }
              resolvedRangedDeclarationId = ready.id;
            } else if (event.sequence > legacyGoToGroundThroughSequence) {
              if (
                !readyRangedAttack ||
                readyRangedAttack.triggerEventId !== event.targetEligibilityEventId ||
                readyRangedAttack.activationEventId !== event.activationEventId ||
                readyRangedAttack.attackerFormationId !== event.attackerFormationId ||
                readyRangedAttack.targetFormationId !== event.targetFormationId ||
                readyRangedAttack.weaponId !== event.weaponId ||
                readyRangedAttack.weaponSourceFormationId !== event.weaponSourceFormationId ||
                readyRangedAttack.sourceSavedUnitId !== event.sourceSavedUnitId ||
                readyRangedAttack.weaponGroupId !== event.weaponGroupId
              ) {
                throw new Error(
                  "Ranged attack is not bound to its resolved target reaction window",
                );
              }
              readyRangedAttack = null;
            }
          } else if (!event.targetEligibilityConfirmed) {
            throw new Error(
              "Attack target eligibility requires explicit range, visibility, and table-state confirmation",
            );
          }
        }
      }
      let hazardousWeaponUsed = false;
      if (
        event.sequence > legacyHazardousThroughSequence &&
        activeActivation &&
        event.weaponSourceFormationId &&
        event.sourceSavedUnitId &&
        event.weaponGroupId &&
        event.weaponId
      ) {
        const source = formations.get(event.weaponSourceFormationId);
        const locked = source
          ? formationWeaponProfile(
              source,
              event.sourceSavedUnitId,
              event.weaponGroupId,
              event.weaponId,
            )
          : null;
        if (!locked) {
          throw new Error("Attack weapon is absent from the locked Hazardous inventory");
        }
        hazardousWeaponUsed = locked.profile.hasHazardous;
      }
      const formation = formations.get(event.targetFormationId);
      if (!formation) throw new Error("Attack target formation is not registered");
      const wasDestroyed = formationDestroyed(formation);
      if (
        event.sequence > legacyUnactionedThroughSequence &&
        !formationIsOnBattlefield(
          event.targetFormationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        )
      ) {
        throw new Error("Attack target is not on the battlefield");
      }
      let appliedDamage = 0;
      let modelsDestroyed = 0;
      for (const allocation of event.allocations) {
        if (!sameHealth(formation.health[allocation.segmentId], allocation.before)) {
          throw new Error("Attack allocation does not match replayed target health");
        }
        const segment = formation.segments.find(
          (candidate) => candidate.id === allocation.segmentId,
        );
        const damage =
          (allocation.before.modelsRemaining - allocation.after.modelsRemaining) * segment.wounds +
          allocation.after.woundsLost -
          allocation.before.woundsLost;
        if (
          damage < 0 ||
          allocation.after.modelsRemaining > allocation.before.modelsRemaining ||
          (allocation.after.modelsRemaining === allocation.before.modelsRemaining &&
            allocation.after.woundsLost < allocation.before.woundsLost)
        ) {
          throw new Error("Attack allocation cannot restore models or wounds");
        }
        appliedDamage += damage;
        modelsDestroyed += allocation.before.modelsRemaining - allocation.after.modelsRemaining;
        formation.health[allocation.segmentId] = { ...allocation.after };
      }
      if (appliedDamage !== event.summary.damage) {
        throw new Error("Attack summary damage does not match its allocations");
      }
      if (modelsDestroyed !== event.summary.modelsDestroyed) {
        throw new Error("Attack summary casualties do not match its allocations");
      }
      if (Object.values(formation.health).filter((health) => health.woundsLost > 0).length > 1) {
        throw new Error("A formation cannot contain more than one wounded model");
      }
      refreshGeometryStaleness(event.targetFormationId);
      attacks.set(event.id, event);
      activeAttackIds.push(event.id);
      targetedFormationIds.add(event.targetFormationId);
      if (resolvedRangedDeclarationId) {
        resolvedRangedDeclarationIds.add(resolvedRangedDeclarationId);
      }
      if (activeActivation) {
        const activationWideRangedAttack = Boolean(resolvedRangedDeclarationId);
        activeActivation = {
          ...activeActivation,
          attackCount: activeActivation.attackCount + 1,
          hazardousTestCount:
            activeActivation.hazardousTestCount +
            (!activationWideRangedAttack && hazardousWeaponUsed ? event.declaredWeaponCount : 0),
          hazardousGroupIds:
            !activationWideRangedAttack && hazardousWeaponUsed
              ? [...new Set([...activeActivation.hazardousGroupIds, event.weaponGroupId])].sort()
              : activeActivation.hazardousGroupIds,
        };
        if (activeActivation.activationType === "fight") {
          const movement = fightMovementsByActivation.get(activeActivation.id);
          if (movement) {
            fightMovementsByActivation.set(activeActivation.id, {
              ...movement,
              attackCount: activeActivation.attackCount,
            });
          }
        }
      }
      if (!wasDestroyed && formationDestroyed(formation)) {
        const passengerFormationIds = [...embarkedByFormation]
          .filter(([, transportId]) => transportId === event.targetFormationId)
          .map(([formationId]) => formationId)
          .sort();
        if (passengerFormationIds.length > 0) {
          pendingTransportDestructions.set(event.targetFormationId, {
            transportFormationId: event.targetFormationId,
            causeEventId: event.id,
            passengerFormationIds,
            clock,
          });
        }
      }
      refreshReadyRangedAttacks();
      continue;
    }
    if (event.type !== "attack_reverted") {
      throw new Error(`Unsupported replayed battle event type: ${event.type}`);
    }
    const reverted = attacks.get(event.revertsEventId);
    if (!reverted || activeAttackIds.at(-1) !== reverted.id) {
      throw new Error("Only the latest unreverted attack can be reverted");
    }
    if (
      [...transportDestructionResolutions.values()].some(
        (resolution) => resolution.causeEventId === reverted.id,
      )
    ) {
      throw new Error(
        "An attack cannot be reverted after resolving destroyed Transport passengers",
      );
    }
    const formation = formations.get(reverted.targetFormationId);
    for (const allocation of reverted.allocations) {
      if (!sameHealth(formation.health[allocation.segmentId], allocation.after)) {
        throw new Error("Reverted attack does not match replayed target health");
      }
      formation.health[allocation.segmentId] = { ...allocation.before };
    }
    refreshGeometryStaleness(reverted.targetFormationId);
    activeAttackIds.pop();
    const revertedActivationWideDeclaration = activeRangedDeclarationSet?.declarations.some(
      (declaration) => declaration.id === reverted.targetEligibilityEventId,
    );
    if (revertedActivationWideDeclaration) {
      resolvedRangedDeclarationIds.delete(reverted.targetEligibilityEventId);
    }
    if (
      activeActivation &&
      (state.version < FIRE_OVERWATCH_BATTLE_STATE_VERSION
        ? activeActivation.activationType === "fight" && reverted.weaponType === "Melee"
        : reverted.activationEventId === activeActivation.id)
    ) {
      const revertedSource = formations.get(reverted.weaponSourceFormationId);
      const revertedInventory = revertedSource
        ? formationWeaponProfile(
            revertedSource,
            reverted.sourceSavedUnitId,
            reverted.weaponGroupId,
            reverted.weaponId,
          )
        : null;
      const revertedHazardousCount =
        !revertedActivationWideDeclaration && revertedInventory?.profile.hasHazardous
          ? reverted.declaredWeaponCount
          : 0;
      const hazardousGroupStillUsed =
        revertedActivationWideDeclaration ||
        activeAttackIds.some((id) => {
          const attack = attacks.get(id);
          if (
            !attack ||
            attack.activationEventId !== activeActivation.id ||
            attack.weaponGroupId !== reverted.weaponGroupId
          ) {
            return false;
          }
          const source = formations.get(attack.weaponSourceFormationId);
          return Boolean(
            source &&
              formationWeaponProfile(
                source,
                attack.sourceSavedUnitId,
                attack.weaponGroupId,
                attack.weaponId,
              )?.profile.hasHazardous,
          );
        });
      activeActivation = {
        ...activeActivation,
        attackCount: Math.max(0, activeActivation.attackCount - 1),
        hazardousTestCount: Math.max(
          0,
          activeActivation.hazardousTestCount - revertedHazardousCount,
        ),
        hazardousGroupIds: hazardousGroupStillUsed
          ? activeActivation.hazardousGroupIds
          : activeActivation.hazardousGroupIds.filter(
              (groupId) => groupId !== reverted.weaponGroupId,
            ),
      };
      if (activeActivation.activationType === "fight") {
        const movement = fightMovementsByActivation.get(activeActivation.id);
        if (movement) {
          fightMovementsByActivation.set(activeActivation.id, {
            ...movement,
            attackCount: activeActivation.attackCount,
          });
        }
      }
    }
    refreshReadyRangedAttacks();
  }
  const offBattlefieldFormationIds = new Set(
    [...formations.keys()].filter(
      (formationId) =>
        !formationIsOnBattlefield(
          formationId,
          deploymentByFormation,
          deployedFormationIds,
          embarkedByFormation,
        ),
    ),
  );
  const reserveDestroyedFormationIds = new Set(
    clock.status === "complete"
      ? [...formations.keys()].filter((formationId) => {
          const chain = transportDeploymentChain(formationId, deploymentByFormation);
          return Boolean(
            chain.complete &&
              ["reserves", "strategic_reserves"].includes(chain.rootDeployment?.location) &&
              !deployedFormationIds.has(chain.rootFormationId),
          );
        })
      : [],
  );
  const largeModelRapidIngressRestrictedFormationIds = new Set(
    rapidIngresses
      .filter((arrival) => arrival.largeModelEdgeException && sameTurn(arrival.clock, clock))
      .map((arrival) => arrival.formationId),
  );
  const spatialFactsByFormation = deriveSpatialFacts({
    formations,
    positions: currentModelPositionsByFormation,
    staleFormationIds: geometryStaleFormationIds,
    objectives: tableGeometry?.objectivePositions ?? [],
  });
  const objectiveControlEligibleFormationIds = new Set(
    [...formations.keys()].filter(
      (formationId) =>
        !offBattlefieldFormationIds.has(formationId) &&
        !formationDestroyed(formations.get(formationId)),
    ),
  );
  const objectiveControlFacts = deriveObjectiveControlFacts({
    players: state.players,
    objectives: tableGeometry?.objectivePositions ?? [],
    formations,
    eligibleFormationIds: objectiveControlEligibleFormationIds,
    spatialFactsByFormation,
    battleShockedFormationIds: new Set(battleShockedFormations.keys()),
  });
  const visibilityFactsByFormation = deriveVisibilityFacts({
    formations,
    positions: currentModelPositionsByFormation,
    staleFormationIds: geometryStaleFormationIds,
    terrainFootprints,
    terrainVisibility,
  });
  return {
    formations,
    activeAttackIds,
    clock,
    ruleCoverage,
    tableGeometry,
    terrainFootprints,
    terrainVisibility,
    pendingChoices,
    resolvedChoices,
    effects,
    mission,
    resources,
    objectives,
    scoringEvents,
    battleShockedFormations,
    movementByFormation,
    chargeByFormation,
    deploymentByFormation,
    deployedFormationIds,
    modelPlacementsByFormation,
    modelPositionHistoryByFormation,
    modelLocationHistoryByFormation,
    currentModelPositionsByFormation,
    geometryStaleFormationIds,
    spatialFactsByFormation,
    objectiveControlFacts,
    visibilityFactsByFormation,
    pendingDeploymentPlacement,
    pendingModelPosition,
    pendingModelPositions: pendingModelPosition
      ? [pendingModelPosition, ...queuedModelPositions]
      : [],
    setupDestroyedFormationIds,
    deploymentPriorityPlayerId,
    deploymentComplete:
      deploymentDeclarationsComplete(formations, deploymentByFormation) &&
      [...deploymentByFormation.values()].every(
        (deployment) =>
          deployment.location !== "battlefield" ||
          (deployedFormationIds.has(deployment.formationId) &&
            (!battleRuleCoverageRequiresTableGeometry(ruleCoverage) ||
              state.version < MODEL_PLACEMENT_BATTLE_STATE_VERSION ||
              modelPlacementsByFormation.has(deployment.formationId))),
      ) &&
      !pendingDeploymentPlacement,
    reserveArrivals,
    embarkedByFormation,
    disembarkedByFormation,
    movementPhaseStartEmbarkedFormationIds,
    pendingTransportDestructions,
    transportDestructionResolutions,
    targetEligibilityFacts,
    fightMovementsByActivation,
    movementStartsByFormation,
    chargeDeclarationsByFormation,
    pendingFireOverwatch,
    fireOverwatches,
    fireOverwatchPasses,
    pendingHazardous,
    hazardousTests,
    hazardousDamageResolutions,
    pendingGoToGround,
    readyRangedAttack: readyRangedAttacks[0] ?? readyRangedAttack,
    readyRangedAttacks,
    rangedDeclarationDraft,
    activeRangedDeclarationSet,
    rangedDeclarationSets,
    rangedDeclarationRetractions,
    autoSkippedRangedDeclarations:
      activeRangedDeclarationSet?.declarations.filter(
        (declaration) =>
          !resolvedRangedDeclarationIds.has(declaration.id) &&
          formationDestroyed(formations.get(declaration.targetFormationId)),
      ) ?? [],
    goToGrounds,
    goToGroundPasses,
    activeGoToGroundEffects: goToGrounds.filter((effect) => samePhase(effect.appliedAt, clock)),
    pendingSmokescreen,
    smokescreens,
    smokescreenPasses,
    activeSmokescreenEffects: smokescreens.filter((effect) => samePhase(effect.appliedAt, clock)),
    pendingRapidIngress,
    rapidIngresses,
    rapidIngressPasses,
    largeModelRapidIngressRestrictedFormationIds,
    pendingCounterOffensive,
    counterOffensives,
    counterOffensivePasses,
    forcedFightFormationId,
    pendingHeroicIntervention,
    heroicInterventions,
    heroicInterventionPasses,
    offBattlefieldFormationIds,
    reserveDestroyedFormationIds,
    completedActivations,
    activeActivation,
  };
}

function appendEvent(state, event) {
  return normalizeBattleState({ ...state, events: [...state.events, event] });
}

export function configureBattleTableGeometry(state, geometry, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Table geometry is locked after the battle starts");
  }
  if (replayed.tableGeometry) throw new Error("Table geometry has already been recorded");
  const migratedInitialGeometry =
    state.migration &&
    state.events.length === (state.migration.legacyTableGeometryThroughSequence ?? -1);
  if (replayed.deploymentByFormation.size > 0 && !migratedInitialGeometry) {
    throw new Error("Table geometry is locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "table_geometry_recorded",
    geometry,
  });
}

export function configureBattleTerrainFootprints(state, terrainFootprints, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Terrain footprints are locked after the battle starts");
  }
  if (replayed.terrainFootprints) {
    throw new Error("Terrain footprints have already been recorded");
  }
  if (!replayed.tableGeometry) {
    throw new Error("Record reviewed table geometry before terrain footprints");
  }
  const migrationBoundary = state.migration?.legacyTerrainFootprintsThroughSequence ?? -1;
  const migratedInitialFootprints =
    state.migration &&
    state.events
      .slice(migrationBoundary)
      .every((candidate) => candidate.type === "table_geometry_recorded");
  if (replayed.deploymentByFormation.size > 0 && !migratedInitialFootprints) {
    throw new Error("Terrain footprints are locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "terrain_footprints_recorded",
    terrainFootprints,
  });
}

export function configureBattleTerrainVisibility(state, terrainVisibility, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Terrain visibility geometry is locked after the battle starts");
  }
  if (replayed.terrainVisibility) {
    throw new Error("Terrain visibility geometry has already been recorded");
  }
  if (!replayed.terrainFootprints) {
    throw new Error("Record reviewed terrain footprints before visibility geometry");
  }
  const migrationBoundary = state.migration?.legacyTerrainVisibilityThroughSequence ?? -1;
  const migratedInitialVisibility = Boolean(
    state.migration && state.events.length >= migrationBoundary,
  );
  if (replayed.deploymentByFormation.size > 0 && !migratedInitialVisibility) {
    throw new Error("Terrain visibility geometry is locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "terrain_visibility_recorded",
    terrainVisibility,
  });
}

export function declareFormationDeployment(
  state,
  formationId,
  location,
  {
    points = 0,
    earliestBattleRound = location === "strategic_reserves" ? 2 : 1,
    eligibilityConfirmed = false,
    eligibilityReason = "",
    transportFormationId = "",
    aircraftMode = "",
  } = {},
  id,
  at,
) {
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "deployment_declared",
    formationId,
    location,
    points,
    earliestBattleRound,
    eligibilityConfirmed,
    eligibilityReason,
    transportFormationId,
    aircraftMode,
  });
}

export function deployFormation(
  state,
  formationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_deployed",
    formationId,
    placementConfirmed,
    placementReason,
  });
}

export function recordDeploymentModelPlacements(state, formationId, placement, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Deployment model placements are locked after the battle starts");
  }
  if (!replayed.deployedFormationIds.has(formationId)) {
    throw new Error("Deploy the formation before recording its model placements");
  }
  if (replayed.modelPlacementsByFormation.has(formationId)) {
    throw new Error("Deployment model placements have already been recorded");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "model_placements_recorded",
    formationId,
    placement,
  });
}

export function recordModelPositions(state, formationId, position, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingModelPosition;
  if (!pending || pending.formationId !== formationId) {
    throw new Error("No per-model position snapshot is pending for this formation");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "model_positions_recorded",
    formationId,
    position,
  });
}

export function arriveFromReserves(
  state,
  formationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "reserve_arrived",
    formationId,
    placementConfirmed,
    placementReason,
    clock,
  });
}

export function startBattle(state, firstPlayerId, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") throw new Error("Battle has already started");
  if (
    state.version >= RULE_COVERAGE_BATTLE_STATE_VERSION &&
    !replayed.ruleCoverage?.report.permitted
  ) {
    throw new Error(
      "Every selected battle rule must pass source-locked coverage before battle start",
    );
  }
  const unresolved = [...replayed.formations.values()].flatMap((formation) =>
    formation.weaponBearerTracking === "exact"
      ? formation.weaponInventory.filter((group) => !group.bearerAssignmentsReviewed)
      : [],
  );
  if (unresolved.length > 0) {
    throw new Error("Confirm every optional weapon bearer before starting the battle");
  }
  const clock = startBattleClock(state.players, firstPlayerId);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "battle_started",
    firstPlayerId,
    clock,
  });
}

export function configureBattleRuleCoverage(state, coverage, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Battle rule selections are locked after the battle starts");
  }
  const migratedInitialBinding =
    state.migration &&
    !replayed.ruleCoverage &&
    state.events.length === state.migration.legacyRuleCoverageThroughSequence;
  if (replayed.deploymentByFormation.size > 0 && !migratedInitialBinding) {
    throw new Error("Battle rule selections are locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "rule_coverage_configured",
    coverage,
  });
}

export function advanceBattleClock(state, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.pendingChoices.size > 0) {
    throw new Error("Pending choices must be resolved before advancing the battle");
  }
  if (replayed.activeActivation) {
    throw new Error("The active formation must finish its activation before advancing");
  }
  if (replayed.pendingHeroicIntervention) {
    throw new Error("Resolve or pass the pending Heroic Intervention window first");
  }
  if (replayed.pendingFireOverwatch) {
    throw new Error("Resolve or pass the pending Fire Overwatch window first");
  }
  if (replayed.pendingSmokescreen) {
    throw new Error("Resolve or pass the pending Smokescreen window first");
  }
  if (replayed.pendingRapidIngress) {
    throw new Error("Resolve or pass the pending Rapid Ingress window first");
  }
  if (replayed.pendingCounterOffensive) {
    throw new Error("Resolve or pass the pending Counter-offensive window first");
  }
  if (replayed.forcedFightFormationId) {
    throw new Error("The Counter-offensive formation must fight next");
  }
  if (replayed.movementStartsByFormation.size > 0) {
    throw new Error("Complete the started movement before advancing the battle");
  }
  if (replayed.chargeDeclarationsByFormation.size > 0) {
    throw new Error("Resolve the declared charge before advancing the battle");
  }
  const from = replayed.clock;
  const to = nextBattleClock(from, state.players);
  const expiredEffectIds = [...replayed.effects.values()]
    .filter((effect) => effectExpiresOnAdvance(effect, from, to))
    .map((effect) => effect.id)
    .sort();
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "clock_advanced",
    from,
    to,
    expiredEffectIds,
  });
}

export function openBattleChoice(state, choice, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "choice_opened",
    choice,
    clock,
  });
}

export function resolveBattleChoice(state, choiceId, selectedOptionIds, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "choice_resolved",
    choiceId,
    selectedOptionIds,
    clock,
  });
}

export function applyBattleEffect(state, effect, id, at) {
  const appliedAt = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "effect_applied",
    effect: { ...effect, appliedAt },
  });
}

export function configureBattleMission(state, mission, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Mission setup is locked after the battle starts");
  }
  if (replayed.deploymentByFormation.size > 0) {
    throw new Error("Mission setup is locked after deployment declarations begin");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "mission_configured",
    mission,
  });
}

export function changeBattleResource(
  state,
  { playerId, resourceId, name, delta, maximum = null, reason },
  id,
  at,
) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status === "complete") {
    throw new Error("Battle resources are locked after the battle ends");
  }
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error("Resource player is unknown");
  }
  if (resourceId === "victory_points") {
    throw new Error("Use a scoring event to change Victory Points");
  }
  const previous = replayed.resources.get(playerId)?.get(resourceId);
  const before = previous?.value ?? 0;
  const after = before + boundedInteger(delta, "Resource change", -100000, 100000);
  if (after < 0) throw new Error(`${previous?.name ?? name} cannot go below 0`);
  const normalizedMaximum = previous?.maximum ?? maximum;
  if (normalizedMaximum !== null && after > normalizedMaximum) {
    throw new Error(`${previous?.name ?? name} cannot exceed ${normalizedMaximum}`);
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "resource_changed",
    playerId,
    resourceId,
    name: previous?.name ?? name,
    before,
    after,
    maximum: normalizedMaximum,
    reason,
    clock: replayed.clock,
  });
}

export function scoreBattlePoints(state, playerId, points, category, reason, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "active") {
    throw new Error("Victory Points can only be scored during an active battle");
  }
  const before = replayed.resources.get(playerId)?.get("victory_points")?.value;
  if (before === undefined) throw new Error("Scoring player is unknown");
  const normalizedPoints = boundedInteger(points, "Scoring points", -1000, 1000);
  const after = before + normalizedPoints;
  if (after < 0) throw new Error("Victory Points cannot go below 0");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "score_recorded",
    playerId,
    category,
    points: normalizedPoints,
    before,
    after,
    reason,
    clock: replayed.clock,
  });
}

export function setBattleObjectiveControl(
  state,
  objectiveId,
  controllerPlayerId,
  contested,
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "objective_control_changed",
    objectiveId,
    controllerPlayerId,
    contested,
    clock,
  });
}

export function clearBattleObjectiveControlOverride(state, objectiveId, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "objective_control_override_cleared",
    objectiveId,
    clock,
  });
}

export function setFormationBattleShocked(state, formationId, battleShocked, reason, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "battleshock_changed",
    formationId,
    battleShocked,
    reason,
    clock,
  });
}

export function battleResource(state, playerId, resourceId) {
  return replayBattleState(state).resources.get(playerId)?.get(resourceId) ?? null;
}

export function battleFormationIsBattleShocked(state, formationId) {
  return replayBattleState(state).battleShockedFormations.has(formationId);
}

export function battleFormationIsOnBattlefield(state, formationId) {
  const replayed = replayBattleState(state);
  return formationIsOnBattlefield(
    formationId,
    replayed.deploymentByFormation,
    replayed.deployedFormationIds,
    replayed.embarkedByFormation,
  );
}

export function completeFormationMovement(state, formationId, movement, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "movement_recorded",
    formationId,
    movement,
    clock,
  });
}

export function recordFormationMovement(state, formationId, movement, id, at) {
  if (state.version < FIRE_OVERWATCH_BATTLE_STATE_VERSION || movement === "stationary") {
    return completeFormationMovement(state, formationId, movement, id, at);
  }
  const replayed = replayBattleState(state);
  if (replayed.movementStartsByFormation.has(formationId)) {
    return completeFormationMovement(state, formationId, movement, id, at);
  }
  let next = startFormationMovement(state, formationId, movement, `${id}-start`, at);
  next = passFireOverwatch(
    next,
    "Compatibility movement helper explicitly declined Fire Overwatch at move start",
    `${id}-start-pass`,
    at,
  );
  next = completeFormationMovement(next, formationId, movement, id, at);
  if (replayBattleState(next).pendingModelPosition) return next;
  return passFireOverwatch(
    next,
    "Compatibility movement helper explicitly declined Fire Overwatch at move end",
    `${id}-end-pass`,
    at,
  );
}

export function startFormationMovement(state, formationId, movement, id, at) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "movement_started",
    formationId,
    movement,
    clock,
  });
}

export function embarkFormation(
  state,
  formationId,
  transportFormationId,
  { rangeConfirmed = false, rangeReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_embarked",
    formationId,
    transportFormationId,
    rangeConfirmed,
    rangeReason,
    clock,
  });
}

export function disembarkFormation(
  state,
  formationId,
  transportFormationId,
  { placementConfirmed = false, placementReason = "" } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_disembarked",
    formationId,
    transportFormationId,
    placementConfirmed,
    placementReason,
    clock,
  });
}

export function resolveDestroyedTransport(
  state,
  transportFormationId,
  passengerOptions,
  id,
  at,
  randomUint32 = secureRandomUint32,
  { deadlyDemiseResolvedConfirmed = false, deadlyDemiseResolutionReason = "" } = {},
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingTransportDestructions.get(transportFormationId);
  if (!pending) throw new Error("Transport does not have a pending destruction resolution");
  const optionsByFormationId = new Map(
    (passengerOptions ?? []).map((options) => [options.formationId, options]),
  );
  if (
    !Array.isArray(passengerOptions) ||
    optionsByFormationId.size !== passengerOptions.length ||
    optionsByFormationId.size !== pending.passengerFormationIds.length
  ) {
    throw new Error("Destroyed Transport resolution must contain each passenger exactly once");
  }
  const passengers = pending.passengerFormationIds.map((formationId) => {
    const formation = replayed.formations.get(formationId);
    const options = optionsByFormationId.get(formationId);
    if (!options) throw new Error("Destroyed Transport resolution is missing a passenger");
    const firstSegmentId = boundedString(
      options.firstSegmentId,
      "Destroyed Transport first allocation profile",
      100,
    );
    const unplacedModels = nonnegativeInteger(
      options.unplacedModels ?? 0,
      "Unplaced passenger models",
      liveModelCount(formation),
    );
    const emergency = Boolean(options.emergency);
    const rolls = Array.from({ length: liveModelCount(formation) - unplacedModels }, () =>
      randomDie(6, randomUint32),
    );
    const resolved = replayDestroyedPassengerResolution(
      formation,
      { firstSegmentId, emergency, unplacedModels, rolls, feelNoPainRolls: [] },
      randomUint32,
    );
    return {
      formationId,
      firstSegmentId,
      emergency,
      placementConfirmed: Boolean(options.placementConfirmed),
      placementReason: options.placementReason ?? "",
      unplacedModels,
      rolls,
      feelNoPainRolls: resolved.feelNoPainRolls,
      summary: resolved.summary,
      allocations: resolved.allocations,
    };
  });
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "transport_destroyed_resolved",
    transportFormationId,
    causeEventId: pending.causeEventId,
    deadlyDemiseResolvedConfirmed,
    deadlyDemiseResolutionReason,
    passengers,
    clock: pending.clock,
  });
}

export function battleFormationEmbarkedTransport(state, formationId) {
  return replayBattleState(state).embarkedByFormation.get(formationId) ?? "";
}

export function battleTransportOccupancy(state, transportFormationId) {
  const replayed = replayBattleState(state);
  return transportOccupancyReport(
    replayed.formations,
    replayed.embarkedByFormation,
    transportFormationId,
  );
}

export function battleTransportDeploymentChains(state) {
  const replayed = replayBattleState(state);
  return [...replayed.formations.keys()].map((formationId) => {
    const chain = transportDeploymentChain(formationId, replayed.deploymentByFormation);
    const rootLocation = chain.rootDeployment?.location ?? "";
    const reserveEligibilityCount = chain.formationIds.filter(
      (id) => replayed.deploymentByFormation.get(id)?.eligibilityConfirmed,
    ).length;
    return {
      formationId,
      formationIds: [...chain.formationIds],
      rootFormationId: chain.rootFormationId,
      rootLocation,
      rootLocationCode: DEPLOYMENT_ROOT_LOCATION[rootLocation] ?? 0,
      reserveEligibilityCount,
      complete: chain.complete,
      valid: chain.valid,
      reason: chain.reason,
    };
  });
}

export function battleInitialDeploymentRules(state) {
  const replayed = replayBattleState(state);
  return [...replayed.formations.keys()].map((formationId) =>
    initialDeploymentReportForFormation(
      formationId,
      replayed.formations,
      replayed.deploymentByFormation,
      replayed.embarkedByFormation,
    ),
  );
}

export function battleEmbarkationOptions(state, formationId) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(formationId);
  if (!formation || formationDestroyed(formation)) return [];
  return formation.transportOptions.map((option) => {
    const transport = replayed.formations.get(option.transportFormationId);
    const onBattlefield = formationIsOnBattlefield(
      option.transportFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    );
    const occupancy = transportOccupancyReport(
      replayed.formations,
      replayed.embarkedByFormation,
      option.transportFormationId,
      formationId,
    );
    return {
      transportFormationId: option.transportFormationId,
      name: transport?.name ?? option.transportFormationId,
      assigned: formation.assignedTransportFormationId === option.transportFormationId,
      available: onBattlefield && occupancy.valid,
      reason: onBattlefield ? occupancy.reason : "Transport is not on the battlefield",
      occupancy,
    };
  });
}

export function recordRangedTargetEligibility(
  state,
  {
    attackerFormationId,
    targetFormationId,
    weaponId,
    weaponName,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    publishedRangeThousandths,
    effectiveRangeThousandths,
    measuredDistanceThousandths,
    visible = false,
    fullyVisible = false,
    indirectFire = false,
    weaponHasIndirect = false,
    eligibleWeaponCount = 0,
    declaredWeaponCount = 0,
    attackSnapshot,
    method = "manual",
    reviewedByPlayer = false,
    reviewReason = "",
    rangeOverrideReason = "",
    visibilityOverrideReason = "",
    fullVisibilityOverrideReason = "",
    coverOverrideReason = "",
    fallbackTargetCover = false,
  },
  id,
  at,
) {
  const replayed = replayBattleState(state);
  const clock = replayed.clock;
  if (!reviewedByPlayer) {
    throw new Error("Target measurement must be reviewed by a player");
  }
  if (!reviewReason.trim()) {
    throw new Error("Target measurement review must explain the checked tabletop facts");
  }
  const geometryDecision = battleRangedGeometryDecision(state, {
    attackerFormationId,
    targetFormationId,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    eligibleWeaponCount,
    declaredWeaponCount: declaredWeaponCount || eligibleWeaponCount,
    requestedVisible: visible,
    requestedFullyVisible: fullyVisible,
    indirectFire,
    weaponHasIndirect,
    reviewedByPlayer,
    visibilityOverrideReason: visibilityOverrideReason || reviewReason,
    fullVisibilityOverrideReason: fullVisibilityOverrideReason || reviewReason,
    coverOverrideReason: coverOverrideReason || reviewReason,
    fallbackTargetCover,
  });
  if (!geometryDecision.valid) {
    throw new Error("Ranged geometry must be proven or explicitly reviewed before declaration");
  }
  let resolvedAttackSnapshot = attackSnapshot;
  if (attackSnapshot && !attackSnapshot.targetModelIds) {
    const target = replayed.formations.get(targetFormationId);
    const modelSequence = buildModelLevelTargetSequence(
      target,
      attackSnapshot.segmentIds,
      attackSnapshot.targets,
      geometryDecision.cover,
    );
    resolvedAttackSnapshot = {
      ...attackSnapshot,
      targets: modelSequence.targets,
      segmentIds: modelSequence.segmentIds,
      targetModelIds: modelSequence.targetModelIds,
    };
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "ranged_target_eligibility_recorded",
    attackerFormationId,
    targetFormationId,
    weaponId,
    weaponName,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    publishedRangeThousandths,
    effectiveRangeThousandths,
    measuredDistanceThousandths,
    visible: geometryDecision.visible,
    fullyVisible: geometryDecision.fullyVisible,
    indirectFire: geometryDecision.indirectFire,
    weaponHasIndirect,
    eligibleWeaponCount,
    declaredWeaponCount,
    attackSnapshot: resolvedAttackSnapshot,
    activationEventId: replayed.activeActivation?.id ?? "",
    method,
    reviewedByPlayer,
    reviewReason,
    rangeOverrideReason,
    geometryDecision,
    clock,
  });
}

export function retractRangedTargetDeclaration(state, declarationEventId, reason, id, at) {
  const replayed = replayBattleState(state);
  if (!replayed.activeActivation || replayed.rangedDeclarationDraft.length < 1) {
    throw new Error("No ranged target declaration is open");
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "ranged_target_declaration_retracted",
    activationEventId: replayed.activeActivation.id,
    declarationEventId,
    reason,
    clock: replayed.clock,
  });
}

export function closeRangedTargetDeclarations(state, id, at, reactionOrder = "") {
  const replayed = replayBattleState(state);
  if (!replayed.activeActivation || replayed.rangedDeclarationDraft.length < 1) {
    throw new Error("Declare at least one ranged attack before finishing target selection");
  }
  const ordered = canonicalRangedDeclarations(replayed.rangedDeclarationDraft);
  const stats = rangedDeclarationStructure(ordered);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "ranged_targets_declared",
    activationEventId: replayed.activeActivation.id,
    declarationEventIds: ordered.map((declaration) => declaration.id),
    ...stats,
    flags: RANGED_DECLARATION_FLAGS.mask,
    reactionOrder,
    clock: replayed.clock,
  });
}

export function passGoToGround(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingGoToGround;
  if (!pending) throw new Error("No Go to Ground window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "go_to_ground_passed",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    targetFormationId: pending.activationWide ? "" : pending.targetFormationId,
    reason,
    clock: replayed.clock,
  });
}

export function resolveGoToGround(state, targetFormationId, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingGoToGround;
  if (!pending) throw new Error("No Go to Ground window is pending");
  const commandPointsBefore =
    replayed.resources.get(pending.responderPlayerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "go_to_ground_resolved",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    targetFormationId: pending.activationWide ? targetFormationId : pending.targetFormationId,
    commandPointCost: 1,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - 1,
    allModelsHaveSixPlusInvulnerable: true,
    allModelsHaveBenefitOfCover: true,
    clock: replayed.clock,
  });
}

export function battleGoToGroundEffect(state, formationId) {
  return (
    replayBattleState(state).activeGoToGroundEffects.find(
      (effect) => effect.targetFormationId === formationId,
    ) ?? null
  );
}

export function passSmokescreen(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingSmokescreen;
  if (!pending) throw new Error("No Smokescreen window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "smokescreen_passed",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function resolveSmokescreen(state, targetFormationId, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingSmokescreen;
  if (!pending) throw new Error("No Smokescreen window is pending");
  const commandPointsBefore =
    replayed.resources.get(pending.responderPlayerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "smokescreen_resolved",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    targetFormationId,
    commandPointCost: 1,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - 1,
    allModelsHaveBenefitOfCover: true,
    allModelsHaveStealth: true,
    clock: replayed.clock,
  });
}

export function battleSmokescreenEffect(state, formationId) {
  return (
    replayBattleState(state).activeSmokescreenEffects.find(
      (effect) => effect.targetFormationId === formationId,
    ) ?? null
  );
}

export function passRapidIngress(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingRapidIngress;
  if (!pending) throw new Error("No Rapid Ingress window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "rapid_ingress_passed",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function resolveRapidIngress(
  state,
  formationId,
  {
    placementMethod = "source_rule",
    placementConfirmed = false,
    placementReason = "",
    allModelsHaveDeepStrike = false,
    whollyWithinSixOfBattlefieldEdge = false,
    outsideEnemyDeploymentZone = false,
    moreThanNineFromEnemyModels = false,
    largeModelEdgeException = false,
    touchingOwnBattlefieldEdge = false,
    sourceRulePlacementConfirmed = false,
    firstRoundOutOfPhaseAllowed = false,
    firstRoundOutOfPhaseReason = "",
  } = {},
  id,
  at,
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingRapidIngress;
  if (!pending) throw new Error("No Rapid Ingress window is pending");
  const commandPointsBefore =
    replayed.resources.get(pending.responderPlayerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "rapid_ingress_resolved",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    formationId,
    commandPointCost: 1,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - 1,
    placementMethod,
    placementConfirmed,
    placementReason,
    allModelsHaveDeepStrike,
    whollyWithinSixOfBattlefieldEdge,
    outsideEnemyDeploymentZone,
    moreThanNineFromEnemyModels,
    largeModelEdgeException,
    touchingOwnBattlefieldEdge,
    sourceRulePlacementConfirmed,
    firstRoundOutOfPhaseAllowed,
    firstRoundOutOfPhaseReason,
    arrivesAsReinforcements: true,
    passengersRemainEmbarked: true,
    clock: replayed.clock,
  });
}

export function recordFormationCharge(
  state,
  formationId,
  targetFormationIds,
  {
    successful = false,
    rolls = [],
    rollModifier = 0,
    chargeDistanceThousandths = Math.max(0, (rolls[0] ?? 0) + (rolls[1] ?? 0) + rollModifier) *
      1000,
    rollOverrideReason = "",
    targetFacts = [],
    phaseStartEligibilityConfirmed = false,
    phaseStartEligibilityReason = "",
    startedOutsideEngagementRange = false,
    maximumModelMoveThousandths = 0,
    unitCoherencyConfirmed = false,
    nonTargetEngagementRangeAvoided = false,
    allModelsCloserToTarget = false,
    baseContactMaximized = false,
    movementReviewedByPlayer = false,
    movementReviewReason = "",
    failureReason = "",
    targetEligibilityConfirmed = false,
    targetEligibilityReason = "",
    eligibilityOverride = false,
    overrideReason = "",
  } = {},
  id,
  at,
) {
  if (
    state.version >= CHARGE_MOVE_BATTLE_STATE_VERSION &&
    (!Array.isArray(rolls) || rolls.length !== 2)
  ) {
    throw new Error("A Charge roll must contain two D6 rolls");
  }
  let next = state;
  let replayed = replayBattleState(next);
  if (
    state.version >= FIRE_OVERWATCH_BATTLE_STATE_VERSION &&
    !replayed.chargeDeclarationsByFormation.has(formationId)
  ) {
    next = declareFormationCharge(
      next,
      formationId,
      targetFormationIds,
      {
        targetFacts: targetFacts.map((fact) => ({
          formationId: fact.formationId,
          startDistanceThousandths: fact.startDistanceThousandths,
        })),
        phaseStartEligibilityConfirmed,
        phaseStartEligibilityReason,
        startedOutsideEngagementRange,
        eligibilityOverride,
        overrideReason,
      },
      `${id}-declared`,
      at,
    );
    next = passFireOverwatch(
      next,
      "Compatibility charge helper explicitly declined Fire Overwatch at declaration",
      `${id}-overwatch-pass`,
      at,
    );
    replayed = replayBattleState(next);
  }
  const clock = replayed.clock;
  return appendEvent(next, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: next.events.length + 1,
    at,
    type: "charge_recorded",
    formationId,
    targetFormationIds,
    successful,
    rolls,
    rollModifier,
    chargeDistanceThousandths,
    rollOverrideReason,
    targetFacts,
    phaseStartEligibilityConfirmed,
    phaseStartEligibilityReason,
    startedOutsideEngagementRange,
    maximumModelMoveThousandths,
    unitCoherencyConfirmed,
    nonTargetEngagementRangeAvoided,
    allModelsCloserToTarget,
    baseContactMaximized,
    movementReviewedByPlayer,
    movementReviewReason,
    failureReason,
    targetEligibilityConfirmed,
    targetEligibilityReason,
    eligibilityOverride,
    overrideReason,
    clock,
  });
}

export function declareFormationCharge(
  state,
  formationId,
  targetFormationIds,
  {
    targetFacts = [],
    phaseStartEligibilityConfirmed = false,
    phaseStartEligibilityReason = "",
    startedOutsideEngagementRange = false,
    eligibilityOverride = false,
    overrideReason = "",
  } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "charge_declared",
    formationId,
    targetFormationIds,
    targetFacts,
    phaseStartEligibilityConfirmed,
    phaseStartEligibilityReason,
    startedOutsideEngagementRange,
    eligibilityOverride,
    overrideReason,
    clock,
  });
}

export function passFireOverwatch(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingFireOverwatch;
  if (!pending) throw new Error("No Fire Overwatch window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "fire_overwatch_passed",
    triggerEventId: pending.triggerEventId,
    playerId: pending.responderPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function startFireOverwatch(
  state,
  formationId,
  {
    commandPointCost = 1,
    costOverrideReason = "",
    usageOverrideReason = "",
    stratagemEligibilityOverrideReason = "",
    distanceThousandths = 0,
    targetVisible = false,
    shootingEligibilityConfirmed = false,
    shootingEligibilityReason = "",
    outOfPhaseRestrictionsConfirmed = false,
    outOfPhaseRestrictionsReason = "",
  } = {},
  id,
  at,
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingFireOverwatch;
  if (!pending) throw new Error("No Fire Overwatch window is pending");
  const formation = replayed.formations.get(formationId);
  if (!formation) throw new Error("Fire Overwatch formation is unknown");
  const lowerKeywords = formation.keywords.map((keyword) => keyword.toLowerCase());
  const commandPointsBefore =
    replayed.resources.get(formation.playerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "fire_overwatch_started",
    triggerEventId: pending.triggerEventId,
    formationId,
    targetFormationId: pending.targetFormationId,
    commandPointCost,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - commandPointCost,
    costOverrideReason,
    usageOverrideReason,
    stratagemEligibilityOverrideReason,
    distanceThousandths,
    targetVisible,
    shootingEligibilityConfirmed,
    shootingEligibilityReason,
    outOfPhaseRestrictionsConfirmed,
    outOfPhaseRestrictionsReason,
    hitsOnUnmodifiedSixConfirmed: true,
    criticalHitsOnSixConfirmed: true,
    titanicRestrictionSatisfied: !lowerKeywords.includes("titanic"),
    clock: replayed.clock,
  });
}

export function passHeroicIntervention(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingHeroicIntervention;
  if (!pending) throw new Error("No Heroic Intervention window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "heroic_intervention_passed",
    triggerChargeEventId: pending.triggerChargeEventId,
    playerId: pending.responderPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function resolveHeroicIntervention(
  state,
  formationId,
  {
    commandPointCost = 1,
    costOverrideReason = "",
    usageOverrideReason = "",
    stratagemEligibilityOverrideReason = "",
    successful = false,
    rolls = [],
    rollModifier = 0,
    chargeDistanceThousandths = Math.max(0, (rolls[0] ?? 0) + (rolls[1] ?? 0) + rollModifier) *
      1000,
    rollOverrideReason = "",
    startDistanceThousandths = 0,
    targetEligibilityConfirmed = false,
    targetEligibilityReason = "",
    startedOutsideEngagementRange = false,
    maximumModelMoveThousandths = 0,
    endsWithinEngagementRange = false,
    unitCoherencyConfirmed = false,
    nonTargetEngagementRangeAvoided = false,
    allModelsCloserToTarget = false,
    baseContactMaximized = false,
    movementReviewedByPlayer = false,
    movementReviewReason = "",
    failureReason = "",
  } = {},
  id,
  at,
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingHeroicIntervention;
  if (!pending) throw new Error("No Heroic Intervention window is pending");
  const formation = replayed.formations.get(formationId);
  if (!formation) throw new Error("Heroic Intervention formation is unknown");
  const lowerKeywords = formation.keywords.map((keyword) => keyword.toLowerCase());
  const commandPointsBefore =
    replayed.resources.get(formation.playerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "heroic_intervention_resolved",
    triggerChargeEventId: pending.triggerChargeEventId,
    formationId,
    targetFormationId: pending.chargingFormationId,
    commandPointCost,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - commandPointCost,
    costOverrideReason,
    usageOverrideReason,
    stratagemEligibilityOverrideReason,
    successful,
    rolls,
    rollModifier,
    chargeDistanceThousandths,
    rollOverrideReason,
    startDistanceThousandths,
    targetEligibilityConfirmed,
    targetEligibilityReason,
    startedOutsideEngagementRange,
    maximumModelMoveThousandths,
    endsWithinEngagementRange,
    unitCoherencyConfirmed,
    nonTargetEngagementRangeAvoided,
    allModelsCloserToTarget,
    baseContactMaximized,
    movementReviewedByPlayer,
    movementReviewReason,
    vehicleRestrictionSatisfied:
      !lowerKeywords.includes("vehicle") || lowerKeywords.includes("walker"),
    soleTriggerTargetConfirmed: true,
    chargeBonusSuppressedConfirmed: true,
    failureReason,
    clock: replayed.clock,
  });
}

export function startFormationActivation(
  state,
  formationId,
  {
    weaponHasAssault = false,
    eligibilityOverride = false,
    overrideReason = "",
    fightsFirst = false,
  } = {},
  id,
  at,
) {
  const clock = replayBattleState(state).clock;
  const activationType = clock.phase === "shooting" ? "shooting" : "fight";
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "activation_started",
    formationId,
    activationType,
    weaponHasAssault,
    eligibilityOverride,
    overrideReason,
    fightsFirst,
    clock,
  });
}

export function recordFightMove(
  state,
  stage,
  {
    destination = "enemy",
    maximumModelMoveThousandths = 0,
    movementReviewedByPlayer = false,
    movementReviewReason = "",
    baseContactModelsStationary = false,
    unitCoherencyConfirmed = false,
    endsWithinEngagementRange = false,
    allMovedModelsCloserToEnemy = false,
    baseContactMaximized = false,
    enemyDestinationImpossible = false,
    objectiveId = "",
    endsWithinObjectiveRange = false,
    allMovedModelsCloserToObjective = false,
    objectiveDestinationImpossible = false,
    outcomeReason = "",
    meleeAttacksCompleteConfirmed = false,
    meleeAttacksCompletionReason = "",
  } = {},
  id,
  at,
) {
  const replayed = replayBattleState(state);
  if (!replayed.activeActivation || replayed.activeActivation.activationType !== "fight") {
    throw new Error("No Fight activation is in progress");
  }
  const movementRuleRestricted = replayed.largeModelRapidIngressRestrictedFormationIds.has(
    replayed.activeActivation.formationId,
  );
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "fight_move_recorded",
    formationId: replayed.activeActivation.formationId,
    activationEventId: replayed.activeActivation.id,
    stage,
    destination: movementRuleRestricted ? "none" : destination,
    maximumModelMoveThousandths: movementRuleRestricted ? 0 : maximumModelMoveThousandths,
    movementReviewedByPlayer,
    movementReviewReason,
    baseContactModelsStationary: movementRuleRestricted ? true : baseContactModelsStationary,
    unitCoherencyConfirmed: movementRuleRestricted ? false : unitCoherencyConfirmed,
    endsWithinEngagementRange: movementRuleRestricted ? false : endsWithinEngagementRange,
    allMovedModelsCloserToEnemy: movementRuleRestricted ? false : allMovedModelsCloserToEnemy,
    baseContactMaximized: movementRuleRestricted ? false : baseContactMaximized,
    enemyDestinationImpossible: movementRuleRestricted ? false : enemyDestinationImpossible,
    objectiveId: movementRuleRestricted ? "" : objectiveId,
    endsWithinObjectiveRange: movementRuleRestricted ? false : endsWithinObjectiveRange,
    allMovedModelsCloserToObjective: movementRuleRestricted
      ? false
      : allMovedModelsCloserToObjective,
    objectiveDestinationImpossible: movementRuleRestricted ? false : objectiveDestinationImpossible,
    outcomeReason: movementRuleRestricted
      ? "Large-model Rapid Ingress restriction prevents movement this turn"
      : outcomeReason,
    movementRuleRestricted,
    movementRuleRestrictionReason: movementRuleRestricted
      ? "Large-model Strategic Reserves own-edge exception"
      : "",
    meleeAttacksCompleteConfirmed,
    meleeAttacksCompletionReason,
    clock: replayed.clock,
  });
}

export function completeFormationActivation(state, id, at) {
  const replayed = replayBattleState(state);
  if (!replayed.activeActivation) throw new Error("No formation activation is in progress");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "activation_completed",
    formationId: replayed.activeActivation.formationId,
    activationType: replayed.activeActivation.activationType,
    clock: replayed.clock,
  });
}

export function recordHazardousTests(state, tests, id, at) {
  const replayed = replayBattleState(state);
  const activation = replayed.activeActivation;
  if (!activation) throw new Error("No formation activation is in progress");
  const deferredUntilChargeMove =
    activation.source === "fire_overwatch" && activation.trigger === "charge_declared";
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "hazardous_tests_recorded",
    activationEventId: activation.id,
    formationId: activation.formationId,
    tests,
    deferredUntilChargeMove,
    triggerChargeEventId: deferredUntilChargeMove ? activation.triggerEventId : "",
    clock: replayed.clock,
  });
}

export function hazardousBearerOptions(state) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingHazardous;
  if (!pending?.due) return [];
  const formation = replayed.formations.get(pending.formationId);
  if (!formation) return [];
  return hazardousSelectionOptions(formation).map((segment) => ({
    id: segment.id,
    modelName: segment.modelName,
    unitName: segment.unitName,
    role: segment.role,
    keywords: [...segment.keywords],
    modelsRemaining: formation.health[segment.id].modelsRemaining,
    woundsLost: formation.health[segment.id].woundsLost,
    wounds: segment.wounds,
    feelNoPain: segment.feelNoPain,
  }));
}

export function rollHazardousFeelNoPain(state, segmentId, randomUint32 = secureRandomUint32) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingHazardous;
  if (!pending?.due) throw new Error("No Hazardous damage is ready to resolve");
  const formation = replayed.formations.get(pending.formationId);
  const options = formation ? hazardousSelectionOptions(formation) : [];
  const segment = options.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new Error("Select an eligible Hazardous weapon bearer");
  if (segment.feelNoPain === 0) return [];
  const before = formation.health[segment.id];
  const remainingWounds = segment.wounds - before.woundsLost;
  const rolls = [];
  let damage = 0;
  while (rolls.length < 3 && damage < remainingWounds) {
    const roll = randomDie(6, randomUint32);
    rolls.push(roll);
    if (roll < segment.feelNoPain) damage += 1;
  }
  return rolls;
}

export function resolveHazardousDamage(
  state,
  { selectedSegmentId = "", feelNoPainRolls = [], selectionReason = "" } = {},
  id,
  at,
) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingHazardous;
  if (!pending?.due) throw new Error("No Hazardous damage is ready to resolve");
  const formation = replayed.formations.get(pending.formationId);
  if (!formation) throw new Error("Hazardous formation is unavailable");
  const options = hazardousSelectionOptions(formation);
  const segment = options.find((candidate) => candidate.id === selectedSegmentId);
  let allocation = null;
  let summary = { damage: 0, modelsDestroyed: 0 };
  if (options.length > 0) {
    if (!segment) throw new Error("Select an eligible Hazardous weapon bearer");
    const before = { ...formation.health[segment.id] };
    const outcome = hazardousHealthAfter(segment, before, feelNoPainRolls);
    allocation = { segmentId: segment.id, before, after: outcome.after };
    summary = { damage: outcome.damage, modelsDestroyed: outcome.destroyed ? 1 : 0 };
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "hazardous_damage_resolved",
    testEventId: pending.testEventId,
    testIndex: pending.failedTestIndices[0],
    formationId: pending.formationId,
    selectedSegmentId: segment?.id ?? "",
    noEligibleBearer: options.length === 0,
    selectionReason,
    feelNoPainRolls,
    summary,
    allocation,
    clock: replayed.clock,
  });
}

export function passFightPriority(state, reason, id, at) {
  const replayed = replayBattleState(state);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "fight_priority_passed",
    playerId: replayed.clock.priorityPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function passCounterOffensive(state, reason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingCounterOffensive;
  if (!pending) throw new Error("No Counter-offensive window is pending");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "counter_offensive_passed",
    triggerActivationEventId: pending.triggerActivationEventId,
    playerId: pending.responderPlayerId,
    reason,
    clock: replayed.clock,
  });
}

export function resolveCounterOffensive(state, formationId, targetEligibilityReason, id, at) {
  const replayed = replayBattleState(state);
  const pending = replayed.pendingCounterOffensive;
  if (!pending) throw new Error("No Counter-offensive window is pending");
  const commandPointsBefore =
    replayed.resources.get(pending.responderPlayerId)?.get("command_points")?.value ?? 0;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "counter_offensive_resolved",
    triggerActivationEventId: pending.triggerActivationEventId,
    playerId: pending.responderPlayerId,
    formationId,
    commandPointCost: 2,
    commandPointsBefore,
    commandPointsAfter: commandPointsBefore - 2,
    targetInEngagementRange: true,
    targetEligibilityReason,
    fightsNextConfirmed: true,
    clock: replayed.clock,
  });
}

export function battleCanStartFormationActivation(
  state,
  attackerFormationId,
  {
    weaponHasAssault = false,
    weaponType = "",
    eligibilityOverride = false,
    fightsFirst = false,
  } = {},
) {
  if (!state) return false;
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(attackerFormationId);
  if (
    !formation ||
    formationDestroyed(formation) ||
    !formationIsOnBattlefield(
      attackerFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    ) ||
    !battleAttackWindow(replayed.clock) ||
    replayed.pendingChoices.size > 0 ||
    replayed.pendingFireOverwatch ||
    replayed.pendingHeroicIntervention ||
    replayed.pendingSmokescreen ||
    replayed.pendingRapidIngress ||
    replayed.pendingCounterOffensive ||
    replayed.activeActivation ||
    replayed.completedActivations.has(
      `${replayed.clock.battleRound}:${replayed.clock.turn}:${replayed.clock.phase}:${attackerFormationId}`,
    )
  ) {
    return false;
  }
  if (replayed.clock.phase === "shooting") {
    if (replayed.largeModelRapidIngressRestrictedFormationIds.has(attackerFormationId)) {
      return false;
    }
    if (weaponType !== "Ranged") return false;
    if (formation.playerId !== replayed.clock.activePlayerId) return false;
    const movement = replayed.movementByFormation.get(attackerFormationId);
    const currentMovement = movement && sameTurn(movement.clock, replayed.clock) ? movement : null;
    if (!currentMovement) return eligibilityOverride;
    if (currentMovement.movement === "advance") return weaponHasAssault || eligibilityOverride;
    if (currentMovement.movement === "fall_back") return eligibilityOverride;
    return true;
  }
  if (weaponType !== "Melee") return false;
  if (replayed.forcedFightFormationId && replayed.forcedFightFormationId !== attackerFormationId) {
    return false;
  }
  if (formation.playerId !== replayed.clock.priorityPlayerId) return false;
  const charge = replayed.chargeByFormation.get(attackerFormationId);
  const charged = Boolean(charge?.successful && sameTurn(charge.clock, replayed.clock));
  const hasChargeBonus = charged && charge.receivesChargeBonus !== false;
  if (!charged && !eligibilityOverride) return false;
  return (
    replayed.clock.step !== "fights_first" ||
    hasChargeBonus ||
    fightsFirst ||
    replayed.forcedFightFormationId === attackerFormationId
  );
}

export function battleCanResolveAttack(state, attackerFormationId, options = {}) {
  if (!state) return false;
  if (!options.targetEligibilityConfirmed) return false;
  const replayed = replayBattleState(state);
  if (replayed.pendingGoToGround || replayed.pendingSmokescreen) return false;
  if (
    options.targetFormationId &&
    !formationIsOnBattlefield(
      options.targetFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    )
  ) {
    return false;
  }
  if (replayed.activeActivation) {
    const expectedWeaponType =
      replayed.activeActivation.activationType === "shooting" ? "Ranged" : "Melee";
    if (
      state.version >= RANGED_DECLARATION_BATTLE_STATE_VERSION &&
      expectedWeaponType === "Ranged" &&
      replayed.activeActivation.source !== "fire_overwatch"
    ) {
      const ready = replayed.readyRangedAttacks[0];
      return Boolean(
        ready &&
          ready.attackerFormationId === attackerFormationId &&
          ready.targetFormationId === options.targetFormationId &&
          ready.weaponId === String(options.weaponId ?? "") &&
          ready.weaponSourceFormationId === (options.weaponSourceFormationId ?? "") &&
          ready.sourceSavedUnitId === (options.sourceSavedUnitId ?? "") &&
          ready.weaponGroupId === (options.weaponGroupId ?? ""),
      );
    }
    if (
      replayed.activeActivation.source === "fire_overwatch" &&
      options.targetFormationId !== replayed.activeActivation.targetFormationId
    ) {
      return false;
    }
    if (
      expectedWeaponType === "Melee" &&
      replayed.activeActivation.sequence >
        (state.version < FIGHT_MOVE_BATTLE_STATE_VERSION
          ? Number.MAX_SAFE_INTEGER
          : (state.migration?.legacyFightMovementThroughSequence ?? 0)) &&
      (!replayed.activeActivation.pileIn ||
        replayed.activeActivation.pileIn.destination === "none" ||
        replayed.activeActivation.consolidation)
    ) {
      return false;
    }
    return (
      replayed.activeActivation.formationId === attackerFormationId &&
      options.weaponType === expectedWeaponType &&
      (replayed.activeActivation.weaponRestriction !== "assault_only" ||
        Boolean(options.weaponHasAssault))
    );
  }
  if (replayed.clock.phase === "fight" && state.version >= FIGHT_MOVE_BATTLE_STATE_VERSION) {
    return false;
  }
  if (
    replayed.clock.phase === "shooting" &&
    state.version >= RANGED_DECLARATION_BATTLE_STATE_VERSION
  ) {
    return false;
  }
  return battleCanStartFormationActivation(state, attackerFormationId, options);
}

export function battleCanDeclareRangedAttack(state, attackerFormationId, options = {}) {
  if (!state || !options.targetEligibilityConfirmed || options.weaponType !== "Ranged") {
    return false;
  }
  const replayed = replayBattleState(state);
  if (
    replayed.pendingGoToGround ||
    replayed.pendingSmokescreen ||
    replayed.readyRangedAttacks.length > 0 ||
    replayed.activeRangedDeclarationSet
  ) {
    return false;
  }
  if (
    options.targetFormationId &&
    !formationIsOnBattlefield(
      options.targetFormationId,
      replayed.deploymentByFormation,
      replayed.deployedFormationIds,
      replayed.embarkedByFormation,
    )
  ) {
    return false;
  }
  if (replayed.activeActivation) {
    return Boolean(
      replayed.activeActivation.activationType === "shooting" &&
        replayed.activeActivation.source !== "fire_overwatch" &&
        replayed.activeActivation.formationId === attackerFormationId &&
        replayed.activeActivation.attackCount === 0 &&
        (replayed.activeActivation.weaponRestriction !== "assault_only" ||
          Boolean(options.weaponHasAssault)),
    );
  }
  return battleCanStartFormationActivation(state, attackerFormationId, options);
}

export function registerBattleFormation(state, formation, id, at) {
  const replayed = replayBattleState(state);
  if (replayed.formations.has(formation.id)) return state;
  const prepared = prepareExactFormationRegistration(formation);
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_registered",
    formation: prepared,
  });
}

export function battleFormationHealth(state, formationId) {
  return replayBattleState(state).formations.get(formationId)?.health ?? null;
}

export function battleFormation(state, formationId) {
  return replayBattleState(state).formations.get(formationId) ?? null;
}

export function battleFormationWasTargeted(state, formationId) {
  return state.events.some(
    (event) => event.type === "attack_resolved" && event.targetFormationId === formationId,
  );
}

export function configureUnengagedBattleFormation(state, formation, id, at) {
  if (battleFormationWasTargeted(state, formation.id)) {
    throw new Error("Target equipment is locked after this formation has been attacked");
  }
  const index = state.events.findIndex(
    (event) => event.type === "formation_registered" && event.formation.id === formation.id,
  );
  if (index < 0) throw new Error("Formation is not registered for this battle");
  const previous = replayBattleState(state).formations.get(formation.id);
  if (
    previous.playerId !== formation.playerId ||
    previous.sourceFormationId !== formation.sourceFormationId ||
    previous.assignedTransportFormationId !== formation.assignedTransportFormationId ||
    JSON.stringify(previous.deploymentTraits) !== JSON.stringify(formation.deploymentTraits) ||
    JSON.stringify(previous.transportOptions) !== JSON.stringify(formation.transportOptions)
  ) {
    throw new Error("Formation identity cannot change during battle setup");
  }
  let configured = formation;
  if (
    previous.weaponBearerTracking === "exact" &&
    formation.weaponBearerTracking === "exact" &&
    JSON.stringify(weaponInventoryProfileIdentity(previous.weaponInventory)) ===
      JSON.stringify(weaponInventoryProfileIdentity(formation.weaponInventory))
  ) {
    const preservedInventory = formation.weaponInventory.map((group) => {
      const current = previous.weaponInventory.find(
        (candidate) =>
          candidate.sourceSavedUnitId === group.sourceSavedUnitId &&
          candidate.groupId === group.groupId,
      );
      return current
        ? {
            ...group,
            bearerModelIds: current.bearerModelIds,
            bearerAssignmentsReviewed: current.bearerAssignmentsReviewed,
            bearerAssignmentSource: current.bearerAssignmentSource,
          }
        : group;
    });
    configured = {
      ...formation,
      weaponInventory: preservedInventory,
      segments: segmentsForBearerAssignments(formation, preservedInventory),
    };
  }
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_configured",
    formation: configured,
  });
}

export function configureBattleWeaponBearers(
  state,
  formationId,
  sourceSavedUnitId,
  groupId,
  bearerModelIds,
  id,
  at,
) {
  const replayed = replayBattleState(state);
  if (replayed.clock.status !== "setup") {
    throw new Error("Weapon bearer assignments are locked after the battle starts");
  }
  const formation = replayed.formations.get(formationId);
  if (!formation || formation.weaponBearerTracking !== "exact") {
    throw new Error("Formation does not support exact weapon bearer assignments");
  }
  const group = formation.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === groupId,
  );
  if (!group) throw new Error("Weapon group is absent from the locked formation inventory");
  if (!Array.isArray(bearerModelIds) || bearerModelIds.length !== group.count) {
    throw new Error("Assign every equipped weapon copy to a bearer model");
  }
  const models = new Map(formation.modelInstances.map((model) => [model.id, model]));
  if (bearerModelIds.some((modelId) => models.get(modelId)?.savedUnitId !== sourceSavedUnitId)) {
    throw new Error("Every weapon bearer must belong to its source saved unit");
  }
  const weaponInventory = formation.weaponInventory.map((candidate) =>
    candidate === group
      ? {
          ...candidate,
          bearerModelIds: [...bearerModelIds],
          bearerAssignmentsReviewed: true,
          bearerAssignmentSource: "player_reviewed",
        }
      : candidate,
  );
  const configured = {
    ...formation,
    weaponInventory,
    segments: segmentsForBearerAssignments(formation, weaponInventory),
  };
  delete configured.health;
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "formation_configured",
    formation: configured,
  });
}

export function appendResolvedAttack(
  state,
  {
    id,
    at,
    attackerFormationId,
    targetFormationId,
    segmentIds,
    targets,
    initialWoundsLost,
    result,
    summary,
    weaponHasAssault = false,
    weaponType = "",
    targetEligibilityConfirmed = false,
    targetEligibilityReason = "",
    targetEligibilityEventId = "",
    weaponId = "",
    declaredWeaponCount = 0,
    indirectFire = false,
    weaponSourceFormationId = "",
    sourceSavedUnitId = "",
    weaponGroupId = "",
  },
) {
  const replayed = replayBattleState(state);
  const formation = replayed.formations.get(targetFormationId);
  if (!formation) throw new Error("Attack target formation is not registered");
  if (segmentIds.length !== targets.length || segmentIds.length < 1) {
    throw new Error("Attack segment ids must match the resolved target sequence");
  }
  const uniqueSegmentIds = [...new Set(segmentIds)];
  if (
    uniqueSegmentIds.some((segmentId) => {
      const indices = segmentIds.flatMap((candidate, index) =>
        candidate === segmentId ? [index] : [],
      );
      return indices.at(-1) - indices[0] + 1 !== indices.length;
    })
  ) {
    throw new Error("Attack target models for each segment must be contiguous");
  }
  const before = uniqueSegmentIds.map((segmentId, segmentIndex) => {
    const health = formation.health[segmentId];
    if (!health) throw new Error("Attack references an unregistered target segment");
    const indices = segmentIds.flatMap((candidate, index) =>
      candidate === segmentId ? [index] : [],
    );
    const targetModelCount = indices.reduce((total, index) => total + targets[index].modelCount, 0);
    if (health.modelsRemaining !== targetModelCount) {
      throw new Error("Attack target model count does not match battle state");
    }
    if ((segmentIndex === 0 ? initialWoundsLost : 0) !== health.woundsLost) {
      throw new Error("Attack target wounds do not match battle state");
    }
    return { ...health };
  });
  const after = targetSequenceState(initialWoundsLost + result.appliedDamage, targets);
  const allocations = uniqueSegmentIds.map((segmentId, segmentIndex) => {
    const indices = segmentIds.flatMap((candidate, index) =>
      candidate === segmentId ? [index] : [],
    );
    const modelsRemaining = indices.reduce(
      (total, index) => total + after[index].modelsRemaining,
      0,
    );
    const surviving = indices
      .map((index) => after[index])
      .find((entry) => entry.modelsRemaining > 0);
    return {
      segmentId,
      before: before[segmentIndex],
      after: {
        modelsRemaining,
        woundsLost: surviving?.woundsLost ?? 0,
      },
    };
  });
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "attack_resolved",
    attackerFormationId,
    targetFormationId,
    summary: { ...summary, modelsDestroyed: result.modelsDestroyed },
    weaponHasAssault,
    weaponType,
    targetEligibilityConfirmed,
    targetEligibilityReason,
    targetEligibilityEventId,
    weaponId,
    declaredWeaponCount,
    indirectFire,
    weaponSourceFormationId,
    sourceSavedUnitId,
    weaponGroupId,
    activationEventId: replayed.activeActivation?.id ?? "",
    clock: replayed.clock,
    allocations,
  });
}

export function revertLatestAttack(state, id, at) {
  const replayed = replayBattleState(state);
  const revertsEventId = replayed.activeAttackIds.at(-1);
  if (!revertsEventId) throw new Error("There is no resolved attack to undo");
  return appendEvent(state, {
    version: BATTLE_EVENT_VERSION,
    id,
    sequence: state.events.length + 1,
    at,
    type: "attack_reverted",
    revertsEventId,
  });
}

export function activeBattleAttacks(state) {
  const replayed = replayBattleState(state);
  const active = new Set(replayed.activeAttackIds);
  return state.events.filter((event) => event.type === "attack_resolved" && active.has(event.id));
}

export function battleUnusedWeaponCount(
  state,
  weaponSourceFormationId,
  sourceSavedUnitId,
  weaponGroupId,
) {
  const replayed = replayBattleState(state);
  const source = replayed.formations.get(weaponSourceFormationId);
  const group = source?.weaponInventory.find(
    (candidate) =>
      candidate.sourceSavedUnitId === sourceSavedUnitId && candidate.groupId === weaponGroupId,
  );
  if (!source || !group) return 0;
  const surviving = formationSurvivingWeaponCount(source, sourceSavedUnitId, weaponGroupId);
  if (surviving < 1) return 0;
  const active = new Set(replayed.activeAttackIds);
  const used = state.events
    .filter(
      (event) =>
        event.type === "attack_resolved" &&
        active.has(event.id) &&
        event.weaponType === "Ranged" &&
        event.weaponSourceFormationId === weaponSourceFormationId &&
        event.sourceSavedUnitId === sourceSavedUnitId &&
        event.weaponGroupId === weaponGroupId &&
        (state.version >= FIRE_OVERWATCH_BATTLE_STATE_VERSION && replayed.activeActivation
          ? event.activationEventId === replayed.activeActivation.id
          : sameBattleClock(event.clock, replayed.clock)),
    )
    .reduce((total, event) => total + event.declaredWeaponCount, 0);
  const resolvedDeclarationIds = new Set(
    state.events
      .filter(
        (event) =>
          event.type === "attack_resolved" &&
          active.has(event.id) &&
          event.activationEventId === replayed.activeActivation?.id,
      )
      .map((event) => event.targetEligibilityEventId),
  );
  const unresolvedDeclarations = [
    ...replayed.rangedDeclarationDraft,
    ...(replayed.activeRangedDeclarationSet?.declarations ?? []).filter(
      (declaration) => !resolvedDeclarationIds.has(declaration.id),
    ),
  ]
    .filter(
      (declaration) =>
        declaration.weaponSourceFormationId === weaponSourceFormationId &&
        declaration.sourceSavedUnitId === sourceSavedUnitId &&
        declaration.weaponGroupId === weaponGroupId,
    )
    .reduce((total, declaration) => total + declaration.declaredWeaponCount, 0);
  return Math.max(0, surviving - used - unresolvedDeclarations);
}

export function battleSurvivingWeaponCount(
  state,
  weaponSourceFormationId,
  sourceSavedUnitId,
  weaponGroupId,
) {
  const replayed = replayBattleState(state);
  const source = replayed.formations.get(weaponSourceFormationId);
  if (!source) return 0;
  return formationSurvivingWeaponCount(source, sourceSavedUnitId, weaponGroupId);
}
