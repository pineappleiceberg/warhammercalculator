import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveFiringDeckSelection } from "../lib/firing-deck.mjs";
import {
  transportAssignmentReport,
  transportCapacity,
  transportCapacityPools,
  transportPassengerEligibility,
} from "../lib/transport.mjs";

const catalogue = JSON.parse(
  await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
);

function unit(name, id) {
  const value = catalogue.units.find(
    (candidate) => candidate.name === name && (!id || candidate.id === id),
  );
  assert.ok(value, `Missing catalogue unit ${name}`);
  return value;
}

test("published Transport keywords and model-space costs gate passengers exactly", () => {
  const trukk = unit("Trukk");
  const boyz = unit("Boyz");
  const meganobz = unit("Meganobz");
  const stormboyz = unit("Stormboyz");
  assert.deepEqual(transportPassengerEligibility(trukk, boyz), {
    eligible: true,
    reason: "",
    modelCost: 1,
    poolPosition: 0,
    poolCapacity: 12,
    poolLabel: "primary",
  });
  assert.equal(transportPassengerEligibility(trukk, meganobz).modelCost, 2);
  const meganobWeapon = meganobz.weapons.find((weapon) => weapon.type === "Ranged");
  const firingDeckSelection = resolveFiringDeckSelection(catalogue, trukk, {
    passengerUnitId: meganobz.id,
    weaponId: meganobWeapon.id,
    modelCount: 6,
  });
  assert.equal(firingDeckSelection.modelCost, 1);
  assert.equal(firingDeckSelection.slots, 6);
  assert.equal(transportPassengerEligibility(trukk, stormboyz).eligible, false);
  assert.match(transportPassengerEligibility(trukk, stormboyz).reason, /exclusion/i);

  const stormChimera = unit("Storm Chimera", "000002379");
  const heavyWeapons = unit("Cadian Heavy Weapons Squad", "000000686");
  assert.equal(transportPassengerEligibility(stormChimera, heavyWeapons).modelCost, 2);
});

test("saved Transport assignments enforce membership and aggregate capacity", () => {
  const trukk = unit("Trukk");
  const boyz = unit("Boyz");
  const meganobz = unit("Meganobz");
  const army = {
    units: [
      { id: "trukk-1", unitId: trukk.id, name: trukk.name, modelCount: 1, weapons: [] },
      {
        id: "boyz-1",
        unitId: boyz.id,
        name: boyz.name,
        modelCount: 4,
        weapons: [],
        transportId: "trukk-1",
      },
      {
        id: "meganobz-1",
        unitId: meganobz.id,
        name: meganobz.name,
        modelCount: 4,
        weapons: [],
        transportId: "trukk-1",
      },
    ],
  };
  const legal = transportAssignmentReport(catalogue, army);
  assert.deepEqual(legal.errors, []);
  assert.equal(legal.assignments.length, 2);
  assert.equal(legal.slotsByTransport.get("trukk-1"), 12);

  const overCapacity = transportAssignmentReport(catalogue, {
    ...army,
    units: army.units.map((entry) =>
      entry.id === "meganobz-1" ? { ...entry, modelCount: 5 } : entry,
    ),
  });
  assert.match(overCapacity.errors[0], /uses 14 of 12/i);
  assert.deepEqual(overCapacity.assignments, []);

  const unassigned = transportAssignmentReport(catalogue, {
    ...army,
    units: army.units.map((entry) =>
      entry.id === "boyz-1" ? { ...entry, transportId: undefined } : entry,
    ),
  });
  assert.equal(
    unassigned.assignments.some((entry) => entry.passengerUnit.id === "boyz-1"),
    false,
  );
});

