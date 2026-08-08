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
  savedFormationDefensiveEquipmentDefaults,
  savedFormationGroups,
  savedFormationModelSegments,
  savedFormationTargetSequence,
  savedUnitDefensiveEquipmentDefaults,
  savedUnitDefensiveEquipmentWarnings,
} from "../lib/formations.mjs";
import {
  compositionLoadoutSubjectCounts,
  defaultLoadoutSubjectCounts,
  defaultWeaponCounts,
  loadoutSubjectWarnings,
  rebaseCompositionLoadoutSubjectCounts,
} from "../lib/loadout.mjs";

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
    protectedUnit.segments.map((segment) => [segment.model.name, segment.modelCount]),
    [
      ["Theyn", 1],
      ["Hearthkyn Warriors", 9],
    ],
  );
  assert.deepEqual(
    applyDefensiveEquipmentTargets(protectedUnit.targets, hearthkyn.defensiveEquipment).map(
      (target) => target.invulnerable,
    ),
    [5, 5],
  );
});

test("saved defensive equipment initializes Play Mode without preventing battle overrides", () => {
  const bullgryn = namedUnit("Bullgryn Squad");
  const shield = bullgryn.defensiveEquipment.find((option) => option.name === "Brute Shield");
  assert.ok(shield);
  const shieldKey = defensiveEquipmentSelectionKey("bullgryn", bullgryn.models[0].id, shield.id);
  const formation = savedFormationGroups(catalogue, {
    units: [
      {
        id: "bullgryn",
        unitId: bullgryn.id,
        name: bullgryn.name,
        modelCount: 3,
        weapons: [],
        defensiveEquipmentCounts: { [shieldKey]: 4, stale: 1 },
      },
    ],
  })[0];
  const defaults = savedFormationDefensiveEquipmentDefaults(formation);
  assert.deepEqual(defaults, { [shieldKey]: 3 });
  const hearthkyn = namedUnit("Hearthkyn Warriors");
  const crest = hearthkyn.defensiveEquipment.find((option) => option.name === "Weavefield Crest");
  assert.ok(crest);
  const crestKey = defensiveEquipmentSelectionKey("hearthkyn", null, crest.id);
  assert.deepEqual(
    savedFormationDefensiveEquipmentDefaults({
      components: [
        ...formation.components,
        {
          unit: {
            id: "hearthkyn",
            unitId: hearthkyn.id,
            name: hearthkyn.name,
            modelCount: 10,
            defensiveEquipmentCounts: { [crestKey]: 1 },
          },
          catalogueUnit: hearthkyn,
        },
      ],
    }),
    { [shieldKey]: 3, [crestKey]: 1 },
  );
  assert.deepEqual(
    savedFormationTargetSequence(formation, "", defaults).targets.map((target) => [
      target.modelCount,
      target.defensiveEquipmentIds,
    ]),
    [[3, [shield.id]]],
  );
  assert.deepEqual(
    savedFormationTargetSequence(formation, "", { ...defaults, [shieldKey]: 1 }).targets.map(
      (target) => [target.modelCount, target.defensiveEquipmentIds],
    ),
    [
      [1, [shield.id]],
      [2, []],
    ],
  );
});

