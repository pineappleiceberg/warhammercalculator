"use client";

import { useState } from "react";
import { terrainClearanceInspectionExport } from "../../lib/terrain-clearance-facts.mjs";
import { visibilityInspectionExport } from "../../lib/visibility-facts.mjs";

type InspectionPoint = {
  centerXThousandths: number;
  centerYThousandths: number;
  elevationThousandths: number;
  rotationMilliDegrees: number;
};

type InspectionCheck = {
  sectionId: string;
  obstacleType: string;
  obstacleId: string;
  status: "clear" | "collision" | "unknown";
  reason: string;
};

type InspectionEnvelope = {
  geometryMode: string;
  shape: string;
  widthThousandths: number;
  depthThousandths: number;
  heightThousandths: number;
  centerOffsetXThousandths: number;
  centerOffsetYThousandths: number;
  convexVertices: Array<{ xOffsetThousandths: number; yOffsetThousandths: number }>;
};

type ModelInspection = {
  modelId: string;
  ready: boolean;
  status: "clear" | "collision" | "unknown";
  unavailableReason: string | null;
  recordedCheckCount: number;
  omittedCheckCount: number;
  envelope: InspectionEnvelope;
  path: InspectionPoint[];
  segments: Array<{
    pathSegmentIndex: number;
    mode: string;
    status: "clear" | "collision" | "unknown";
    start: InspectionPoint | null;
    end: InspectionPoint | null;
    checks: InspectionCheck[];
  }>;
  endpointSupport: {
    status: "clear" | "collision" | "unknown";
    reason: string;
    sectionId: string;
    obstacleId: string;
    point: InspectionPoint;
  } | null;
};

type ClearanceInspection = {
  schemaVersion: number;
  formationId: string;
  status: "clear" | "collision" | "unknown";
  executable: boolean;
  unavailableReasons: string[];
  traceComplete: boolean;
  recordedCheckCount: number;
  omittedCheckCount: number;
  models: ModelInspection[];
};

type TerrainVisibility = {
  sections: Array<{
    sectionId: string;
    panels: Array<{
      id: string;
      startXThousandths: number;
      startYThousandths: number;
      endXThousandths: number;
      endYThousandths: number;
      bottomZThousandths: number;
      topZThousandths: number;
    }>;
    surfaces?: Array<{
      id: string;
      vertices: Array<{ xThousandths: number; yThousandths: number }>;
      bottomZThousandths: number;
      topZThousandths: number;
    }>;
  }>;
};

type TerrainFootprints = {
  footprints: Array<{
    areaTerrainSectionId: string;
    centerXThousandths: number;
    centerYThousandths: number;
    widthThousandths: number;
    heightThousandths: number;
    rotationMilliDegrees: number;
  }>;
};

type VisibilityPoint = { x: number; y: number; z: number };

type VisibilityPair = {
  observerModelId: string;
  targetModelId: string;
  visible: boolean;
  fullVisibility: "fully_visible" | "not_fully_visible" | "unknown";
  inspection: {
    schemaVersion: number;
    observer: { modelId: string; point: InspectionPoint; envelope: InspectionEnvelope };
    target: { modelId: string; point: InspectionPoint; envelope: InspectionEnvelope };
    visibility: {
      status: "visible" | "unknown";
      testedRayCount: number;
      witnessRay: {
        start: VisibilityPoint;
        end: VisibilityPoint;
        clear: boolean;
        status: "clear" | "blocked" | "ambiguous";
        sectionId: string;
        obstacleType: string;
        obstacleId: string;
        reason: string;
      };
      blockerSummary: Array<{
        reason: string;
        sectionId: string;
        obstacleType: string;
        obstacleId: string;
        count: number;
      }>;
    };
    fullVisibility: {
      status: "fully_visible" | "not_fully_visible" | "unknown";
      reason: string;
      sectionId: string;
      obstacleType: string;
      obstacleId: string;
      observerPoint: VisibilityPoint | null;
      corridor: {
        minimumX: number;
        maximumX: number;
        minimumY: number;
        maximumY: number;
        minimumZ: number;
        maximumZ: number;
      } | null;
    };
  };
};

type VisibilityFacts = {
  executable: boolean;
  unavailableReasons: string[];
  modelPairs?: VisibilityPair[];
};

