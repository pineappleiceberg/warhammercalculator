import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GOLDEN_BATTLE_REPLAY_SCHEMA,
  GOLDEN_BATTLE_REPLAY_SCHEMA_VERSION,
  goldenBattleReplaySummary,
  validateGoldenBattleReplay,
} from "../lib/golden-battle-replay.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/golden-battle-necrons-vs-space-marines-v1.json", import.meta.url),
    "utf8",
  ),
);
const sourceManifest = JSON.parse(
  await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("replays a source-locked real-catalogue pair through every battle phase and final score", async () => {
  const { replayed, summary } = await validateGoldenBattleReplay(fixture, sourceManifest);
  assert.equal(fixture.schema, GOLDEN_BATTLE_REPLAY_SCHEMA);
  assert.equal(fixture.schemaVersion, GOLDEN_BATTLE_REPLAY_SCHEMA_VERSION);
  assert.equal(fixture.stateDigest, digest(fixture.state));
  assert.equal(fixture.expectedDigest, digest(fixture.expected));
  assert.deepEqual(summary, goldenBattleReplaySummary(fixture.state));
  assert.equal(summary.eventTypeCounts.clock_advanced, 170);
  assert.equal(summary.phaseStepCoverage.length, 170);
  assert.equal(summary.scoringEventCount, 20);
  assert.deepEqual(
    summary.players.map((player) => player.missionPoints),
    [
      { primary: 20, secondary: 10, battle_ready: 10, total: 40 },
      { primary: 20, secondary: 10, battle_ready: 10, total: 40 },
    ],
  );
  assert.equal(summary.formations[0].deploymentLocation, "reserves");
  assert.equal(summary.formations[0].reserveDestroyed, true);
  assert.equal(summary.formations[1].deployed, true);
  assert.equal(
    replayed.ruleCoverage.report.results.every((result) => result.permitted),
    true,
  );
});

test("pins every golden replay source checksum to the authoritative manifest", () => {
  const manifestLocks = new Map(sourceManifest.sources.map((source) => [source.id, source.sha256]));
  const event = fixture.state.events.find(
    (candidate) => candidate.type === "rule_coverage_configured",
  );
  assert.ok(event);
  assert.deepEqual(
    [...event.coverage.sourceLocks].sort((left, right) => left.id.localeCompare(right.id)),
    fixture.expected.sourceLockIds.map((id) => ({ id, sha256: manifestLocks.get(id) })),
  );
});

test("rejects summary drift, source tampering, and non-canonical phase transitions", async () => {
  const stale = structuredClone(fixture);
  stale.expected.eventCount++;
  await assert.rejects(() => validateGoldenBattleReplay(stale, sourceManifest), /expected digest/i);

  const unlocked = structuredClone(fixture);
  unlocked.state.events.find(
    (event) => event.type === "rule_coverage_configured",
  ).coverage.sourceLocks[0].sha256 = "0".repeat(64);
  unlocked.stateDigest = digest(unlocked.state);
  await assert.rejects(
    () => validateGoldenBattleReplay(unlocked, sourceManifest),
    /authoritative manifest/i,
  );

  const divergent = structuredClone(fixture);
  const advance = divergent.state.events.find((event) => event.type === "clock_advanced");
  advance.to.step = "end";
  divergent.stateDigest = digest(divergent.state);
  await assert.rejects(
    () => validateGoldenBattleReplay(divergent, sourceManifest),
    /not canonical/i,
  );
});
