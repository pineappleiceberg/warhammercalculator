import assert from "node:assert/strict";
import test from "node:test";
import {
  ARMY_LIST_BACKUP_KIND,
  createArmyListBackup,
  mergeArmyListRecords,
  parseArmyListBackup,
} from "../lib/army-list-codec.mjs";
import { createPlayRecovery, parsePlayRecovery } from "../lib/play-recovery.mjs";

const list = {
  id: "01234567-89ab-4cde-8fab-0123456789ab",
  name: "Awakened Dynasty",
  factionId: "NEC",
  units: [
    {
      id: "unit-1",
      unitId: "datasheet-1",
      name: "Necron Warriors",
      modelCount: 10,
      weapons: [
        {
          weaponId: 7,
          groupId: "datasheet-1:7",
          name: "Gauss flayer",
          count: 10,
          optionCount: 0,
        },
      ],
      choiceSelections: { "datasheet-1:choice:1": 0 },
      loadoutSubjectCounts: { "datasheet-1:subject:1": 4 },
      combatPresetIds: ["datasheet-1:ability:2"],
    },
  ],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

test("round-trips a versioned army-list backup", () => {
  const backup = createArmyListBackup(
    [list],
    "2026-08-06T00:00:00.000Z",
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(backup.kind, ARMY_LIST_BACKUP_KIND);
  assert.equal(backup.version, 1);
  assert.equal(backup.profileSourceUpdatedAt, "2026-07-31T00:00:00.000Z");
  assert.deepEqual(parseArmyListBackup(JSON.parse(JSON.stringify(backup))), backup);
});

test("rejects incompatible and malformed army-list backups", () => {
  const backup = createArmyListBackup([list]);
  assert.throws(() => parseArmyListBackup({ ...backup, version: 2 }), /unsupported/i);
  assert.throws(
    () => parseArmyListBackup({ ...backup, profileSourceUpdatedAt: 42 }),
    /profileSourceUpdatedAt/,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [
              {
                ...list.units[0],
                weapons: [{ ...list.units[0].weapons[0], optionCount: 11 }],
              },
            ],
          },
        ],
      }),
    /optionCount/i,
  );
  assert.throws(() => parseArmyListBackup({ ...backup, lists: Array(101).fill(list) }), /100/);
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], loadoutSubjectCounts: { "subject:1": 1001 } }],
          },
        ],
      }),
    /loadoutSubjectCounts/i,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], combatPresetIds: [42] }],
          },
        ],
      }),
    /combatPresetIds/i,
  );
});

test("reconciles newer device edits and offline deletions deterministically", () => {
  const olderCloud = { ...list, name: "Cloud copy", updatedAt: list.updatedAt - 1 };
  const newerDevice = { ...list, name: "Device copy" };
  assert.equal(mergeArmyListRecords([olderCloud], [newerDevice])[0].name, "Device copy");
  assert.deepEqual(mergeArmyListRecords([olderCloud], [newerDevice], [list.id]), []);
  assert.equal(mergeArmyListRecords([newerDevice], [olderCloud])[0].name, "Device copy");
});

test("round-trips bounded play recovery and rejects corrupt history", () => {
  const state = {
    attackerListId: list.id,
    targetListId: list.id,
    attackerUnitId: "unit-1",
    targetUnitId: "unit-1",
    weaponId: "7",
    profileId: "7",
    targetModelId: "3",
    activeAttackerPresetIds: ["datasheet-1:ability:2"],
    activeTargetPresetIds: ["datasheet-2:ability:4"],
    profile: {
      attacks: 2,
      hitOn: 3,
      damage: 2,
      targetDistance: 9,
      attackerUnitModels: 11,
      nearbyEnemyModels: 7,
      attackerRemainedStationary: true,
      attackerAttached: true,
      targetAttached: true,
      attackerWaaaghActive: true,
      targetWaaaghActive: true,
      attackerBattleShocked: true,
      targetBattleShocked: true,
      targetStrengthState: "below_half",
    },
    history: [
      {
        id: "attack-1",
        attacker: "Necron Warriors",
        weapon: "Gauss flayer",
        target: "Intercessors",
        damage: 2,
        successful: 1,
      },
    ],
  };
  const recovery = createPlayRecovery(state, 1_700_000_000_000);
  assert.deepEqual(recovery.activeAttackerPresetIds, ["datasheet-1:ability:2"]);
  assert.equal(recovery.profile.targetDistance, 9);
  assert.equal(recovery.profile.attackerUnitModels, 11);
  assert.equal(recovery.profile.nearbyEnemyModels, 7);
  assert.equal(recovery.profile.attackerRemainedStationary, true);
  assert.equal(recovery.profile.attackerAttached, true);
  assert.equal(recovery.profile.targetAttached, true);
  assert.equal(recovery.profile.attackerWaaaghActive, true);
  assert.equal(recovery.profile.targetWaaaghActive, true);
  assert.equal(recovery.profile.attackerBattleShocked, true);
  assert.equal(recovery.profile.targetBattleShocked, true);
  assert.equal(recovery.profile.targetStrengthState, "below_half");
  assert.deepEqual(parsePlayRecovery(JSON.parse(JSON.stringify(recovery))), recovery);
  assert.throws(
    () => parsePlayRecovery({ ...recovery, history: [{ ...recovery.history[0], damage: -1 }] }),
    /damage/i,
  );
  assert.throws(
    () => parsePlayRecovery({ ...recovery, history: Array(31).fill(recovery.history[0]) }),
    /30/,
  );
  assert.throws(
    () => parsePlayRecovery({ ...recovery, activeTargetPresetIds: [42] }),
    /activeTargetPresetIds/,
  );
});
