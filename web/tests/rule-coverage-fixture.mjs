import { readFile } from "node:fs/promises";
import {
  bindBattleRuleSelections,
  deriveBattleRuleSelectionPlan,
} from "../lib/battle-rule-selection.mjs";
import { normalizeRuleCoverageMatrix } from "../lib/rule-coverage.mjs";

const coverageSource = JSON.parse(
  await readFile(new URL("../../data/battle-rule-coverage.json", import.meta.url), "utf8"),
);
for (const category of ["faction", "detachment", "datasheet", "mission", "terrain"]) {
  coverageSource.rules.push({
    id: `${category}.test`,
    category,
    name: `Test ${category}`,
    status: "irrelevant",
    introducedBattleStateVersion: 24,
    sources: [{ id: "core-rules-10e", pages: [7] }],
  });
}

export const coveredRuleCoverageMatrix = normalizeRuleCoverageMatrix(
  coverageSource,
  JSON.parse(
    await readFile(new URL("../../data/battle-rule-sources.json", import.meta.url), "utf8"),
  ),
);

export function coveredRuleSelectionOverrides(players, lists) {
  return {
    guidedReason: "Players will review guided movement and placement at the table",
    players: Object.fromEntries(
      players.map((player, index) => [
        player.id,
        {
          factionRuleIds: ["faction.test"],
          detachmentSourceId: "test",
          detachmentRuleIds: ["detachment.test"],
          datasheetRuleIds: Object.fromEntries(
            lists[index].units.map((unit) => [unit.id, ["datasheet.test"]]),
          ),
        },
      ]),
    ),
    missionSourceId: "test",
    missionRuleIds: ["mission.test"],
    terrainSourceId: "test",
    terrainRuleIds: ["terrain.test"],
  };
}

export function coveredBattleRuleBinding(players) {
  const lists = players.map((player, index) => ({
    factionId: `test-faction-${index + 1}`,
    units: [
      {
        id: `test-unit-${index + 1}`,
        unitId: `test-datasheet-${index + 1}`,
      },
    ],
  }));
  const plan = deriveBattleRuleSelectionPlan(
    coveredRuleCoverageMatrix,
    players,
    lists,
    coveredRuleSelectionOverrides(players, lists),
  );
  return bindBattleRuleSelections(coveredRuleCoverageMatrix, plan);
}