const reasonLabels: Record<string, string> = {
  continuous_rotation_clearance_unavailable: "Continuous pivot geometry is not executable",
  endpoint_inside_ruin_panel: "Endpoint intersects a Ruins wall panel",
  endpoint_inside_ruin_surface: "Endpoint intersects a Ruins solid",
  ground_endpoint: "Endpoint is supported by the battlefield",
  legacy_terrain_clearance_unavailable: "Legacy movement has no executable geometry proof",
  model_movement_geometry_unavailable: "The model envelope or path is incomplete",
  no_horizontal_overlap: "The swept envelope does not overlap this obstacle in plan view",
  path_crosses_terrain_panel: "The swept envelope intersects this wall panel",
  path_crosses_terrain_surface: "The swept envelope intersects this terrain solid",
  ruins_pass_through_keyword: "INFANTRY or BEAST can pass through this Ruins section",
  ruins_upper_floor_keyword_required:
    "This model lacks a keyword that permits ending on this floor",
  section_has_no_blocking_geometry: "This section has no blocking movement geometry",
  terrain_forbids_ending_on_top: "This terrain classification forbids ending on top",
  terrain_movement_rules_require_review: "This section still requires a player-reviewed ruling",
  terrain_two_inches_or_less: "This obstacle is no more than 2 inches high",
  unsupported_elevated_endpoint: "The whole model footprint is not supported at this elevation",
  vertical_clearance: "The whole envelope passes above or below this obstacle",
  whole_envelope_fits_opening: "The whole envelope fits through a recorded opening",
  whole_footprint_supported: "The whole model footprint is supported by this surface",
  area_terrain_could_obscure_target: "Area terrain overlaps the full-visibility corridor",
  full_visibility_witness_unavailable: "No conservative full-visibility witness is available",
  model_could_occlude_full_visibility: "Another model could obscure part of the target",
  model_could_occlude_ray: "Another model intersects this sampled sight ray",
  ruins_footprint_blocks_ray: "The ray crosses an intervening Ruins footprint",
  sampled_ray_clear: "This sampled sight ray is clear",
  target_corridor_clear: "The target envelope corridor is clear from this sight point",
  target_inside_woods: "A target within Woods is not fully visible",
  terrain_panel_blocks_ray: "A terrain panel blocks this sampled ray",
  terrain_panel_could_obscure_target: "A terrain panel overlaps the full-visibility corridor",
  terrain_panel_ray_ambiguous: "The ray touches a panel or opening boundary",
};

function reasonLabel(reason: string) {
  const [code, ...identity] = reason.split(":");
  const label = reasonLabels[code] ?? code.replaceAll("_", " ");
  return identity.length ? `${label} · ${identity.join(" · ")}` : label;
}

function inches(value: number) {
  return (value / 1000).toFixed(2).replace(/\.00$/, "");
}

function statusLabel(status: string) {
  if (status === "collision") return "Blocked";
  if (status === "clear") return "Proven clear";
  return "Needs review";
}

function rotatedPoint(x: number, y: number, milliDegrees: number) {
  const angle = (milliDegrees * Math.PI) / 180_000;
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  };
}

function envelopeCenter(envelope: InspectionEnvelope, point: InspectionPoint) {
  const offset = rotatedPoint(
    envelope.centerOffsetXThousandths,
    envelope.centerOffsetYThousandths,
    point.rotationMilliDegrees,
  );
  return {
    x: point.centerXThousandths + offset.x,
    y: point.centerYThousandths + offset.y,
  };
}

function modelEnvelope(envelope: InspectionEnvelope, point: InspectionPoint, status: string) {
  const center = envelopeCenter(envelope, point);
  if (envelope.geometryMode === "convex_prism" && envelope.convexVertices.length >= 3) {
    const points = envelope.convexVertices
      .map((vertex) =>
        rotatedPoint(
          vertex.xOffsetThousandths,
          vertex.yOffsetThousandths,
          point.rotationMilliDegrees,
        ),
      )
      .map((vertex) => `${center.x + vertex.x},${center.y + vertex.y}`)
      .join(" ");
    return <polygon className={`geometry-envelope geometry-${status}`} points={points} />;
  }
  if (envelope.shape === "rectangle") {
    return (
      <rect
        className={`geometry-envelope geometry-${status}`}
        height={envelope.depthThousandths}
        transform={`rotate(${point.rotationMilliDegrees / 1000} ${center.x} ${center.y})`}
        width={envelope.widthThousandths}
        x={center.x - envelope.widthThousandths / 2}
        y={center.y - envelope.depthThousandths / 2}
      />
    );
  }
  return (
    <ellipse
      className={`geometry-envelope geometry-${status}`}
      cx={center.x}
      cy={center.y}
      rx={envelope.widthThousandths / 2}
      ry={envelope.depthThousandths / 2}
      transform={`rotate(${point.rotationMilliDegrees / 1000} ${center.x} ${center.y})`}
    />
  );
}