test("equipped capacity modifiers and circular assignments are deterministic", () => {
  const battlewagon = unit("Battlewagon");
  assert.equal(transportCapacity(battlewagon, { weapons: [] }), 22);
  assert.equal(
    transportCapacity(battlewagon, {
      weapons: [{ name: "killkannon", count: 1 }],
    }),
    12,
  );
  const report = transportAssignmentReport(catalogue, {
    units: [
      {
        id: "a",
        unitId: battlewagon.id,
        name: "Battlewagon A",
        modelCount: 1,
        weapons: [],
        transportId: "b",
      },
      {
        id: "b",
        unitId: battlewagon.id,
        name: "Battlewagon B",
        modelCount: 1,
        weapons: [],
        transportId: "a",
      },
    ],
  });
  assert.ok(report.errors.every((error) => /circular/i.test(error)));
});

test("independent Transport pools do not consume each other's capacity", () => {
  const stormraven = unit("Stormraven Gunship", "000001191");
  const tacticalSquad = unit("Tactical Squad", "000000070");
  const dreadnought = unit("Dreadnought", "000000117");
  assert.deepEqual(transportCapacityPools(stormraven), [
    {
      position: 0,
      capacity: 12,
      allowedKeywords: [["adeptus astartes", "infantry"]],
      label: "primary",
    },
    {
      position: 1,
      capacity: 1,
      allowedKeywords: [["dreadnought"]],
      label: "dreadnought",
    },
  ]);
  assert.equal(transportPassengerEligibility(stormraven, tacticalSquad).poolPosition, 0);
  assert.equal(transportPassengerEligibility(stormraven, dreadnought).poolPosition, 1);

  const army = {
    units: [
      {
        id: "stormraven",
        unitId: stormraven.id,
        name: stormraven.name,
        modelCount: 1,
        weapons: [],
      },
      {
        id: "tactical",
        unitId: tacticalSquad.id,
        name: tacticalSquad.name,
        modelCount: 12,
        weapons: [],
        transportId: "stormraven",
      },
      {
        id: "dreadnought",
        unitId: dreadnought.id,
        name: dreadnought.name,
        modelCount: 1,
        weapons: [],
        transportId: "stormraven",
      },
    ],
  };
  const legal = transportAssignmentReport(catalogue, army);
  assert.deepEqual(legal.errors, []);
  assert.equal(legal.slotsByTransport.get("stormraven"), 13);
  assert.equal(legal.poolSlotsByTransport.get("stormraven:0"), 12);
  assert.equal(legal.poolSlotsByTransport.get("stormraven:1"), 1);

  const tooManyDreadnoughts = transportAssignmentReport(catalogue, {
    ...army,
    units: army.units.map((entry) =>
      entry.id === "dreadnought" ? { ...entry, modelCount: 2 } : entry,
    ),
  });
  assert.match(tooManyDreadnoughts.errors[0], /uses 2 of 1.*dreadnought pool/i);
  assert.deepEqual(tooManyDreadnoughts.assignments, []);

  const ghostArk = unit("Ghost Ark", "000000543");
  const warriors = unit("Necron Warriors", "000000534");
  const overlord = unit("Overlord", "000000523");
  assert.equal(transportPassengerEligibility(ghostArk, warriors).poolPosition, 0);
  const characterPool = transportPassengerEligibility(ghostArk, overlord);
  assert.equal(characterPool.poolPosition, 1);
  assert.equal(characterPool.poolCapacity, 1);
});