test("source-backed defensive defaults prefill only eligible proven equipment", () => {
  const hearthkyn = namedUnit("Hearthkyn Warriors");
  const crest = hearthkyn.defensiveEquipment.find((option) => option.name === "Weavefield Crest");
  const savedHearthkyn = {
    id: "hearthkyn",
    unitId: hearthkyn.id,
    name: hearthkyn.name,
    modelCount: 10,
  };
  const crestKey = defensiveEquipmentSelectionKey("hearthkyn", null, crest.id);
  assert.equal(crest.selectionKind, "default");
  assert.deepEqual(savedUnitDefensiveEquipmentDefaults(savedHearthkyn, hearthkyn), {
    [crestKey]: 1,
  });
  assert.deepEqual(
    savedUnitDefensiveEquipmentDefaults(
      { ...savedHearthkyn, defensiveEquipmentCounts: {} },
      hearthkyn,
    ),
    {},
  );

  const hounds = namedUnit("Flesh Hounds");
  const collar = hounds.defensiveEquipment.find((option) => option.name === "Collar of Khorne");
  assert.ok(collar);
  const collarKey = defensiveEquipmentSelectionKey("hounds", hounds.models[0].id, collar.id);
  assert.equal(collar.eligibilityExact, true);
  assert.deepEqual(
    savedUnitDefensiveEquipmentDefaults(
      { id: "hounds", unitId: hounds.id, name: hounds.name, modelCount: 5 },
      hounds,
    ),
    { [collarKey]: 5 },
  );

  const voidscarred = unit("000002532");
  const stones = voidscarred.defensiveEquipment.find(
    (option) => option.name === "Channeller Stones",
  );
  assert.ok(stones);
  const stonesKey = defensiveEquipmentSelectionKey("voidscarred", null, stones.id);
  assert.deepEqual(
    savedUnitDefensiveEquipmentDefaults(
      {
        id: "voidscarred",
        unitId: voidscarred.id,
        name: voidscarred.name,
        modelCount: 5,
        loadoutSubjectCounts: { "000002532:3": 1 },
      },
      voidscarred,
    ),
    { [stonesKey]: 1 },
  );

  const direAvengers = namedUnit("Dire Avengers");
  const shimmershield = direAvengers.defensiveEquipment.find(
    (option) => option.name === "Shimmershield",
  );
  assert.ok(shimmershield);
  assert.deepEqual(shimmershield.eligibleModelIds, [370]);
  assert.equal(shimmershield.selectionKind, "optional");
  assert.deepEqual(
    savedUnitDefensiveEquipmentDefaults(
      {
        id: "avengers",
        unitId: direAvengers.id,
        name: direAvengers.name,
        modelCount: 5,
      },
      direAvengers,
    ),
    {},
  );
});

test("defensive equipment source bounds require explicit saved-list overrides", () => {
  const veterans = namedUnit("Deathwatch Veterans");
  const shield = veterans.defensiveEquipment.find((option) => option.name === "Astartes Shield");
  assert.ok(shield);
  assert.equal(shield.maximumKind, "per_increment");
  assert.equal(shield.maximumValue, 2);
  assert.equal(shield.maximumModelsPerIncrement, 5);
  const shieldKey = defensiveEquipmentSelectionKey("veterans", veterans.models[0].id, shield.id);
  const invalidVeterans = {
    id: "veterans",
    unitId: veterans.id,
    name: veterans.name,
    modelCount: 5,
    defensiveEquipmentCounts: { [shieldKey]: 3, "other-unit::7::other-option": 1 },
  };
  assert.deepEqual(
    savedUnitDefensiveEquipmentWarnings(invalidVeterans, veterans).map((warning) => [
      warning.key,
      warning.reason,
    ]),
    [[shield.id, null]],
  );
  assert.match(
    savedUnitDefensiveEquipmentWarnings(invalidVeterans, veterans)[0].message,
    /maximum of 2 for 5 models/i,
  );
  assert.equal(
    savedUnitDefensiveEquipmentWarnings(
      {
        ...invalidVeterans,
        defensiveEquipmentOverrides: { [shield.id]: "narrative" },
      },
      veterans,
    )[0].reason,
    "narrative",
  );
  assert.match(
    savedUnitDefensiveEquipmentWarnings(
      {
        ...invalidVeterans,
        defensiveEquipmentCounts: {
          [shieldKey]: 2,
          "veterans::999999::retired-equipment": 1,
        },
      },
      veterans,
    )[0].message,
    /unknown or ineligible/i,
  );

  const hounds = namedUnit("Flesh Hounds");
  const collar = hounds.defensiveEquipment.find((option) => option.name === "Collar of Khorne");
  assert.ok(collar);
  const collarKey = defensiveEquipmentSelectionKey("hounds", hounds.models[0].id, collar.id);
  const missingCollars = savedUnitDefensiveEquipmentWarnings(
    {
      id: "hounds",
      unitId: hounds.id,
      name: hounds.name,
      modelCount: 5,
      defensiveEquipmentCounts: { [collarKey]: 4 },
    },
    hounds,
  );
  assert.equal(collar.minimumKind, "default");
  assert.match(missingCollars[0].message, /required source minimum of 5/i);

  const hearthguard = namedUnit("Einhyr Hearthguard");
  assert.deepEqual(
    savedUnitDefensiveEquipmentWarnings(
      {
        id: "hearthguard",
        unitId: hearthguard.id,
        name: hearthguard.name,
        modelCount: 5,
        defensiveEquipmentCounts: {},
      },
      hearthguard,
    ),
    [],
  );
});

