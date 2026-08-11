import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  advanceBattleClock,
  appendResolvedAttack,
  battleFormation,
  battleFormationHealth,
  configureUnengagedBattleFormation,
  declareFormationDeployment,
  deployFormation,
  normalizeBattleState,
  replayBattleState,
  recordFormationMovement,
  recordRangedTargetEligibility,
  startBattle,
  startFormationActivation,
} from "../lib/battle-state.mjs";
import { battleAttackWindow } from "../lib/battle-clock.mjs";
import { battleRosterRevisionsMatch, initializeBattleForLists } from "../lib/battle-setup.mjs";
import {
  battleTargetSequence,
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationTargetSequence,
} from "../lib/formations.mjs";

test("fails closed before exact bearer loadouts exceed the native allocation limit", () => {
  const orderedSegments = Array.from({ length: 17 }, (_, index) => ({
    id: `base-${index}`,
    role: "standalone",
  }));
  const targets = orderedSegments.map(() => ({ modelCount: 1 }));
  assert.throws(
    () =>
      battleTargetSequence(
        {
          orderedSegments,
          segments: orderedSegments,
          allocationOptions: orderedSegments,
          targets,
          first: orderedSegments[0],
        },
        {
          weaponBearerTracking: "exact",
          segments: orderedSegments.map((segment) => ({
            id: `${segment.id}:loadout:1`,
            baseSegmentId: segment.id,
            startingModels: 1,
            weaponCopies: [],
          })),
        },
      ),
    /16-segment damage allocation limit/,
  );
});

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
const heavyDeathRay = catalogueUnit("Doom Scythe").weapons.find(
  (weapon) => weapon.name === "Heavy death ray",
);
assert.ok(heavyDeathRay);
attackers.units[0].weapons = [
  {
    weaponId: heavyDeathRay.id,
    groupId: heavyDeathRay.groupId,
    name: heavyDeathRay.groupName,
    count: 1,
  },
];

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

function deployAllOnBattlefield(state) {
  let next = state;
  for (const formation of replayBattleState(next).formations.values()) {
    next = declareFormationDeployment(
      next,
      formation.id,
      "battlefield",
      {},
      `declare-${formation.id}`,
      next.events.length + 1,
    );
  }
  while (!replayBattleState(next).deploymentComplete) {
    const replayed = replayBattleState(next);
    const formation = [...replayed.formations.values()].find(
      (candidate) =>
        candidate.playerId === replayed.deploymentPriorityPlayerId &&
        !replayed.deployedFormationIds.has(candidate.id),
    );
    assert.ok(formation);
    next = deployFormation(
      next,
      formation.id,
      { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
      `deploy-${formation.id}`,
      next.events.length + 1,
    );
  }
  return next;
}

test("registers every formation on both rosters before combat with stable ids", () => {
  const state = setup();
  assert.equal(state.version, 12);
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

test("locks saved Transport assignments into exact battle formations", () => {
  const trukk = catalogueUnit("Trukk");
  const boyz = catalogueUnit("Boyz");
  const transportList = {
    id: "list-transports",
    createdAt: 1,
    updatedAt: 30,
    name: "Transport test",
    factionId: trukk.factionId,
    units: [
      {
        id: "trukk",
        unitId: trukk.id,
        name: trukk.name,
        modelCount: 1,
        weapons: [],
      },
      {
        id: "boyz",
        unitId: boyz.id,
        name: boyz.name,
        modelCount: 10,
        weapons: [],
        transportId: "trukk",
      },
    ],
  };
  const state = initializeBattleForLists({
    catalogue,
    firstList: transportList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    id: "battle-transport-setup",
  });
  assert.equal(
    battleFormation(state, "player-1:boyz").assignedTransportFormationId,
    "player-1:trukk",
  );
  assert.equal(battleFormation(state, "player-1:trukk").assignedTransportFormationId, "");
  const versionSix = structuredClone(state);
  versionSix.version = 6;
  delete versionSix.migration;
  const migrated = initializeBattleForLists({
    catalogue,
    firstList: transportList,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    state: normalizeBattleState(versionSix),
    id: "battle-transport-setup",
  });
  assert.equal(
    battleFormation(migrated, "player-1:boyz").assignedTransportFormationId,
    "player-1:trukk",
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
  state = startBattle(deployAllOnBattlefield(state), "player-1", "start-battle", 4);
  assert.throws(
    () => configureUnengagedBattleFormation(state, registration, "configure-after-start", 5),
    /locked after the battle starts/i,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(state, `advance-${state.events.length}`, state.events.length + 1);
  }
  state = recordFormationMovement(
    state,
    "player-1:doom-scythe",
    "stationary",
    "stationary",
    state.events.length + 1,
  );
  while (!battleAttackWindow(replayBattleState(state).clock)) {
    state = advanceBattleClock(state, `advance-${state.events.length}`, state.events.length + 1);
  }
  state = startFormationActivation(
    state,
    "player-1:doom-scythe",
    {},
    "start-activation",
    state.events.length + 1,
  );

  const target = battleFormation(state, targetId);
  const targets = target.segments.map((segment) => ({
    wounds: segment.wounds,
    modelCount: segment.startingModels,
  }));
  state = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: "player-1:doom-scythe",
      targetFormationId: targetId,
      weaponId: String(heavyDeathRay.id),
      weaponName: heavyDeathRay.name,
      weaponSourceFormationId: "player-1:doom-scythe",
      sourceSavedUnitId: "doom-scythe",
      weaponGroupId: heavyDeathRay.groupId,
      publishedRangeThousandths: 36000,
      effectiveRangeThousandths: 36000,
      measuredDistanceThousandths: 18000,
      visible: true,
      fullyVisible: true,
      eligibleWeaponCount: 1,
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Range and line of sight checked",
    },
    "death-ray-eligibility",
    state.events.length + 1,
  );
  state = appendResolvedAttack(state, {
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Target is visible and in range",
    targetEligibilityEventId: "death-ray-eligibility",
    weaponId: String(heavyDeathRay.id),
    declaredWeaponCount: 1,
    weaponSourceFormationId: "player-1:doom-scythe",
    sourceSavedUnitId: "doom-scythe",
    weaponGroupId: heavyDeathRay.groupId,
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
      weapon: heavyDeathRay.name,
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
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 2,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
  });
  assert.equal(migrated.events.at(-1).id, "legacy-attack");
});

test("migrates a partial version-1 log without changing attack ids or health", () => {
  const defenderFormation = savedFormationGroups(catalogue, defenders)[0];
  const equipment = savedFormationDefensiveEquipmentDefaults(defenderFormation);
  const sequence = savedFormationTargetSequence(defenderFormation, "", equipment);
  const legacy = normalizeBattleState(legacySetup);

  const migrated = setup(legacy);
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 1,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
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
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 3,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).mission.name, "Custom mission");
});

