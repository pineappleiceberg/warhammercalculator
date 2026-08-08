import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachmentFormationReport,
  bodyguardJoinEligibility,
  leaderAttachmentEligibility,
  leaderFormationEligibility,
} from "../lib/attachments.mjs";
import { transportAssignmentReport } from "../lib/transport.mjs";
import {
  savedFormationForUnit,
  savedFormationGroups,
  savedFormationModelSegments,
  savedFormationTargetSequence,
} from "../lib/formations.mjs";

const catalogue = JSON.parse(
  await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
);

function unit(id) {
  const value = catalogue.units.find((candidate) => candidate.id === id);
  assert.ok(value, `Missing catalogue unit ${id}`);
  return value;
}

test("published Leader pairs allow only listed Bodyguard datasheets", () => {
  const captain = unit("000000073");
  const tactical = unit("000000070");
  const warriors = unit("000000534");
  const boyz = unit("000000016");

  assert.deepEqual(leaderAttachmentEligibility(captain, tactical), {
    eligible: true,
    reason: "",
  });
  assert.deepEqual(leaderAttachmentEligibility(captain, warriors), {
    eligible: false,
    reason: "Captain cannot lead Necron Warriors",
  });
  assert.match(leaderAttachmentEligibility(boyz, tactical).reason, /no published/i);
});

test("saved formations reject illegal pairs and expose exact attached membership", () => {
  const captain = unit("000000073");
  const tactical = unit("000000070");
  const warriors = unit("000000534");
  const legal = attachmentFormationReport(catalogue, {
    units: [
      { id: "captain", unitId: captain.id, name: captain.name, attachedToId: "tactical" },
      { id: "tactical", unitId: tactical.id, name: tactical.name },
    ],
  });
  assert.deepEqual(legal.errors, []);
  assert.deepEqual([...legal.attachedUnitIds].sort(), ["captain", "tactical"]);

  const illegalList = {
    units: [
      { id: "captain", unitId: captain.id, name: captain.name, attachedToId: "warriors" },
      { id: "warriors", unitId: warriors.id, name: warriors.name },
    ],
  };
  assert.deepEqual(attachmentFormationReport(catalogue, illegalList).errors, [
    "Captain cannot lead Necron Warriors",
  ]);
  assert.match(transportAssignmentReport(catalogue, illegalList).errors[0], /cannot lead/i);
});

test("Boyz require 20 models and a Warboss for a second Leader", () => {
  const warboss = unit("000000001");
  const banner = unit("000000022");
  const painboy = unit("000000013");
  const boyz = unit("000000016");
  assert.equal(leaderFormationEligibility(boyz, [warboss, banner], 20).eligible, true);
  assert.match(leaderFormationEligibility(boyz, [warboss, banner], 10).reason, /cannot have/i);
  assert.match(leaderFormationEligibility(boyz, [painboy, banner], 20).reason, /cannot have/i);

  const report = attachmentFormationReport(catalogue, {
    units: [
      { id: "warboss", unitId: warboss.id, name: warboss.name, attachedToId: "boyz" },
      { id: "banner", unitId: banner.id, name: banner.name, attachedToId: "boyz" },
      { id: "boyz", unitId: boyz.id, name: boyz.name, modelCount: 20 },
    ],
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.attachments.length, 2);
});

test("Kroot duplicate restriction and Leader exception pairs enforce the global two-Leader cap", () => {
  const carnivores = unit("000000413");
  const warShaper = unit("000003703");
  const trailShaper = unit("000003702");
  assert.equal(leaderFormationEligibility(carnivores, [warShaper, trailShaper], 20).eligible, true);
  assert.match(
    leaderFormationEligibility(carnivores, [warShaper, warShaper], 20).reason,
    /cannot have/i,
  );

  const tactical = unit("000000070");
  const captain = unit("000000073");
  const lieutenant = unit("000001346");
  const apothecary = unit("000002773");
  assert.equal(leaderFormationEligibility(tactical, [captain, lieutenant], 10).eligible, true);
  assert.match(
    leaderFormationEligibility(tactical, [captain, lieutenant, apothecary], 10).reason,
    /more than two/i,
  );
});

test("mandatory Leader and Bodyguard formation clauses reject undeployable saved units", () => {
  const datasmith = unit("000000846");
  const mandatoryLeader = attachmentFormationReport(catalogue, {
    units: [{ id: "datasmith", unitId: datasmith.id, name: datasmith.name, modelCount: 1 }],
  });
  assert.match(mandatoryLeader.errors[0], /must be attached/i);

  const companyHeroes = unit("000002772");
  const lieutenant = unit("000001346");
  const captain = unit("000000073");
  assert.match(leaderFormationEligibility(companyHeroes, [], 4).reason, /requires/i);
  assert.match(leaderFormationEligibility(companyHeroes, [lieutenant], 4).reason, /requires/i);
  assert.equal(leaderFormationEligibility(companyHeroes, [captain], 4).eligible, true);
});

test("same-Leader prohibitions and explicit Datasmith duplicates stay distinct", () => {
  const plagueMarines = unit("000001044");
  const blightspawn = unit("000001367");
  const putrifier = unit("000001368");
  assert.equal(
    leaderFormationEligibility(plagueMarines, [blightspawn, putrifier], 10).eligible,
    true,
  );
  assert.match(
    leaderFormationEligibility(plagueMarines, [blightspawn, blightspawn], 10).reason,
    /cannot have/i,
  );

  const kastelanRobots = unit("000000845");
  const datasmith = unit("000000846");
  assert.equal(
    leaderFormationEligibility(kastelanRobots, [datasmith, datasmith], 2).eligible,
    true,
  );
  assert.match(
    leaderFormationEligibility(kastelanRobots, [datasmith, datasmith, datasmith], 2).reason,
    /more than two/i,
  );
  const attached = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "datasmith",
        unitId: datasmith.id,
        name: datasmith.name,
        modelCount: 1,
        attachedToId: "robots",
      },
      { id: "robots", unitId: kastelanRobots.id, name: kastelanRobots.name, modelCount: 2 },
    ],
  });
  assert.deepEqual(attached.errors, []);
});

