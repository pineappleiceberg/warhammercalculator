import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveFiringDeckSelection } from "../lib/firing-deck.mjs";
import {
  transportAssignmentReport,
  transportCapacity,
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
