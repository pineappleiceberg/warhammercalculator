import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachmentFormationReport,
  leaderAttachmentEligibility,
  leaderFormationEligibility,
} from "../lib/attachments.mjs";
import { transportAssignmentReport } from "../lib/transport.mjs";

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