function GeometryPlot({
  model,
  terrainVisibility,
  terrainFootprints,
}: {
  model: ModelInspection;
  terrainVisibility: TerrainVisibility;
  terrainFootprints: TerrainFootprints;
}) {
  const collisionIds = new Set([
    ...model.segments.flatMap((segment) =>
      segment.checks
        .filter((check) => check.status === "collision")
        .map((check) => `${check.sectionId}:${check.obstacleType}:${check.obstacleId}`),
    ),
    ...(model.endpointSupport?.status === "collision" && model.endpointSupport.obstacleId
      ? [`${model.endpointSupport.sectionId}:surface:${model.endpointSupport.obstacleId}`]
      : []),
  ]);
  const endpoint = model.path.at(-1);
  return (
    <svg
      aria-label={`Top-down terrain clearance inspection for ${model.modelId}`}
      className="geometry-plot"
      role="img"
      viewBox="0 0 60000 44000"
    >
      <rect className="geometry-table" height="44000" width="60000" x="0" y="0" />
      {terrainFootprints.footprints.map((footprint, index) => (
        <rect
          className="geometry-footprint"
          height={footprint.heightThousandths}
          key={`${footprint.areaTerrainSectionId}:${index}`}
          transform={`rotate(${footprint.rotationMilliDegrees / 1000} ${footprint.centerXThousandths} ${footprint.centerYThousandths})`}
          width={footprint.widthThousandths}
          x={footprint.centerXThousandths - footprint.widthThousandths / 2}
          y={footprint.centerYThousandths - footprint.heightThousandths / 2}
        />
      ))}
      {terrainVisibility.sections.flatMap((section) => [
        ...section.panels.map((panel) => (
          <line
            className={
              collisionIds.has(`${section.sectionId}:panel:${panel.id}`)
                ? "geometry-obstacle geometry-collision"
                : "geometry-obstacle"
            }
            key={`${section.sectionId}:panel:${panel.id}`}
            x1={panel.startXThousandths}
            x2={panel.endXThousandths}
            y1={panel.startYThousandths}
            y2={panel.endYThousandths}
          >
            <title>
              {panel.id} · {inches(panel.bottomZThousandths)}–{inches(panel.topZThousandths)} inches
            </title>
          </line>
        )),
        ...(section.surfaces ?? []).map((surface) => (
          <polygon
            className={
              collisionIds.has(`${section.sectionId}:surface:${surface.id}`)
                ? "geometry-surface geometry-collision"
                : "geometry-surface"
            }
            key={`${section.sectionId}:surface:${surface.id}`}
            points={surface.vertices
              .map((vertex) => `${vertex.xThousandths},${vertex.yThousandths}`)
              .join(" ")}
          >
            <title>
              {surface.id} · {inches(surface.bottomZThousandths)}–{inches(surface.topZThousandths)}{" "}
              inches
            </title>
          </polygon>
        )),
      ])}
      {model.path.length > 1 && (
        <polyline
          className={`geometry-path geometry-${model.status}`}
          points={model.path
            .map((point) => `${point.centerXThousandths},${point.centerYThousandths}`)
            .join(" ")}
        />
      )}
      {model.path[0] && modelEnvelope(model.envelope, model.path[0], "start")}
      {endpoint && modelEnvelope(model.envelope, endpoint, model.status)}
    </svg>
  );
}

