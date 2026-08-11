import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chapterApprovedTableBinding,
  normalizeMissionPackCatalogue,
  validateMissionTerrainSelection,
} from "../lib/mission-pack.mjs";

const sourceText = await readFile(
  new URL("../../data/chapter-approved-2025-26-v1.4.json", import.meta.url),
  "utf8",
);
const publishedText = await readFile(
  new URL("../public/chapter-approved-2025-26-v1.4.json", import.meta.url),
  "utf8",
);
const source = JSON.parse(sourceText);
const published = JSON.parse(publishedText);

test("published Chapter Approved catalogue exactly matches the checked source data", () => {
  assert.equal(publishedText, sourceText);
  assert.deepEqual(published, source);
  const pack = normalizeMissionPackCatalogue(source);
  assert.equal(pack.id, "chapter-approved-2025-26-v1.4");
  assert.equal(pack.edition, "Warhammer 40,000 10th Edition");
  assert.equal(pack.version, "1.4");
  assert.equal(pack.missions.length, 20);
  assert.equal(pack.terrainLayouts.length, 8);
  assert.deepEqual(
    pack.missions.map((mission) => mission.code),
    [..."ABCDEFGHIJKLMNOPQRST"],
  );
  assert.deepEqual(pack.missions[0], {
    id: "chapter-approved-2025-26-v1.4-a",
    code: "A",
    primaryMission: "Take and Hold",
    deployment: "Tipping Point",
    terrainLayoutIds: [
      "chapter-approved-2025-26-v1.4-layout-1",
      "chapter-approved-2025-26-v1.4-layout-2",
      "chapter-approved-2025-26-v1.4-layout-4",
      "chapter-approved-2025-26-v1.4-layout-6",
      "chapter-approved-2025-26-v1.4-layout-7",
      "chapter-approved-2025-26-v1.4-layout-8",
    ],
    sourcePage: 6,
  });
});

test("mission and terrain selection accepts only source-compatible pairs", () => {
  const compatible = validateMissionTerrainSelection(
    source,
    "chapter-approved-2025-26-v1.4-a",
    "chapter-approved-2025-26-v1.4-layout-1",
  );
  assert.equal(compatible.mission.primaryMission, "Take and Hold");
  assert.equal(compatible.terrain.number, 1);
  assert.throws(
    () =>
      validateMissionTerrainSelection(
        source,
        "chapter-approved-2025-26-v1.4-a",
        "chapter-approved-2025-26-v1.4-layout-5",
      ),
    /not source-compatible/,
  );
  assert.throws(
    () => validateMissionTerrainSelection(source, "unknown", "unknown"),
    /outside the source-locked mission pack/,
  );
});

test("runtime table bindings exactly match every published mission compatibility", () => {
  for (const mission of source.missions) {
    for (const terrain of source.terrainLayouts) {
      const binding = chapterApprovedTableBinding(mission.id, terrain.id);
      assert.equal(Boolean(binding), mission.terrainLayoutIds.includes(terrain.id));
      if (binding) assert.equal(binding.deploymentName, mission.deployment);
    }
  }
  assert.equal(chapterApprovedTableBinding("unknown", "unknown"), null);
});

test("mission catalogue rejects altered compatibility and duplicate identities", () => {
  const incompatible = structuredClone(source);
  incompatible.missions[0].terrainLayoutIds.push("unknown");
  assert.throws(() => normalizeMissionPackCatalogue(incompatible), /compatibility/);

  const duplicate = structuredClone(source);
  duplicate.missions[1].id = duplicate.missions[0].id;
  assert.throws(() => normalizeMissionPackCatalogue(duplicate), /unique/);
});
