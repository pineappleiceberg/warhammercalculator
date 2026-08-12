const EPSILON = 0.001;

export const TERRAIN_VISIBILITY_FEATURES = Object.freeze(["ruins", "woods", "other"]);
export const TERRAIN_VISIBILITY_METHODS = Object.freeze(["manual", "uwb", "camera", "imported"]);
export const TERRAIN_VISIBILITY_LIMITS = Object.freeze({
  maximumSections: 24,
  maximumPanels: 256,
  maximumOpeningsPerPanel: 32,
  maximumSightPointsPerModel: 16,
  maximumCoordinateThousandths: 100_000,
  maximumHeightThousandths: 30_000,
});

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function rotate(x, y, milliDegrees) {
  const angle = (milliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function inverseRotate(x, y, milliDegrees) {
  return rotate(x, y, (180_000 - milliDegrees) % 180_000);
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
      silhouette.sightPointsReviewed === true,
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

function ruinBlocksRay(start, end, observer, sections, terrainFootprints, exempt) {
  if (exempt) return false;
  return sections.some((section) => {
    if (section.featureType !== "ruins") return false;
    if (
      pointInsideSection(end, section, terrainFootprints) ||
      modelInsideSection(observer, section, terrainFootprints)
    ) {
      return false;
    }
    return sectionFootprints(section, terrainFootprints).some((footprint) =>
      segmentIntersectsFootprintInterior(start, end, footprint),
    );
  });
}

function rayIsClear(
  start,
  end,
  observer,
  sections,
  terrainFootprints,
  blockingModels,
  exemptFromAreaTerrain,
) {
  if (ruinBlocksRay(start, end, observer, sections, terrainFootprints, exemptFromAreaTerrain))
    return false;
  for (const section of sections) {
    for (const panel of section.panels) {
      if (panelIntersection(start, end, panel) !== "clear") return false;
    }
  }
  return blockingModels.every((model) => !segmentIntersectsBox(start, end, silhouetteBox(model)));
}

function modelPairFullyVisible(
  observer,
  target,
  sections,
  terrainFootprints,
  blockingModels,
  exemptFromAreaTerrain,
) {
  if (
    sections.some(
      (section) =>
        section.featureType === "woods" && modelInsideSection(target, section, terrainFootprints),
    )
  ) {
    return "not_fully_visible";
  }
  const corridor = corridorBox(silhouetteBox(observer), silhouetteBox(target));
  if (blockingModels.some((model) => boxesOverlap(corridor, silhouetteBox(model))))
    return "unknown";
  for (const section of sections) {
    if (section.panels.some((panel) => boxesOverlap(corridor, panelBox(panel)))) return "unknown";
    if (exemptFromAreaTerrain) continue;
    const observerInside = modelInsideSection(observer, section, terrainFootprints);
    const targetInside = modelInsideSection(target, section, terrainFootprints);
    if (section.featureType === "ruins" && !observerInside && !targetInside) {
      if (
        sectionFootprints(section, terrainFootprints).some((footprint) =>
          boxesOverlap(corridor, footprintBox(footprint)),
        )
      ) {
        return "unknown";
      }
    }
    if (section.featureType === "woods") {
      if (
        sectionFootprints(section, terrainFootprints).some((footprint) =>
          boxesOverlap(corridor, footprintBox(footprint)),
        )
      ) {
        return "unknown";
      }
    }
  }
  return "fully_visible";
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
          const visible = sightPoints(observer).some((start) =>
            sightPoints(target).some((end) =>
              rayIsClear(start, end, observer, sections, terrainFootprints, blockingModels, exempt),
            ),
          );
          const fullVisibility = modelPairFullyVisible(
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
            fullVisibility,
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
  const panelIds = new Set();
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
  }
  return (
    panelCount <= TERRAIN_VISIBILITY_LIMITS.maximumPanels &&
    (!set.allFeaturesRecorded || set.sections.every((section) => section.geometryComplete))
  );
}

export { silhouetteReady };
