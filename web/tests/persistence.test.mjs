import assert from "node:assert/strict";
import test from "node:test";
import {
  ARMY_LIST_BACKUP_KIND,
  createArmyListBackup,
  mergeArmyListRecords,
  parseArmyListBackup,
} from "../lib/army-list-codec.mjs";
import { createPlayRecovery, parsePlayRecovery } from "../lib/play-recovery.mjs";
import {
  abilityUsesRemaining,
  commitAbilityPresetSelection,
  normalizeAbilityUses,
  reconcileActiveLimitedAbilityUses,
  setAbilityUsesRemaining,
  spendAbilityUse,
  withoutLimitedAbilityPresetIds,
} from "../lib/ability-uses.mjs";
import { savedFormationCombatPresetSourceUnitIds } from "../lib/formations.mjs";

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
      defensiveEquipmentCounts: {
        "unit-1::3::datasheet-1:equipment:1": 1,
      },
      defensiveEquipmentOverrides: {
        "datasheet-1:equipment:1": "casualties",
      },
      transportId: "unit-transport",
      attachedToId: "unit-bodyguard",
      joinedToId: "unit-joined-bodyguard",
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
  assert.equal(backup.lists[0].units[0].transportId, "unit-transport");
  assert.equal(backup.lists[0].units[0].attachedToId, "unit-bodyguard");
  assert.equal(backup.lists[0].units[0].joinedToId, "unit-joined-bodyguard");
  assert.deepEqual(backup.lists[0].units[0].defensiveEquipmentCounts, {
    "unit-1::3::datasheet-1:equipment:1": 1,
  });
  assert.deepEqual(backup.lists[0].units[0].defensiveEquipmentOverrides, {
    "datasheet-1:equipment:1": "casualties",
  });
  const legacy = JSON.parse(JSON.stringify(backup));
  delete legacy.lists[0].units[0].defensiveEquipmentCounts;
  delete legacy.lists[0].units[0].defensiveEquipmentOverrides;
  assert.equal(parseArmyListBackup(legacy).lists[0].units[0].defensiveEquipmentCounts, undefined);
  assert.equal(
    parseArmyListBackup(legacy).lists[0].units[0].defensiveEquipmentOverrides,
    undefined,
  );
});

