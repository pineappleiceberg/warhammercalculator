import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { missionTrackerFacts } from "../lib/battle-state.mjs";

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
const actionFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/golden-battle-action-necrons-vs-space-marines-v1.json", import.meta.url),
    "utf8",
  ),
);
const attachedFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/golden-battle-attached-aeldari-vs-orks-v1.json", import.meta.url),
    "utf8",
  ),
);
const shadowFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/golden-battle-tyranids-vs-space-marines-v1.json", import.meta.url),
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
  for (const candidateFixture of [fixture, actionFixture, attachedFixture, shadowFixture]) {
    const event = candidateFixture.state.events.find(
      (candidate) => candidate.type === "rule_coverage_configured",
    );
    assert.ok(event);
    assert.deepEqual(
      [...event.coverage.sourceLocks].sort((left, right) => left.id.localeCompare(right.id)),
      candidateFixture.expected.sourceLockIds.map((id) => ({
        id,
        sha256: manifestLocks.get(id),
      })),
    );
  }
});

test("replays a complete source-locked Shadow in the Warp battle", async () => {
  const { replayed, summary } = await validateGoldenBattleReplay(shadowFixture, sourceManifest);
  assert.equal(shadowFixture.stateDigest, digest(shadowFixture.state));
  assert.equal(shadowFixture.expectedDigest, digest(shadowFixture.expected));
  assert.equal(summary.phaseStepCoverage.length, 170);
  assert.equal(summary.eventTypeCounts.shadow_in_the_warp_unleashed, 1);
  assert.equal(summary.eventTypeCounts.shadow_in_the_warp_test_resolved, 1);
  assert.equal(replayed.shadowInTheWarpActivations.length, 1);
  assert.deepEqual(replayed.shadowInTheWarpResolutions[0].dice, [6, 5]);
  assert.equal(replayed.shadowInTheWarpResolutions[0].failed, true);
  assert.equal(replayed.battleShockedFormations.has("player-2:shadow-intercessors"), false);
  assert.equal(replayed.ruleCoverage.plan.players[0].faction.sourceId, "TYR");
});

