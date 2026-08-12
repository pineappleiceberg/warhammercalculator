import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessRuleCoverage,
  normalizeRuleCoverageMatrix,
  ruleCoverageIsPermitted,
} from "../lib/rule-coverage.mjs";
import {
  battleRuleSelectionIds,
  bindBattleRuleSelections,
  deriveBattleRuleSelectionPlan,
  verifyBattleRuleCoverageBinding,
} from "../lib/battle-rule-selection.mjs";

const sourceManifest = JSON.parse(
  await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
);
const coverageSource = JSON.parse(
  await readFile(new URL("../../data/battle-rule-coverage.json", import.meta.url), "utf8"),
);
const publicCoverageSource = JSON.parse(
  await readFile(new URL("../public/battle-rule-coverage.json", import.meta.url), "utf8"),
);
const publicSourceManifest = JSON.parse(
  await readFile(new URL("../public/battle-rule-sources.json", import.meta.url), "utf8"),
);

test("published coverage matrix is source-locked and identical to its data source", () => {
  assert.deepEqual(publicCoverageSource, coverageSource);
  assert.deepEqual(publicSourceManifest, sourceManifest);
  const matrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);
  assert.equal(matrix.sourceLocked, true);
  assert.equal(
    matrix.snapshotId,
    "wh40k-10e-core-2025-10-army-rules-2026-06-13-chapter-approved-v1-4-necrons-faq-v1-2-tyranids-v1-v45",
  );
  assert.equal(matrix.rules.length, 2974);
  assert.deepEqual(
    new Set(matrix.rules.map((rule) => rule.category)),
    new Set([
      "core",
      "stratagem",
      "faction",
      "detachment",
      "enhancement",
      "datasheet",
      "mission",
      "terrain",
    ]),
  );
  assert.deepEqual(
    matrix.rules.find((rule) => rule.id === "faction.catalogue-nec"),
    {
      id: "faction.catalogue-nec",
      category: "faction",
      name: "Necrons faction rules",
      status: "guided",
      introducedBattleStateVersion: 24,
      sources: [
        {
          id: "wahapedia-profile-export-2026-06-13",
          records: [{ type: "faction", id: "NEC" }],
        },
      ],
    },
  );
  assert.equal(matrix.rules.find((rule) => rule.id === "faction.catalogue-sm")?.status, "guided");
  assert.deepEqual(
    matrix.rules.find((rule) => rule.id === "faction.oath-of-moment"),
    {
      id: "faction.oath-of-moment",
      category: "faction",
      name: "Oath of Moment",
      status: "executable",
      introducedBattleStateVersion: 42,
      sources: [
        {
          id: "wahapedia-profile-export-2026-06-13",
          records: [{ type: "faction", id: "SM:ability:000008350" }],
        },
      ],
    },
  );
  assert.deepEqual(
    matrix.rules.find((rule) => rule.id === "faction.reanimation-protocols"),
    {
      id: "faction.reanimation-protocols",
      category: "faction",
      name: "Reanimation Protocols",
      status: "executable",
      introducedBattleStateVersion: 43,
      sources: [
        {
          id: "wahapedia-profile-export-2026-06-13",
          records: [{ type: "faction", id: "NEC:ability:000008369" }],
        },
        { id: "codex-necrons-faq-v1.2", pages: [2] },
      ],
    },
  );
  for (const [id, name, abilityId] of [
    ["faction.shadow-in-the-warp", "Shadow in the Warp", "000000707"],
    ["faction.synapse-battle-shock", "Synapse Battle-shock", "000000705"],
  ]) {
    assert.deepEqual(
      matrix.rules.find((rule) => rule.id === id),
      {
        id,
        category: "faction",
        name,
        status: "executable",
        introducedBattleStateVersion: 44,
        sources: [
          {
            id: "wahapedia-profile-export-2026-06-13",
            records: [{ type: "faction", id: `TYR:ability:${abilityId}` }],
          },
          { id: "core-rules-10e", pages: [11, 12] },
          { id: "tyranids-faction-pack-v1.0", pages: [19, 21] },
        ],
      },
    );
  }
  assert.equal(
    matrix.rules.find((rule) => rule.id === "datasheet.catalogue-000000545")?.name,
    "Doom Scythe datasheet rules",
  );
  assert.equal(
    matrix.rules.find((rule) => rule.id === "detachment.catalogue-000000818")?.name,
    "Hypercrypt Legion detachment rules",
  );
  assert.equal(
    matrix.rules.find((rule) => rule.id === "enhancement.catalogue-000008554003")?.name,
    "Arisen Tyrant enhancement rules",
  );
});

test("coverage matrix rejects stale source hashes and pages outside the manifest", () => {
  const stale = structuredClone(coverageSource);
  stale.sourceLocks[0].sha256 = "0".repeat(64);
  assert.throws(() => normalizeRuleCoverageMatrix(stale, sourceManifest), /does not match/);

  const badPage = structuredClone(coverageSource);
  badPage.rules[0].sources[0].pages.push(999);
  assert.throws(() => normalizeRuleCoverageMatrix(badPage, sourceManifest), /outside/);

  const badRecord = structuredClone(coverageSource);
  badRecord.rules.find((rule) => rule.id === "faction.catalogue-nec").sources[0].records[0].type =
    "datasheet";
  assert.throws(() => normalizeRuleCoverageMatrix(badRecord, sourceManifest), /outside/);
});