test("grouped Veteran statlines expose exact composition-backed shield bearers", () => {
  const command = namedUnit("Command Squad");
  assert.deepEqual(
    catalogueModelSegments(command, 5).segments.map(({ model, modelCount }) => [
      model.name,
      modelCount,
      model.sourceModelId,
    ]),
    [
      ["Apothecary", 1, 953],
      ["Company Ancient", 1, 953],
      ["Company Champion", 1, 953],
      ["Company Veterans", 2, 953],
    ],
  );
  const commandShield = command.defensiveEquipment.find(
    (option) => option.name === "Astartes Shield",
  );
  assert.ok(commandShield);
  assert.equal(commandShield.eligibilityExact, true);
  assert.equal(commandShield.limitExact, true);
  assert.deepEqual(
    command.models
      .filter((model) => commandShield.eligibleModelIds.includes(model.id))
      .map((model) => model.name),
    ["Company Champion", "Company Veterans"],
  );
  const champion = command.models.find((model) => model.name === "Company Champion");
  const veterans = command.models.find((model) => model.name === "Company Veterans");
  const commandSaved = {
    id: "command",
    unitId: command.id,
    name: command.name,
    modelCount: 5,
  };
  assert.deepEqual(savedUnitDefensiveEquipmentDefaults(commandSaved, command), {
    [defensiveEquipmentSelectionKey("command", champion.id, commandShield.id)]: 1,
  });
  assert.deepEqual(
    savedUnitDefensiveEquipmentDefaults(
      {
        ...commandSaved,
        defensiveEquipmentCounts: {
          [defensiveEquipmentSelectionKey("command", champion.sourceModelId, commandShield.id)]: 3,
        },
      },
      command,
    ),
    {
      [defensiveEquipmentSelectionKey("command", champion.id, commandShield.id)]: 1,
      [defensiveEquipmentSelectionKey("command", veterans.id, commandShield.id)]: 2,
    },
  );
  assert.deepEqual(
    savedUnitDefensiveEquipmentWarnings(
      {
        ...commandSaved,
        defensiveEquipmentCounts: {
          [defensiveEquipmentSelectionKey("command", champion.sourceModelId, commandShield.id)]: 3,
        },
      },
      command,
    ),
    [],
  );
  assert.match(
    savedUnitDefensiveEquipmentWarnings(
      {
        ...commandSaved,
        defensiveEquipmentCounts: {
          [defensiveEquipmentSelectionKey("command", champion.id, commandShield.id)]: 1,
          [defensiveEquipmentSelectionKey("command", veterans.id, commandShield.id)]: 3,
        },
      },
      command,
    )[0].message,
    /maximum of 3 for 5 models/i,
  );

  const bikes = namedUnit("Company Veterans On Bikes");
  assert.deepEqual(
    catalogueModelSegments(bikes, 5).segments.map(({ model, modelCount }) => [
      model.name,
      modelCount,
    ]),
    [
      ["Veteran Biker Sergeant", 1],
      ["Veteran Bikers", 4],
    ],
  );
  const stormShield = bikes.defensiveEquipment.find((option) => option.name === "Storm Shield");
  const bikeVeterans = bikes.models.find((model) => model.name === "Veteran Bikers");
  assert.ok(stormShield);
  assert.equal(stormShield.eligibilityExact, true);
  assert.equal(stormShield.limitExact, true);
  assert.deepEqual(
    bikes.models
      .filter((model) => stormShield.eligibleModelIds.includes(model.id))
      .map((model) => model.name),
    ["Veteran Bikers"],
  );
  assert.match(
    savedUnitDefensiveEquipmentWarnings(
      {
        id: "bikes",
        unitId: bikes.id,
        name: bikes.name,
        modelCount: 5,
        defensiveEquipmentCounts: {
          [defensiveEquipmentSelectionKey("bikes", bikeVeterans.id, stormShield.id)]: 5,
        },
      },
      bikes,
    )[0].message,
    /maximum of 4 for 5 models/i,
  );
});

