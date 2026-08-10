import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  advanceBattleClock,
  appendResolvedAttack,
  battleFormation,
  battleFormationHealth,
  configureUnengagedBattleFormation,
  normalizeBattleState,
  replayBattleState,
  startBattle,
} from "../lib/battle-state.mjs";
import { battleAttackWindow } from "../lib/battle-clock.mjs";
import { battleRosterRevisionsMatch, initializeBattleForLists } from "../lib/battle-setup.mjs";
import {
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationTargetSequence,
} from "../lib/formations.mjs";

const catalogue = JSON.parse(
  await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
);
const legacySetup = JSON.parse(
  await readFile(new URL("./fixtures/battle-setup-migration-v1.json", import.meta.url), "utf8"),
);

function catalogueUnit(name) {
  const unit = catalogue.units.find((candidate) => candidate.name === name);
  assert.ok(unit, `Missing catalogue unit ${name}`);
  return unit;
}

function list(id, updatedAt, name, unitName, savedUnitId) {
  const source = catalogueUnit(unitName);
  return {
    id,
    createdAt: 1,
    updatedAt,
    name,
    factionId: source.factionId,
    units: [
      {
        id: savedUnitId,
        unitId: source.id,
        name: source.name,
        modelCount: 1,
        weapons: [],
      },
    ],
  };
}

const attackers = list("list-attackers", 10, "Necrons", "Doom Scythe", "doom-scythe");
const defenders = list("list-defenders", 20, "Space Marines", "Brutalis Dreadnought", "brutalis");

function setup(state = null) {
  return initializeBattleForLists({
    catalogue,
    firstList: attackers,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    state,
    id: "battle-setup-test",
  });
}

test("registers every formation on both rosters before combat with stable ids", () => {
  const state = setup();
  assert.equal(state.version, 4);
  assert.deepEqual(
    state.players.map((player) => [player.listId, player.listUpdatedAt]),
    [
      [attackers.id, attackers.updatedAt],
      [defenders.id, defenders.updatedAt],
    ],
  );
  assert.deepEqual(
    state.events.map((event) => [event.type, event.formation?.id]),
    [
      ["formation_registered", "player-1:doom-scythe"],
      ["formation_registered", "player-2:brutalis"],
    ],
  );
  assert.equal(setup(state), state);
  assert.equal(battleRosterRevisionsMatch(state, attackers, defenders), true);
  assert.equal(
    battleRosterRevisionsMatch(state, { ...attackers, updatedAt: 11 }, defenders),
    false,
  );
  assert.equal(
    savedFormationGroups(catalogue, {
      ...attackers,
      units: [{ ...attackers.units[0], modelCount: 2 }],
    })[0].id,
    "doom-scythe",
  );
  assert.throws(
    () =>
      initializeBattleForLists({
        catalogue,
        firstList: { ...attackers, updatedAt: 11 },
        secondList: defenders,
        rulesSnapshot: "catalogue:test",
        state,
      }),
    /roster changed/i,
  );
});

test("allows equipment correction during setup, then freezes it when battle starts", () => {
  let state = setup();
  const targetId = "player-2:brutalis";
  const registration = battleFormation(state, targetId);
  const configured = {
    ...registration,
    health: undefined,
    defensiveEquipmentCounts: { "brutalis::unit::narrative": 1 },
  };
  delete configured.health;
  state = configureUnengagedBattleFormation(state, configured, "configure-1", 3);
  assert.equal(state.events.at(-1).type, "formation_configured");
  assert.deepEqual(battleFormation(state, targetId).defensiveEquipmentCounts, {
    "brutalis::unit::narrative": 1,
  });
  state = startBattle(state, "player-1", "start-battle", 4);
  assert.throws(
    () => configureUnengagedBattleFormation(state, registration, "configure-after-start", 5),
    /locked after the battle starts/i,
  );
  while (!battleAttackWindow(replayBattleState(state).clock)) {
    state = advanceBattleClock(state, `advance-${state.events.length}`, state.events.length + 1);
  }

  const target = battleFormation(state, targetId);
  const targets = target.segments.map((segment) => ({
    wounds: segment.wounds,
    modelCount: segment.startingModels,
  }));
  state = appendResolvedAttack(state, {
    id: "attack-1",
    at: state.events.length + 1,
    attackerFormationId: "player-1:doom-scythe",
    targetFormationId: targetId,
    segmentIds: target.segments.map((segment) => segment.id),
    targets,
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: "Doom Scythe",
      weapon: "Death ray",
      target: "Brutalis Dreadnought",
      damage: 0,
      successful: 0,
    },
  });
  assert.throws(
    () => configureUnengagedBattleFormation(state, registration, "configure-2", 5),
    /locked after this formation has been attacked/i,
  );
});

test("migrates a version-2 roster battle with explicit untimed provenance", () => {
  const versionTwo = structuredClone(legacySetup);
  versionTwo.version = 2;
  versionTwo.players[0].listUpdatedAt = attackers.updatedAt;
  versionTwo.players[1].listUpdatedAt = defenders.updatedAt;
  const migrated = setup(normalizeBattleState(versionTwo));
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 2,
    legacyUntimedThroughSequence: 3,
  });
  assert.equal(migrated.events.at(-1).id, "legacy-attack");
});

test("migrates a partial version-1 log without changing attack ids or health", () => {
  const defenderFormation = savedFormationGroups(catalogue, defenders)[0];
  const equipment = savedFormationDefensiveEquipmentDefaults(defenderFormation);
  const sequence = savedFormationTargetSequence(defenderFormation, "", equipment);
  const legacy = normalizeBattleState(legacySetup);

  const migrated = setup(legacy);
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 1,
    legacyUntimedThroughSequence: 3,
  });
  assert.deepEqual(
    migrated.events.map((event) => event.type),
    ["formation_registered", "formation_registered", "attack_resolved"],
  );
  assert.equal(migrated.events.at(-1).id, "legacy-attack");
  assert.deepEqual(battleFormationHealth(migrated, "player-2:brutalis"), {
    [sequence.orderedSegments[0].id]: { modelsRemaining: 1, woundsLost: 1 },
  });
});

test("migrates a version-3 guided battle without reclassifying timed events", () => {
  const versionThree = structuredClone(setup());
  versionThree.version = 3;
  delete versionThree.migration;
  const migrated = setup(normalizeBattleState(versionThree));
  assert.equal(migrated.version, 4);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 3,
    legacyUntimedThroughSequence: 0,
  });
  assert.equal(replayBattleState(migrated).mission.name, "Custom mission");
});
