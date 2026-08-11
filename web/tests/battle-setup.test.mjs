import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  battleFormation,
  battleFormationHealth,
  configureUnengagedBattleFormation,
  declareFormationDeployment,
  deployFormation,
  normalizeBattleState,
  replayBattleState,
  startBattle,
} from "../lib/battle-state.mjs";
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
    const aircraft = formation.deploymentTraits.aircraft;
    const hover = formation.deploymentTraits.hover;
    const location = aircraft && !hover ? "reserves" : "battlefield";
    next = declareFormationDeployment(
      next,
      formation.id,
      location,
      aircraft
        ? {
            aircraftMode: hover ? "hover" : "aircraft",
            eligibilityConfirmed: location === "reserves",
            eligibilityReason: location === "reserves" ? "Aircraft must start in Reserves" : "",
          }
        : {},
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
  assert.equal(state.version, 21);
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

test("locks every source-compatible friendly Transport option independently of the roster preset", () => {
  const trukk = catalogueUnit("Trukk");
  const boyz = catalogueUnit("Boyz");
  const list = {
    id: "list-transport-options",
    createdAt: 1,
    updatedAt: 31,
    name: "Transport options",
    factionId: trukk.factionId,
    units: [
      ...["trukk-a", "trukk-b"].map((id) => ({
        id,
        unitId: trukk.id,
        name: trukk.name,
        modelCount: 1,
        weapons: [],
      })),
      {
        id: "boyz",
        unitId: boyz.id,
        name: boyz.name,
        modelCount: 10,
        weapons: [],
        transportId: "trukk-a",
      },
    ],
  };
  const state = initializeBattleForLists({
    catalogue,
    firstList: list,
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    id: "battle-transport-options",
  });
  const formation = battleFormation(state, "player-1:boyz");
  assert.equal(formation.assignedTransportFormationId, "player-1:trukk-a");
  assert.deepEqual(
    formation.transportOptions.map((option) => option.transportFormationId),
    ["player-1:trukk-a", "player-1:trukk-b"],
  );
  assert.deepEqual(
    formation.transportOptions.map((option) => option.assignments[0].poolCapacity),
    [12, 12],
  );

  const oversizedState = initializeBattleForLists({
    catalogue,
    firstList: {
      ...list,
      id: "list-oversized-transport-options",
      units: list.units.map((unit) =>
        unit.id === "boyz" ? { ...unit, modelCount: 20, transportId: "" } : unit,
      ),
    },
    secondList: defenders,
    rulesSnapshot: "catalogue:test",
    id: "battle-oversized-transport-options",
  });
  const oversizedFormation = battleFormation(oversizedState, "player-1:boyz");
  assert.equal(oversizedFormation.assignedTransportFormationId, "");
  assert.deepEqual(
    oversizedFormation.transportOptions.map((option) => option.transportFormationId),
    ["player-1:trukk-a", "player-1:trukk-b"],
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
});

test("migrates a version-2 roster battle with explicit untimed provenance", () => {
  const versionTwo = structuredClone(legacySetup);
  versionTwo.version = 2;
  versionTwo.players[0].listUpdatedAt = attackers.updatedAt;
  versionTwo.players[1].listUpdatedAt = defenders.updatedAt;
  const migrated = setup(normalizeBattleState(versionTwo));
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 2,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTransportCompatibilityThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
    legacyHeroicInterventionThroughSequence: 3,
    legacyFireOverwatchThroughSequence: 3,
    legacyHazardousThroughSequence: 3,
    legacyGoToGroundThroughSequence: 3,
    legacyRangedDeclarationsThroughSequence: 3,
    legacySetupRulesThroughSequence: 3,
    legacyCounterOffensiveThroughSequence: 3,
  });
  assert.equal(migrated.events.at(-1).id, "legacy-attack");
});