test("preserves editable casualty counts independently of catalogue starting sizes", () => {
  const casualtyList = {
    ...list,
    units: [{ ...list.units[0], name: "Cadian Shock Troops", modelCount: 15 }],
  };
  const backup = createArmyListBackup([casualtyList]);
  assert.equal(
    parseArmyListBackup(JSON.parse(JSON.stringify(backup))).lists[0].units[0].modelCount,
    15,
  );
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
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], defensiveEquipmentCounts: { shield: -1 } }],
          },
        ],
      }),
    /defensiveEquipmentCounts/i,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], defensiveEquipmentOverrides: { shield: "because" } }],
          },
        ],
      }),
    /defensiveEquipmentOverrides/i,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], transportId: list.units[0].id }],
          },
        ],
      }),
    /transportId/i,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], attachedToId: list.units[0].id }],
          },
        ],
      }),
    /attachedToId/i,
  );
  assert.throws(
    () =>
      parseArmyListBackup({
        ...backup,
        lists: [
          {
            ...list,
            units: [{ ...list.units[0], joinedToId: list.units[0].id }],
          },
        ],
      }),
    /joinedToId/i,
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
    firingDeckModels: 6,
    firingDeckPassengerAlreadyShot: true,
    activeAttackerPresetIds: ["datasheet-1:ability:2"],
    activeTargetPresetIds: ["datasheet-2:ability:4"],
    supportUnitId: "unit-2",
    activeSupportPresetIds: ["datasheet-3:ability:5"],
    targetSupportUnitId: "unit-3",
    activeTargetSupportPresetIds: ["datasheet-4:ability:6"],
    abilityUsesSpent: {
      "unit-1": { "datasheet-1:ability:2": 1 },
      "unit-2": { "datasheet-3:ability:5": 1 },
    },
    targetDefensiveEquipmentCounts: { "unit-1::3::equipment-1": 1 },
    profile: {
      attacks: 2,
      hitOn: 3,
      damage: 2,
      targetDistance: 9,
      attackerSourceTargetDistance: 18,
      targetSourceAttackerDistance: 12,
      supportDistance: 6,
      targetSupportDistance: 3,
      attackerUnitModels: 11,
      nearbyEnemyModels: 7,
      nearbyEnemyUnits: 3,
      enemyCharacterModelsDestroyed: 2,
      destructiveFightPhases: 4,
      embarkedModels: 10,
      embarkedWracksModels: 6,
      attackerRemainedStationary: true,
      attackerAttached: true,
      targetAttached: true,
      attackerWaaaghActive: true,
      targetWaaaghActive: true,
      targetOathOfMoment: true,
      attackerOathWoundBonusEligible: true,
      attackerOnObjective: true,
      targetOnObjective: true,
      attackerObjectiveOwner: "attacker",
      targetObjectiveOwner: "uncontrolled",
      attackerOnAttackerSelectedObjective: true,
      targetOnAttackerSelectedObjective: true,
      attackerOnTargetSelectedObjective: true,
      targetOnTargetSelectedObjective: true,
      attackerGuidedAgainstTarget: true,
      targetSpotted: true,
      targetSpottedByMarkerlightObserver: true,
      targetClosestEligible: true,
      attackerSourceCanSeeTarget: true,
      targetSourceCanSeeAttacker: true,
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
  assert.equal(recovery.firingDeckModels, 6);
  assert.equal(recovery.firingDeckPassengerAlreadyShot, true);
  assert.equal(recovery.supportUnitId, "unit-2");
  assert.deepEqual(recovery.activeSupportPresetIds, ["datasheet-3:ability:5"]);
  assert.equal(recovery.targetSupportUnitId, "unit-3");
  assert.deepEqual(recovery.activeTargetSupportPresetIds, ["datasheet-4:ability:6"]);
  assert.equal(recovery.version, 2);
  assert.deepEqual(recovery.abilityUsesSpent, {
    "unit-1": { "datasheet-1:ability:2": 1 },
    "unit-2": { "datasheet-3:ability:5": 1 },
  });
  assert.deepEqual(recovery.targetDefensiveEquipmentCounts, {
    "unit-1::3::equipment-1": 1,
  });
  assert.equal(recovery.profile.targetDistance, 9);
  assert.equal(recovery.profile.attackerSourceTargetDistance, 18);
  assert.equal(recovery.profile.targetSourceAttackerDistance, 12);
  assert.equal(recovery.profile.supportDistance, 6);
  assert.equal(recovery.profile.targetSupportDistance, 3);
  assert.equal(recovery.profile.attackerUnitModels, 11);
  assert.equal(recovery.profile.nearbyEnemyModels, 7);
  assert.equal(recovery.profile.nearbyEnemyUnits, 3);
  assert.equal(recovery.profile.enemyCharacterModelsDestroyed, 2);
  assert.equal(recovery.profile.destructiveFightPhases, 4);
  assert.equal(recovery.profile.embarkedModels, 10);
  assert.equal(recovery.profile.embarkedWracksModels, 6);
  assert.equal(recovery.profile.attackerRemainedStationary, true);
  assert.equal(recovery.profile.attackerAttached, true);
  assert.equal(recovery.profile.targetAttached, true);
  assert.equal(recovery.profile.attackerWaaaghActive, true);
  assert.equal(recovery.profile.targetWaaaghActive, true);
  assert.equal(recovery.profile.targetOathOfMoment, true);
  assert.equal(recovery.profile.attackerOathWoundBonusEligible, true);
  assert.equal(recovery.profile.attackerOnObjective, true);
  assert.equal(recovery.profile.targetOnObjective, true);
  assert.equal(recovery.profile.attackerObjectiveOwner, "attacker");
  assert.equal(recovery.profile.targetObjectiveOwner, "uncontrolled");
  assert.equal(recovery.profile.attackerOnAttackerSelectedObjective, true);
  assert.equal(recovery.profile.targetOnAttackerSelectedObjective, true);
  assert.equal(recovery.profile.attackerOnTargetSelectedObjective, true);
  assert.equal(recovery.profile.targetOnTargetSelectedObjective, true);
  assert.equal(recovery.profile.attackerGuidedAgainstTarget, true);
  assert.equal(recovery.profile.targetSpotted, true);
  assert.equal(recovery.profile.targetSpottedByMarkerlightObserver, true);
  assert.equal(recovery.profile.targetClosestEligible, true);
  assert.equal(recovery.profile.attackerSourceCanSeeTarget, true);
  assert.equal(recovery.profile.targetSourceCanSeeAttacker, true);
  assert.equal(recovery.profile.attackerBattleShocked, true);
  assert.equal(recovery.profile.targetBattleShocked, true);
  assert.equal(recovery.profile.targetStrengthState, "below_half");
  assert.deepEqual(parsePlayRecovery(JSON.parse(JSON.stringify(recovery))), recovery);
  const legacy = { ...recovery, version: 1, supportUsesSpent: recovery.abilityUsesSpent };
  delete legacy.abilityUsesSpent;
  delete legacy.supportUnitId;
  delete legacy.activeSupportPresetIds;
  delete legacy.targetSupportUnitId;
  delete legacy.activeTargetSupportPresetIds;
  delete legacy.targetDefensiveEquipmentCounts;
  const migrated = parsePlayRecovery(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.supportUnitId, "");
  assert.deepEqual(migrated.activeSupportPresetIds, []);
  assert.equal(migrated.targetSupportUnitId, "");
  assert.deepEqual(migrated.activeTargetSupportPresetIds, []);
  assert.deepEqual(migrated.abilityUsesSpent, {
    "unit-1": { "datasheet-1:ability:2": 1 },
    "unit-2": { "datasheet-3:ability:5": 1 },
  });
  assert.deepEqual(migrated.targetDefensiveEquipmentCounts, {});
  const legacyProfile = JSON.parse(JSON.stringify(recovery));
  delete legacyProfile.profile.targetClosestEligible;
  delete legacyProfile.profile.attackerSourceTargetDistance;
  delete legacyProfile.profile.targetSourceAttackerDistance;
  delete legacyProfile.profile.attackerSourceCanSeeTarget;
  delete legacyProfile.profile.targetSourceCanSeeAttacker;
  assert.equal(parsePlayRecovery(legacyProfile).profile.targetClosestEligible, false);
  assert.equal(parsePlayRecovery(legacyProfile).profile.attackerSourceTargetDistance, 0);
  assert.equal(parsePlayRecovery(legacyProfile).profile.targetSourceAttackerDistance, 0);
  assert.equal(parsePlayRecovery(legacyProfile).profile.attackerSourceCanSeeTarget, false);
  assert.equal(parsePlayRecovery(legacyProfile).profile.targetSourceCanSeeAttacker, false);
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
  assert.throws(
    () => parsePlayRecovery({ ...recovery, activeSupportPresetIds: [42] }),
    /activeSupportPresetIds/,
  );
  assert.throws(
    () => parsePlayRecovery({ ...recovery, activeTargetSupportPresetIds: [42] }),
    /activeTargetSupportPresetIds/,
  );
  assert.throws(
    () => parsePlayRecovery({ ...recovery, abilityUsesSpent: { "unit-2": { preset: -1 } } }),
    /use count/i,
  );
  assert.throws(
    () =>
      parsePlayRecovery({
        ...recovery,
        targetDefensiveEquipmentCounts: { "unit-1::3::equipment-1": -1 },
      }),
    /targetDefensiveEquipmentCounts/i,
  );
});