test("Tacticus Characters use the published non-Tacticus attachment exception", () => {
  const rhino = unit("Rhino", "000002723");
  const captain = unit("Captain", "000000073");
  const tacticalSquad = unit("Tactical Squad", "000000070");
  const intercessors = unit("Intercessor Squad", "000001157");
  assert.equal(rhino.transport.exactRules, true);
  assert.equal(transportPassengerEligibility(rhino, captain).eligible, false);
  assert.equal(
    transportPassengerEligibility(rhino, captain, { attachedUnit: tacticalSquad }).eligible,
    true,
  );
  assert.equal(
    transportPassengerEligibility(rhino, captain, { attachedUnit: intercessors }).eligible,
    false,
  );
  assert.match(
    transportPassengerEligibility(rhino, captain, { attachedUnit: captain }).reason,
    /itself/i,
  );
  assert.match(
    transportPassengerEligibility(rhino, captain, { attachedUnit: unit("Boyz") }).reason,
    /same faction/i,
  );

  const rangedWeapon = captain.weapons.find((weapon) => weapon.type === "Ranged");
  const firingDeck = resolveFiringDeckSelection(catalogue, rhino, {
    passengerUnitId: captain.id,
    attachedUnitId: tacticalSquad.id,
    weaponId: rangedWeapon.id,
    modelCount: 1,
  });
  assert.equal(firingDeck.attachedUnitId, tacticalSquad.id);

  const formation = {
    units: [
      { id: "rhino", unitId: rhino.id, name: rhino.name, modelCount: 1, weapons: [] },
      {
        id: "captain",
        unitId: captain.id,
        name: captain.name,
        modelCount: 1,
        weapons: [],
        attachedToId: "tactical",
        transportId: "rhino",
      },
      {
        id: "tactical",
        unitId: tacticalSquad.id,
        name: tacticalSquad.name,
        modelCount: 10,
        weapons: [],
        transportId: "rhino",
      },
    ],
  };
  const legal = transportAssignmentReport(catalogue, formation);
  assert.deepEqual(legal.errors, []);
  assert.equal(legal.assignments.length, 2);
  assert.equal(legal.slotsByTransport.get("rhino"), 11);

  const splitFormation = transportAssignmentReport(catalogue, {
    ...formation,
    units: formation.units.map((entry) =>
      entry.id === "tactical" ? { ...entry, transportId: undefined } : entry,
    ),
  });
  assert.match(splitFormation.errors[0], /must embark in the same Transport/i);
  assert.deepEqual(splitFormation.assignments, []);

  const missingAttachment = transportAssignmentReport(catalogue, {
    units: [
      {
        id: "captain",
        unitId: captain.id,
        name: captain.name,
        modelCount: 1,
        weapons: [],
        attachedToId: "missing",
      },
    ],
  });
  assert.match(missingAttachment.errors[0], /not in this list/i);

  const circularAttachment = transportAssignmentReport(catalogue, {
    units: [
      {
        id: "captain",
        unitId: captain.id,
        name: captain.name,
        modelCount: 1,
        weapons: [],
        attachedToId: "tactical",
      },
      {
        id: "tactical",
        unitId: tacticalSquad.id,
        name: tacticalSquad.name,
        modelCount: 10,
        weapons: [],
        attachedToId: "captain",
      },
    ],
  });
  assert.ok(circularAttachment.errors.every((error) => /circular attachment/i.test(error)));
});

test("Aeldari Transports apply Ynnari exceptions only to the published exclusion", () => {
  const waveSerpent = unit("Wave Serpent", "000000599");
  const yvraine = unit("Yvraine", "000002542");
  const visarch = unit("The Visarch", "000002543");
  const ynnariKabalites = unit("Ynnari Kabalite Warriors", "000003916");
  const warpSpiders = unit("Warp Spiders", "000000601");

  assert.equal(waveSerpent.transport.exactRules, true);
  assert.deepEqual(waveSerpent.transport.excluded, [
    {
      keywords: ["jump pack"],
      minimumWounds: null,
      nonCharacter: false,
      attachmentException: null,
      keywordExceptions: [],
    },
    {
      keywords: ["ynnari"],
      minimumWounds: null,
      nonCharacter: false,
      attachmentException: null,
      keywordExceptions: [["asuryani"], ["yvraine"], ["the visarch"]],
    },
  ]);
  assert.equal(transportPassengerEligibility(waveSerpent, yvraine).eligible, true);
  assert.equal(transportPassengerEligibility(waveSerpent, visarch).eligible, true);
  assert.equal(transportPassengerEligibility(waveSerpent, ynnariKabalites).eligible, false);
  assert.equal(transportPassengerEligibility(waveSerpent, warpSpiders).eligible, false);
});
