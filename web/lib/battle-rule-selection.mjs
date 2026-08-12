import {
  assessRuleCoverage,
  normalizeRuleCoverageMatrix,
  ruleCoverageIsPermitted,
  RULE_COVERAGE_STATUS,
} from "./rule-coverage.mjs";

export const BATTLE_RULE_SELECTION_SCHEMA_VERSION = 1;

export async function loadBattleRuleCoverage() {
  const publicRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
  const [coverageResponse, sourceResponse] = await Promise.all([
    fetch(new URL("battle-rule-coverage.json", publicRoot)),
    fetch(new URL("battle-rule-sources.json", publicRoot)),
  ]);
  if (!coverageResponse.ok || !sourceResponse.ok) {
    throw new Error("Battle rule coverage catalogue is unavailable");
  }
  return normalizeRuleCoverageMatrix(await coverageResponse.json(), await sourceResponse.json());
}

const RULE_ID = /^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$/;
const CATEGORIES = new Set([
  "core",
  "faction",
  "detachment",
  "enhancement",
  "datasheet",
  "stratagem",
  "terrain",
  "mission",
]);

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

function ruleId(value, category, message) {
  const id = string(value, message, 300);
  if (!RULE_ID.test(id) || !id.startsWith(`${category}.`)) throw new Error(message);
  return id;
}

function ruleIds(value, category, message, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 1000) {
    throw new Error(message);
  }
  const normalized = value.map((id) => ruleId(id, category, message));
  if (new Set(normalized).size !== normalized.length) throw new Error(message);
  return normalized;
}

function token(value) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function fallbackRuleId(category, ...identity) {
  return `${category}.unselected-${identity.map(token).join("-")}`;
}

function catalogueRuleId(matrixRuleIds, category, sourceId, ...fallbackIdentity) {
  const candidate = `${category}.catalogue-${token(sourceId)}`;
  return matrixRuleIds.has(candidate)
    ? candidate
    : fallbackRuleId(category, ...(fallbackIdentity.length ? fallbackIdentity : [sourceId]));
}

function factionRuleIds(matrixRuleIds, sourceId) {
  const ruleIds = [catalogueRuleId(matrixRuleIds, "faction", sourceId)];
  if (sourceId === "SM" && matrixRuleIds.has("faction.oath-of-moment")) {
    ruleIds.push("faction.oath-of-moment");
  }
  return ruleIds;
}

function normalizeAcknowledgements(value) {
  const source =
    value === undefined ? {} : object(value, "Rule acknowledgements must be an object");
  if (Object.keys(source).length > 1000) throw new Error("Too many rule acknowledgements");
  return Object.fromEntries(
    Object.entries(source).map(([id, reason]) => {
      const category = id.split(".", 1)[0];
      if (!CATEGORIES.has(category)) throw new Error(`Rule acknowledgement ${id} is invalid`);
      return [
        ruleId(id, category, `Rule acknowledgement ${id} is invalid`),
        string(reason, `Rule acknowledgement ${id} needs a reason`, 500),
      ];
    }),
  );
}