test("migrates a partial version-1 log without changing attack ids or health", () => {
  const defenderFormation = savedFormationGroups(catalogue, defenders)[0];
  const equipment = savedFormationDefensiveEquipmentDefaults(defenderFormation);
  const sequence = savedFormationTargetSequence(defenderFormation, "", equipment);
  const legacy = normalizeBattleState(legacySetup);

  const migrated = setup(legacy);
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 1,
    legacyUntimedThroughSequence: 3,
    legacyUnactionedThroughSequence: 3,
    legacyDeploymentThroughSequence: 3,
    legacyTransportThroughSequence: 3,
    legacyTransportCompatibilityThroughSequence: 3,
    legacyTargetEligibilityThroughSequence: 3,
    legacyWeaponInventoryThroughSequence: 3,
    legacyWeaponBearersThroughSequence: 3,
    legacyChargeMovementThroughSequence: 3,
    legacyFightMovementThroughSequence: 3,
    legacyHeroicInterventionThroughSequence: 3,
    legacyFireOverwatchThroughSequence: 3,
    legacyHazardousThroughSequence: 3,
    legacyGoToGroundThroughSequence: 3,
    legacyRangedDeclarationsThroughSequence: 3,
    legacySetupRulesThroughSequence: 3,
    legacyCounterOffensiveThroughSequence: 3,
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
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 3,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).mission.name, "Custom mission");
});

test("migrates a version-4 tracker battle with explicit unactioned provenance", () => {
  const versionFour = structuredClone(setup());
  versionFour.version = 4;
  delete versionFour.migration;
  const migrated = setup(normalizeBattleState(versionFour));
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 4,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 2,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
  });
});

test("migrates a version-5 action battle as already deployed without rewriting its log", () => {
  const versionFive = structuredClone(setup());
  versionFive.version = 5;
  delete versionFive.migration;
  let migrated = setup(normalizeBattleState(versionFive));
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 5,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
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
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 6,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 2,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
  });
  assert.equal(replayBattleState(migrated).embarkedByFormation.size, 0);
});

test("migrates a version-7 Transport battle with explicit legacy target provenance", () => {
  const versionSeven = structuredClone(setup());
  versionSeven.version = 7;
  delete versionSeven.migration;
  const migrated = setup(normalizeBattleState(versionSeven));
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 7,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 2,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
  });
});

test("migrates a version-8 target-eligibility battle with locked weapon provenance", () => {
  const versionEight = structuredClone(setup());
  versionEight.version = 8;
  delete versionEight.migration;
  const migrated = setup(normalizeBattleState(versionEight));
  assert.equal(migrated.version, 21);
  assert.deepEqual(migrated.migration, {
    sourceVersion: 8,
    legacyUntimedThroughSequence: 0,
    legacyUnactionedThroughSequence: 0,
    legacyDeploymentThroughSequence: 2,
    legacyTransportThroughSequence: 0,
    legacyTransportCompatibilityThroughSequence: 2,
    legacyTargetEligibilityThroughSequence: 0,
    legacyWeaponInventoryThroughSequence: 2,
    legacyWeaponBearersThroughSequence: 2,
    legacyChargeMovementThroughSequence: 2,
    legacyFightMovementThroughSequence: 2,
    legacyHeroicInterventionThroughSequence: 2,
    legacyFireOverwatchThroughSequence: 2,
    legacyHazardousThroughSequence: 2,
    legacyGoToGroundThroughSequence: 2,
    legacyRangedDeclarationsThroughSequence: 2,
    legacySetupRulesThroughSequence: 2,
    legacyCounterOffensiveThroughSequence: 2,
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
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 9);
  assert.equal(migrated.migration.legacyWeaponInventoryThroughSequence, 0);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 2);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
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
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 10);
  assert.equal(migrated.migration.legacyWeaponBearersThroughSequence, 0);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
  assert.equal(battleFormation(migrated, "player-1:doom-scythe").weaponBearerTracking, "exact");
});