test("saved list identities select exact guided catalogue rules", () => {
  const matrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);
  const players = [{ id: "player-1" }, { id: "player-2" }];
  const lists = [
    { factionId: "NEC", units: [{ id: "doom", unitId: "000000545" }] },
    { factionId: "SM", units: [{ id: "brutalis", unitId: "000000136" }] },
  ];
  const plan = deriveBattleRuleSelectionPlan(matrix, players, lists, {
    guidedReason: "Players will resolve non-executable source rules at the physical table",
    players: {
      "player-1": {
        detachmentSourceId: "000000818",
        enhancementSourceIds: ["000008554003"],
      },
      "player-2": { detachmentSourceId: "000000750" },
    },
    missionSourceId: "chapter-approved-2025-26-v1.4-a",
    terrainSourceId: "chapter-approved-2025-26-v1.4-layout-1",
  });
  assert.deepEqual(plan.players[0].faction.ruleIds, [
    "faction.catalogue-nec",
    "faction.reanimation-protocols",
  ]);
  assert.deepEqual(plan.players[1].faction.ruleIds, [
    "faction.catalogue-sm",
    "faction.oath-of-moment",
  ]);
  assert.deepEqual(plan.players[0].datasheets[0].ruleIds, ["datasheet.catalogue-000000545"]);
  assert.deepEqual(plan.players[0].detachment.ruleIds, ["detachment.catalogue-000000818"]);
  assert.deepEqual(plan.players[0].enhancements.ruleIds, ["enhancement.catalogue-000008554003"]);
  assert.deepEqual(plan.mission.ruleIds, ["mission.catalogue-chapter-approved-2025-26-v1-4-a"]);
  assert.deepEqual(plan.terrain.ruleIds, [
    "terrain.catalogue-chapter-approved-2025-26-v1-4-layout-1",
  ]);
  assert.match(plan.acknowledgements["faction.catalogue-nec"], /physical table/);
  assert.match(plan.acknowledgements["datasheet.catalogue-000000545"], /physical table/);
  const binding = bindBattleRuleSelections(matrix, plan);
  assert.equal(
    binding.report.results.find((result) => result.id === "faction.catalogue-nec")?.permitted,
    true,
  );
  assert.equal(binding.report.permitted, true);
});

test("coverage gate requires acknowledgement for guided rules and fails closed", () => {
  const matrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);
  const report = assessRuleCoverage(matrix, [
    "core.attack-sequence",
    { id: "core.charge-resolution", acknowledgement: "Players will review the measured move" },
    "faction.necrons-reanimation-protocols",
  ]);
  assert.equal(report.permitted, false);
  assert.deepEqual(
    report.results.map(({ status, permitted, sourceLocked }) => ({
      status,
      permitted,
      sourceLocked,
    })),
    [
      { status: "executable", permitted: true, sourceLocked: true },
      { status: "guided", permitted: true, sourceLocked: true },
      { status: "unsupported", permitted: false, sourceLocked: false },
    ],
  );
  assert.equal(assessRuleCoverage(matrix, ["core.charge-resolution"]).permitted, false);
});

test("coverage status predicate rejects unlocked, unsupported, and unknown statuses", () => {
  assert.equal(ruleCoverageIsPermitted("executable", true), true);
  assert.equal(ruleCoverageIsPermitted("irrelevant", true), true);
  assert.equal(ruleCoverageIsPermitted("guided", true, "reviewed at table"), true);
  assert.equal(ruleCoverageIsPermitted("guided", true), false);
  assert.equal(ruleCoverageIsPermitted("unsupported", true, "ignored"), false);
  assert.equal(ruleCoverageIsPermitted("executable", false), false);
  assert.equal(ruleCoverageIsPermitted(99, true), false);
});

test("battle bindings capture every exact selection and fail closed on omitted categories", () => {
  const matrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);
  const players = [{ id: "player-1" }, { id: "player-2" }];
  const lists = [
    { factionId: "NEC", units: [{ id: "doom", unitId: "000000001" }] },
    { factionId: "SM", units: [{ id: "brutalis", unitId: "000000002" }] },
  ];
  const plan = deriveBattleRuleSelectionPlan(matrix, players, lists);
  const binding = bindBattleRuleSelections(matrix, plan);
  assert.equal(binding.report.permitted, false);
  assert.equal(binding.plan.players[0].faction.sourceId, "NEC");
  assert.equal(binding.plan.players[0].datasheets[0].datasheetId, "000000001");
  assert.ok(battleRuleSelectionIds(plan).includes("mission.unselected-unselected"));
  assert.deepEqual(verifyBattleRuleCoverageBinding(matrix, binding), binding);

  const altered = structuredClone(binding);
  altered.report.results[0].permitted = false;
  assert.throws(() => verifyBattleRuleCoverageBinding(matrix, altered), /inconsistent|altered/);

  const omitted = structuredClone(binding);
  omitted.plan.universal.coreRuleIds.pop();
  omitted.report.results.splice(omitted.plan.universal.coreRuleIds.length, 1);
  assert.throws(
    () => verifyBattleRuleCoverageBinding(matrix, omitted),
    /omits|incomplete|canonical/,
  );

  const enhancedPlan = deriveBattleRuleSelectionPlan(matrix, players, lists, {
    players: { "player-1": { enhancementSourceIds: ["hypermaterial-ablation"] } },
  });
  assert.ok(
    battleRuleSelectionIds(enhancedPlan).includes(
      "enhancement.unselected-player-1-hypermaterial-ablation",
    ),
  );
  assert.equal(bindBattleRuleSelections(matrix, enhancedPlan).report.permitted, false);
});