test("migrates a version-4 tracker battle with explicit unactioned provenance", () => {
  const versionFour = structuredClone(setup());
  versionFour.version = 4;
  delete versionFour.migration;
  const migrated = setup(normalizeBattleState(versionFour));
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 4,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
});

test("migrates a version-5 action battle as already deployed without rewriting its log", () => {
  const versionFive = structuredClone(setup());
  versionFive.version = 5;
  delete versionFive.migration;
  let migrated = setup(normalizeBattleState(versionFive));
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 5,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
  assert.equal(migrated.events.length, 2);
  migrated = startBattle(migrated, "player-1", "start-migrated", 3);
  const replayed = replayBattleState(migrated);
  assert.equal(replayed.deploymentComplete, true);
  assert.deepEqual([...replayed.offBattlefieldFormationIds], []);
  assert.equal(replayed.deploymentByFormation.get("player-1:doom-scythe").legacyAssumed, true);
});

test("migrates a version-6 deployment battle with explicit unembarked provenance", () => {
  const versionSix = structuredClone(setup());
  versionSix.version = 6;
  delete versionSix.migration;
  const migrated = setup(normalizeBattleState(versionSix));
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 6,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).embarkedByFormation.size, 0);
});

test("migrates a version-7 Transport battle with explicit legacy target provenance", () => {
  const versionSeven = structuredClone(setup());
  versionSeven.version = 7;
  delete versionSeven.migration;
  const migrated = setup(normalizeBattleState(versionSeven));
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 7,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
});

test("migrates a version-8 target-eligibility battle with locked weapon provenance", () => {
  const versionEight = structuredClone(setup());
  versionEight.version = 8;
  delete versionEight.migration;
  const migrated = setup(normalizeBattleState(versionEight));
  assert.equal(migrated.version, 12);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 8,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTargetEligibilityThroughSequence: 0,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
  });
  assert.ok(battleFormation(migrated, "player-1:doom-scythe").weaponInventory.length > 0);
});

test("migrates version-9 weapon inventory with explicit aggregate-bearer provenance", () => {
  const versionNine = structuredClone(setup());
  versionNine.version = 9;
  delete versionNine.migration;
  for (const event of versionNine.events) {
    if (!event.formation) continue;
    delete event.formation.weaponBearerTracking;
    delete event.formation.modelInstances;
    event.formation.weaponInventory = event.formation.weaponInventory.map((group) => {
      const legacy = { ...group };
      delete legacy.bearerModelIds;
      delete legacy.bearerAssignmentsReviewed;
      delete legacy.bearerAssignmentSource;
      return legacy;
    });
    event.formation.segments = event.formation.segments.map((segment) => {
      const legacy = { ...segment, id: segment.baseSegmentId ?? segment.id };
      delete legacy.baseSegmentId;
      delete legacy.modelIds;
      delete legacy.weaponCopies;
      return legacy;
    });
  }
  const migrated = setup(normalizeBattleState(versionNine));
  assert.equal(migrated.version, 12);
  assert.equal(migrated.migration.sourceVersion, 9);
  assert.equal(migrated.migration.legacyWeaponInventoryThroughSequence, 0);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 2);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(
    battleFormation(migrated, "player-1:doom-scythe").weaponBearerTracking,
    "legacy_aggregate",
  );

  const tampered = structuredClone(versionNine);
  tampered.events[0].formation.weaponInventory[0].name = "Changed after registration";
  assert.throws(
    () => setup(normalizeBattleState(tampered)),
    /weapon inventory no longer matches its locked battle formation/,
  );
});

test("migrates version-10 exact bearers with an explicit legacy charge boundary", () => {
  const versionTen = structuredClone(setup());
  versionTen.version = 10;
  delete versionTen.migration;
  const migrated = setup(normalizeBattleState(versionTen));
  assert.equal(migrated.version, 12);
  assert.equal(migrated.migration.sourceVersion, 10);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 0);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(battleFormation(migrated, "player-1:doom-scythe").weaponBearerTracking, "exact");
});

test("migrates version-11 charge movement with an explicit legacy Fight boundary", () => {
  const versionEleven = structuredClone(setup());
  versionEleven.version = 11;
  delete versionEleven.migration;
  const migrated = setup(normalizeBattleState(versionEleven));
  assert.equal(migrated.version, 12);
  assert.equal(migrated.migration.sourceVersion, 11);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 0);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
});