test("migrates version-11 charge movement with explicit Fight and reaction boundaries", () => {
  const versionEleven = structuredClone(setup());
  versionEleven.version = 11;
  delete versionEleven.migration;
  const migrated = setup(normalizeBattleState(versionEleven));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 11);
  assert.equal(migrated.migration.legacyChargeMovementThroughSequence, 0);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 2);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-12 Fight movement with an explicit Heroic Intervention boundary", () => {
  const versionTwelve = structuredClone(setup());
  versionTwelve.version = 12;
  delete versionTwelve.migration;
  const migrated = setup(normalizeBattleState(versionTwelve));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 12);
  assert.equal(migrated.migration.legacyFightMovementThroughSequence, 0);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 2);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-13 reactions with an explicit Fire Overwatch boundary", () => {
  const versionThirteen = structuredClone(setup());
  versionThirteen.version = 13;
  delete versionThirteen.migration;
  const migrated = setup(normalizeBattleState(versionThirteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 13);
  assert.equal(migrated.migration.legacyHeroicInterventionThroughSequence, 0);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 2);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-14 Fire Overwatch with an explicit Hazardous boundary", () => {
  const versionFourteen = structuredClone(setup());
  versionFourteen.version = 14;
  delete versionFourteen.migration;
  const migrated = setup(normalizeBattleState(versionFourteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 14);
  assert.equal(migrated.migration.legacyFireOverwatchThroughSequence, 0);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 2);
});

test("migrates version-15 Hazardous state with an explicit Go to Ground boundary", () => {
  const versionFifteen = structuredClone(setup());
  versionFifteen.version = 15;
  const migrated = setup(normalizeBattleState(versionFifteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 15);
  assert.equal(migrated.migration.legacyHazardousThroughSequence, 0);
  assert.equal(migrated.migration.legacyGoToGroundThroughSequence, 2);
});

test("migrates version-16 Go to Ground state with an explicit ranged declaration boundary", () => {
  const versionSixteen = structuredClone(setup());
  versionSixteen.version = 16;
  delete versionSixteen.migration;
  const migrated = setup(normalizeBattleState(versionSixteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 16);
  assert.equal(migrated.migration.legacyGoToGroundThroughSequence, 0);
  assert.equal(migrated.migration.legacyRangedDeclarationsThroughSequence, 2);
});

test("migrates version-17 declarations with an explicit Transport compatibility boundary", () => {
  const versionSeventeen = structuredClone(setup());
  versionSeventeen.version = 17;
  delete versionSeventeen.migration;
  const migrated = setup(normalizeBattleState(versionSeventeen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 17);
  assert.equal(migrated.migration.legacyRangedDeclarationsThroughSequence, 0);
  assert.equal(migrated.migration.legacyTransportCompatibilityThroughSequence, 2);
  assert.ok(
    migrated.events
      .filter((event) => event.type === "formation_registered")
      .every((event) => Array.isArray(event.formation.transportOptions)),
  );
});

test("migrates version-18 Transport compatibility state to nested deployment semantics", () => {
  const versionEighteen = structuredClone(setup());
  versionEighteen.version = 18;
  delete versionEighteen.migration;
  const eventIds = versionEighteen.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionEighteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 18);
  assert.equal(migrated.migration.legacyTransportCompatibilityThroughSequence, 0);
  assert.deepEqual(
    migrated.events.map((event) => event.id),
    eventIds,
  );
});

test("migrates version-19 nested Transport state across the setup-rules boundary", () => {
  const versionNineteen = structuredClone(setup());
  versionNineteen.version = 19;
  delete versionNineteen.migration;
  const eventIds = versionNineteen.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionNineteen));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 19);
  assert.equal(migrated.migration.legacySetupRulesThroughSequence, 2);
  assert.deepEqual(
    migrated.events.map((event) => event.id),
    eventIds,
  );
});

test("migrates version-20 setup state across the Counter-offensive boundary", () => {
  const versionTwenty = structuredClone(setup());
  versionTwenty.version = 20;
  delete versionTwenty.migration;
  const eventIds = versionTwenty.events.map((event) => event.id);
  const migrated = setup(normalizeBattleState(versionTwenty));
  assert.equal(migrated.version, 21);
  assert.equal(migrated.migration.sourceVersion, 20);
  assert.equal(migrated.migration.legacyCounterOffensiveThroughSequence, 2);
  assert.deepEqual(
    migrated.events.map((event) => event.id),
    eventIds,
  );
});