test("tracks limited self and support ability uses per saved unit without spending per attack", () => {
  const limited = {
    id: "datasheet:ability",
    name: "Blacklight Marker Drones",
    usesPerBattle: 2,
  };
  const unlimited = { id: "datasheet:other", name: "Forward Observers" };
  let state = {};
  let selection = commitAbilityPresetSelection(
    [limited, unlimited],
    [],
    [limited.id],
    { [limited.id]: "army-unit-a" },
    state,
  );
  state = selection.uses;
  assert.equal(abilityUsesRemaining(state, "army-unit-a", limited.id, 2), 1);
  assert.deepEqual(selection.selectedIds, [limited.id]);

  selection = commitAbilityPresetSelection(
    [limited, unlimited],
    selection.selectedIds,
    selection.selectedIds,
    { [limited.id]: "army-unit-a" },
    state,
  );
  assert.equal(abilityUsesRemaining(selection.uses, "army-unit-a", limited.id, 2), 1);

  selection = commitAbilityPresetSelection(
    [limited, unlimited],
    [limited.id],
    [],
    { [limited.id]: "army-unit-a" },
    selection.uses,
  );
  selection = commitAbilityPresetSelection(
    [limited, unlimited],
    [],
    [limited.id],
    { [limited.id]: "army-unit-a" },
    selection.uses,
  );
  assert.equal(abilityUsesRemaining(selection.uses, "army-unit-a", limited.id, 2), 0);
  assert.equal(abilityUsesRemaining(selection.uses, "army-unit-b", limited.id, 2), 2);
  assert.throws(
    () => spendAbilityUse(selection.uses, "army-unit-a", limited.id, 2),
    /no uses remaining/i,
  );
  const corrected = setAbilityUsesRemaining(selection.uses, "army-unit-a", limited.id, 2, 1);
  assert.equal(abilityUsesRemaining(corrected, "army-unit-a", limited.id, 2), 1);
  assert.deepEqual(setAbilityUsesRemaining(corrected, "army-unit-a", limited.id, 2, 2), {});
  assert.deepEqual(normalizeAbilityUses({ "army-unit-a": { [limited.id]: 0 } }), {});
  assert.throws(() => normalizeAbilityUses({ "army-unit-a": { [limited.id]: 1.5 } }), /count/);
  assert.deepEqual(
    withoutLimitedAbilityPresetIds([limited, unlimited], [limited.id, unlimited.id]),
    [unlimited.id],
  );
  assert.throws(
    () => commitAbilityPresetSelection([limited], [], [limited.id], {}, {}),
    /source unit is ambiguous/i,
  );
  assert.deepEqual(
    reconcileActiveLimitedAbilityUses(
      [
        {
          presets: [limited, unlimited],
          selectedIds: [limited.id],
          sourceUnitIds: { [limited.id]: "legacy-self-unit" },
        },
      ],
      {},
    ),
    { "legacy-self-unit": { [limited.id]: 1 } },
  );
  assert.deepEqual(
    reconcileActiveLimitedAbilityUses(
      [
        {
          presets: [limited],
          selectedIds: [limited.id],
          sourceUnitIds: { [limited.id]: "army-unit-a" },
        },
      ],
      selection.uses,
    ),
    selection.uses,
  );
});

test("maps a limited formation ability to one saved source unit and fails closed if ambiguous", () => {
  const preset = { id: "datasheet:ability", usesPerBattle: 1 };
  const formation = {
    components: [
      { unit: { id: "saved-a" }, catalogueUnit: { combatPresets: [preset] } },
      { unit: { id: "saved-b" }, catalogueUnit: { combatPresets: [{ id: "other" }] } },
    ],
  };
  assert.deepEqual(savedFormationCombatPresetSourceUnitIds(formation), {
    [preset.id]: "saved-a",
    other: "saved-b",
  });
  formation.components[1].catalogueUnit.combatPresets.push(preset);
  assert.deepEqual(savedFormationCombatPresetSourceUnitIds(formation), { other: "saved-b" });
});