export function normalizeBattleRuleSelectionPlan(value) {
  const body = object(value, "Battle rule selections must be an object");
  if (body.schemaVersion !== BATTLE_RULE_SELECTION_SCHEMA_VERSION) {
    throw new Error("Battle rule selection schema is unsupported");
  }
  const universal = object(body.universal, "Universal rule selections are required");
  if (!Array.isArray(body.players) || body.players.length !== 2) {
    throw new Error("Battle rule selections require exactly two players");
  }
  const players = body.players.map((candidate) => {
    const player = object(candidate, "Each player rule selection must be an object");
    if (
      !Array.isArray(player.datasheets) ||
      player.datasheets.length < 1 ||
      player.datasheets.length > 100
    ) {
      throw new Error("Each player must declare 1 to 100 datasheets");
    }
    const datasheets = player.datasheets.map((candidateDatasheet) => {
      const datasheet = object(candidateDatasheet, "Each datasheet selection must be an object");
      return {
        savedUnitId: string(datasheet.savedUnitId, "Datasheet saved unit id is required", 100),
        datasheetId: string(datasheet.datasheetId, "Datasheet source id is required", 100),
        ruleIds: ruleIds(datasheet.ruleIds, "datasheet", "Datasheet rule ids are invalid", 1),
      };
    });
    if (new Set(datasheets.map((entry) => entry.savedUnitId)).size !== datasheets.length) {
      throw new Error("Datasheet saved unit ids must be unique per player");
    }
    const faction = object(player.faction, "Faction rule selections are required");
    const detachment = object(player.detachment, "Detachment rule selections are required");
    const enhancements = object(player.enhancements, "Enhancement rule selections are required");
    if (enhancements.declared !== true) {
      throw new Error("Enhancement selections must explicitly declare that the list was reviewed");
    }
    const enhancementSourceIds = Array.isArray(enhancements.sourceIds)
      ? enhancements.sourceIds.map((id) => string(id, "Enhancement source ids are invalid", 200))
      : (() => {
          throw new Error("Enhancement source ids must be an array");
        })();
    if (new Set(enhancementSourceIds).size !== enhancementSourceIds.length) {
      throw new Error("Enhancement source ids must be unique");
    }
    return {
      playerId: string(player.playerId, "Rule selection player id is required", 100),
      faction: {
        sourceId: string(faction.sourceId, "Faction source id is required", 100),
        ruleIds: ruleIds(faction.ruleIds, "faction", "Faction rule ids are invalid", 1),
      },
      detachment: {
        sourceId: string(detachment.sourceId, "Detachment source id is required", 200),
        ruleIds: ruleIds(detachment.ruleIds, "detachment", "Detachment rule ids are invalid", 1),
      },
      enhancements: {
        declared: true,
        sourceIds: enhancementSourceIds,
        ruleIds: ruleIds(enhancements.ruleIds, "enhancement", "Enhancement rule ids are invalid"),
      },
      datasheets,
    };
  });
  if (new Set(players.map((player) => player.playerId)).size !== players.length) {
    throw new Error("Rule selection player ids must be unique");
  }
  const mission = object(body.mission, "Mission rule selections are required");
  const terrain = object(body.terrain, "Terrain rule selections are required");
  return {
    schemaVersion: BATTLE_RULE_SELECTION_SCHEMA_VERSION,
    universal: {
      coreRuleIds: ruleIds(universal.coreRuleIds, "core", "Core rule ids are invalid", 1),
      stratagemRuleIds: ruleIds(
        universal.stratagemRuleIds,
        "stratagem",
        "Universal Stratagem rule ids are invalid",
        1,
      ),
    },
    players,
    mission: {
      sourceId: string(mission.sourceId, "Mission source id is required", 200),
      ruleIds: ruleIds(mission.ruleIds, "mission", "Mission rule ids are invalid", 1),
    },
    terrain: {
      sourceId: string(terrain.sourceId, "Terrain source id is required", 200),
      ruleIds: ruleIds(terrain.ruleIds, "terrain", "Terrain rule ids are invalid", 1),
    },
    acknowledgements: normalizeAcknowledgements(body.acknowledgements),
  };
}

export function battleRuleSelectionIds(planValue) {
  const plan = normalizeBattleRuleSelectionPlan(planValue);
  return [
    ...plan.universal.coreRuleIds,
    ...plan.universal.stratagemRuleIds,
    ...plan.players.flatMap((player) => [
      ...player.faction.ruleIds,
      ...player.detachment.ruleIds,
      ...player.enhancements.ruleIds,
      ...player.datasheets.flatMap((datasheet) => datasheet.ruleIds),
    ]),
    ...plan.mission.ruleIds,
    ...plan.terrain.ruleIds,
  ].filter((id, index, values) => values.indexOf(id) === index);
}

