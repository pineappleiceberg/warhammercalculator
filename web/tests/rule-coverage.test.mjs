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

test("published coverage matrix is source-locked and identical to its data source", () => {
  assert.deepEqual(publicCoverageSource, coverageSource);
  const matrix = normalizeRuleCoverageMatrix(coverageSource, sourceManifest);
  assert.equal(matrix.sourceLocked, true);
  assert.equal(matrix.snapshotId, "wh40k-10e-core-2025-10-v23");
  assert.equal(matrix.rules.length, 15);
  assert.deepEqual(
    new Set(matrix.rules.map((rule) => rule.category)),
    new Set(["core", "stratagem"]),
  );
});

test("coverage matrix rejects stale source hashes and pages outside the manifest", () => {
  const stale = structuredClone(coverageSource);
  stale.sourceLocks[0].sha256 = "0".repeat(64);
  assert.throws(() => normalizeRuleCoverageMatrix(stale, sourceManifest), /does not match/);

  const badPage = structuredClone(coverageSource);
  badPage.rules[0].sources[0].pages.push(999);
  assert.throws(() => normalizeRuleCoverageMatrix(badPage, sourceManifest), /outside/);
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