test("simple source compositions expose exact bearer identities and recover grouped IDs", () => {
  const assault = namedUnit("Assault Squad");
  const segments = catalogueModelSegments(assault, 5);
  assert.equal(segments.exact, true);
  assert.deepEqual(
    segments.segments.map(({ model, modelCount }) => [model.name, modelCount]),
    [
      ["Assault Sergeant", 1],
      ["Assault Marines", 4],
    ],
  );
  const shield = assault.defensiveEquipment.find((option) => option.name === "Astartes Shield");
  const sergeant = assault.models.find((model) => model.name === "Assault Sergeant");
  assert.ok(shield);
  assert.equal(shield.eligibilityExact, true);
  assert.deepEqual(shield.eligibleModelIds, [sergeant.id]);

  const legacyKey = defensiveEquipmentSelectionKey("assault", sergeant.sourceModelId, shield.id);
  const formation = savedFormationGroups(catalogue, {
    units: [
      {
        id: "assault",
        unitId: assault.id,
        name: assault.name,
        modelCount: 5,
        defensiveEquipmentCounts: { [legacyKey]: 1 },
      },
    ],
  })[0];
  const legacySegmentId = `assault:${sergeant.sourceModelId}:equipment:${shield.id}`;
  const recovered = savedFormationTargetSequence(formation, legacySegmentId, {
    [legacyKey]: 1,
  });
  assert.equal(recovered.first.model.name, "Assault Sergeant");
  assert.deepEqual(recovered.first.defensiveEquipmentIds, [shield.id]);
  assert.equal(recovered.first.id, `assault:${sergeant.id}:equipment:${shield.id}`);

  const breachers = namedUnit("Imperial Navy Breachers");
  const endurant = breachers.defensiveEquipment.find((option) => option.name === "Endurant Shield");
  assert.ok(endurant);
  assert.equal(endurant.eligibilityExact, true);
  assert.deepEqual(
    breachers.models
      .filter((model) => endurant.eligibleModelIds.includes(model.id))
      .map((model) => model.name),
    ["Navis Armsmen"],
  );

  const deathwatch = namedUnit("Deathwatch Veterans");
  assert.equal(
    deathwatch.defensiveEquipment.find((option) => option.name === "Astartes Shield")
      .eligibilityExact,
    true,
  );
  assert.equal(
    namedUnit("Mortifiers").defensiveEquipment.find(
      (option) => option.name === "Anchorite Sarcophagus",
    ).eligibilityExact,
    true,
  );
});

test("optional specialists resolve exact Voidscarred and Spectrus compositions", () => {
  for (const datasheetId of ["000002532", "000004169"]) {
    const voidscarred = unit(datasheetId);
    const sourceModelId = voidscarred.models[0].sourceModelId;
    assert.equal(voidscarred.models.length, 5);
    assert.ok(voidscarred.models.every((model) => model.sourceModelId === sourceModelId));
    const compositionCounts = {
      [`${datasheetId}:2`]: 1,
      [`${datasheetId}:3`]: 1,
      [`${datasheetId}:4`]: 1,
    };
    assert.deepEqual(defaultLoadoutSubjectCounts(voidscarred), {
      [`${datasheetId}:1`]: 5,
      [`${datasheetId}:2`]: 0,
      [`${datasheetId}:3`]: 0,
      [`${datasheetId}:4`]: 0,
    });
    assert.deepEqual(compositionLoadoutSubjectCounts(voidscarred, 10, compositionCounts), {
      [`${datasheetId}:1`]: 7,
      ...compositionCounts,
    });
    const composition = catalogueModelSegments(voidscarred, 10, compositionCounts);
    assert.equal(composition.exact, true);
    assert.deepEqual(
      composition.segments.map(({ model, modelCount }) => [model.name, modelCount]),
      [
        ["Voidscarred Felarch", 1],
        ["Corsair Voidscarred", 6],
        ["Shade Runner", 1],
        ["Soul Weaver", 1],
        ["Way Seeker", 1],
      ],
    );
    const stones = voidscarred.defensiveEquipment.find(
      (option) => option.name === "Channeller Stones",
    );
    const mistshield = voidscarred.defensiveEquipment.find(
      (option) => option.name === "Mistshield",
    );
    assert.equal(stones.eligibilityExact, true);
    assert.equal(mistshield.eligibilityExact, true);
    assert.deepEqual(
      stones.eligibleModelIds.map((id) => voidscarred.models.find((model) => model.id === id).name),
      ["Soul Weaver"],
    );
    assert.deepEqual(
      mistshield.eligibleModelIds.map(
        (id) => voidscarred.models.find((model) => model.id === id).name,
      ),
      ["Voidscarred Felarch"],
    );
    const saved = {
      id: `voidscarred-${datasheetId}`,
      unitId: datasheetId,
      name: voidscarred.name,
      modelCount: 10,
      loadoutSubjectCounts: compositionCounts,
    };
    const formation = savedFormationGroups(catalogue, { units: [saved] })[0];
    assert.deepEqual(
      savedFormationModelSegments(formation).segments.map(({ model, modelCount }) => [
        model.name,
        modelCount,
      ]),
      composition.segments.map(({ model, modelCount }) => [model.name, modelCount]),
    );
    const stonesKey = defensiveEquipmentSelectionKey(saved.id, null, stones.id);
    assert.deepEqual(savedUnitDefensiveEquipmentDefaults(saved, voidscarred), {
      [stonesKey]: 1,
    });
    assert.match(
      loadoutSubjectWarnings(
        voidscarred,
        10,
        { ...compositionCounts, [`${datasheetId}:2`]: 2 },
        {},
      )[0],
      /do not form a legal/i,
    );
  }

  for (const datasheetId of ["000002779", "000003827"]) {
    const spectrus = unit(datasheetId);
    const optionalCounts = Object.fromEntries(
      spectrus.compositionModels
        .filter((model) => model.loadoutSubjectId)
        .map((model, index) => [model.loadoutSubjectId, index === 0 ? 1 : 0]),
    );
    const composition = catalogueModelSegments(spectrus, 5, optionalCounts);
    assert.equal(composition.exact, true);
    assert.equal(composition.segments[0].model.name, "Kill Team Infiltrators");
    assert.equal(
      composition.segments.reduce((total, segment) => total + segment.modelCount, 0),
      5,
    );
    const helix = spectrus.defensiveEquipment.find((option) => option.name === "Helix Gauntlet");
    assert.equal(helix.eligibilityExact, true);
    assert.deepEqual(
      helix.eligibleModelIds.map((id) => spectrus.models.find((model) => model.id === id).name),
      ["Kill Team Infiltrators"],
    );
  }
});