function VisibilityPlot({
  pair,
  terrainVisibility,
  terrainFootprints,
}: {
  pair: VisibilityPair;
  terrainVisibility: TerrainVisibility;
  terrainFootprints: TerrainFootprints;
}) {
  const ray = pair.inspection.visibility.witnessRay;
  const blockerKey = `${ray.sectionId}:${ray.obstacleType}:${ray.obstacleId}`;
  const corridor = pair.inspection.fullVisibility.corridor;
  return (
    <svg
      aria-label={`Top-down visibility inspection from ${pair.observerModelId} to ${pair.targetModelId}`}
      className="geometry-plot"
      role="img"
      viewBox="0 0 60000 44000"
    >
      <rect className="geometry-table" height="44000" width="60000" x="0" y="0" />
      {terrainFootprints.footprints.map((footprint, index) => (
        <rect
          className={
            blockerKey ===
            `${footprint.areaTerrainSectionId}:area_terrain:${footprint.areaTerrainSectionId}`
              ? "geometry-footprint geometry-collision"
              : "geometry-footprint"
          }
          height={footprint.heightThousandths}
          key={`${footprint.areaTerrainSectionId}:${index}`}
          transform={`rotate(${footprint.rotationMilliDegrees / 1000} ${footprint.centerXThousandths} ${footprint.centerYThousandths})`}
          width={footprint.widthThousandths}
          x={footprint.centerXThousandths - footprint.widthThousandths / 2}
          y={footprint.centerYThousandths - footprint.heightThousandths / 2}
        />
      ))}
      {terrainVisibility.sections.flatMap((section) => [
        ...section.panels.map((panel) => (
          <line
            className={
              blockerKey === `${section.sectionId}:panel:${panel.id}`
                ? "geometry-obstacle geometry-collision"
                : "geometry-obstacle"
            }
            key={`${section.sectionId}:panel:${panel.id}`}
            x1={panel.startXThousandths}
            x2={panel.endXThousandths}
            y1={panel.startYThousandths}
            y2={panel.endYThousandths}
          />
        )),
        ...(section.surfaces ?? []).map((surface) => (
          <polygon
            className="geometry-surface"
            key={`${section.sectionId}:surface:${surface.id}`}
            points={surface.vertices
              .map((vertex) => `${vertex.xThousandths},${vertex.yThousandths}`)
              .join(" ")}
          />
        )),
      ])}
      {corridor && (
        <rect
          className="geometry-corridor"
          height={corridor.maximumY - corridor.minimumY}
          width={corridor.maximumX - corridor.minimumX}
          x={corridor.minimumX}
          y={corridor.minimumY}
        />
      )}
      <line
        className={`geometry-ray geometry-${ray.clear ? "clear" : "unknown"}`}
        x1={ray.start.x}
        x2={ray.end.x}
        y1={ray.start.y}
        y2={ray.end.y}
      />
      {modelEnvelope(pair.inspection.observer.envelope, pair.inspection.observer.point, "start")}
      {modelEnvelope(
        pair.inspection.target.envelope,
        pair.inspection.target.point,
        pair.visible ? "clear" : "unknown",
      )}
    </svg>
  );
}