test("replays attached Leaders, mixed profiles, a Mission Action, and Strategic Reserves", async () => {
  const { replayed, summary } = await validateGoldenBattleReplay(attachedFixture, sourceManifest);
  assert.equal(attachedFixture.stateDigest, digest(attachedFixture.state));
  assert.equal(attachedFixture.expectedDigest, digest(attachedFixture.expected));
  assert.equal(summary.phaseStepCoverage.length, 170);
  assert.equal(summary.eventTypeCounts.mission_action_started, 1);
  assert.equal(summary.eventTypeCounts.mission_action_completed, 1);
  assert.equal(summary.eventTypeCounts.reserve_arrived, 1);
  assert.equal(summary.eventTypeCounts.attack_resolved, 2);
  assert.equal(summary.eventTypeCounts.waaagh_called, 1);
  assert.equal(replayed.waaaghCallsByPlayer.get("player-2").sourceRuleId, "faction.catalogue-ork");
  assert.equal(replayed.activeWaaaghPlayerIds.size, 0);
  assert.deepEqual(
    replayed.ruleCoverage.plan.players.map((player) => ({
      faction: player.faction.sourceId,
      detachment: player.detachment.sourceId,
    })),
    [
      { faction: "AE", detachment: "000001020" },
      { faction: "ORK", detachment: "000000856" },
    ],
  );

  const guardians = summary.formations.find((formation) => formation.id === "player-1:guardians");
  const rangers = summary.formations.find((formation) => formation.id === "player-1:rangers");
  assert.deepEqual(guardians.health, {
    "guardians:363:loadout:1": { modelsRemaining: 0, woundsLost: 0 },
    "guardians:364:loadout:1": { modelsRemaining: 0, woundsLost: 0 },
    "farseer:357:loadout:1": { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.equal(guardians.destroyed, false);
  assert.equal(rangers.deploymentLocation, "strategic_reserves");
  assert.equal(rangers.deployed, true);
  assert.equal(rangers.offBattlefield, false);

  const attacks = attachedFixture.state.events.filter((event) => event.type === "attack_resolved");
  assert.deepEqual(
    attacks.map((event) => ({
      weapon: event.summary.weapon,
      damage: event.summary.damage,
      destroyed: event.summary.modelsDestroyed,
      remaining: event.allocations.map((allocation) => [
        allocation.segmentId,
        allocation.after.modelsRemaining,
        allocation.after.woundsLost,
      ]),
    })),
    [
      {
        weapon: "Slugga",
        damage: 9,
        destroyed: 9,
        remaining: [
          ["guardians:363:loadout:1", 1, 0],
          ["guardians:364:loadout:1", 1, 0],
          ["farseer:357:loadout:1", 1, 0],
        ],
      },
      {
        weapon: "Rokkit launcha",
        damage: 3,
        destroyed: 2,
        remaining: [
          ["guardians:363:loadout:1", 0, 0],
          ["guardians:364:loadout:1", 0, 0],
          ["farseer:357:loadout:1", 1, 0],
        ],
      },
    ],
  );
  assert.equal(replayed.completedMissionActions.length, 1);
  assert.equal(replayed.secondaryCardPoints.get("player-1:player-1:tactical:action"), 5);
  assert.equal(missionTrackerFacts(attachedFixture.state, "player-1").valid, true);
  assert.equal(missionTrackerFacts(attachedFixture.state, "player-2").valid, true);
});

test("replays source-locked movement, reactions, combat, casualties, objectives, and Tactical cards", async () => {
  const { replayed, summary } = await validateGoldenBattleReplay(actionFixture, sourceManifest);
  assert.equal(actionFixture.stateDigest, digest(actionFixture.state));
  assert.equal(actionFixture.expectedDigest, digest(actionFixture.expected));
  assert.equal(summary.phaseStepCoverage.length, 170);
  assert.deepEqual(
    {
      movementStarted: summary.eventTypeCounts.movement_started,
      positionsRecorded: summary.eventTypeCounts.model_positions_recorded,
      overwatchStarted: summary.eventTypeCounts.fire_overwatch_started,
      goToGround: summary.eventTypeCounts.go_to_ground_resolved,
      attacks: summary.eventTypeCounts.attack_resolved,
      charges: summary.eventTypeCounts.charge_recorded,
      fightMoves: summary.eventTypeCounts.fight_move_recorded,
      objectiveChanges: summary.eventTypeCounts.objective_control_changed,
      tacticalDraws: summary.eventTypeCounts.secondary_card_drawn,
      tacticalScores: summary.eventTypeCounts.secondary_card_scored,
    },
    {
      movementStarted: 1,
      positionsRecorded: 6,
      overwatchStarted: 1,
      goToGround: 1,
      attacks: 4,
      charges: 1,
      fightMoves: 4,
      objectiveChanges: 3,
      tacticalDraws: 2,
      tacticalScores: 1,
    },
  );
  assert.deepEqual(
    summary.formations.map(({ id, health }) => ({ id, health })),
    [
      {
        id: "player-1:doomstalker",
        health: { "doomstalker:961:loadout:1": { modelsRemaining: 1, woundsLost: 0 } },
      },
      {
        id: "player-2:intercessors",
        health: { "intercessors:728:loadout:1": { modelsRemaining: 2, woundsLost: 0 } },
      },
    ],
  );
  assert.equal(replayed.activeAttackIds.length, 4);
  assert.equal(summary.eventTypeCounts.reanimation_protocols_activated, 5);
  assert.equal(summary.eventTypeCounts.reanimation_wound_resolved, 1);
  assert.equal(summary.eventTypeCounts.grim_resolve_selected, 5);
  assert.deepEqual(
    actionFixture.state.events
      .filter((event) => event.type === "grim_resolve_selected")
      .map((event) => ({
        playerId: event.playerId,
        formationId: event.formationId,
        sourceDetachmentId: event.sourceDetachmentId,
        sourceAbilityId: event.sourceAbilityId,
      })),
    Array.from({ length: 5 }, () => ({
      playerId: "player-2",
      formationId: "player-2:intercessors",
      sourceDetachmentId: "000000834",
      sourceAbilityId: "000008770",
    })),
  );
  assert.equal(
    replayed.ruleCoverage.plan.players.find((player) => player.playerId === "player-2").detachment
      .sourceId,
    "000000834",
  );
  assert.equal(replayed.objectives.get("objective-3").controllerPlayerId, "player-2");
  assert.equal(replayed.secondaryCardPoints.get("player-1:player-1:tactical:hold"), 5);
  assert.deepEqual([...replayed.secondaryDiscardedCardIds.get("player-1")].sort(), [
    "player-1:tactical:hold",
    "player-1:tactical:pressure",
  ]);
  assert.deepEqual(
    summary.players.map((player) => player.missionPoints),
    [
      { primary: 0, secondary: 5, battle_ready: 10, total: 15 },
      { primary: 0, secondary: 0, battle_ready: 10, total: 10 },
    ],
  );
  assert.equal(missionTrackerFacts(actionFixture.state, "player-1").valid, true);
  assert.equal(missionTrackerFacts(actionFixture.state, "player-2").valid, true);
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