test("named Kill Team and Wardens profiles resolve exact equipment bearers", () => {
  for (const datasheetId of ["000004174", "000004175"]) {
    const killTeam = unit(datasheetId);
    assert.deepEqual(
      killTeam.models.map((model) => model.name),
      [
        "Kill Team Sergeant",
        "Gravis Veteran",
        "Deathwatch Veteran with stalker bolt rifle",
        "Deathwatch Veteran with heavy thunder hammer",
        "Deathwatch Veteran with marksman bolt carbine",
        "Deathwatch Veteran with xenophase blade",
      ],
    );
    assert.deepEqual(
      catalogueModelSegments(killTeam, 5).segments.map(({ model, modelCount }) => [
        model.name,
        modelCount,
      ]),
      [
        ["Kill Team Sergeant", 1],
        ["Gravis Veteran", 1],
        ["Deathwatch Veteran with stalker bolt rifle", 1],
        ["Deathwatch Veteran with heavy thunder hammer", 1],
        ["Deathwatch Veteran with marksman bolt carbine", 1],
      ],
    );
    assert.deepEqual(defaultLoadoutSubjectCounts(killTeam), {
      [`${datasheetId}:1`]: 1,
      [`${datasheetId}:2`]: 1,
      [`${datasheetId}:3`]: 1,
      [`${datasheetId}:4`]: 1,
      [`${datasheetId}:5`]: 1,
      [`${datasheetId}:6`]: 0,
    });
    assert.deepEqual(compositionLoadoutSubjectCounts(killTeam, 10), {
      [`${datasheetId}:1`]: 1,
      [`${datasheetId}:2`]: 2,
      [`${datasheetId}:3`]: 2,
      [`${datasheetId}:4`]: 2,
      [`${datasheetId}:5`]: 2,
      [`${datasheetId}:6`]: 1,
    });
    const customCounts = {
      [`${datasheetId}:1`]: 1,
      [`${datasheetId}:2`]: 1,
      [`${datasheetId}:3`]: 0,
      [`${datasheetId}:4`]: 1,
      [`${datasheetId}:5`]: 2,
      [`${datasheetId}:6`]: 0,
    };
    assert.deepEqual(compositionLoadoutSubjectCounts(killTeam, 5, customCounts), customCounts);
    assert.deepEqual(
      rebaseCompositionLoadoutSubjectCounts(killTeam, 5, 10, defaultLoadoutSubjectCounts(killTeam)),
      compositionLoadoutSubjectCounts(killTeam, 10),
    );
    assert.deepEqual(
      rebaseCompositionLoadoutSubjectCounts(killTeam, 5, 10, customCounts),
      customCounts,
    );
    const counts = defaultWeaponCounts(killTeam, 5, defaultLoadoutSubjectCounts(killTeam));
    const weaponCount = (name) =>
      counts[killTeam.weapons.find((weapon) => weapon.groupName === name).groupId];
    assert.equal(weaponCount("Infernus heavy bolter"), 1);
    assert.equal(weaponCount("Heavy thunder hammer"), 1);
    assert.equal(weaponCount("Xenophase blade"), 0);
    assert.equal(catalogueModelSegments(killTeam, 6).exact, false);
    const shield = killTeam.defensiveEquipment.find((option) => option.name === "Astartes Shield");
    assert.equal(shield.eligibilityExact, true);
    assert.deepEqual(
      shield.eligibleModelIds.map((id) => killTeam.models.find((model) => model.id === id).name),
      ["Deathwatch Veteran with heavy thunder hammer"],
    );
    const shieldBearer = killTeam.models.find(
      (model) => model.name === "Deathwatch Veteran with heavy thunder hammer",
    );
    const legacySavedId = `legacy-${datasheetId}`;
    const legacyShieldKey = defensiveEquipmentSelectionKey(
      legacySavedId,
      shieldBearer.sourceModelId,
      shield.id,
    );
    assert.deepEqual(
      savedUnitDefensiveEquipmentDefaults(
        {
          id: legacySavedId,
          modelCount: 5,
          loadoutSubjectCounts: defaultLoadoutSubjectCounts(killTeam),
          defensiveEquipmentCounts: { [legacyShieldKey]: 1 },
        },
        killTeam,
      ),
      {
        [defensiveEquipmentSelectionKey(legacySavedId, shieldBearer.id, shield.id)]: 1,
      },
    );
    const saved = {
      id: `kill-team-${datasheetId}`,
      unitId: datasheetId,
      name: killTeam.name,
      modelCount: 5,
      loadoutSubjectCounts: defaultLoadoutSubjectCounts(killTeam),
    };
    const formation = savedFormationGroups(catalogue, { units: [saved] })[0];
    assert.deepEqual(savedFormationModelSegments(formation).ambiguousComponents, []);
  }

  for (const datasheetId of ["000003821", "000003875"]) {
    const cassius = unit(datasheetId);
    const composition = catalogueModelSegments(cassius, 11);
    assert.equal(composition.exact, true);
    assert.ok(composition.segments.every(({ modelCount }) => modelCount === 1));
    const hood = cassius.defensiveEquipment.find((option) => option.name === "Psychic Hood");
    assert.equal(hood.eligibilityExact, true);
    assert.deepEqual(
      hood.eligibleModelIds.map((id) => cassius.models.find((model) => model.id === id).name),
      ["Jensus Natorian"],
    );
    assert.deepEqual(
      savedUnitDefensiveEquipmentDefaults(
        { id: `cassius-${datasheetId}`, modelCount: 11 },
        cassius,
      ),
      {
        [defensiveEquipmentSelectionKey(`cassius-${datasheetId}`, null, hood.id)]: 1,
      },
    );
  }

  const wardens = unit("000004188");
  const wardensComposition = catalogueModelSegments(wardens, 6);
  assert.equal(wardensComposition.exact, true);
  assert.ok(wardensComposition.segments.every(({ modelCount }) => modelCount === 1));
  assert.deepEqual(
    wardens.defensiveEquipment.map((option) => [
      option.name,
      option.eligibleModelIds.map((id) => wardens.models.find((model) => model.id === id).name),
    ]),
    [
      ["Refractor Field", ["Gaius Silva"]],
      ["Storm Shield", ["Veteran Sergeant Metaurus"]],
    ],
  );
  const savedWardens = { id: "wardens", modelCount: 6 };
  const wardensDefaults = savedUnitDefensiveEquipmentDefaults(savedWardens, wardens);
  for (const option of wardens.defensiveEquipment) {
    const modelId = option.eligibleModelIds[0];
    assert.equal(
      wardensDefaults[defensiveEquipmentSelectionKey(savedWardens.id, modelId, option.id)],
      1,
    );
  }
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
