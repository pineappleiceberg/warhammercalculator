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
  applyDefensiveEquipmentProfile,
  applyDefensiveEquipmentTargets,
  bearerEquipmentAvailableCount,
  bearerEquipmentCount,
  defensiveEquipmentSelectionKey,
  setBearerEquipmentCount,
} from "../lib/defensive-equipment.mjs";
import {
  bodyguardJoinerOptions,
  catalogueModelSegments,
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

function namedUnit(name) {
  const value = catalogue.units.find((candidate) => candidate.name === name);
  assert.ok(value, `Missing catalogue unit ${name}`);
  return value;
}

test("Unit vs Unit exposes published joined formations with exact model segments", () => {
  const guardians = namedUnit("Guardian Defenders");
  const conclave = namedUnit("Warlock Conclave");
  const windriders = namedUnit("Windriders");
  const skyrunners = namedUnit("Warlock Skyrunners");

  assert.deepEqual(
    bodyguardJoinerOptions(catalogue, guardians).map((candidate) => candidate.id),
    [conclave.id],
  );
  assert.deepEqual(
    bodyguardJoinerOptions(catalogue, windriders).map((candidate) => candidate.id),
    [skyrunners.id],
  );
  assert.deepEqual(bodyguardJoinerOptions(catalogue, namedUnit("Necron Warriors")), []);

  const guardianSegments = catalogueModelSegments(guardians, 11);
  assert.equal(guardianSegments.exact, true);
  assert.deepEqual(
    guardianSegments.segments.map((segment) => [segment.model.name, segment.modelCount]),
    [
      ["GUARDIAN DEFENDER", 10],
      ["HEAVY WEAPON PLATFORM", 1],
    ],
  );
  assert.equal(catalogueModelSegments(conclave, 2).exact, true);
});

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

test("Play Mode splits bearer equipment from unequipped models and preserves unit effects", () => {
  const bullgryn = namedUnit("Bullgryn Squad");
  const bullgrynFormation = savedFormationGroups(catalogue, {
    units: [
      {
        id: "bullgryn",
        unitId: bullgryn.id,
        name: bullgryn.name,
        modelCount: 3,
        weapons: [],
      },
    ],
  })[0];
  const shield = bullgryn.defensiveEquipment.find((option) => option.name === "Brute Shield");
  assert.ok(shield);
  const shieldKey = defensiveEquipmentSelectionKey("bullgryn", bullgryn.models[0].id, shield.id);
  const split = savedFormationTargetSequence(bullgrynFormation, "", { [shieldKey]: 1 });
  assert.deepEqual(
    split.targets.map((target) => [target.modelCount, target.defensiveEquipmentIds]),
    [
      [1, [shield.id]],
      [2, []],
    ],
  );
  assert.deepEqual(
    applyDefensiveEquipmentTargets(split.targets, bullgryn.defensiveEquipment).map(
      (target) => target.invulnerable,
    ),
    [4, 0],
  );

  const hearthkyn = namedUnit("Hearthkyn Warriors");
  const hearthkynFormation = savedFormationGroups(catalogue, {
    units: [
      {
        id: "hearthkyn",
        unitId: hearthkyn.id,
        name: hearthkyn.name,
        modelCount: 10,
        weapons: [],
      },
    ],
  })[0];
  const crest = hearthkyn.defensiveEquipment.find((option) => option.name === "Weavefield Crest");
  assert.ok(crest);
  const crestKey = defensiveEquipmentSelectionKey("hearthkyn", null, crest.id);
  const protectedUnit = savedFormationTargetSequence(hearthkynFormation, "", { [crestKey]: 1 });
  assert.deepEqual(
    applyDefensiveEquipmentTargets(protectedUnit.targets, hearthkyn.defensiveEquipment).map(
      (target) => target.invulnerable,
    ),
    [5],
  );
});

test("Model vs Model applies selected equipment only to matching attacks", () => {
  const hounds = namedUnit("Flesh Hounds");
  const collar = hounds.defensiveEquipment.find((option) => option.name === "Collar of Khorne");
  assert.ok(collar);
  const profile = { save: 7, invulnerable: 5, feelNoPain: 0, reduction: 0 };
  assert.equal(
    applyDefensiveEquipmentProfile(profile, hounds.defensiveEquipment, [collar.id], []).feelNoPain,
    0,
  );
  assert.equal(
    applyDefensiveEquipmentProfile(profile, hounds.defensiveEquipment, [collar.id], ["Psychic"])
      .feelNoPain,
    3,
  );
  assert.equal(
    applyDefensiveEquipmentProfile(profile, hounds.defensiveEquipment, [], ["Psychic"]).feelNoPain,
    0,
  );
});

test("Unit vs Unit creates reorderable bearer-only allocation segments", () => {
  const base = {
    id: "bullgryn-base",
    unitId: "bullgryn",
    modelId: 475,
    modelCount: 3,
    defensiveEquipmentIds: ["unit-effect"],
  };
  const other = {
    id: "other",
    unitId: "other",
    modelId: 1,
    modelCount: 1,
    defensiveEquipmentIds: [],
  };
  const bearerIds = new Set(["brute-shield", "other-shield"]);
  const split = setBearerEquipmentCount(
    [base, other],
    "bullgryn",
    475,
    "brute-shield",
    bearerIds,
    1,
    16,
    () => "bullgryn-equipped",
  );
  assert.deepEqual(
    split.map((segment) => [segment.id, segment.modelCount, segment.defensiveEquipmentIds]),
    [
      ["bullgryn-equipped", 1, ["unit-effect", "brute-shield"]],
      ["bullgryn-base", 2, ["unit-effect"]],
      ["other", 1, []],
    ],
  );
  assert.equal(bearerEquipmentCount(split, "bullgryn", 475, "brute-shield"), 1);
  assert.equal(bearerEquipmentAvailableCount(split, "bullgryn", 475, "brute-shield", bearerIds), 3);

  const reordered = [split[1], other, split[0]];
  const adjusted = setBearerEquipmentCount(
    reordered,
    "bullgryn",
    475,
    "brute-shield",
    bearerIds,
    2,
  );
  assert.deepEqual(
    adjusted.map((segment) => [segment.id, segment.modelCount]),
    [
      ["bullgryn-base", 1],
      ["other", 1],
      ["bullgryn-equipped", 2],
    ],
  );

  const otherShield = {
    ...base,
    id: "other-shield-model",
    modelCount: 1,
    defensiveEquipmentIds: ["other-shield"],
  };
  assert.equal(
    bearerEquipmentAvailableCount(
      [otherShield, ...split],
      "bullgryn",
      475,
      "brute-shield",
      bearerIds,
    ),
    3,
  );
  assert.throws(
    () =>
      setBearerEquipmentCount(
        [
          ...Array.from({ length: 15 }, (_, index) => ({
            ...other,
            id: `other-${index}`,
            modelId: index + 10,
          })),
          base,
        ],
        "bullgryn",
        475,
        "brute-shield",
        bearerIds,
        1,
      ),
    /at most 16/i,
  );
});