export function deriveBattleRuleSelectionPlan(matrix, players, lists, overrides = {}) {
  if (!matrix?.sourceLocked || !Array.isArray(matrix.rules)) {
    throw new Error("A normalized source-locked rule coverage matrix is required");
  }
  if (
    !Array.isArray(players) ||
    players.length !== 2 ||
    !Array.isArray(lists) ||
    lists.length !== 2
  ) {
    throw new Error("Two battle players and their exact saved lists are required");
  }
  const guidedReason =
    typeof overrides.guidedReason === "string" ? overrides.guidedReason.trim() : "";
  const matrixRuleIds = new Set(matrix.rules.map((rule) => rule.id));
  const universalRuleIds = matrix.rules.filter((rule) =>
    ["core", "stratagem"].includes(rule.category),
  );
  const plan = {
    schemaVersion: BATTLE_RULE_SELECTION_SCHEMA_VERSION,
    universal: {
      coreRuleIds: universalRuleIds
        .filter((rule) => rule.category === "core")
        .map((rule) => rule.id),
      stratagemRuleIds: universalRuleIds
        .filter((rule) => rule.category === "stratagem")
        .map((rule) => rule.id),
    },
    players: players.map((player, index) => {
      const list = lists[index];
      const playerOverride = overrides.players?.[player.id] ?? {};
      const detachmentSourceId = playerOverride.detachmentSourceId?.trim() || "unselected";
      const enhancementSourceIds = Array.isArray(playerOverride.enhancementSourceIds)
        ? playerOverride.enhancementSourceIds
        : [];
      return {
        playerId: player.id,
        faction: {
          sourceId: list.factionId,
          ruleIds: playerOverride.factionRuleIds ?? factionRuleIds(matrixRuleIds, list.factionId),
        },
        detachment: {
          sourceId: detachmentSourceId,
          ruleIds: playerOverride.detachmentRuleIds ?? [
            catalogueRuleId(
              matrixRuleIds,
              "detachment",
              detachmentSourceId,
              player.id,
              detachmentSourceId,
            ),
          ],
        },
        enhancements: {
          declared: true,
          sourceIds: enhancementSourceIds,
          ruleIds:
            playerOverride.enhancementRuleIds ??
            enhancementSourceIds.map((sourceId) =>
              catalogueRuleId(matrixRuleIds, "enhancement", sourceId, player.id, sourceId),
            ),
        },
        datasheets: list.units.map((unit) => ({
          savedUnitId: unit.id,
          datasheetId: unit.unitId,
          ruleIds: playerOverride.datasheetRuleIds?.[unit.id] ?? [
            catalogueRuleId(matrixRuleIds, "datasheet", unit.unitId),
          ],
        })),
      };
    }),
    mission: {
      sourceId: overrides.missionSourceId?.trim() || "unselected",
      ruleIds: overrides.missionRuleIds ?? [
        catalogueRuleId(matrixRuleIds, "mission", overrides.missionSourceId || "unselected"),
      ],
    },
    terrain: {
      sourceId: overrides.terrainSourceId?.trim() || "unselected",
      ruleIds: overrides.terrainRuleIds ?? [
        catalogueRuleId(matrixRuleIds, "terrain", overrides.terrainSourceId || "unselected"),
      ],
    },
    acknowledgements: { ...(overrides.acknowledgements ?? {}) },
  };
  if (guidedReason) {
    const rules = new Map(matrix.rules.map((rule) => [rule.id, rule]));
    for (const id of battleRuleSelectionIds(plan)) {
      if (rules.get(id)?.status === "guided" && !plan.acknowledgements[id]) {
        plan.acknowledgements[id] = guidedReason;
      }
    }
  }
  return normalizeBattleRuleSelectionPlan(plan);
}

export function bindBattleRuleSelections(matrix, planValue) {
  const plan = normalizeBattleRuleSelectionPlan(planValue);
  const ids = battleRuleSelectionIds(plan);
  if (Object.keys(plan.acknowledgements).some((id) => !ids.includes(id))) {
    throw new Error("Rule acknowledgements must reference selected battle rules");
  }
  const requests = ids.map((id) => ({
    id,
    acknowledgement: plan.acknowledgements[id] ?? "",
  }));
  return normalizeBattleRuleCoverageBinding({
    schemaVersion: BATTLE_RULE_SELECTION_SCHEMA_VERSION,
    snapshotId: matrix.snapshotId,
    sourceLocks: matrix.sourceLocks,
    plan,
    report: assessRuleCoverage(matrix, requests),
  });
}