test("Captain attachment conditions use exact saved equipment selections", () => {
  const captain = unit("000000073");
  const bladeguard = unit("000000071");
  const hellblasters = unit("000002098");
  assert.match(leaderAttachmentEligibility(captain, bladeguard).reason, /relic shield/i);
  assert.equal(
    leaderAttachmentEligibility(captain, bladeguard, {
      choiceSelectionIds: ["000000073:1:7"],
    }).eligible,
    true,
  );
  assert.match(leaderAttachmentEligibility(captain, hellblasters).reason, /plasma pistol/i);
  assert.equal(
    leaderAttachmentEligibility(captain, hellblasters, {
      equippedWeaponGroupIds: ["000000073:5"],
    }).eligible,
    true,
  );
  const invalid = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "captain",
        unitId: captain.id,
        name: captain.name,
        modelCount: 1,
        weapons: [],
        attachedToId: "bladeguard",
      },
      {
        id: "bladeguard",
        unitId: bladeguard.id,
        name: bladeguard.name,
        modelCount: 3,
      },
    ],
  });
  assert.match(invalid.errors[0], /requires relic shield/i);
  const valid = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "captain",
        unitId: captain.id,
        name: captain.name,
        modelCount: 1,
        weapons: [],
        choiceSelections: { "000000073:1:7": 1 },
        attachedToId: "bladeguard",
      },
      {
        id: "bladeguard",
        unitId: bladeguard.id,
        name: bladeguard.name,
        modelCount: 3,
      },
    ],
  });
  assert.deepEqual(valid.errors, []);
});

test("Warlock joins preserve Bodyguard membership, exclusivity, and Starting Strength", () => {
  const conclave = unit("000000584");
  const guardians = unit("000000589");
  const windriders = unit("000000591");
  const farseer = unit("000000582");
  assert.equal(bodyguardJoinEligibility(conclave, guardians).eligible, true);
  assert.match(bodyguardJoinEligibility(conclave, windriders).reason, /cannot join/i);
  assert.match(
    bodyguardJoinEligibility(conclave, guardians, { isAttached: true }).reason,
    /Attached unit/i,
  );
  assert.match(
    bodyguardJoinEligibility(conclave, guardians, { existingSameJoiners: 1 }).reason,
    /more than 1/i,
  );

  const joined = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "farseer",
        unitId: farseer.id,
        name: farseer.name,
        modelCount: 1,
        attachedToId: "guardians",
      },
      {
        id: "conclave",
        unitId: conclave.id,
        name: conclave.name,
        modelCount: 2,
        joinedToId: "guardians",
      },
      {
        id: "guardians",
        unitId: guardians.id,
        name: guardians.name,
        modelCount: 11,
      },
    ],
  });
  assert.deepEqual(joined.errors, []);
  assert.equal(joined.startingStrengthByBodyguard.get("guardians"), 13);
  assert.deepEqual([...joined.joinedUnitIds].sort(), ["conclave", "guardians"]);
  assert.deepEqual([...joined.attachedUnitIds].sort(), ["conclave", "farseer", "guardians"]);

  const duplicate = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "conclave-1",
        unitId: conclave.id,
        name: conclave.name,
        modelCount: 2,
        joinedToId: "guardians",
      },
      {
        id: "conclave-2",
        unitId: conclave.id,
        name: conclave.name,
        modelCount: 2,
        joinedToId: "guardians",
      },
      {
        id: "guardians",
        unitId: guardians.id,
        name: guardians.name,
        modelCount: 11,
      },
    ],
  });
  assert.match(duplicate.errors[0], /cannot have more than 1/i);

  const alreadyAttached = attachmentFormationReport(catalogue, {
    units: [
      {
        id: "farseer",
        unitId: farseer.id,
        name: farseer.name,
        modelCount: 1,
        attachedToId: "conclave",
      },
      {
        id: "conclave",
        unitId: conclave.id,
        name: conclave.name,
        modelCount: 2,
        joinedToId: "guardians",
      },
      {
        id: "guardians",
        unitId: guardians.id,
        name: guardians.name,
        modelCount: 11,
      },
    ],
  });
  assert.match(alreadyAttached.errors.at(-1), /while it is an Attached unit/i);
});

