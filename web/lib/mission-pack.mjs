export const MISSION_PACK_SCHEMA_VERSION = 1;

const ID = /^[a-z0-9][a-z0-9.-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function string(value, message, maximum = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(message);
  }
  return value.trim();
}

function id(value, message) {
  const normalized = string(value, message, 200);
  if (!ID.test(normalized)) throw new Error(message);
  return normalized;
}

function pages(value, allowed, message) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((page) => !Number.isInteger(page) || !allowed.has(page))
  ) {
    throw new Error(message);
  }
  return [...new Set(value)];
}

export function normalizeMissionPackCatalogue(value) {
  const body = object(value, "Mission pack catalogue must be an object");
  if (body.schemaVersion !== MISSION_PACK_SCHEMA_VERSION) {
    throw new Error("Mission pack catalogue schema is unsupported");
  }
  const source = object(body.source, "Mission pack source is required");
  const sourcePages = pages(
    source.pages,
    new Set(source.pages),
    "Mission pack source pages are invalid",
  );
  const sourceSha256 = string(source.sha256, "Mission pack source checksum is required", 64);
  if (!SHA256.test(sourceSha256)) throw new Error("Mission pack source checksum is invalid");
  const normalizedSource = {
    id: id(source.id, "Mission pack source id is invalid"),
    title: string(source.title, "Mission pack source title is required"),
    url: string(source.url, "Mission pack source URL is required", 1000),
    retrievedAt: string(source.retrievedAt, "Mission pack retrieval date is required", 10),
    sha256: sourceSha256,
    pages: sourcePages,
  };
  if (!/^https:\/\//.test(normalizedSource.url))
    throw new Error("Mission pack source URL is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedSource.retrievedAt)) {
    throw new Error("Mission pack retrieval date is invalid");
  }
  if (!Array.isArray(body.terrainLayouts) || body.terrainLayouts.length !== 8) {
    throw new Error("Mission pack must contain the eight source terrain layouts");
  }
  const terrainLayouts = body.terrainLayouts.map((candidate) => {
    const layout = object(candidate, "Each terrain layout must be an object");
    if (!Number.isInteger(layout.number) || layout.number < 1 || layout.number > 8) {
      throw new Error("Terrain layout number is invalid");
    }
    return {
      id: id(layout.id, "Terrain layout id is invalid"),
      number: layout.number,
      name: string(layout.name, "Terrain layout name is required"),
      sourcePages: pages(
        layout.sourcePages,
        new Set(sourcePages),
        "Terrain layout source pages are invalid",
      ),
    };
  });
  if (
    new Set(terrainLayouts.map((layout) => layout.id)).size !== terrainLayouts.length ||
    new Set(terrainLayouts.map((layout) => layout.number)).size !== terrainLayouts.length
  ) {
    throw new Error("Terrain layout identities must be unique");
  }
  const layoutsById = new Map(terrainLayouts.map((layout) => [layout.id, layout]));
  if (!Array.isArray(body.missions) || body.missions.length !== 20) {
    throw new Error("Mission pack must contain the twenty source mission combinations");
  }
  const missions = body.missions.map((candidate) => {
    const mission = object(candidate, "Each mission must be an object");
    const code = string(mission.code, "Mission code is required", 1);
    if (!/^[A-T]$/.test(code)) throw new Error("Mission code is invalid");
    if (
      !Array.isArray(mission.terrainLayoutIds) ||
      mission.terrainLayoutIds.length === 0 ||
      mission.terrainLayoutIds.some((layoutId) => !layoutsById.has(layoutId)) ||
      new Set(mission.terrainLayoutIds).size !== mission.terrainLayoutIds.length
    ) {
      throw new Error(`Mission ${code} terrain compatibility is invalid`);
    }
    if (!sourcePages.includes(mission.sourcePage)) {
      throw new Error(`Mission ${code} source page is invalid`);
    }
    return {
      id: id(mission.id, `Mission ${code} id is invalid`),
      code,
      primaryMission: string(mission.primaryMission, `Mission ${code} primary mission is required`),
      deployment: string(mission.deployment, `Mission ${code} deployment is required`),
      terrainLayoutIds: [...mission.terrainLayoutIds],
      sourcePage: mission.sourcePage,
    };
  });
  if (
    new Set(missions.map((mission) => mission.id)).size !== missions.length ||
    new Set(missions.map((mission) => mission.code)).size !== missions.length
  ) {
    throw new Error("Mission identities must be unique");
  }
  if (
    terrainLayouts.some(
      (layout) => !missions.some((mission) => mission.terrainLayoutIds.includes(layout.id)),
    )
  ) {
    throw new Error("Every terrain layout must be compatible with at least one mission");
  }
  return {
    schemaVersion: MISSION_PACK_SCHEMA_VERSION,
    id: id(body.id, "Mission pack id is invalid"),
    name: string(body.name, "Mission pack name is required"),
    edition: string(body.edition, "Mission pack edition is required"),
    version: string(body.version, "Mission pack version is required", 50),
    source: normalizedSource,
    missions,
    terrainLayouts,
  };
}

export async function loadMissionPackCatalogue() {
  const publicRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
  const response = await fetch(new URL("chapter-approved-2025-26-v1.4.json", publicRoot));
  if (!response.ok) throw new Error("Mission pack catalogue is unavailable");
  return normalizeMissionPackCatalogue(await response.json());
}

export function validateMissionTerrainSelection(catalogueValue, missionId, terrainLayoutId) {
  const catalogue = normalizeMissionPackCatalogue(catalogueValue);
  const mission = catalogue.missions.find((entry) => entry.id === missionId);
  if (!mission) throw new Error("Selected mission is outside the source-locked mission pack");
  const terrain = catalogue.terrainLayouts.find((entry) => entry.id === terrainLayoutId);
  if (!terrain) throw new Error("Selected terrain is outside the source-locked mission pack");
  if (!mission.terrainLayoutIds.includes(terrain.id)) {
    throw new Error(`${terrain.name} is not source-compatible with mission ${mission.code}`);
  }
  return { mission, terrain };
}