export function GeometryInspector({
  inspections,
  terrainVisibility,
  terrainFootprints,
  visibilityFacts = null,
  observerFormationName = "Observer",
  targetFormationName = "Target",
}: {
  inspections: Array<{ formationName: string; inspection: ClearanceInspection }>;
  terrainVisibility: TerrainVisibility;
  terrainFootprints: TerrainFootprints;
  visibilityFacts?: VisibilityFacts | null;
  observerFormationName?: string;
  targetFormationName?: string;
}) {
  const [selectedFormationId, setSelectedFormationId] = useState(
    inspections[0]?.inspection.formationId ?? "",
  );
  const selectedFormation =
    inspections.find(({ inspection }) => inspection.formationId === selectedFormationId) ??
    inspections[0];
  const [selectedModelId, setSelectedModelId] = useState(
    selectedFormation?.inspection.models[0]?.modelId ?? "",
  );
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedPairId, setSelectedPairId] = useState(
    visibilityFacts?.modelPairs?.[0]
      ? `${visibilityFacts.modelPairs[0].observerModelId}:${visibilityFacts.modelPairs[0].targetModelId}`
      : "",
  );
  const [visibilityCopyStatus, setVisibilityCopyStatus] = useState("");
  const selectedModel =
    selectedFormation?.inspection.models.find((model) => model.modelId === selectedModelId) ??
    selectedFormation?.inspection.models[0];
  const selectedPair =
    visibilityFacts?.modelPairs?.find(
      (pair) => `${pair.observerModelId}:${pair.targetModelId}` === selectedPairId,
    ) ?? visibilityFacts?.modelPairs?.[0];
  if (inspections.length === 0 && !visibilityFacts) return null;
  return (
    <details className="geometry-inspector" data-testid="geometry-inspector">
      <summary>
        <strong>
          {inspections.length > 0 ? "Inspect movement geometry" : "Inspect line of sight"}
        </strong>
        <span>
          {inspections.length > 0
            ? "Paths, whole-model envelopes, terrain solids, and proof reasons"
            : "Model envelopes, sampled rays, blockers, and proof reasons"}
        </span>
      </summary>
      <div className="geometry-inspector-body">
        {inspections.length > 0 && (
          <>
            <div className="geometry-inspector-controls">
              <label>
                <span>Formation</span>
                <select
                  aria-label="Geometry inspection formation"
                  value={selectedFormation?.inspection.formationId}
                  onChange={(event) => {
                    const next = inspections.find(
                      ({ inspection }) => inspection.formationId === event.target.value,
                    );
                    setSelectedFormationId(event.target.value);
                    setSelectedModelId(next?.inspection.models[0]?.modelId ?? "");
                  }}
                >
                  {inspections.map(({ formationName, inspection }) => (
                    <option key={inspection.formationId} value={inspection.formationId}>
                      {formationName} · {statusLabel(inspection.status)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model</span>
                <select
                  aria-label="Geometry inspection model"
                  value={selectedModel?.modelId ?? ""}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  {selectedFormation?.inspection.models.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.modelId} · {statusLabel(model.status)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedFormation && (
                <span className={`geometry-status geometry-${selectedFormation.inspection.status}`}>
                  {statusLabel(selectedFormation.inspection.status)}
                </span>
              )}
              <button
                disabled={!selectedFormation}
                type="button"
                onClick={async () => {
                  if (!selectedFormation) return;
                  const payload = terrainClearanceInspectionExport({
                    formationName: selectedFormation.formationName,
                    fact: { inspection: selectedFormation.inspection },
                    terrainFootprints,
                    terrainVisibility,
                  });
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                    setCopyStatus("Proof JSON copied");
                  } catch {
                    setCopyStatus("Clipboard unavailable");
                  }
                }}
              >
                Copy proof JSON
              </button>
              {copyStatus && (
                <small aria-live="polite" className="geometry-copy-status">
                  {copyStatus}
                </small>
              )}
            </div>
            {selectedFormation &&
              !selectedFormation.inspection.executable &&
              selectedFormation.inspection.unavailableReasons.length > 0 && (
                <p className="geometry-review-reasons">
                  {selectedFormation.inspection.unavailableReasons.map(reasonLabel).join(" · ")}
                </p>
              )}
            {selectedFormation && !selectedFormation.inspection.traceComplete && (
              <p className="geometry-review-reasons">
                Inspection display limit reached · {selectedFormation.inspection.recordedCheckCount}{" "}
                checks shown · {selectedFormation.inspection.omittedCheckCount} additional checks
                omitted. The ruling still uses the complete calculation.
              </p>
            )}
            {selectedModel && (
              <div className="geometry-model">
                <GeometryPlot
                  model={selectedModel}
                  terrainFootprints={terrainFootprints}
                  terrainVisibility={terrainVisibility}
                />
                <div className="geometry-model-facts">
                  <span>
                    Envelope: {selectedModel.envelope.geometryMode.replaceAll("_", " ")} ·{" "}
                    {inches(selectedModel.envelope.widthThousandths)} ×{" "}
                    {inches(selectedModel.envelope.depthThousandths)} ×{" "}
                    {inches(selectedModel.envelope.heightThousandths)} inches
                  </span>
                  {selectedModel.omittedCheckCount > 0 && (
                    <span className="geometry-unknown">
                      This model has {selectedModel.recordedCheckCount} displayed checks and{" "}
                      {selectedModel.omittedCheckCount} omitted checks; the ruling still uses all
                      geometry.
                    </span>
                  )}
                  {selectedModel.segments.map((segment) => (
                    <details className="geometry-segment" key={segment.pathSegmentIndex}>
                      <summary>
                        Segment {segment.pathSegmentIndex + 1} · {statusLabel(segment.status)} ·{" "}
                        {segment.mode.replaceAll("_", " ")}
                      </summary>
                      {segment.start && segment.end && (
                        <small>
                          ({inches(segment.start.centerXThousandths)},{" "}
                          {inches(segment.start.centerYThousandths)},{" "}
                          {inches(segment.start.elevationThousandths)}) to (
                          {inches(segment.end.centerXThousandths)},{" "}
                          {inches(segment.end.centerYThousandths)},{" "}
                          {inches(segment.end.elevationThousandths)}) inches
                        </small>
                      )}
                      <ul>
                        {segment.checks.map((check, index) => (
                          <li
                            className={`geometry-${check.status}`}
                            key={`${check.sectionId}:${check.obstacleType}:${check.obstacleId}:${index}`}
                          >
                            <strong>{statusLabel(check.status)}</strong> ·{" "}
                            {check.sectionId || "geometry"}
                            {check.obstacleId ? ` / ${check.obstacleId}` : ""} ·{" "}
                            {reasonLabel(check.reason)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  {selectedModel.endpointSupport && (
                    <span className={`geometry-${selectedModel.endpointSupport.status}`}>
                      Endpoint: {statusLabel(selectedModel.endpointSupport.status)} ·{" "}
                      {reasonLabel(selectedModel.endpointSupport.reason)}
                      {selectedModel.endpointSupport.obstacleId
                        ? ` · ${selectedModel.endpointSupport.obstacleId}`
                        : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {visibilityFacts && (
          <div className="visibility-inspector" data-testid="visibility-inspector">
            <div className="visibility-inspector-heading">
              <div>
                <strong>Inspect line of sight</strong>
                <span>
                  {observerFormationName} to {targetFormationName}
                </span>
              </div>
              {selectedPair && (
                <select
                  aria-label="Visibility inspection model pair"
                  value={`${selectedPair.observerModelId}:${selectedPair.targetModelId}`}
                  onChange={(event) => setSelectedPairId(event.target.value)}
                >
                  {visibilityFacts.modelPairs?.map((pair) => (
                    <option
                      key={`${pair.observerModelId}:${pair.targetModelId}`}
                      value={`${pair.observerModelId}:${pair.targetModelId}`}
                    >
                      {pair.observerModelId} → {pair.targetModelId} ·{" "}
                      {pair.visible ? "visible" : "unknown"}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {!visibilityFacts.executable && visibilityFacts.unavailableReasons.length > 0 && (
              <p className="geometry-review-reasons">
                {visibilityFacts.unavailableReasons.join(" · ")}
              </p>
            )}
            {selectedPair && (
              <>
                <VisibilityPlot
                  pair={selectedPair}
                  terrainFootprints={terrainFootprints}
                  terrainVisibility={terrainVisibility}
                />
                <div className="geometry-model-facts">
                  <span>
                    Visibility: {selectedPair.visible ? "proven visible" : "unknown"} ·{" "}
                    {selectedPair.inspection.visibility.testedRayCount} sampled ray
                    {selectedPair.inspection.visibility.testedRayCount === 1 ? "" : "s"} tested ·{" "}
                    {reasonLabel(selectedPair.inspection.visibility.witnessRay.reason)}
                  </span>
                  {selectedPair.inspection.visibility.witnessRay.obstacleId && (
                    <span className="geometry-unknown">
                      First blocker:{" "}
                      {selectedPair.inspection.visibility.witnessRay.sectionId || "model"} /{" "}
                      {selectedPair.inspection.visibility.witnessRay.obstacleId}
                    </span>
                  )}
                  <span>
                    Full visibility: {selectedPair.fullVisibility.replaceAll("_", " ")} ·{" "}
                    {reasonLabel(selectedPair.inspection.fullVisibility.reason)}
                  </span>
                  {selectedPair.inspection.visibility.blockerSummary.length > 0 && (
                    <details className="geometry-segment">
                      <summary>Blocked-ray summary</summary>
                      <ul>
                        {selectedPair.inspection.visibility.blockerSummary.map((blocker) => (
                          <li
                            className="geometry-unknown"
                            key={`${blocker.reason}:${blocker.sectionId}:${blocker.obstacleType}:${blocker.obstacleId}`}
                          >
                            {blocker.count} ray{blocker.count === 1 ? "" : "s"} ·{" "}
                            {reasonLabel(blocker.reason)}
                            {blocker.obstacleId ? ` · ${blocker.obstacleId}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="geometry-copy-row">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const payload = visibilityInspectionExport({
                            observerFormationName,
                            targetFormationName,
                            pair: selectedPair,
                            terrainFootprints,
                            terrainVisibility,
                          });
                          await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                          setVisibilityCopyStatus("LOS proof JSON copied");
                        } catch {
                          setVisibilityCopyStatus("Clipboard unavailable");
                        }
                      }}
                    >
                      Copy LOS proof JSON
                    </button>
                    {visibilityCopyStatus && (
                      <small aria-live="polite">{visibilityCopyStatus}</small>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