export function normalizeBattleRuleCoverageBinding(value) {
  const body = object(value, "Battle rule coverage binding must be an object");
  if (body.schemaVersion !== BATTLE_RULE_SELECTION_SCHEMA_VERSION) {
    throw new Error("Battle rule coverage binding schema is unsupported");
  }
  const snapshotId = string(body.snapshotId, "Battle rule coverage snapshot is required", 200);
  if (
    !Array.isArray(body.sourceLocks) ||
    body.sourceLocks.length < 1 ||
    body.sourceLocks.length > 100
  ) {
    throw new Error("Battle rule coverage source locks are required");
  }
  const sourceLocks = body.sourceLocks.map((candidate) => {
    const lock = object(candidate, "Each battle rule source lock must be an object");
    const id = string(lock.id, "Battle rule source lock id is required", 200);
    const sha256 = string(lock.sha256, `Battle rule source lock ${id} needs a checksum`, 64);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Battle rule source lock ${id} is invalid`);
    return { id, sha256 };
  });
  if (new Set(sourceLocks.map((lock) => lock.id)).size !== sourceLocks.length) {
    throw new Error("Battle rule source locks must be unique");
  }
  const plan = normalizeBattleRuleSelectionPlan(body.plan);
  const report = object(body.report, "Battle rule coverage report is required");
  if (report.snapshotId !== snapshotId || !Array.isArray(report.results)) {
    throw new Error("Battle rule coverage report snapshot is invalid");
  }
  const ids = battleRuleSelectionIds(plan);
  if (Object.keys(plan.acknowledgements).some((id) => !ids.includes(id))) {
    throw new Error("Rule acknowledgements must reference selected battle rules");
  }
  if (report.results.length !== ids.length)
    throw new Error("Battle rule coverage report is incomplete");
  const results = report.results.map((candidate, index) => {
    const result = object(candidate, "Each battle rule coverage result must be an object");
    const id = ruleId(
      result.id,
      String(result.category),
      "Battle rule coverage result id is invalid",
    );
    if (id !== ids[index] || !CATEGORIES.has(result.category)) {
      throw new Error("Battle rule coverage result order is not canonical");
    }
    if (!Object.hasOwn(RULE_COVERAGE_STATUS, result.status)) {
      throw new Error(`Battle rule coverage status for ${id} is invalid`);
    }
    const sourceLocked = result.sourceLocked === true;
    const acknowledged = Boolean(plan.acknowledgements[id]);
    const permitted = ruleCoverageIsPermitted(
      result.status,
      sourceLocked,
      acknowledged ? plan.acknowledgements[id] : "",
    );
    if (
      Boolean(result.acknowledgementRequired) !== (result.status === "guided") ||
      Boolean(result.acknowledged) !== acknowledged ||
      Boolean(result.permitted) !== permitted
    ) {
      throw new Error(`Battle rule coverage result for ${id} is inconsistent`);
    }
    return {
      id,
      category: result.category,
      name: string(result.name, `Battle rule coverage name for ${id} is required`, 300),
      status: result.status,
      sourceLocked,
      acknowledgementRequired: result.status === "guided",
      acknowledged,
      permitted,
      reason: string(result.reason, `Battle rule coverage reason for ${id} is required`, 500),
    };
  });
  const permitted = results.every((result) => result.permitted);
  if (Boolean(report.permitted) !== permitted)
    throw new Error("Battle rule coverage result is inconsistent");
  return {
    schemaVersion: BATTLE_RULE_SELECTION_SCHEMA_VERSION,
    snapshotId,
    sourceLocks,
    plan,
    report: { snapshotId, permitted, results },
  };
}

export function verifyBattleRuleCoverageBinding(matrix, bindingValue) {
  const binding = normalizeBattleRuleCoverageBinding(bindingValue);
  if (
    binding.snapshotId !== matrix.snapshotId ||
    JSON.stringify(binding.sourceLocks) !== JSON.stringify(matrix.sourceLocks)
  ) {
    throw new Error("Battle rule coverage binding does not match the loaded source snapshot");
  }
  const expectedUniversal = matrix.rules.filter((rule) =>
    ["core", "stratagem"].includes(rule.category),
  );
  if (
    JSON.stringify(binding.plan.universal.coreRuleIds) !==
      JSON.stringify(
        expectedUniversal.filter((rule) => rule.category === "core").map((rule) => rule.id),
      ) ||
    JSON.stringify(binding.plan.universal.stratagemRuleIds) !==
      JSON.stringify(
        expectedUniversal.filter((rule) => rule.category === "stratagem").map((rule) => rule.id),
      )
  ) {
    throw new Error("Battle rule coverage binding omits a universal rule");
  }
  const recomputed = bindBattleRuleSelections(matrix, binding.plan);
  if (JSON.stringify(recomputed) !== JSON.stringify(binding)) {
    throw new Error("Battle rule coverage binding is stale or has been altered");
  }
  return binding;
}