test("saved formations expose one play unit with exact joined model profiles and weapons", () => {
  const farseer = unit("000000582");
  const conclave = unit("000000584");
  const guardians = unit("000000589");
  const armyList = {
    units: [
      {
        id: "farseer",
        unitId: farseer.id,
        name: farseer.name,
        modelCount: 1,
        weapons: [{ weaponId: farseer.weapons[0].id, name: farseer.weapons[0].name, count: 1 }],
        attachedToId: "guardians",
      },
      {
        id: "conclave",
        unitId: conclave.id,
        name: conclave.name,
        modelCount: 2,
        weapons: [{ weaponId: conclave.weapons[0].id, name: conclave.weapons[0].name, count: 2 }],
        joinedToId: "guardians",
      },
      {
        id: "guardians",
        unitId: guardians.id,
        name: guardians.name,
        modelCount: 11,
        weapons: [
          { weaponId: guardians.weapons[0].id, name: guardians.weapons[0].name, count: 10 },
        ],
      },
    ],
  };

  const groups = savedFormationGroups(catalogue, armyList);
  assert.equal(groups.length, 1);
  assert.equal(savedFormationForUnit(catalogue, armyList, "conclave")?.id, groups[0].id);
  assert.equal(groups[0].id, "guardians");
  assert.equal(groups[0].modelCount, 14);
  assert.equal(groups[0].attached, true);
  assert.deepEqual(
    groups[0].components.map((component) => [component.unit.id, component.role]),
    [
      ["guardians", "bodyguard"],
      ["conclave", "joined"],
      ["farseer", "leader"],
    ],
  );
  assert.deepEqual(
    groups[0].components.flatMap((component) =>
      component.unit.weapons.map((weapon) => weapon.name),
    ),
    [guardians.weapons[0].name, conclave.weapons[0].name, farseer.weapons[0].name],
  );

  const composition = savedFormationModelSegments(groups[0]);
  assert.deepEqual(composition.ambiguousComponents, []);
  assert.deepEqual(
    composition.segments.map((segment) => [
      segment.unitName,
      segment.model.name,
      segment.modelCount,
      segment.role,
    ]),
    [
      ["Guardian Defenders", "GUARDIAN DEFENDER", 10, "bodyguard"],
      ["Guardian Defenders", "HEAVY WEAPON PLATFORM", 1, "bodyguard"],
      ["Warlock Conclave", "Warlock Conclave", 2, "joined"],
      ["Farseer", "Farseer", 1, "leader"],
    ],
  );

  const conclaveId = composition.segments.find((segment) => segment.unitName === conclave.name).id;
  const farseerId = composition.segments.find((segment) => segment.unitName === farseer.name).id;
  const ordered = savedFormationTargetSequence(groups[0], conclaveId);
  assert.deepEqual(
    ordered.orderedSegments.map((segment) => segment.unitName),
    ["Warlock Conclave", "Guardian Defenders", "Guardian Defenders", "Farseer"],
  );
  assert.deepEqual(
    ordered.targets.map((target) => [
      target.modelCount,
      target.toughness,
      target.save,
      target.wounds,
    ]),
    [
      [2, 3, 6, 2],
      [10, 3, 4, 1],
      [1, 3, 4, 2],
      [1, 3, 6, 4],
    ],
  );
  assert.notEqual(savedFormationTargetSequence(groups[0], farseerId).first.id, farseerId);
});
