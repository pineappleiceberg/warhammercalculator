import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { antiWoundThreshold } from "../lib/anti.mjs";
import { sourceEquippedWeaponCounts } from "../lib/loadout.mjs";
import {
  BATTLE_STATE_VERSION,
  TABLE_GEOMETRY_CONSTANTS,
  advanceBattleClock,
  appendResolvedAttack,
  applyBattleEffect,
  changeBattleResource,
  closeRangedTargetDeclarations,
  completeFormationActivation,
  configureBattleMission,
  configureBattleTableGeometry,
  createBattleState as createUncoveredBattleState,
  declareFormationDeployment,
  deployFormation,
  openBattleChoice,
  passFightPriority,
  passFireOverwatch,
  recordFormationCharge,
  recordFormationMovement,
  recordFightMove,
  recordHazardousTests,
  recordRangedTargetEligibility,
  registerBattleFormation,
  replayBattleState,
  resolveHeroicIntervention,
  resolveCounterOffensive,
  resolveHazardousDamage,
  resolveGoToGround,
  resolveSmokescreen,
  resolveRapidIngress,
  resolveBattleChoice,
  resolveDestroyedTransport,
  scoreBattlePoints,
  setBattleObjectiveControl,
  setFormationBattleShocked,
  startBattle,
  startFireOverwatch,
  startFormationActivation,
  startFormationMovement,
} from "../lib/battle-state.mjs";
import { rulesInteractionCases } from "./rules-interaction-corpus.mjs";
import {
  coveredBattleRuleBinding,
  coveredExactBattleRuleBinding,
  coveredRuleCoverageMatrix,
} from "./rule-coverage-fixture.mjs";

function createBattleState(input) {
  return createUncoveredBattleState({
    ...input,
    ruleCoverage: coveredBattleRuleBinding(input.players),
  });
}

const projectRoot = new URL("../", import.meta.url);
const goldenBattleReplay = JSON.parse(
  await readFile(new URL("./fixtures/battle-replay-v1.json", import.meta.url), "utf8"),
);

function createD1Mock() {
  const rows = [];
  return {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async run() {
          if (sql.startsWith("INSERT")) {
            const next = {
              id: values[0],
              name: values[1],
              faction_id: values[2],
              roster: values[3],
              created_at: values[4],
              updated_at: values[5],
            };
            const existing = rows.find((entry) => entry.id === values[0]);
            if (existing) Object.assign(existing, next);
            else rows.push(next);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE")) {
            const row = rows.find((entry) => entry.id === values[4]);
            if (!row) return { meta: { changes: 0 } };
            Object.assign(row, {
              name: values[0],
              faction_id: values[1],
              roster: values[2],
              updated_at: values[3],
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE")) {
            const index = rows.findIndex((entry) => entry.id === values[0]);
            if (index < 0) return { meta: { changes: 0 } };
            rows.splice(index, 1);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          return { results: [...rows].sort((a, b) => b.updated_at - a.updated_at) };
        },
        async first() {
          return rows.find((entry) => entry.id === values[0]) ?? null;
        },
      };
    },
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const testEnv = {
  ARMY_DB: createD1Mock(),
  ASSETS: {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname.replace(/^\//, "");
      if (pathname === "battle-rule-coverage.json") {
        return Response.json(coveredRuleCoverageMatrix);
      }
      try {
        return new Response(await readFile(new URL(`../public/${pathname}`, import.meta.url)));
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};

async function render(pathname = "/") {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    testEnv,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the calculator interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Warhammer Damage Calculator<\/title>/i);
  assert.match(html, /Damage Calculator/);
  assert.match(html, /Expected damage/);
  assert.match(html, /Weapon rules/);
  assert.match(html, /Sustained Hits/);
  assert.match(html, /Rapid Fire/);
  assert.match(html, /Hit re-rolls/);
  assert.match(html, /Wound re-rolls/);
  assert.match(html, /Other Hit modifier/);
  assert.match(html, /Other Wound modifier/);
  assert.match(html, /Roll this attack/);
  assert.match(html, /Share matchup/);
  assert.match(html, /aria-label="Attacker objective owner"/);
  assert.match(html, /aria-label="Target objective owner"/);
  assert.match(html, /aria-label="Target is the closest eligible target"/);
  assert.match(html, /LIVE RESOLUTION/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders every battle workflow", async () => {
  for (const [pathname, heading] of [
    ["/model-vs-model", "Damage Calculator"],
    ["/unit-vs-unit", "Unit vs Unit"],
    ["/lists", "Army Lists"],
    ["/play", "Play Mode"],
    ["/agent", "Parameterized Calculator"],
  ]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, new RegExp(heading, "i"));
    if (pathname === "/lists") {
      assert.match(html, /Export backup/);
      assert.match(html, /Import backup/);
    }
    if (pathname === "/play") {
      assert.match(html, /Reset battle/);
      assert.match(html, /Import battle/);
      assert.match(html, /Allocate first/);
      assert.match(html, /wounds, casualties, and the event log/i);
      assert.match(html, /recover automatically/i);
      assert.match(html, /limited ability uses/i);
      assert.match(html, /<legend>Attacker<\/legend>/);
      assert.match(html, /<legend>Target<\/legend>/);
      assert.match(html, /role="status"/);
      assert.match(html, /aria-live="polite"/);
      assert.match(html, /Quick overrides/);
      assert.match(html, /play-action-hint/);
      assert.match(html, /aria-label="Target distance in inches"/);
      assert.match(html, /aria-label="Attacker-side source to target distance in inches"/);
      assert.match(html, /aria-label="Target visible to attacker-side source"/);
      assert.match(html, /aria-label="Target-side source to attacker distance in inches"/);
      assert.match(html, /aria-label="Attacker visible to target-side source"/);
      assert.match(html, /aria-label="Models in the attacker unit"/);
      assert.match(html, /aria-label="Enemy models within the ability range"/);
      assert.match(html, /aria-label="Attacker is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is the Oath of Moment target"/);
      assert.match(html, /aria-label="Attacker is within range of an objective marker"/);
      assert.match(html, /aria-label="Target is within range of an objective marker"/);
      assert.match(html, /aria-label="Attacker objective owner"/);
      assert.match(html, /aria-label="Target objective owner"/);
      assert.match(html, /aria-label="Attacker qualifies for the Codex Oath wound bonus"/);
      assert.match(html, /aria-label="Target is the closest eligible target"/);
    }
    if (pathname === "/unit-vs-unit") {
      assert.match(html, /aria-label="Target distance in inches"/);
      assert.match(html, /aria-label="Attacker-side source to target distance in inches"/);
      assert.match(html, /aria-label="Target visible to attacker-side source"/);
      assert.match(html, /aria-label="Target-side source to attacker distance in inches"/);
      assert.match(html, /aria-label="Attacker visible to target-side source"/);
      assert.match(html, /aria-label="Models in the attacker unit"/);
      assert.match(html, /aria-label="Enemy models within the ability range"/);
      assert.match(html, /aria-label="Attacker is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is gaining Waaagh! benefits"/);
      assert.match(html, /aria-label="Target is the Oath of Moment target"/);
      assert.match(html, /aria-label="Attacker is within range of an objective marker"/);
      assert.match(html, /aria-label="Target is within range of an objective marker"/);
      assert.match(html, /aria-label="Attacker objective owner"/);
      assert.match(html, /aria-label="Target objective owner"/);
      assert.match(html, /aria-label="Attacker qualifies for the Codex Oath wound bonus"/);
      assert.match(html, /aria-label="Target is the closest eligible target"/);
    }
    if (pathname === "/agent") {
      assert.match(html, /Call with a URL/);
      assert.match(html, /MACHINE-READABLE OUTPUT/);
      assert.match(html, /Doom Scythe/);
    }
  }
});

test("serves profile discovery, exact calculation, and CSPRNG roll APIs", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };

  const docs = await worker.fetch(new Request("http://localhost/api/v1"), testEnv, context);
  assert.equal(docs.status, 200);
  assert.equal(docs.headers.get("access-control-allow-origin"), "*");
  const documented = await docs.json();
  assert.equal(documented.apiVersion, "v1");
  assert.match(documented.endpoints.calculate, /POST \/api\/v1\/calculate/);
  assert.match(documented.endpoints.volleyComplexity, /POST \/api\/v1\/volley\/complexity/);
  assert.match(documented.endpoints.volleySimulate, /POST \/api\/v1\/volley\/simulate/);
  assert.match(documented.endpoints.battleReplay, /POST \/api\/v1\/battle\/replay/);
  assert.match(documented.endpoints.ruleCoverage, /GET \/api\/v1\/rules\/coverage/);
  assert.match(documented.endpoints.checkRuleCoverage, /POST \/api\/v1\/rules\/coverage\/check/);
  assert.match(documented.endpoints.missions, /GET \/api\/v1\/missions/);
  assert.match(documented.endpoints.terrain, /GET \/api\/v1\/terrain/);
  assert.match(documented.endpoints.firingDeck, /GET \/api\/v1\/firing-deck/);
  assert.match(documented.endpoints.transport, /GET \/api\/v1\/transport/);
  assert.match(documented.endpoints.leader, /GET \/api\/v1\/leader/);
  assert.match(documented.endpoints.leaderFormation, /GET \/api\/v1\/leader-formation/);
  assert.match(documented.endpoints.bodyguardJoin, /GET \/api\/v1\/bodyguard-join/);
  assert.match(documented.endpoints.validateFiringDeck, /POST \/api\/v1\/validate-firing-deck/);
  assert.match(documented.endpoints.lists, /lists\/export/);

  const coverageResponse = await worker.fetch(
    new Request("http://localhost/api/v1/rules/coverage"),
    testEnv,
    context,
  );
  assert.equal(coverageResponse.status, 200);
  const coverage = (await coverageResponse.json()).data;
  assert.equal(
    coverage.snapshotId,
    "wh40k-10e-core-2025-10-army-rules-2026-06-13-chapter-approved-v1-4-v24",
  );
  assert.equal(coverage.sourceLocked, true);
  assert.equal(coverage.rules.length, coveredRuleCoverageMatrix.rules.length);

  const coverageCheckResponse = await worker.fetch(
    new Request("http://localhost/api/v1/rules/coverage/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rules: [
          "core.attack-sequence",
          {
            id: "core.charge-resolution",
            acknowledgement: "Players will review measured charge movement",
          },
          "mission.pariah-nexus",
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(coverageCheckResponse.status, 200);
  const coverageCheck = (await coverageCheckResponse.json()).data;
  assert.equal(coverageCheck.permitted, false);
  assert.deepEqual(
    coverageCheck.results.map((entry) => [entry.status, entry.permitted, entry.sourceLocked]),
    [
      ["executable", true, true],
      ["guided", true, true],
      ["unsupported", false, false],
    ],
  );

  const factions = await worker.fetch(
    new Request("http://localhost/api/v1/factions"),
    testEnv,
    context,
  );
  assert.equal(factions.status, 200);
  assert.ok((await factions.json()).data.length > 20);

  const detachments = await worker.fetch(
    new Request("http://localhost/api/v1/detachments?faction=NEC"),
    testEnv,
    context,
  );
  assert.equal(detachments.status, 200);
  assert.deepEqual(
    (await detachments.json()).data.find((entry) => entry.id === "000000818"),
    { id: "000000818", factionId: "NEC", name: "Hypercrypt Legion" },
  );

  const enhancements = await worker.fetch(
    new Request("http://localhost/api/v1/enhancements?detachment=000000818&unit=000000523"),
    testEnv,
    context,
  );
  assert.equal(enhancements.status, 200);
  assert.deepEqual(
    (await enhancements.json()).data.find((entry) => entry.id === "000008554003"),
    {
      id: "000008554003",
      detachmentId: "000000818",
      name: "Arisen Tyrant",
      cost: "25",
      eligibleDatasheetIds: [
        "000000523",
        "000000524",
        "000000533",
        "000002108",
        "000002109",
        "000002350",
        "000002351",
        "000002352",
        "000002353",
        "000002354",
        "000002355",
        "000003693",
        "000004178",
      ],
    },
  );

  const missions = await worker.fetch(
    new Request("http://localhost/api/v1/missions"),
    testEnv,
    context,
  );
  assert.equal(missions.status, 200);
  const missionPayload = await missions.json();
  assert.equal(missionPayload.pack.version, "1.4");
  assert.equal(missionPayload.data.length, 20);
  assert.equal(missionPayload.data[0].primaryMission, "Take and Hold");

  const terrain = await worker.fetch(
    new Request("http://localhost/api/v1/terrain?mission=chapter-approved-2025-26-v1.4-a"),
    testEnv,
    context,
  );
  assert.equal(terrain.status, 200);
  assert.deepEqual(
    (await terrain.json()).data.map((entry) => entry.number),
    [1, 2, 4, 6, 7, 8],
  );

  const profiles = await worker.fetch(
    new Request("http://localhost/api/v1/profiles"),
    testEnv,
    context,
  );
  const catalogue = await profiles.json();
  const warriors = catalogue.units.find((unit) => unit.name === "Necron Warriors");
  assert.ok(warriors);
  const impulsor = catalogue.units.find((unit) => unit.id === "000002568");
  const shieldDome = impulsor.combatPresets.find((preset) => preset.name === "Shield Dome");
  const shieldDomeChoice = impulsor.wargearChoicePools
    .flatMap((pool) => pool.alternatives)
    .find((alternative) => /shield dome/i.test(alternative.label));
  assert.ok(shieldDome && shieldDomeChoice);
  assert.equal(shieldDome.sourceEquipmentChoiceExact, true);
  assert.deepEqual(
    shieldDome.sourceEquipmentChoiceLinks.map((link) => [link.alternativeId, link.quantityDelta]),
    [
      ["000002568:3:1", 0],
      ["000002568:3:2", 0],
      ["000002568:3:3", 0],
      ["000002568:3:4", 1],
    ],
  );
  const wolfGuardLeader = catalogue.units.find((unit) => unit.id === "000002804");
  const wolfGuardShield = wolfGuardLeader.combatPresets.find(
    (preset) => preset.name === "Storm Shield",
  );
  assert.equal(wolfGuardShield.sourceEquipmentChoiceExact, true);
  assert.deepEqual(wolfGuardLeader.wargearChoicePairingRules, [
    {
      poolId: "000002804:2",
      weaponType: "Ranged",
      evaluationScope: "pool",
      triggerCount: 2,
      maximumTypedSelections: 2,
      requirements: [
        {
          label: "pistol",
          minimum: 1,
          maximum: 1,
          matches: [{ kind: "ability", value: "pistol" }],
        },
      ],
      requiredAbility: "pistol",
      requiredMinimum: 1,
      requiredMaximum: 1,
      source:
        "* This model can only be equipped with two ranged weapons if one of them is a Pistol (and it can only have one Pistol).",
    },
  ]);
  const assault = catalogue.units.find((unit) => unit.name === "Assault Squad");
  const assaultSourceModelId = assault.models[0].sourceModelId;
  assert.deepEqual(
    assault.models.map((model) => [model.name, model.sourceModelId]),
    [
      ["Assault Sergeant", assaultSourceModelId],
      ["Assault Marines", assaultSourceModelId],
    ],
  );
  assert.deepEqual(
    assault.defensiveEquipment
      .find((option) => option.name === "Astartes Shield")
      .eligibleModelIds.map((id) => assault.models.find((model) => model.id === id).name),
    ["Assault Sergeant"],
  );
  const voidscarred = catalogue.units.find((unit) => unit.id === "000002532");
  assert.deepEqual(
    voidscarred.models.map((model) => model.name),
    ["Voidscarred Felarch", "Corsair Voidscarred", "Shade Runner", "Soul Weaver", "Way Seeker"],
  );
  assert.deepEqual(
    voidscarred.compositionModels
      .filter((model) => model.controlsComposition)
      .map((model) => [model.name, model.loadoutSubjectId]),
    [
      ["Shade Runner", "000002532:2"],
      ["Soul Weaver", "000002532:3"],
      ["Way Seeker", "000002532:4"],
    ],
  );
  const spectrus = catalogue.units.find((unit) => unit.id === "000002779");
  assert.deepEqual(
    spectrus.defensiveEquipment
      .find((option) => option.name === "Helix Gauntlet")
      .eligibleModelIds.map((id) => spectrus.models.find((model) => model.id === id).name),
    ["Kill Team Infiltrators"],
  );
  const aquila = catalogue.units.find((unit) => unit.id === "000004174");
  assert.deepEqual(
    aquila.compositionModels.map((model) => [
      model.name,
      model.countFormula,
      model.loadoutSubjectId ?? null,
    ]),
    [
      [
        "Kill Team Sergeant",
        { fixed: 1, perModel: 0, perIncrement: 0, modelsPerIncrement: 1 },
        "000004174:1",
      ],
      [
        "Gravis Veteran",
        { fixed: 0, perModel: 0, perIncrement: 1, modelsPerIncrement: 5 },
        "000004174:2",
      ],
      [
        "Deathwatch Veteran with stalker bolt rifle",
        { fixed: 0, perModel: 0, perIncrement: 1, modelsPerIncrement: 5 },
        "000004174:3",
      ],
      [
        "Deathwatch Veteran with heavy thunder hammer",
        { fixed: 0, perModel: 0, perIncrement: 1, modelsPerIncrement: 5 },
        "000004174:4",
      ],
      [
        "Deathwatch Veteran with marksman bolt carbine",
        { fixed: 0, perModel: 0, perIncrement: 1, modelsPerIncrement: 5 },
        "000004174:5",
      ],
      [
        "Deathwatch Veteran with xenophase blade",
        { fixed: 0, perModel: 0, perIncrement: 1, modelsPerIncrement: 10 },
        "000004174:6",
      ],
    ],
  );
  assert.deepEqual(
    aquila.defensiveEquipment
      .find((option) => option.name === "Astartes Shield")
      .eligibleModelIds.map((id) => aquila.models.find((model) => model.id === id).name),
    ["Deathwatch Veteran with heavy thunder hammer"],
  );
  const cassius = catalogue.units.find((unit) => unit.id === "000003821");
  assert.equal(cassius.models.length, 11);
  assert.deepEqual(
    cassius.defensiveEquipment
      .find((option) => option.name === "Psychic Hood")
      .eligibleModelIds.map((id) => cassius.models.find((model) => model.id === id).name),
    ["Jensus Natorian"],
  );
  const wardens = catalogue.units.find((unit) => unit.id === "000004188");
  assert.equal(wardens.models.length, 6);
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
  const trukk = catalogue.units.find((unit) => unit.id === "000000026");
  const boyz = catalogue.units.find((unit) => unit.id === "000000016");
  const stormboyz = catalogue.units.find((unit) => unit.id === "000000027");
  assert.deepEqual(trukk.firingDeck, { capacity: 12, abilityId: "000008334" });
  assert.equal(trukk.transport.capacity, 12);
  const transport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${trukk.id}&passenger=${boyz.id}&models=12`,
    ),
    testEnv,
    context,
  );
  assert.equal(transport.status, 200);
  assert.deepEqual((await transport.json()).data, {
    transport: { id: trukk.id, name: "Trukk" },
    passenger: { id: boyz.id, name: "Boyz" },
    attached: null,
    capacity: 12,
    pool: {
      position: 0,
      kind: "primary",
      label: "primary",
      capacity: 12,
      maximumWounds: null,
    },
    pools: [
      {
        position: 0,
        kind: "primary",
        label: "primary",
        capacity: 12,
        maximumWounds: null,
        allowedKeywords: [["orks", "infantry"]],
      },
    ],
    sharedAllowance: null,
    sharedAllowances: [],
    eligible: true,
    reason: "",
    modelCost: 1,
    models: 12,
    slots: 12,
    fits: true,
    source: trukk.transport.source,
  });
  const illegalTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${trukk.id}&passenger=${stormboyz.id}&models=1`,
    ),
    testEnv,
    context,
  );
  assert.equal(illegalTransport.status, 200);
  assert.equal((await illegalTransport.json()).data.eligible, false);
  const illegalFiringDeck = await worker.fetch(
    new Request(`http://localhost/api/v1/firing-deck?unit=${trukk.id}&passenger=${stormboyz.id}`),
    testEnv,
    context,
  );
  assert.equal(illegalFiringDeck.status, 409);
  const firingDeck = await worker.fetch(
    new Request(`http://localhost/api/v1/firing-deck?unit=${trukk.id}&passenger=${boyz.id}`),
    testEnv,
    context,
  );
  assert.equal(firingDeck.status, 200);
  const firingDeckBody = await firingDeck.json();
  assert.equal(firingDeckBody.data.capacity, 12);
  assert.equal(
    firingDeckBody.data.passenger.weapons.some((weapon) => weapon.name === "Choppa"),
    false,
  );
  const validatedDeck = await worker.fetch(
    new Request("http://localhost/api/v1/validate-firing-deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transportId: trukk.id,
        selections: [
          { passengerUnitId: boyz.id, weaponId: 59, modelCount: 12, unitAlreadyShot: false },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(validatedDeck.status, 200);
  assert.deepEqual((await validatedDeck.json()).data, {
    capacity: 12,
    slotsUsed: 12,
    selections: [
      {
        passengerUnitId: boyz.id,
        passengerUnitName: "Boyz",
        attachedUnitId: null,
        attachedUnitName: null,
        weaponId: 59,
        weaponName: "Shoota",
        modelCount: 12,
        modelCost: 1,
        slots: 12,
        bearerUnitId: trukk.id,
      },
    ],
  });
  const invalidDeck = await worker.fetch(
    new Request("http://localhost/api/v1/validate-firing-deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transportId: trukk.id,
        selections: [{ passengerUnitId: boyz.id, weaponId: 59, modelCount: 13 }],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalidDeck.status, 400);
  assert.match((await invalidDeck.text()).toLowerCase(), /allows 12/);
  const rhino = catalogue.units.find((unit) => unit.id === "000002723");
  const transportCaptain = catalogue.units.find((unit) => unit.id === "000000073");
  const tacticalSquad = catalogue.units.find((unit) => unit.id === "000000070");
  const leader = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader?unit=${transportCaptain.id}&bodyguard=${tacticalSquad.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(leader.status, 200);
  const leaderBody = await leader.json();
  assert.equal(leaderBody.data.eligible, true);
  assert.ok(leaderBody.data.options.some((option) => option.id === tacticalSquad.id));
  assert.deepEqual(leaderBody.data.leaderAttachmentException, null);
  assert.equal(leaderBody.data.bodyguardLeaderRule, null);
  const illegalLeader = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader?unit=${transportCaptain.id}&bodyguard=${warriors.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(illegalLeader.status, 200);
  assert.equal((await illegalLeader.json()).data.eligible, false);
  const bladeguard = catalogue.units.find((unit) => unit.id === "000000071");
  const unshieldedCaptain = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader?unit=${transportCaptain.id}&bodyguard=${bladeguard.id}`,
    ),
    testEnv,
    context,
  );
  assert.match((await unshieldedCaptain.json()).data.reason, /relic shield/i);
  const shieldedCaptain = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader?unit=${transportCaptain.id}&bodyguard=${bladeguard.id}&leaderChoice=000000073:1:7`,
    ),
    testEnv,
    context,
  );
  assert.equal((await shieldedCaptain.json()).data.eligible, true);
  const shieldedFormation = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader-formation?bodyguard=${bladeguard.id}&leader=${transportCaptain.id}&leaderChoice=000000073:1:7&models=3`,
    ),
    testEnv,
    context,
  );
  assert.equal((await shieldedFormation.json()).data.eligible, true);
  const conclave = catalogue.units.find((unit) => unit.id === "000000584");
  const guardians = catalogue.units.find((unit) => unit.id === "000000589");
  const joinedBodyguard = await worker.fetch(
    new Request(
      `http://localhost/api/v1/bodyguard-join?unit=${conclave.id}&bodyguard=${guardians.id}&models=2&bodyguardModels=11`,
    ),
    testEnv,
    context,
  );
  const joinedBodyguardData = (await joinedBodyguard.json()).data;
  assert.equal(joinedBodyguardData.eligible, true);
  assert.equal(joinedBodyguardData.startingStrength, 13);
  assert.equal(joinedBodyguardData.rule.maximumSameJoiner, 1);
  const attachedConclave = await worker.fetch(
    new Request(
      `http://localhost/api/v1/bodyguard-join?unit=${conclave.id}&bodyguard=${guardians.id}&attached=true`,
    ),
    testEnv,
    context,
  );
  assert.match((await attachedConclave.json()).data.reason, /Attached unit/i);
  const formationWarboss = catalogue.units.find((unit) => unit.id === "000000001");
  const formationBanner = catalogue.units.find((unit) => unit.id === "000000022");
  const legalBoyzFormation = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader-formation?bodyguard=${boyz.id}&leader=${formationWarboss.id}&leader=${formationBanner.id}&models=20`,
    ),
    testEnv,
    context,
  );
  assert.equal(legalBoyzFormation.status, 200);
  const legalBoyzFormationBody = await legalBoyzFormation.json();
  assert.equal(legalBoyzFormationBody.data.eligible, true);
  assert.equal(legalBoyzFormationBody.data.globalRule.maximumLeaders, 2);
  assert.equal(legalBoyzFormationBody.data.globalRule.sourcePage, 16);
  const smallBoyzFormation = await worker.fetch(
    new Request(
      `http://localhost/api/v1/leader-formation?bodyguard=${boyz.id}&leader=${formationWarboss.id}&leader=${formationBanner.id}&models=10`,
    ),
    testEnv,
    context,
  );
  assert.equal((await smallBoyzFormation.json()).data.eligible, false);
  const attachedTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${rhino.id}&passenger=${transportCaptain.id}&attached=${tacticalSquad.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(attachedTransport.status, 200);
  const attachedTransportBody = await attachedTransport.json();
  assert.equal(attachedTransportBody.data.eligible, true);
  assert.deepEqual(attachedTransportBody.data.attached, {
    id: tacticalSquad.id,
    name: tacticalSquad.name,
  });
  const unattachedTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${rhino.id}&passenger=${transportCaptain.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal((await unattachedTransport.json()).data.eligible, false);
  const stormraven = catalogue.units.find((unit) => unit.id === "000001191");
  const dreadnought = catalogue.units.find((unit) => unit.id === "000000117");
  const additionalPool = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${stormraven.id}&passenger=${dreadnought.id}&models=2`,
    ),
    testEnv,
    context,
  );
  assert.equal(additionalPool.status, 200);
  const additionalPoolBody = await additionalPool.json();
  assert.equal(additionalPoolBody.data.capacity, 1);
  assert.deepEqual(additionalPoolBody.data.pool, {
    position: 1,
    kind: "additional",
    label: "dreadnought",
    capacity: 1,
    maximumWounds: null,
  });
  assert.equal(additionalPoolBody.data.fits, false);
  const mastodon = catalogue.units.find((unit) => unit.id === "000003646");
  const helbrute = catalogue.units.find((unit) => unit.id === "000000954");
  const mastodonAllowance = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${mastodon.id}&passenger=${helbrute.id}&models=3`,
    ),
    testEnv,
    context,
  );
  assert.equal(mastodonAllowance.status, 200);
  const mastodonAllowanceBody = await mastodonAllowance.json();
  assert.equal(mastodonAllowanceBody.data.eligible, true);
  assert.equal(mastodonAllowanceBody.data.modelCost, 8);
  assert.equal(mastodonAllowanceBody.data.slots, 24);
  assert.equal(mastodonAllowanceBody.data.sharedAllowance.maximumModels, 2);
  assert.equal(mastodonAllowanceBody.data.fits, false);
  const stormbird = catalogue.units.find((unit) => unit.id === "000001179");
  const rhinoPassenger = catalogue.units.find((unit) => unit.id === "000002723");
  const nestedTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${stormbird.id}&passenger=${rhinoPassenger.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(nestedTransport.status, 200);
  const nestedTransportBody = await nestedTransport.json();
  assert.equal(nestedTransportBody.data.modelCost, 25);
  assert.equal(nestedTransportBody.data.slots, 25);
  assert.equal(
    nestedTransportBody.data.sharedAllowance.nestedPassengerPolicy,
    "included_in_fixed_cost",
  );
  const thunderhawkTransporter = catalogue.units.find((unit) => unit.id === "000002724");
  const stormravenPassenger = catalogue.units.find((unit) => unit.id === "000001191");
  const independentVehiclePool = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${thunderhawkTransporter.id}&passenger=${rhinoPassenger.id}&models=2`,
    ),
    testEnv,
    context,
  );
  assert.equal(independentVehiclePool.status, 200);
  const independentVehiclePoolBody = await independentVehiclePool.json();
  assert.equal(independentVehiclePoolBody.data.pool.kind, "additional");
  assert.equal(independentVehiclePoolBody.data.capacity, 2);
  assert.equal(independentVehiclePoolBody.data.fits, true);
  const excludedNestedTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${thunderhawkTransporter.id}&passenger=${stormravenPassenger.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(excludedNestedTransport.status, 200);
  assert.equal((await excludedNestedTransport.json()).data.eligible, false);
  const orion = catalogue.units.find((unit) => unit.id === "000001564");
  const venerableContemptor = catalogue.units.find((unit) => unit.id === "000000883");
  const conditionalCapacity = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${orion.id}&passenger=${venerableContemptor.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(conditionalCapacity.status, 200);
  const conditionalCapacityBody = await conditionalCapacity.json();
  assert.equal(conditionalCapacityBody.data.pool.kind, "additional");
  assert.equal(conditionalCapacityBody.data.capacity, 1);
  assert.equal(conditionalCapacityBody.data.sharedAllowance.primaryCapacityWhileUsed, 6);
  assert.equal(conditionalCapacityBody.data.fits, true);
  const dreadclaw = catalogue.units.find((unit) => unit.id === "000001310");
  const alternativeMode = await worker.fetch(
    new Request(`http://localhost/api/v1/transport?unit=${dreadclaw.id}&passenger=${helbrute.id}`),
    testEnv,
    context,
  );
  assert.equal(alternativeMode.status, 200);
  assert.deepEqual((await alternativeMode.json()).data.pool, {
    position: 1,
    kind: "alternative",
    label: "helbrute or dreadnought",
    capacity: 1,
    maximumWounds: null,
  });
  const tyrannocyte = catalogue.units.find((unit) => unit.id === "000000489");
  const norn = catalogue.units.find((unit) => unit.id === "000002751");
  const oversizedMonster = await worker.fetch(
    new Request(`http://localhost/api/v1/transport?unit=${tyrannocyte.id}&passenger=${norn.id}`),
    testEnv,
    context,
  );
  assert.equal(oversizedMonster.status, 200);
  const oversizedMonsterBody = await oversizedMonster.json();
  assert.equal(oversizedMonsterBody.data.eligible, false);
  assert.match(oversizedMonsterBody.data.reason, /12 Wounds limit/i);
  const waveSerpent = catalogue.units.find((unit) => unit.id === "000000599");
  const yvraine = catalogue.units.find((unit) => unit.id === "000002542");
  const ynnariKabalites = catalogue.units.find((unit) => unit.id === "000003916");
  const yvraineTransport = await worker.fetch(
    new Request(`http://localhost/api/v1/transport?unit=${waveSerpent.id}&passenger=${yvraine.id}`),
    testEnv,
    context,
  );
  assert.equal(yvraineTransport.status, 200);
  assert.equal((await yvraineTransport.json()).data.eligible, true);
  const kabaliteTransport = await worker.fetch(
    new Request(
      `http://localhost/api/v1/transport?unit=${waveSerpent.id}&passenger=${ynnariKabalites.id}`,
    ),
    testEnv,
    context,
  );
  assert.equal(kabaliteTransport.status, 200);
  assert.equal((await kabaliteTransport.json()).data.eligible, false);
  const warboss = catalogue.units.find((unit) => unit.name === "Warboss");
  const mightIsRight = warboss.combatPresets.find((preset) => preset.name === "Might is Right");
  assert.equal(mightIsRight.hitModifierRole, "attacker");
  assert.equal(mightIsRight.hitModifierSubject, "led_unit");
  const castigator = catalogue.units.find((unit) => unit.name === "Castigator");
  const rites = castigator.combatPresets.find((preset) => preset.name === "Rites of Castigation");
  assert.deepEqual(rites.effects, [
    {
      type: "ap_modifier",
      value: 1,
      diceCount: 0,
      diceSides: 0,
      role: "attacker",
      subject: "friendly_unit",
    },
  ]);
  const captainTycho = catalogue.units.find((unit) => unit.id === "000000152");
  const embittered = captainTycho.combatPresets.find((preset) => preset.name === "Embittered");
  assert.deepEqual(embittered.effects, [
    {
      type: "attacks_replacement",
      value: 12,
      diceCount: 0,
      diceSides: 0,
      weaponName: "Dead Man’s Hand",
      role: "attacker",
      subject: "self",
    },
  ]);
  const harker = catalogue.units.find((unit) => unit.name === "Sergeant Harker");
  const payback = harker.combatPresets.find((preset) => preset.name === "Payback Time");
  assert.equal(payback.activation, "situational");
  assert.equal(payback.weaponScope, "Ranged");
  assert.deepEqual(
    payback.effects.map((effect) => [effect.type, effect.value, effect.weaponName]),
    [
      ["attacks_replacement", 6, "Payback"],
      ["sustained_hits", 3, "Payback"],
    ],
  );
  const trajann = catalogue.units.find((unit) => unit.name === "Trajann Valoris");
  const momentShackle = trajann.combatPresets.filter((preset) =>
    preset.name.startsWith("Moment Shackle —"),
  );
  assert.equal(momentShackle.length, 2);
  assert.equal(new Set(momentShackle.map((preset) => preset.choiceGroup)).size, 1);
  assert.equal(
    momentShackle.find((preset) => preset.name.endsWith("Invulnerable 2+")).weaponScope,
    "Melee",
  );
  const culexus = catalogue.units.find((unit) => unit.name === "Culexus Assassin");
  const psychicAssassin = culexus.combatPresets.find(
    (preset) => preset.name === "Psychic Assassin",
  );
  assert.equal(psychicAssassin.activation, "automatic");
  assert.deepEqual(psychicAssassin.effects, [
    {
      type: "attacks_replacement",
      value: 6,
      diceCount: 0,
      diceSides: 0,
      weaponName: "Animus speculum",
      requiredTargetKeyword: "psyker",
      role: "attacker",
      subject: "self",
    },
  ]);
  const abomination = culexus.combatPresets.find((preset) => preset.name === "Abomination");
  assert.equal(abomination.activation, "automatic");
  assert.deepEqual(abomination.effects, [
    {
      type: "feel_no_pain",
      value: 2,
      diceCount: 0,
      diceSides: 0,
      requiredAttackKeyword: "psychic",
      role: "target",
      subject: "self",
    },
  ]);
  const eldrad = catalogue.units.find((unit) => unit.name === "Eldrad Ulthran");
  const doom = eldrad.combatPresets.find((preset) => preset.name === "Doom (Psychic)");
  assert.equal(doom.sourceRelationship, "self_or_supporting_unit");
  assert.deepEqual(doom.requiredAttackerKeywords, ["aeldari"]);
  const lordOfVirulence = catalogue.units.find((unit) => unit.name === "Lord of Virulence");
  const blight = lordOfVirulence.combatPresets.find(
    (preset) => preset.name === "Blight Bombardment",
  );
  assert.deepEqual(blight.requiredAttackerKeywords, ["death guard"]);
  assert.deepEqual(blight.effects, [
    {
      type: "reroll_hits",
      value: 1,
      diceCount: 0,
      diceSides: 0,
      requiredAttackKeyword: "blast",
      role: "attacker",
      subject: "friendly_unit",
    },
  ]);
  const marshal = catalogue.units.find((unit) => unit.name === "Marshal");
  const piousFervour = marshal.combatPresets.find((preset) => preset.name === "Pious Fervour");
  assert.equal(piousFervour.activation, "automatic");
  assert.deepEqual(
    piousFervour.effects.map((effect) => [
      effect.modelCountSource,
      effect.modelsPerIncrement,
      effect.maximumModifier,
      effect.weaponName,
    ]),
    [["nearby_enemy_units", 1, 3, "master-crafted power weapon"]],
  );
  const huntaRig = catalogue.units.find((unit) => unit.name === "Hunta Rig");
  const onDaHunt = huntaRig.combatPresets.find((preset) => preset.name === "On Da Hunt");
  assert.deepEqual(
    onDaHunt.effects.map((effect) => [
      effect.modelCountSource,
      effect.modelsPerIncrement,
      effect.maximumModifier,
      effect.weaponName,
    ]),
    [["embarked_models", 1, 6, "butcha boyz"]],
  );
  const raider = catalogue.units.find((unit) => unit.name === "Raider");
  const visions = raider.combatPresets.find((preset) => preset.name === "Visions of Butchery");
  assert.deepEqual(
    visions.effects.map((effect) => [effect.modelCountSource, effect.weaponName]),
    [["embarked_wracks_models", "bladevanes and chainsnares"]],
  );
  const captain = catalogue.units.find((unit) => unit.id === "000000073");
  const finestHour = captain.combatPresets.find((preset) => preset.name === "Finest Hour");
  assert.equal(finestHour.weaponScope, "Melee");
  assert.deepEqual(
    finestHour.effects.map((effect) => [effect.type, effect.value, effect.role, effect.subject]),
    [
      ["devastating_wounds", 1, "attacker", "self"],
      ["attacks_modifier", 3, "attacker", "self"],
    ],
  );
  const redemptor = catalogue.units.find((unit) => unit.name === "Redemptor Dreadnought");
  const dutyEternal = redemptor.combatPresets.find((preset) => preset.name === "Duty Eternal");
  assert.equal(dutyEternal.activation, "inherent");
  assert.equal(redemptor.models[0].reduction, 1);
  assert.equal(redemptor.models[0].feelNoPain, 0);
  assert.deepEqual(
    dutyEternal.effects.map((effect) => [effect.type, effect.value, effect.role]),
    [["damage_reduction", 1, "target"]],
  );
  assert.equal(
    catalogue.units.some((unit) =>
      unit.combatPresets.some((preset) => preset.name === "Impossible Form (Psychic)"),
    ),
    false,
  );
  const loadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${warriors.id}`),
    testEnv,
    context,
  );
  assert.equal(loadout.status, 200);
  const loadoutData = (await loadout.json()).data;
  assert.equal(loadoutData.suggestedModelCount, 10);
  assert.equal(loadoutData.maximumModelCount, 20);
  assert.deepEqual(loadoutData.startingSizeRanges, [
    { minimum: 10, maximum: 20, source: "10-20 Necron Warriors" },
  ]);
  assert.match(loadoutData.composition[0].text, /10-20 Necron Warriors/i);
  assert.match(loadoutData.loadout, /Every model is equipped with.*gauss flayer/i);
  assert.equal(
    loadoutData.defaultWeapons.find((weapon) => weapon.groupName === "Gauss flayer").terms[0]
      .perModel,
    1,
  );
  assert.ok(loadoutData.wargearOptions.some((option) => /gauss reaper/i.test(option)));
  const reaperLimit = loadoutData.weaponLimits.find((limit) => limit.groupName === "Gauss reaper");
  assert.ok(reaperLimit);
  assert.equal(reaperLimit.terms[0].modelsPerIncrement, 1);

  const invalidLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { [reaperLimit.groupId]: 11 },
        optionCounts: { [reaperLimit.groupId]: 11 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalidLoadout.status, 200);
  const invalidLoadoutData = (await invalidLoadout.json()).data;
  assert.equal(invalidLoadoutData.valid, false);
  assert.match(invalidLoadoutData.warnings[0], /limit of 10/i);

  const standardEquipment = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { [reaperLimit.groupId]: 10 },
        optionCounts: { [reaperLimit.groupId]: 0 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal((await standardEquipment.json()).data.valid, true);

  const cadianDiscrete = catalogue.units.find((unit) => unit.id === "000002612");
  assert.deepEqual(
    cadianDiscrete.startingSizeRanges.map((range) => [range.minimum, range.maximum]),
    [
      [10, 10],
      [20, 20],
    ],
  );
  const casualtyLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId: cadianDiscrete.id, modelCount: 15, weaponCounts: {} }),
    }),
    testEnv,
    context,
  );
  const casualtyLoadoutData = (await casualtyLoadout.json()).data;
  assert.equal(casualtyLoadoutData.valid, false);
  assert.match(casualtyLoadoutData.warnings[0], /starting sizes are 10 or 20/i);
  assert.deepEqual(casualtyLoadoutData.startingSizeRanges, cadianDiscrete.startingSizeRanges);
  assert.deepEqual(casualtyLoadoutData.modelCountStatus, {
    legal: false,
    interpretation: "possible_casualties",
    maximum: 20,
  });

  const accursed = catalogue.units.find((unit) => unit.name === "Accursed Cultists");
  const tormentSubject = accursed.unresolvedLoadoutSubjects.find(
    (subject) => subject.subject === "Every Torment",
  );
  const mutationGroup = tormentSubject.weapons[0].groupId;
  const explicitComposition = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: accursed.id,
        modelCount: 8,
        weaponCounts: { [mutationGroup]: 3 },
        loadoutSubjectCounts: { [tormentSubject.id]: 3 },
      }),
    }),
    testEnv,
    context,
  );
  const explicitCompositionData = (await explicitComposition.json()).data;
  assert.equal(explicitCompositionData.valid, true);
  assert.equal(explicitCompositionData.compositionWeaponCounts[mutationGroup], 3);
  assert.equal(explicitCompositionData.suggestedEquippedCounts[mutationGroup], 3);

  const impossibleComposition = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: accursed.id,
        modelCount: 8,
        weaponCounts: { [mutationGroup]: 9 },
        loadoutSubjectCounts: { [tormentSubject.id]: 9 },
      }),
    }),
    testEnv,
    context,
  );
  const impossibleCompositionData = (await impossibleComposition.json()).data;
  assert.equal(impossibleCompositionData.valid, false);
  assert.match(impossibleCompositionData.warnings[0], /exceeds the unit total/i);

  const invalidSpecialists = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: voidscarred.id,
        modelCount: 10,
        weaponCounts: {},
        loadoutSubjectCounts: { "000002532:2": 2 },
      }),
    }),
    testEnv,
    context,
  );
  const invalidSpecialistsData = (await invalidSpecialists.json()).data;
  assert.equal(invalidSpecialistsData.valid, false);
  assert.match(invalidSpecialistsData.warnings[0], /do not form a legal/i);

  const invalidAquilaComposition = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: aquila.id,
        modelCount: 6,
        weaponCounts: {},
      }),
    }),
    testEnv,
    context,
  );
  const invalidAquilaData = (await invalidAquilaComposition.json()).data;
  assert.equal(invalidAquilaData.valid, false);
  assert.ok(invalidAquilaData.warnings.some((warning) => /do not form a legal/i.test(warning)));

  const aquilaShield = aquila.defensiveEquipment.find(
    (option) => option.name === "Astartes Shield",
  );
  const aquilaShieldPool = aquila.wargearChoicePools.find((pool) => pool.id === "000004174:2");
  const aquilaShieldChoice = aquilaShieldPool.alternatives[0];
  assert.equal(aquilaShield.choiceCoverageExact, true);
  assert.deepEqual(aquilaShield.choiceLinks, [
    {
      alternativeId: aquilaShieldChoice.id,
      quantityDelta: 1,
      source: aquilaShieldPool.source,
    },
  ]);
  assert.deepEqual(
    aquilaShieldPool.replaces.map((weapon) => weapon.groupName),
    ["Heavy thunder hammer"],
  );
  const aquilaPowerWeapon = aquilaShieldChoice.weapons[0];
  const aquilaShieldLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: aquila.id,
        modelCount: 5,
        weaponCounts: { [aquilaPowerWeapon.groupId]: 2 },
        choiceSelections: { [aquilaShieldChoice.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  const aquilaShieldData = (await aquilaShieldLoadout.json()).data;
  assert.equal(aquilaShieldData.suggestedEquippedCounts[aquilaShieldPool.replaces[0].groupId], 0);
  assert.equal(aquilaShieldData.suggestedEquippedCounts[aquilaPowerWeapon.groupId], 2);

  const impulsorShieldLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: impulsor.id,
        modelCount: 1,
        weaponCounts: {},
        choiceSelections: { [shieldDomeChoice.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  assert.deepEqual((await impulsorShieldLoadout.json()).data.sourceCombatPresetIds, [
    shieldDome.id,
  ]);

  const wulfen = catalogue.units.find((unit) => unit.id === "000000311");
  const deathTotem = wulfen.combatPresets.find((preset) => preset.name === "Death Totem");
  assert.ok(deathTotem);
  const wulfenLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: wulfen.id,
        modelCount: 5,
        weaponCounts: {},
        choiceSelections: {},
      }),
    }),
    testEnv,
    context,
  );
  const wulfenData = (await wulfenLoadout.json()).data;
  assert.equal(wulfenData.sourceCombatPresetEquipmentCounts[deathTotem.id], 5);
  assert.deepEqual(wulfenData.sourceCombatPresetIds, []);

  const vespid = catalogue.units.find((unit) => unit.id === "000000427");
  const oversight = vespid.combatPresets.find((preset) => preset.name === "Oversight Drone");
  const oversightChoice = vespid.wargearChoicePools
    .flatMap((pool) => pool.alternatives)
    .find((alternative) => /oversight drone/i.test(alternative.label));
  assert.ok(oversight && oversightChoice);
  const undersizedVespidLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: vespid.id,
        modelCount: 5,
        weaponCounts: {},
        choiceSelections: { [oversightChoice.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  const undersizedVespidData = (await undersizedVespidLoadout.json()).data;
  assert.equal(undersizedVespidData.valid, false);
  assert.equal(undersizedVespidData.sourceCombatPresetEquipmentCounts[oversight.id], 0);
  assert.deepEqual(undersizedVespidData.unavailableSourceCombatPresetIds, [oversight.id]);

  const crisis = catalogue.units.find((unit) => unit.id === "000000418");
  const crisisShieldChoices = crisis.wargearChoicePools
    .flatMap((pool) => pool.alternatives)
    .filter((alternative) => alternative.selectionKey === "equipment:shield generator");
  const duplicateCrisisShield = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: crisis.id,
        modelCount: 3,
        weaponCounts: {},
        choiceSelections: Object.fromEntries(
          crisisShieldChoices.map((alternative) => [alternative.id, 2]),
        ),
      }),
    }),
    testEnv,
    context,
  );
  const duplicateCrisisShieldData = (await duplicateCrisisShield.json()).data;
  assert.equal(duplicateCrisisShieldData.valid, false);
  assert.equal(duplicateCrisisShieldData.selectedChoiceItemCounts["equipment:shield generator"], 4);
  assert.match(
    duplicateCrisisShieldData.warnings.find((warning) => /shield generator/i.test(warning)),
    /shared limit of 3/i,
  );
  assert.equal(duplicateCrisisShieldData.wargearChoiceItemLimits.length, 4);
  assert.deepEqual(duplicateCrisisShieldData.wargearChoicePairingRules, []);
  assert.deepEqual(duplicateCrisisShieldData.weaponTypeLimits, crisis.weaponTypeLimits);

  const wolfPool = wolfGuardLeader.wargearChoicePools.find((pool) => pool.id === "000002804:2");
  const wolfBoltgun = wolfPool.alternatives.find((choice) => /^1 boltgun$/i.test(choice.label));
  const wolfStormBolter = wolfPool.alternatives.find((choice) =>
    /^1 storm bolter$/i.test(choice.label),
  );
  const invalidWolfPair = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: wolfGuardLeader.id,
        modelCount: 1,
        weaponCounts: {},
        choiceSelections: { [wolfBoltgun.id]: 1, [wolfStormBolter.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  const invalidWolfPairData = (await invalidWolfPair.json()).data;
  assert.equal(invalidWolfPairData.valid, false);
  assert.deepEqual(
    invalidWolfPairData.wargearChoicePairingRules,
    wolfGuardLeader.wargearChoicePairingRules,
  );
  assert.match(invalidWolfPairData.warnings.join("\n"), /requires at least 1 pistol selection/i);

  const terminatorLeader = catalogue.units.find((unit) => unit.id === "000002803");
  const terminatorPool = terminatorLeader.wargearChoicePools.find(
    (pool) => pool.id === "000002803:2",
  );
  const cyclone = terminatorPool.alternatives.find((choice) =>
    /cyclone missile launcher/i.test(choice.label),
  );
  const chainfist = terminatorPool.alternatives.find((choice) =>
    /^1 chainfist$/i.test(choice.label),
  );
  const assaultCannon = terminatorPool.alternatives.find((choice) =>
    /^1 assault cannon$/i.test(choice.label),
  );
  const combiWeapon = terminatorLeader.wargearChoicePools
    .flatMap((pool) => pool.alternatives)
    .find((choice) => /^1 combi-weapon$/i.test(choice.label));
  const validCycloneChoices = {
    [cyclone.id]: 1,
    [chainfist.id]: 1,
    [combiWeapon.id]: 1,
  };
  const validCycloneLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: terminatorLeader.id,
        modelCount: 1,
        weaponCounts: sourceEquippedWeaponCounts(terminatorLeader, 1, validCycloneChoices),
        choiceSelections: validCycloneChoices,
      }),
    }),
    testEnv,
    context,
  );
  const validCycloneData = (await validCycloneLoadout.json()).data;
  assert.equal(validCycloneData.valid, true, validCycloneData.warnings.join("\n"));
  assert.equal(validCycloneData.wargearChoicePairingRules[0].evaluationScope, "unit");

  const invalidCycloneChoices = { [cyclone.id]: 1, [assaultCannon.id]: 1 };
  const invalidCycloneLoadout = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: terminatorLeader.id,
        modelCount: 1,
        weaponCounts: sourceEquippedWeaponCounts(terminatorLeader, 1, invalidCycloneChoices),
        choiceSelections: invalidCycloneChoices,
      }),
    }),
    testEnv,
    context,
  );
  const invalidCycloneData = (await invalidCycloneLoadout.json()).data;
  assert.equal(invalidCycloneData.valid, false);
  assert.match(invalidCycloneData.warnings.join("\n"), /3 ranged selections.*maximum of 2/i);

  const burstGroup = crisis.weapons.find((weapon) => weapon.groupName === "Burst cannon").groupId;
  const tooManyRangedWeapons = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: crisis.id,
        modelCount: 3,
        weaponCounts: { [burstGroup]: 10 },
      }),
    }),
    testEnv,
    context,
  );
  const tooManyRangedWeaponsData = (await tooManyRangedWeapons.json()).data;
  assert.equal(tooManyRangedWeaponsData.valid, false);
  assert.ok(
    tooManyRangedWeaponsData.warnings.some((warning) =>
      /10 equipped copies.*limit of 9/i.test(warning),
    ),
  );

  const assaultWithChoices = catalogue.units.find((unit) => unit.id === "000000061");
  const assaultChoicePool = assaultWithChoices.wargearChoicePools.find(
    (pool) => pool.id === "000000061:3",
  );
  assert.deepEqual(assaultChoicePool.replaces, []);
  assert.deepEqual(
    assaultChoicePool.alternatives.map((alternative) =>
      (alternative.replaces ?? []).map((weapon) => weapon.groupName),
    ),
    [["Bolt pistol", "Astartes chainsword"], []],
  );

  const achillus = catalogue.units.find((unit) => unit.name === "Contemptor-achillus Dreadnought");
  const achillusPool = achillus.wargearChoicePools[0];
  assert.equal(achillusPool.alternatives.length, 5);
  const infernusGroup = achillus.weapons.find(
    (weapon) => weapon.groupName === "Infernus incinerator",
  ).groupId;
  const lastrumGroup = achillus.weapons.find(
    (weapon) => weapon.groupName === "Lastrum storm bolter",
  ).groupId;
  assert.deepEqual(achillusPool.replaces, [
    { groupId: lastrumGroup, groupName: "Lastrum storm bolter", quantity: 2 },
  ]);
  const doubleInfernus = achillusPool.alternatives.find((alternative) =>
    /^2 infernus incinerators$/i.test(alternative.label),
  );
  const validBundle = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: achillus.id,
        modelCount: 1,
        weaponCounts: { [infernusGroup]: 2 },
        choiceSelections: { [doubleInfernus.id]: 1 },
      }),
    }),
    testEnv,
    context,
  );
  const validBundleData = (await validBundle.json()).data;
  assert.equal(validBundleData.valid, true);
  assert.equal(validBundleData.selectedWeaponCounts[infernusGroup], 2);
  assert.equal(validBundleData.suggestedEquippedCounts[lastrumGroup], 0);
  assert.equal(validBundleData.suggestedEquippedCounts[infernusGroup], 2);
  const invalidSharedPool = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: achillus.id,
        modelCount: 1,
        weaponCounts: { [infernusGroup]: 4 },
        choiceSelections: { [doubleInfernus.id]: 2 },
      }),
    }),
    testEnv,
    context,
  );
  const invalidSharedPoolData = (await invalidSharedPool.json()).data;
  assert.equal(invalidSharedPoolData.valid, false);
  assert.match(invalidSharedPoolData.warnings[0], /shared limit of 1/i);

  const unknownWeapon = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId: warriors.id,
        modelCount: 10,
        weaponCounts: { "not-a-weapon": 1 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(unknownWeapon.status, 400);
  assert.match((await unknownWeapon.json()).error.message, /weapon group ids/i);

  const overriddenCasualties = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId: warriors.id, modelCount: 7, weaponCounts: {} }),
    }),
    testEnv,
    context,
  );
  assert.match((await overriddenCasualties.json()).data.warnings[0], /battlefield casualties/i);

  const cadian = catalogue.units.find((unit) => unit.name === "Cadian Shock Troops");
  const cadianLoadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${cadian.id}`),
    testEnv,
    context,
  );
  const cadianData = (await cadianLoadout.json()).data;
  assert.equal(cadianData.suggestedModelCount, 10);
  assert.equal(cadianData.maximumModelCount, 20);
  assert.ok(cadianData.compositionModels.some((model) => model.name === "Shock Troopers"));
  const cadianDefaults = await worker.fetch(
    new Request("http://localhost/api/v1/validate-loadout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId: cadian.id, modelCount: 20, weaponCounts: {} }),
    }),
    testEnv,
    context,
  );
  const cadianDefaultCounts = (await cadianDefaults.json()).data.suggestedEquippedCounts;
  const lasgunGroup = cadian.weapons.find((weapon) => weapon.groupName === "Lasgun").groupId;
  assert.equal(cadianDefaultCounts[lasgunGroup], 18);

  const sisters = catalogue.units.find((unit) => unit.name === "Battle Sisters Squad");
  const sisterUnits = await worker.fetch(
    new Request(`http://localhost/api/v1/units?faction=${sisters.factionId}&kind=attacker`),
    testEnv,
    context,
  );
  const sistersSummary = (await sisterUnits.json()).data.find((unit) => unit.id === sisters.id);
  assert.ok(sistersSummary.weaponGroupCount < sistersSummary.weaponProfileCount);
  assert.deepEqual(
    sistersSummary.startingSizeRanges.map((range) => [range.minimum, range.maximum]),
    [[10, 10]],
  );
  const sistersLoadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${sisters.id}`),
    testEnv,
    context,
  );
  const plasmaProfiles = (await sistersLoadout.json()).data.weapons.filter(
    (weapon) => weapon.groupName === "Plasma pistol",
  );
  assert.equal(plasmaProfiles.length, 2);
  assert.equal(new Set(plasmaProfiles.map((weapon) => weapon.groupId)).size, 1);
  assert.deepEqual(
    new Set(plasmaProfiles.map((weapon) => weapon.profileName)),
    new Set(["standard", "supercharge"]),
  );

  const calculate = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: {} }),
    }),
    testEnv,
    context,
  );
  const calculateBody = await calculate.text();
  assert.equal(calculate.status, 200, calculateBody);
  const calculated = JSON.parse(calculateBody);
  assert.ok(calculated.data.mean > 0);
  assert.match(calculated.data.exact.numerator, /^\d+$/);
  assert.ok(calculated.data.applied.mean > 0);
  assert.ok(calculated.data.applied.mean <= calculated.data.mean);
  assert.match(calculated.data.applied.estimated.numerator, /^\d+$/);

  const signedProfile = {
    attackDice: 1,
    attackSides: 6,
    attacks: 0,
    attacksModifier: -100,
    weaponCount: 2,
    hitOn: 2,
    strength: 10,
    ap: 0,
    damageDice: 0,
    damageSides: 0,
    damage: 1,
    toughness: 1,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    wounds: 10,
    targetModels: 1,
    torrent: true,
  };
  const signedCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: signedProfile }),
    }),
    testEnv,
    context,
  );
  const signedCalculationBody = await signedCalculation.json();
  assert.equal(signedCalculation.status, 200);
  assert.deepEqual(signedCalculationBody.data.exact, { numerator: "5", denominator: "3" });

  const replacementProfile = {
    ...signedProfile,
    attacksReplacement: 4,
    attacksModifier: -1,
  };
  const replacementCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: replacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementCalculation.status, 200);
  assert.deepEqual((await replacementCalculation.json()).data.exact, {
    numerator: "5",
    denominator: "1",
  });

  const firstFailedSaveProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 2,
    attacksModifier: 0,
    weaponCount: 1,
    damage: 3,
    firstFailedSaveDamageReplacement: 0,
    wounds: 20,
  };
  const firstFailedSaveCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: firstFailedSaveProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(firstFailedSaveCalculation.status, 200);
  const firstFailedSaveExact = (await firstFailedSaveCalculation.json()).data;
  assert.equal(firstFailedSaveExact.maximum, 3);
  assert.ok(Math.abs(firstFailedSaveExact.mean - 25 / 12) < 1e-8);

  const firstFailedSaveSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [firstFailedSaveProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 20,
            reduction: 0,
            damageDivisor: 1,
            firstFailedSaveDamageReplacement: 0,
            modelCount: 1,
          },
        ],
        seed: 404,
        trials: 10_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(firstFailedSaveSimulation.status, 200);
  const firstFailedSaveSimulated = (await firstFailedSaveSimulation.json()).data;
  assert.ok(
    Math.abs(firstFailedSaveSimulated.mean - 25 / 12) < 0.08,
    JSON.stringify(firstFailedSaveSimulated),
  );

  const allocatedReplacementProfile = {
    ...firstFailedSaveProfile,
    firstFailedSaveDamageReplacement: null,
    torrent: true,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 2,
    allocatedAttackDamageReplacementSkip: 0,
  };
  const allocatedReplacementCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: allocatedReplacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(allocatedReplacementCalculation.status, 200);
  assert.equal((await allocatedReplacementCalculation.json()).data.maximum, 0);
  const allocatedReplacementSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [allocatedReplacementProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 20,
            reduction: 0,
            damageDivisor: 1,
            firstFailedSaveDamageReplacement: null,
            allocatedAttackDamageReplacement: 0,
            allocatedAttackDamageReplacementUses: 2,
            allocatedAttackDamageReplacementSkip: 0,
            modelCount: 1,
          },
        ],
        seed: 405,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(allocatedReplacementSimulation.status, 200);
  assert.equal((await allocatedReplacementSimulation.json()).data.maximum, 0);

  const zeroDamageReplacement = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    strength: 2,
    strengthReplacement: 8,
    strengthModifier: -1,
    damageDice: 1,
    damageSides: 6,
    damage: 0,
    damageReplacement: 0,
    damageModifier: 0,
    toughness: 7,
  };
  const zeroDamageCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: zeroDamageReplacement }),
    }),
    testEnv,
    context,
  );
  assert.equal(zeroDamageCalculation.status, 200);
  assert.deepEqual((await zeroDamageCalculation.json()).data.exact, {
    numerator: "0",
    denominator: "1",
  });

  const meltaAfterReplacement = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: { ...zeroDamageReplacement, withinHalfRange: true, melta: 2 },
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(meltaAfterReplacement.status, 200);
  assert.deepEqual((await meltaAfterReplacement.json()).data.exact, {
    numerator: "1",
    denominator: "1",
  });

  const dividedDamageProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    damage: 5,
    damageModifier: 1,
    damageDivisor: 2,
  };
  const dividedDamageCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: dividedDamageProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(dividedDamageCalculation.status, 200);
  assert.deepEqual((await dividedDamageCalculation.json()).data.exact, {
    numerator: "10",
    denominator: "3",
  });

  const multipliedProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 3,
    attacksMultiplier: 2,
    attacksModifier: 1,
    weaponCount: 1,
    strength: 4,
    strengthMultiplier: 2,
    strengthModifier: 1,
    toughness: 8,
    damage: 5,
    damageMultiplier: 2,
    damageModifier: 1,
    damageDivisor: 2,
  };
  const multipliedCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: multipliedProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(multipliedCalculation.status, 200);
  assert.deepEqual((await multipliedCalculation.json()).data.exact, {
    numerator: "28",
    denominator: "1",
  });
  const multipliedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [multipliedProfile],
        targets: [
          {
            toughness: 8,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 100,
            reduction: 0,
            damageDivisor: 2,
            modelCount: 1,
          },
        ],
        seed: 1701,
        trials: 5000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(multipliedSimulation.status, 200);
  assert.ok(Math.abs((await multipliedSimulation.json()).data.mean - 28) < 0.25);

  const sharedCharacteristicProfile = {
    ...signedProfile,
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    attacksModifier: 0,
    weaponCount: 1,
    strength: 3,
    strengthModifier: 0,
    toughness: 5,
    damage: 1,
    characteristicModifierDice: 1,
    characteristicModifierSides: 3,
    characteristicModifierBonus: 0,
    characteristicModifierAttacks: true,
    characteristicModifierStrength: true,
    characteristicModifierDamage: false,
  };
  const sharedCharacteristicCalculation = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: sharedCharacteristicProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(sharedCharacteristicCalculation.status, 200);
  assert.deepEqual((await sharedCharacteristicCalculation.json()).data.exact, {
    numerator: "29",
    denominator: "18",
  });
  const sharedCharacteristicSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [sharedCharacteristicProfile],
        targets: [
          {
            toughness: 5,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 100,
            reduction: 0,
            damageDivisor: 1,
            modelCount: 1,
          },
        ],
        seed: 1701,
        trials: 10000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(sharedCharacteristicSimulation.status, 200);
  assert.ok(Math.abs((await sharedCharacteristicSimulation.json()).data.mean - 29 / 18) < 0.04);

  const groupedProfiles = [
    { ...sharedCharacteristicProfile, characteristicModifierGroup: "shared-d3" },
    { ...sharedCharacteristicProfile, characteristicModifierGroup: "shared-d3" },
  ];
  const groupedTargets = [
    {
      toughness: 5,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 2,
      reduction: 0,
      damageDivisor: 1,
      modelCount: 1,
    },
  ];
  const volleyResult = async (path, profiles, extra = {}) => {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles, targets: groupedTargets, ...extra }),
      }),
      testEnv,
      context,
    );
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };
  const groupedExact = await volleyResult("/api/v1/volley", groupedProfiles);
  const independentProfiles = [
    groupedProfiles[0],
    { ...groupedProfiles[1], characteristicModifierGroup: "another-d3" },
  ];
  const independentExact = await volleyResult("/api/v1/volley", independentProfiles);
  assert.notEqual(groupedExact.mean, independentExact.mean);
  const groupedSimulation = await volleyResult("/api/v1/volley/simulate", groupedProfiles, {
    seed: 1701,
    trials: 20000,
  });
  const independentSimulation = await volleyResult("/api/v1/volley/simulate", independentProfiles, {
    seed: 1701,
    trials: 20000,
  });
  assert.ok(Math.abs(groupedSimulation.mean - groupedExact.mean) < 0.025);
  assert.ok(Math.abs(independentSimulation.mean - independentExact.mean) < 0.025);

  const simulateDamageDivisor = async (damageDivisor) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [{ ...dividedDamageProfile, damageDivisor: 1 }],
          targets: [
            {
              toughness: 1,
              save: 7,
              invulnerable: 0,
              feelNoPain: 0,
              wounds: 1000,
              reduction: 0,
              damageDivisor,
              modelCount: 1,
            },
          ],
          seed: 17,
          trials: 100,
        }),
      }),
      testEnv,
      context,
    );
    assert.equal(response.status, 200);
    return (await response.json()).data.mean;
  };
  const undividedSimulationMean = await simulateDamageDivisor(1);
  const dividedSimulationMean = await simulateDamageDivisor(2);
  assert.equal(dividedSimulationMean * 1.5, undividedSimulationMean);

  const volleyProfile = (ap, damage) => ({
    attackDice: 0,
    attackSides: 0,
    attacks: 1,
    weaponCount: 1,
    hitOn: 2,
    strength: 10,
    ap,
    damageDice: 0,
    damageSides: 0,
    damage,
    torrent: true,
  });
  const volleyTargets = [
    {
      toughness: 1,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 1,
      reduction: 0,
      modelCount: 1,
    },
    {
      toughness: 1,
      save: 2,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 2,
      reduction: 0,
      modelCount: 1,
    },
  ];
  const requestVolley = async (profiles, targets = volleyTargets, initialWoundsLost = 0) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/volley", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles, targets, initialWoundsLost }),
      }),
      testEnv,
      context,
    );
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text).data;
  };
  const rapidReplacementVolley = await requestVolley(
    [
      {
        ...replacementProfile,
        weaponCount: 1,
        withinHalfRange: true,
        rapidFireDice: 1,
        rapidFireSides: 3,
        rapidFire: 0,
      },
    ],
    [
      {
        toughness: 1,
        save: 7,
        invulnerable: 0,
        feelNoPain: 0,
        wounds: 10,
        reduction: 0,
        modelCount: 1,
      },
    ],
  );
  assert.equal(rapidReplacementVolley.maximum, 6);
  assert.ok(Math.abs(rapidReplacementVolley.mean - 25 / 6) < 1e-8);
  const forwardVolley = await requestVolley([volleyProfile(0, 1), volleyProfile(6, 2)]);
  const reverseVolley = await requestVolley([volleyProfile(6, 2), volleyProfile(0, 1)]);
  assert.ok(forwardVolley.mean > reverseVolley.mean);
  assert.equal(forwardVolley.maximum, 3);
  assert.equal(forwardVolley.cumulative.length, 2);
  const partialVolley = await requestVolley(
    [volleyProfile(6, 2)],
    [{ ...volleyTargets[1], save: 7, modelCount: 2 }],
    1,
  );
  assert.equal(partialVolley.maximum, 1);

  const volleyRoll = await worker.fetch(
    new Request("http://localhost/api/v1/volley/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [volleyProfile(0, 1), volleyProfile(6, 2)],
        targets: volleyTargets,
        initialWoundsLost: 0,
      }),
    }),
    testEnv,
    context,
  );
  const volleyRollText = await volleyRoll.text();
  assert.equal(volleyRoll.status, 200, volleyRollText);
  const volleyRolled = JSON.parse(volleyRollText).data;
  assert.equal(volleyRolled.lines.length, 2);
  assert.ok(volleyRolled.appliedDamage >= 0 && volleyRolled.appliedDamage <= 3);
  assert.equal(
    volleyRolled.appliedDamage,
    volleyRolled.lines.reduce((total, line) => total + line.appliedDamage, 0),
  );
  assert.ok(volleyRolled.lines.every((line) => line.details.length === 0));

  const simulationRequest = () =>
    worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [volleyProfile(0, 1), volleyProfile(6, 2)],
          targets: volleyTargets,
          initialWoundsLost: 0,
          seed: 0x40_000,
          trials: 20_000,
        }),
      }),
      testEnv,
      context,
    );
  const firstSimulationResponse = await simulationRequest();
  const firstSimulationText = await firstSimulationResponse.text();
  assert.equal(firstSimulationResponse.status, 200, firstSimulationText);
  const firstSimulation = JSON.parse(firstSimulationText).data;
  const secondSimulation = (await (await simulationRequest()).json()).data;
  assert.deepEqual(secondSimulation, firstSimulation);
  assert.equal(firstSimulation.algorithm, "xoshiro128ss-v1");
  assert.equal(firstSimulation.seed, 0x40_000);
  assert.equal(
    firstSimulation.histogram.reduce((total, bucket) => total + bucket.count, 0),
    firstSimulation.trials,
  );
  assert.ok(Math.abs(firstSimulation.mean - forwardVolley.mean) < 0.06);
  assert.ok(firstSimulation.zeroDamageChance >= 0 && firstSimulation.zeroDamageChance <= 1);
  assert.ok(firstSimulation.unitDestroyedChance >= 0 && firstSimulation.unitDestroyedChance <= 1);

  const devastatingLastProfiles = [
    {
      ...volleyProfile(0, 2),
      criticalWounds: 2,
      devastatingWounds: true,
    },
    volleyProfile(0, 3),
  ];
  const devastatingLastTargets = [
    {
      toughness: 1,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 3,
      reduction: 0,
      modelCount: 2,
    },
  ];
  const devastatingLastExact = await requestVolley(devastatingLastProfiles, devastatingLastTargets);
  assert.equal(devastatingLastExact.maximum, 5);
  assert.equal(devastatingLastExact.peakSparseStates, 4);
  assert.ok(Math.abs(devastatingLastExact.mean - 25 / 6) < 1e-8, devastatingLastExact.mean);

  const complexityResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: devastatingLastProfiles,
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const complexityText = await complexityResponse.text();
  assert.equal(complexityResponse.status, 200, complexityText);
  const complexity = JSON.parse(complexityText).data;
  assert.equal(complexity.usesDeferredStates, true);
  assert.equal(complexity.exactGuaranteedByBound, true);
  assert.equal(complexity.estimatedStateUpperBound, 112);
  assert.equal(complexity.stateLimit, 2047);
  assert.equal(complexity.estimateKind, "prefix-aware-conservative-upper-bound");
  assert.equal(complexity.fallbackEndpoint, "/api/v1/volley/simulate");

  const highComplexityResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ ...devastatingLastProfiles[0], attacks: 20 }, devastatingLastProfiles[1]],
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const highComplexity = (await highComplexityResponse.json()).data;
  assert.equal(highComplexity.exactGuaranteedByBound, false);
  assert.ok(highComplexity.estimatedStateUpperBound > highComplexity.stateLimit);

  const tightenedResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/complexity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ ...volleyProfile(0, 1), attacks: 8 }, devastatingLastProfiles[0]],
        targets: devastatingLastTargets,
      }),
    }),
    testEnv,
    context,
  );
  const tightened = (await tightenedResponse.json()).data;
  assert.equal(tightened.estimatedStateUpperBound, 1134);
  assert.equal(tightened.exactGuaranteedByBound, true);

  const overflowingProfile = {
    ...volleyProfile(4, 0),
    attackDice: 1,
    attackSides: 6,
    attacks: 0,
    damageDice: 1,
    damageSides: 6,
    criticalHits: 5,
    criticalWounds: 5,
    lethalHits: true,
    devastatingWounds: true,
    sustainedHitsDice: 1,
    sustainedHitsSides: 3,
  };
  const exactLimitResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: Array.from({ length: 4 }, () => overflowingProfile),
        targets: [{ ...devastatingLastTargets[0], feelNoPain: 6, modelCount: 20 }],
      }),
    }),
    testEnv,
    context,
  );
  const exactLimit = await exactLimitResponse.json();
  assert.equal(exactLimitResponse.status, 422);
  assert.equal(exactLimit.error.code, "EXACT_STATE_LIMIT");
  assert.match(exactLimit.error.message, /volley\/simulate/);

  const devastatingLastResponse = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: devastatingLastProfiles,
        targets: devastatingLastTargets,
        seed: 0xd3_7a_51,
        trials: 20_000,
      }),
    }),
    testEnv,
    context,
  );
  const devastatingLastText = await devastatingLastResponse.text();
  assert.equal(devastatingLastResponse.status, 200, devastatingLastText);
  const devastatingLast = JSON.parse(devastatingLastText).data;
  assert.ok(Math.abs(devastatingLast.mean - 25 / 6) < 0.04, devastatingLast.mean);
  const replaySnapshot = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [
          {
            attackDice: 0,
            attacks: 4,
            weaponCount: 1,
            hitOn: 3,
            strength: 10,
            ap: 0,
            damageDice: 0,
            damageSides: 0,
            damage: 2,
          },
        ],
        targets: [
          {
            toughness: 10,
            save: 3,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 12,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 0x40_000,
        trials: 1_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.deepEqual((await replaySnapshot.json()).data.histogram, [
    { damage: 0, count: 659, probability: 0.659 },
    { damage: 2, count: 271, probability: 0.271 },
    { damage: 4, count: 64, probability: 0.064 },
    { damage: 6, count: 6, probability: 0.006 },
  ]);
  const oversizedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [
          {
            attackDice: 20,
            attackSides: 100,
            attacks: 1024,
            weaponCount: 100,
            sustainedHitsDice: 20,
            sustainedHitsSides: 100,
            sustainedHits: 1024,
          },
        ],
        targets: volleyTargets,
        seed: 1,
        trials: 100_000,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(oversizedSimulation.status, 400);
  assert.match(await oversizedSimulation.text(), /simulation is too large/i);

  const roll = await worker.fetch(
    new Request("http://localhost/api/v1/roll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: {} }),
    }),
    testEnv,
    context,
  );
  const rollBody = await roll.text();
  assert.equal(roll.status, 200, rollBody);
  const rolled = JSON.parse(rollBody);
  assert.equal(rolled.data.attacks, 4);
  assert.ok(rolled.data.attacksResolved >= 1 && rolled.data.attacksResolved <= 4);
  assert.ok(rolled.data.details.length >= rolled.data.attacksResolved);
  assert.ok(rolled.data.appliedDamage <= rolled.data.totalDamage);
  assert.ok(rolled.data.modelsDestroyed <= 1);

  const signedRoll = await worker.fetch(
    new Request("http://localhost/api/v1/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: signedProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(signedRoll.status, 200);
  assert.equal((await signedRoll.json()).data.attacks, 2);

  const signedSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [signedProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 10,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 1,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(signedSimulation.status, 200);
  assert.equal((await signedSimulation.json()).data.means.attacksResolved, 2);

  const replacementRoll = await worker.fetch(
    new Request("http://localhost/api/v1/roll?details=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: replacementProfile }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementRoll.status, 200);
  assert.equal((await replacementRoll.json()).data.attacks, 6);

  const replacementSimulation = await worker.fetch(
    new Request("http://localhost/api/v1/volley/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [replacementProfile],
        targets: [
          {
            toughness: 1,
            save: 7,
            invulnerable: 0,
            feelNoPain: 0,
            wounds: 10,
            reduction: 0,
            modelCount: 1,
          },
        ],
        seed: 1,
        trials: 100,
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(replacementSimulation.status, 200);
  assert.equal((await replacementSimulation.json()).data.means.attacksResolved, 6);
});

test("replays canonical battle health through the C and WebAssembly API", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: goldenBattleReplay, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.schemaVersion, 1);
  assert.equal(result.data.rulesSnapshot, "catalogue:test");
  assert.deepEqual(result.data.health, {
    bodyguard: { modelsRemaining: 1, woundsLost: 1 },
    leader: { modelsRemaining: 1, woundsLost: 0 },
  });
  assert.deepEqual(result.data.activeAttackIds, ["final-attack"]);

  const versionTwo = structuredClone(goldenBattleReplay);
  versionTwo.version = 2;
  versionTwo.players[0].listUpdatedAt = 10;
  versionTwo.players[1].listUpdatedAt = 20;
  const versionTwoResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionTwo, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(versionTwoResponse.status, 200);
  const versionTwoResult = await versionTwoResponse.json();
  assert.equal(versionTwoResult.data.schemaVersion, 2);
  assert.deepEqual(versionTwoResult.data.health, result.data.health);

  let versionThree = {
    ...structuredClone(versionTwo),
    version: 3,
    migration: {
      sourceVersion: 2,
      legacyUntimedThroughSequence: versionTwo.events.length,
    },
  };
  versionThree = startBattle(versionThree, "player-1", "start-guided-battle", 200);
  for (let index = 0; index < 8; index++) {
    versionThree = advanceBattleClock(versionThree, `advance-clock-${index}`, 201 + index);
  }
  versionThree = applyBattleEffect(
    versionThree,
    {
      id: "phase-effect",
      name: "Test phase effect",
      ownerPlayerId: "player-1",
      sourceFormationId: "attacker",
      duration: "end_of_phase",
    },
    "apply-phase-effect",
    220,
  );
  versionThree = openBattleChoice(
    versionThree,
    {
      id: "attack-choice",
      kind: "test",
      ownerPlayerId: "player-1",
      prompt: "Choose a firing mode",
      minimumSelections: 1,
      maximumSelections: 1,
      options: [{ id: "focused", label: "Focused" }],
    },
    "open-attack-choice",
    221,
  );
  assert.deepEqual(versionThree.migration, {
    sourceVersion: 2,
    legacyUntimedThroughSequence: versionTwo.events.length,
  });
  const versionThreeResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionThree, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(
    versionThreeResponse.status,
    200,
    JSON.stringify(await versionThreeResponse.clone().json()),
  );
  const versionThreeResult = await versionThreeResponse.json();
  assert.equal(versionThreeResult.data.schemaVersion, 3);
  assert.deepEqual(versionThreeResult.data.health, result.data.health);
  assert.deepEqual(versionThreeResult.data.clock, {
    status: "active",
    battleRound: 1,
    turn: 1,
    phase: "shooting",
    step: "resolve_attacks",
    firstPlayerId: "player-1",
    activePlayerId: "player-1",
    priorityPlayerId: "player-1",
  });
  assert.deepEqual(versionThreeResult.data.pendingChoiceIds, ["attack-choice"]);
  assert.deepEqual(versionThreeResult.data.activeEffects, [
    {
      id: "phase-effect",
      name: "Test phase effect",
      duration: "end_of_phase",
      ownerPlayerId: "player-1",
      sourceFormationId: "attacker",
    },
  ]);

  let versionFour = {
    ...structuredClone(versionThree),
    version: 4,
    migration: {
      sourceVersion: 3,
      legacyUntimedThroughSequence: versionThree.migration.legacyUntimedThroughSequence,
    },
  };
  versionFour = changeBattleResource(
    versionFour,
    {
      playerId: "player-1",
      resourceId: "command_points",
      name: "Command Points",
      delta: -1,
      reason: "Used a Stratagem",
    },
    "api-spend-cp",
    222,
  );
  versionFour = scoreBattlePoints(
    versionFour,
    "player-1",
    5,
    "primary",
    "Held an objective",
    "api-score",
    223,
  );
  versionFour = setBattleObjectiveControl(
    versionFour,
    "objective-1",
    "player-1",
    false,
    "api-objective",
    224,
  );
  versionFour = setFormationBattleShocked(
    versionFour,
    "target",
    true,
    "Failed Battle-shock test",
    "api-shock",
    225,
  );
  const versionFourResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionFour, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(
    versionFourResponse.status,
    200,
    JSON.stringify(await versionFourResponse.clone().json()),
  );
  const versionFourResult = await versionFourResponse.json();
  assert.equal(versionFourResult.data.schemaVersion, 4);
  assert.equal(versionFourResult.data.mission.name, "Custom mission");
  assert.deepEqual(
    versionFourResult.data.players[0].resources.map(({ id, value }) => [id, value]),
    [
      ["command_points", 0],
      ["victory_points", 5],
    ],
  );
  assert.equal(versionFourResult.data.objectives[0].controllerPlayerId, "player-1");
  assert.deepEqual(versionFourResult.data.battleShockedFormationIds, ["target"]);
  assert.equal(versionFourResult.data.scoringEvents[0].reason, "Held an objective");

  let versionFive = {
    ...structuredClone(versionFour),
    version: 5,
    migration: {
      sourceVersion: 4,
      legacyUntimedThroughSequence: versionFour.migration.legacyUntimedThroughSequence,
      legacyUnactionedThroughSequence: versionFour.events.length,
    },
  };
  versionFive = resolveBattleChoice(
    versionFive,
    "attack-choice",
    ["focused"],
    "resolve-api-choice",
    226,
  );
  versionFive = startFormationActivation(
    versionFive,
    "attacker",
    {
      weaponType: "Ranged",
      eligibilityOverride: true,
      overrideReason: "Migrated battle has no recorded movement",
    },
    "api-activation",
    227,
  );
  const versionFiveResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionFive, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(
    versionFiveResponse.status,
    200,
    JSON.stringify(await versionFiveResponse.clone().json()),
  );
  const versionFiveResult = await versionFiveResponse.json();
  assert.equal(versionFiveResult.data.schemaVersion, 5);
  assert.deepEqual(versionFiveResult.data.movement, []);
  assert.deepEqual(versionFiveResult.data.charges, []);
  assert.deepEqual(versionFiveResult.data.activeActivation, {
    formationId: "attacker",
    activationType: "shooting",
    weaponRestriction: "all",
    source: "normal",
    targetFormationId: null,
    attackCount: 0,
  });

  const versionSix = {
    ...structuredClone(versionFive),
    version: 6,
    migration: {
      sourceVersion: 5,
      legacyUntimedThroughSequence: versionFive.migration.legacyUntimedThroughSequence,
      legacyUnactionedThroughSequence: versionFive.migration.legacyUnactionedThroughSequence,
      legacyDeploymentThroughSequence: versionFive.events.length,
    },
  };
  const versionSixResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionSix, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(
    versionSixResponse.status,
    200,
    JSON.stringify(await versionSixResponse.clone().json()),
  );
  const versionSixResult = await versionSixResponse.json();
  assert.equal(versionSixResult.data.schemaVersion, 6);
  assert.equal(versionSixResult.data.deployment.complete, true);
  assert.deepEqual(versionSixResult.data.deployment.offBattlefieldFormationIds, []);
  assert.deepEqual(versionSixResult.data.deployment.deployedFormationIds, ["attacker", "target"]);
  assert.equal(versionSixResult.data.deployment.declarations[0].legacyAssumed, true);

  const versionSeven = {
    ...structuredClone(versionSix),
    version: 7,
    migration: {
      sourceVersion: 6,
      legacyUntimedThroughSequence: versionSix.migration.legacyUntimedThroughSequence,
      legacyUnactionedThroughSequence: versionSix.migration.legacyUnactionedThroughSequence,
      legacyDeploymentThroughSequence: versionSix.migration.legacyDeploymentThroughSequence,
      legacyTransportThroughSequence: versionSix.events.length,
    },
  };
  const versionSevenResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionSeven, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(versionSevenResponse.status, 200);
  const versionSevenResult = await versionSevenResponse.json();
  assert.equal(versionSevenResult.data.schemaVersion, 7);
  assert.deepEqual(versionSevenResult.data.transports.embarked, []);
  assert.deepEqual(versionSevenResult.data.transports.pendingDestroyedTransportIds, []);

  const versionEight = {
    ...structuredClone(versionSeven),
    version: 8,
    migration: {
      ...versionSeven.migration,
      sourceVersion: 7,
      legacyTargetEligibilityThroughSequence: versionSeven.events.length,
    },
  };
  const versionEightResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: versionEight, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(versionEightResponse.status, 200);
  const versionEightResult = await versionEightResponse.json();
  assert.equal(versionEightResult.data.schemaVersion, 8);
  assert.deepEqual(versionEightResult.data.targetEligibilityFacts, []);

  const configuredVersionTwo = structuredClone(versionTwo);
  configuredVersionTwo.events.splice(2, 0, {
    version: 1,
    id: "configure-target",
    sequence: 3,
    at: 102,
    type: "formation_configured",
    formation: {
      ...structuredClone(configuredVersionTwo.events[1].formation),
      defensiveEquipmentCounts: { "unit-bodyguard::guard::shield": 1 },
    },
  });
  configuredVersionTwo.events.forEach((event, index) => {
    event.sequence = index + 1;
  });
  const configuredResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: configuredVersionTwo, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(configuredResponse.status, 200);
  assert.deepEqual((await configuredResponse.json()).data.health, result.data.health);

  const tampered = structuredClone(goldenBattleReplay);
  tampered.events.at(-1).summary.damage = 5;
  const rejected = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: tampered, formationId: "target" }),
    }),
    testEnv,
    context,
  );
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "INVALID_REQUEST");
});

test("replays source-locked table geometry through the JavaScript and C/WebAssembly API", async () => {
  const players = [
    { id: "player-1", listId: "list-1", listUpdatedAt: 1, name: "Attackers" },
    { id: "player-2", listId: "list-2", listUpdatedAt: 1, name: "Defenders" },
  ];
  let state = createUncoveredBattleState({
    id: "table-geometry-api",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players,
    ruleCoverage: coveredExactBattleRuleBinding(players),
  });
  const target = {
    id: "table-geometry-target",
    playerId: "player-2",
    sourceFormationId: "table-geometry-target",
    name: "Geometry target",
    keywords: ["Vehicle"],
    segments: [
      {
        id: "table-geometry-target-model",
        savedUnitId: "table-geometry-target",
        unitName: "Geometry target",
        modelName: "Geometry target",
        role: "standalone",
        wounds: 10,
        startingModels: 1,
      },
    ],
  };
  state = registerBattleFormation(state, target, "register-table-geometry-target", 1);
  state = configureBattleMission(
    state,
    {
      name: "A · Take and Hold · Tipping Point",
      pointsLimit: 2000,
      deploymentFirstPlayerId: "player-1",
      commandPointsPerCommandPhase: 1,
      startingCommandPoints: { "player-1": 0, "player-2": 0 },
      objectives: [
        { id: "objective-1", name: "Objective 1" },
        { id: "objective-2", name: "Objective 2" },
      ],
    },
    "configure-table-geometry-mission",
    2,
  );
  const geometry = {
    missionSourceId: "chapter-approved-2025-26-v1.4-a",
    terrainSourceId: "chapter-approved-2025-26-v1.4-layout-1",
    deploymentName: "Tipping Point",
    battlefieldWidthThousandths: TABLE_GEOMETRY_CONSTANTS.widthThousandths,
    battlefieldHeightThousandths: TABLE_GEOMETRY_CONSTANTS.heightThousandths,
    origin: "attacker-left-near",
    objectivePositions: [
      { objectiveId: "objective-1", xThousandths: 12_000, yThousandths: 11_000 },
      { objectiveId: "objective-2", xThousandths: 48_000, yThousandths: 33_000 },
    ],
    terrainProfile: {
      sectionCount: TABLE_GEOMETRY_CONSTANTS.terrainSectionCount,
      sixByFourCount: TABLE_GEOMETRY_CONSTANTS.sixByFourCount,
      tenByFiveCount: TABLE_GEOMETRY_CONSTANTS.tenByFiveCount,
      twelveBySixCount: TABLE_GEOMETRY_CONSTANTS.twelveBySixCount,
      sourcePage: 8,
    },
    terrainLayoutReviewed: true,
    deploymentZonesReviewed: true,
    objectivePositionsReviewed: true,
    reviewedByPlayer: true,
    method: "manual",
    reviewReason: "Players checked the mission card, terrain, zones, and objective centres",
  };
  state = configureBattleTableGeometry(state, geometry, "record-table-geometry", 3);

  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: target.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.deepEqual(body.data.tableGeometry, geometry);
});

test("cross-checks structured charge movement through the C and WebAssembly API", async () => {
  const attacker = {
    id: "charge-attacker",
    playerId: "player-1",
    sourceFormationId: "charge-attacker",
    name: "Charge attacker",
    keywords: ["Infantry"],
    segments: [
      {
        id: "charge-attacker-model",
        savedUnitId: "charge-attacker",
        unitName: "Charge attacker",
        modelName: "Charge attacker",
        role: "standalone",
        wounds: 2,
        startingModels: 1,
      },
    ],
  };
  const target = {
    ...structuredClone(attacker),
    id: "charge-target",
    playerId: "player-2",
    sourceFormationId: "charge-target",
    name: "Charge target",
    segments: [
      {
        ...attacker.segments[0],
        id: "charge-target-model",
        savedUnitId: "charge-target",
        unitName: "Charge target",
        modelName: "Charge target",
      },
    ],
  };
  const intervenor = {
    ...structuredClone(target),
    id: "heroic-intervenor",
    sourceFormationId: "heroic-intervenor",
    name: "Heroic intervenor",
    segments: [
      {
        ...target.segments[0],
        id: "heroic-intervenor-model",
        savedUnitId: "heroic-intervenor",
        unitName: "Heroic intervenor",
        modelName: "Heroic intervenor",
      },
    ],
  };
  let state = createBattleState({
    id: "charge-api",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", listUpdatedAt: 1, name: "Chargers" },
      { id: "player-2", listId: "list-2", listUpdatedAt: 1, name: "Targets" },
    ],
  });
  state = registerBattleFormation(state, attacker, "register-charge-attacker", 1);
  state = registerBattleFormation(state, target, "register-charge-target", 2);
  state = registerBattleFormation(state, intervenor, "register-heroic-intervenor", 3);
  state = declareFormationDeployment(
    state,
    attacker.id,
    "battlefield",
    {},
    "declare-charge-attacker",
    3,
  );
  state = declareFormationDeployment(
    state,
    target.id,
    "battlefield",
    {},
    "declare-charge-target",
    4,
  );
  state = declareFormationDeployment(
    state,
    intervenor.id,
    "battlefield",
    {},
    "declare-heroic-intervenor",
    5,
  );
  state = deployFormation(
    state,
    attacker.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-charge-attacker",
    5,
  );
  state = deployFormation(
    state,
    target.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-charge-target",
    6,
  );
  state = deployFormation(
    state,
    intervenor.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-heroic-intervenor",
    7,
  );
  state = startBattle(state, "player-1", "start-charge", 7);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(state, `to-charge-move-${state.events.length}`, state.events.length);
  }
  state = recordFormationMovement(
    state,
    attacker.id,
    "normal",
    "charge-attacker-moved",
    state.events.length,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "charge" &&
      replayBattleState(state).clock.step === "charge_moves"
    )
  ) {
    state = advanceBattleClock(state, `to-charge-${state.events.length}`, state.events.length);
  }
  state = recordFormationCharge(
    state,
    attacker.id,
    [target.id],
    {
      successful: true,
      rolls: [3, 4],
      rollModifier: 0,
      chargeDistanceThousandths: 7000,
      targetFacts: [
        {
          formationId: target.id,
          startDistanceThousandths: 8000,
          endsWithinEngagementRange: true,
        },
      ],
      phaseStartEligibilityConfirmed: true,
      phaseStartEligibilityReason: "Within 12 inches at the start of the Charge phase",
      startedOutsideEngagementRange: true,
      maximumModelMoveThousandths: 7000,
      unitCoherencyConfirmed: true,
      nonTargetEngagementRangeAvoided: true,
      allModelsCloserToTarget: true,
      baseContactMaximized: true,
      movementReviewedByPlayer: true,
      movementReviewReason: "Player reviewed every model endpoint",
    },
    "resolved-charge",
    state.events.length,
  );
  state = resolveHeroicIntervention(
    state,
    intervenor.id,
    {
      successful: true,
      rolls: [3, 4],
      rollModifier: 0,
      chargeDistanceThousandths: 7000,
      startDistanceThousandths: 6000,
      targetEligibilityConfirmed: true,
      targetEligibilityReason: "Within 6 inches and eligible to charge the triggering unit",
      startedOutsideEngagementRange: true,
      maximumModelMoveThousandths: 5000,
      endsWithinEngagementRange: true,
      unitCoherencyConfirmed: true,
      nonTargetEngagementRangeAvoided: true,
      allModelsCloserToTarget: true,
      baseContactMaximized: true,
      movementReviewedByPlayer: true,
      movementReviewReason: "Player reviewed every model endpoint",
    },
    "resolved-heroic-intervention",
    state.events.length,
  );
  state = changeBattleResource(
    state,
    {
      playerId: "player-2",
      resourceId: "command_points",
      name: "Command Points",
      delta: 2,
      reason: "Test Counter-offensive resources",
    },
    "grant-counter-offensive-cp",
    state.events.length,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "fight" &&
      replayBattleState(state).clock.step === "fights_first"
    )
  ) {
    state = advanceBattleClock(state, `to-fight-${state.events.length}`, state.events.length);
  }
  state = passFightPriority(
    state,
    "No eligible Fights First formation",
    "pass-fight-priority",
    state.events.length,
  );
  state = startFormationActivation(
    state,
    attacker.id,
    {},
    "start-fight-activation",
    state.events.length,
  );
  const fightMoveOptions = (stage) => ({
    destination: "enemy",
    maximumModelMoveThousandths: 3000,
    movementReviewedByPlayer: true,
    movementReviewReason: `Player reviewed the ${stage} endpoints`,
    baseContactModelsStationary: true,
    unitCoherencyConfirmed: true,
    endsWithinEngagementRange: true,
    allMovedModelsCloserToEnemy: true,
    baseContactMaximized: true,
    enemyDestinationImpossible: false,
    objectiveId: "",
    endsWithinObjectiveRange: false,
    allMovedModelsCloserToObjective: false,
    objectiveDestinationImpossible: false,
    outcomeReason: "",
    meleeAttacksCompleteConfirmed: stage === "consolidation",
    meleeAttacksCompletionReason:
      stage === "consolidation" ? "All eligible melee attacks were resolved" : "",
  });
  state = recordFightMove(
    state,
    "pile_in",
    fightMoveOptions("pile_in"),
    "record-pile-in",
    state.events.length,
  );
  state = recordFightMove(
    state,
    "consolidation",
    fightMoveOptions("consolidation"),
    "record-consolidation",
    state.events.length,
  );
  state = completeFormationActivation(state, "complete-fight-activation", state.events.length);
  assert.ok(replayBattleState(state).pendingCounterOffensive);
  state = resolveCounterOffensive(
    state,
    target.id,
    "The target remains within Engagement Range of the attacker",
    "resolve-counter-offensive",
    state.events.length,
  );
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: target.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.equal(body.data.ruleCoverage.report.permitted, true);
  assert.equal(body.data.ruleCoverage.snapshotId, coveredRuleCoverageMatrix.snapshotId);
  assert.equal(body.data.charges[0].canonicalMovement, true);
  assert.deepEqual(body.data.charges[0].rolls, [3, 4]);
  assert.equal(body.data.charges[0].chargeDistanceThousandths, 7000);
  const tamperedCoverageState = structuredClone(state);
  tamperedCoverageState.events.find(
    (event) => event.type === "rule_coverage_configured",
  ).coverage.sourceLocks[0].sha256 = "0".repeat(64);
  const tamperedCoverageResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: tamperedCoverageState, formationId: target.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(tamperedCoverageResponse.status, 400);
  assert.match(
    (await tamperedCoverageResponse.json()).error.message,
    /does not match the loaded source snapshot/,
  );
  assert.equal(body.data.charges[0].successful, true);
  assert.equal(body.data.pendingHeroicIntervention, null);
  assert.equal(body.data.heroicInterventions.length, 1);
  assert.equal(body.data.heroicInterventions[0].formationId, intervenor.id);
  assert.equal(body.data.heroicInterventions[0].targetFormationId, attacker.id);
  assert.equal(body.data.heroicInterventions[0].commandPointsBefore, 1);
  assert.equal(body.data.heroicInterventions[0].commandPointsAfter, 0);
  assert.equal(body.data.heroicInterventions[0].receivesChargeBonus, false);
  assert.deepEqual(body.data.heroicInterventionPasses, []);
  assert.equal(body.data.pendingCounterOffensive, null);
  assert.equal(body.data.counterOffensives.length, 1);
  assert.equal(body.data.counterOffensives[0].formationId, target.id);
  assert.equal(body.data.counterOffensives[0].commandPointCost, 2);
  assert.equal(body.data.counterOffensives[0].commandPointsBefore, 2);
  assert.equal(body.data.counterOffensives[0].commandPointsAfter, 0);
  assert.equal(body.data.counterOffensives[0].canonical, true);
  assert.equal(body.data.forcedFightFormationId, target.id);
  assert.equal(body.data.fightActivations.length, 1);
  assert.equal(body.data.fightActivations[0].canonicalMovement, true);
  assert.equal(body.data.fightActivations[0].formationId, attacker.id);
  assert.equal(body.data.fightActivations[0].attackCount, 0);
  assert.equal(body.data.fightActivations[0].pileIn.stage, "pile_in");
  assert.equal(body.data.fightActivations[0].pileIn.destination, "enemy");
  assert.equal(body.data.fightActivations[0].consolidation.stage, "consolidation");
  assert.equal(body.data.fightActivations[0].consolidation.destination, "enemy");
});

test("cross-checks Fire Overwatch reactions through the C and WebAssembly API", async () => {
  const mover = {
    id: "overwatch-mover",
    playerId: "player-1",
    sourceFormationId: "overwatch-mover",
    name: "Overwatch target",
    keywords: ["Vehicle"],
    segments: [
      {
        id: "overwatch-mover-model",
        savedUnitId: "overwatch-mover",
        unitName: "Overwatch target",
        modelName: "Overwatch target",
        role: "standalone",
        wounds: 10,
        startingModels: 1,
      },
    ],
  };
  const shooter = {
    id: "overwatch-shooter",
    playerId: "player-2",
    sourceFormationId: "overwatch-shooter",
    name: "Overwatch shooter",
    keywords: ["Infantry"],
    weaponInventory: [
      {
        sourceSavedUnitId: "overwatch-shooter",
        groupId: "overwatch-gun-group",
        name: "Overwatch gun",
        count: 1,
        profiles: [
          {
            weaponId: "overwatch-gun",
            name: "Overwatch gun",
            type: "Ranged",
            publishedRangeThousandths: 24000,
            hasAssault: false,
            hasIndirect: false,
            hasHazardous: true,
          },
        ],
      },
    ],
    segments: [
      {
        id: "overwatch-shooter-model",
        savedUnitId: "overwatch-shooter",
        unitName: "Overwatch shooter",
        modelName: "Overwatch shooter",
        role: "standalone",
        keywords: ["Infantry"],
        wounds: 3,
        startingModels: 1,
      },
    ],
  };
  let state = createBattleState({
    id: "api-overwatch-battle",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "overwatch-list-1", listUpdatedAt: 1, name: "Mover" },
      { id: "player-2", listId: "overwatch-list-2", listUpdatedAt: 1, name: "Shooter" },
    ],
  });
  state = registerBattleFormation(state, mover, "overwatch-register-mover", 1);
  state = registerBattleFormation(state, shooter, "overwatch-register-shooter", 2);
  state = configureBattleMission(
    state,
    {
      name: "API Fire Overwatch",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "overwatch-configure-mission",
    3,
  );
  state = declareFormationDeployment(
    state,
    mover.id,
    "battlefield",
    {},
    "overwatch-declare-mover",
    4,
  );
  state = declareFormationDeployment(
    state,
    shooter.id,
    "battlefield",
    {},
    "overwatch-declare-shooter",
    5,
  );
  state = deployFormation(
    state,
    mover.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "overwatch-deploy-mover",
    6,
  );
  state = deployFormation(
    state,
    shooter.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "overwatch-deploy-shooter",
    7,
  );
  state = startBattle(state, "player-1", "overwatch-start-battle", 8);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(
      state,
      `overwatch-advance-${state.events.length}`,
      state.events.length,
    );
  }
  const pendingState = startFormationMovement(
    state,
    mover.id,
    "normal",
    "overwatch-normal-start",
    state.events.length,
  );
  state = startFireOverwatch(
    pendingState,
    shooter.id,
    {
      distanceThousandths: 12000,
      targetVisible: true,
      shootingEligibilityConfirmed: true,
      shootingEligibilityReason: "Eligible to shoot in the Shooting phase",
      outOfPhaseRestrictionsConfirmed: true,
      outOfPhaseRestrictionsReason: "Shooting-phase-only rules and Firing Deck excluded",
    },
    "overwatch-started",
    pendingState.events.length,
  );
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: mover.id }),
    }),
    testEnv,
    context,
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.equal(body.data.pendingFireOverwatch, null);
  assert.equal(body.data.fireOverwatches.length, 1);
  assert.equal(body.data.fireOverwatches[0].trigger, "normal_move_start");
  assert.equal(body.data.fireOverwatches[0].formationId, shooter.id);
  assert.equal(body.data.fireOverwatches[0].targetFormationId, mover.id);
  assert.equal(body.data.fireOverwatches[0].commandPointsBefore, 1);
  assert.equal(body.data.fireOverwatches[0].commandPointsAfter, 0);
  assert.equal(body.data.fireOverwatches[0].hitsOnUnmodifiedSixConfirmed, true);
  assert.equal(body.data.fireOverwatches[0].criticalHitsOnSixConfirmed, true);
  assert.deepEqual(body.data.activeActivation, {
    formationId: shooter.id,
    activationType: "shooting",
    weaponRestriction: "all",
    source: "fire_overwatch",
    targetFormationId: mover.id,
    attackCount: 0,
  });
  assert.equal(
    body.data.players
      .find((player) => player.id === "player-2")
      .resources.find((resource) => resource.id === "command_points").value,
    0,
  );

  let hazardousState = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: shooter.id,
      targetFormationId: mover.id,
      weaponId: "overwatch-gun",
      weaponName: "Overwatch gun",
      weaponSourceFormationId: shooter.id,
      sourceSavedUnitId: "overwatch-shooter",
      weaponGroupId: "overwatch-gun-group",
      publishedRangeThousandths: 24000,
      effectiveRangeThousandths: 24000,
      measuredDistanceThousandths: 12000,
      visible: true,
      fullyVisible: false,
      indirectFire: false,
      weaponHasIndirect: false,
      eligibleWeaponCount: 1,
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Visible triggering unit within 24 inches",
    },
    "overwatch-target-fact",
    state.events.length,
  );
  hazardousState = appendResolvedAttack(hazardousState, {
    id: "overwatch-hazardous-attack",
    at: hazardousState.events.length,
    attackerFormationId: shooter.id,
    targetFormationId: mover.id,
    segmentIds: ["overwatch-mover-model"],
    targets: [{ wounds: 10, modelCount: 1 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 0, modelsDestroyed: 0 },
    summary: {
      attacker: shooter.name,
      weapon: "Overwatch gun",
      target: mover.name,
      damage: 0,
      successful: 0,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible triggering unit within 24 inches",
    targetEligibilityEventId: hazardousState.events.at(-1).id,
    weaponId: "overwatch-gun",
    declaredWeaponCount: 1,
    weaponSourceFormationId: shooter.id,
    sourceSavedUnitId: "overwatch-shooter",
    weaponGroupId: "overwatch-gun-group",
  });
  hazardousState = recordHazardousTests(
    hazardousState,
    [{ initialRoll: 1, reroll: 0, rerollReason: "" }],
    "overwatch-hazardous-tests",
    hazardousState.events.length,
  );
  hazardousState = resolveHazardousDamage(
    hazardousState,
    {
      selectedSegmentId: "overwatch-shooter-model",
      feelNoPainRolls: [],
      selectionReason: "Only eligible Hazardous bearer",
    },
    "overwatch-hazardous-damage",
    hazardousState.events.length,
  );
  const hazardousResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: hazardousState, formationId: shooter.id }),
    }),
    testEnv,
    context,
  );
  assert.equal(
    hazardousResponse.status,
    200,
    JSON.stringify(await hazardousResponse.clone().json()),
  );
  const hazardousBody = await hazardousResponse.json();
  assert.deepEqual(hazardousBody.data.health["overwatch-shooter-model"], {
    modelsRemaining: 0,
    woundsLost: 0,
  });
  assert.equal(hazardousBody.data.hazardousTests[0].failedTestIndices[0], 0);
  assert.equal(hazardousBody.data.hazardousDamageResolutions[0].summary.damage, 3);
  assert.equal(hazardousBody.data.pendingHazardous, null);

  const declined = passFireOverwatch(
    pendingState,
    "The responding player declined Fire Overwatch",
    "overwatch-declined",
    pendingState.events.length,
  );
  const declinedResponse = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: declined, formationId: mover.id }),
    }),
    testEnv,
    context,
  );
  assert.equal(declinedResponse.status, 200);
  const declinedBody = await declinedResponse.json();
  assert.equal(declinedBody.data.pendingFireOverwatch, null);
  assert.equal(declinedBody.data.fireOverwatches.length, 0);
  assert.equal(declinedBody.data.fireOverwatchPasses.length, 1);
  assert.equal(declinedBody.data.fireOverwatchPasses[0].trigger, "normal_move_start");
});

test("cross-checks Go to Ground and Smokescreen through the C and WebAssembly API", async () => {
  const attacker = {
    id: "gtg-attacker",
    playerId: "player-1",
    sourceFormationId: "gtg-attacker",
    name: "Go to Ground attacker",
    keywords: ["Vehicle"],
    weaponInventory: [
      {
        sourceSavedUnitId: "gtg-attacker",
        groupId: "gtg-gun-group",
        name: "Go to Ground gun",
        count: 1,
        profiles: [
          {
            weaponId: "gtg-gun",
            name: "Go to Ground gun",
            type: "Ranged",
            publishedRangeThousandths: 24000,
            hasAssault: false,
            hasIndirect: false,
            hasHazardous: false,
          },
        ],
      },
    ],
    segments: [
      {
        id: "gtg-attacker-model",
        savedUnitId: "gtg-attacker",
        unitName: "Go to Ground attacker",
        modelName: "Go to Ground attacker",
        role: "standalone",
        wounds: 10,
        startingModels: 1,
      },
    ],
  };
  const target = {
    id: "gtg-target",
    playerId: "player-2",
    sourceFormationId: "gtg-target",
    name: "Go to Ground target",
    keywords: ["Infantry", "Smoke"],
    segments: [
      {
        id: "gtg-target-model",
        savedUnitId: "gtg-target",
        unitName: "Go to Ground target",
        modelName: "Go to Ground target",
        role: "standalone",
        keywords: ["Infantry", "Smoke"],
        wounds: 2,
        startingModels: 5,
      },
    ],
  };
  let state = createBattleState({
    id: "api-go-to-ground-battle",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "gtg-list-1", listUpdatedAt: 1, name: "Attacker" },
      { id: "player-2", listId: "gtg-list-2", listUpdatedAt: 1, name: "Defender" },
    ],
  });
  state = registerBattleFormation(state, attacker, "gtg-register-attacker", 1);
  state = registerBattleFormation(state, target, "gtg-register-target", 2);
  state = configureBattleMission(
    state,
    {
      name: "API Go to Ground",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 2 },
      objectives: [],
    },
    "gtg-mission",
    3,
  );
  state = declareFormationDeployment(state, attacker.id, "battlefield", {}, "gtg-declare-a", 4);
  state = declareFormationDeployment(state, target.id, "battlefield", {}, "gtg-declare-t", 5);
  state = deployFormation(
    state,
    attacker.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "gtg-deploy-a",
    6,
  );
  state = deployFormation(
    state,
    target.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "gtg-deploy-t",
    7,
  );
  state = startBattle(state, "player-1", "gtg-start", 8);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(state, `gtg-move-${state.events.length}`, state.events.length);
  }
  state = recordFormationMovement(
    state,
    attacker.id,
    "stationary",
    "gtg-stationary",
    state.events.length,
  );
  while (
    !(
      replayBattleState(state).clock.phase === "shooting" &&
      replayBattleState(state).clock.step === "resolve_attacks"
    )
  ) {
    state = advanceBattleClock(state, `gtg-shoot-${state.events.length}`, state.events.length);
  }
  state = startFormationActivation(state, attacker.id, {}, "gtg-activation", state.events.length);
  state = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: attacker.id,
      targetFormationId: target.id,
      weaponId: "gtg-gun",
      weaponName: "Go to Ground gun",
      weaponSourceFormationId: attacker.id,
      sourceSavedUnitId: "gtg-attacker",
      weaponGroupId: "gtg-gun-group",
      publishedRangeThousandths: 24000,
      effectiveRangeThousandths: 24000,
      measuredDistanceThousandths: 12000,
      visible: true,
      fullyVisible: false,
      indirectFire: false,
      weaponHasIndirect: false,
      eligibleWeaponCount: 1,
      declaredWeaponCount: 1,
      attackSnapshot: {
        attackProfiles: [{ weaponCount: 1 }],
        targets: [{ wounds: 2, modelCount: 5 }],
        segmentIds: ["gtg-target-model"],
        initialWoundsLost: 0,
        weaponHasAssault: false,
        summary: {
          attacker: attacker.name,
          weapon: "Go to Ground gun",
          target: target.name,
        },
      },
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Range and visibility reviewed",
    },
    "gtg-target-selected",
    state.events.length,
  );
  state = closeRangedTargetDeclarations(
    state,
    "gtg-targets-declared",
    state.events.length,
    "go_to_ground_first",
  );
  assert.equal(replayBattleState(state).pendingGoToGround.targetFormationId, target.id);
  state = resolveGoToGround(state, target.id, "gtg-resolved", state.events.length);
  assert.equal(replayBattleState(state).pendingSmokescreen.targetFormationId, target.id);
  state = resolveSmokescreen(state, target.id, "smokescreen-resolved", state.events.length);

  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: target.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.equal(body.data.pendingGoToGround, null);
  assert.equal(body.data.readyRangedAttack.triggerEventId, "gtg-target-selected");
  assert.equal(body.data.rangedDeclarations.sets.length, 1);
  assert.equal(body.data.rangedDeclarations.sets[0].eventId, "gtg-targets-declared");
  assert.equal(body.data.rangedDeclarations.sets[0].reactionOrder, "go_to_ground_first");
  assert.deepEqual(body.data.rangedDeclarations.sets[0].declarationEventIds, [
    "gtg-target-selected",
  ]);
  assert.equal(body.data.rangedDeclarations.ready.length, 1);
  assert.deepEqual(body.data.rangedDeclarations.draft, []);
  assert.equal(body.data.goToGrounds.length, 1);
  assert.equal(body.data.goToGrounds[0].canonical, true);
  assert.equal(body.data.goToGrounds[0].commandPointsBefore, 2);
  assert.equal(body.data.goToGrounds[0].commandPointsAfter, 1);
  assert.equal(body.data.goToGrounds[0].effect.invulnerableSave, 6);
  assert.equal(body.data.goToGrounds[0].effect.benefitOfCover, true);
  assert.equal(body.data.activeGoToGroundEffects.length, 1);
  assert.deepEqual(body.data.goToGroundPasses, []);
  assert.equal(body.data.pendingSmokescreen, null);
  assert.equal(body.data.smokescreens.length, 1);
  assert.equal(body.data.smokescreens[0].canonical, true);
  assert.equal(body.data.smokescreens[0].commandPointsBefore, 1);
  assert.equal(body.data.smokescreens[0].commandPointsAfter, 0);
  assert.equal(body.data.smokescreens[0].effect.benefitOfCover, true);
  assert.equal(body.data.smokescreens[0].effect.stealth, true);
  assert.equal(body.data.activeSmokescreenEffects.length, 1);
  assert.deepEqual(body.data.smokescreenPasses, []);
});

test("cross-checks Rapid Ingress through the C and WebAssembly replay API", async () => {
  const active = {
    id: "rapid-api-active",
    playerId: "player-1",
    sourceFormationId: "rapid-api-active",
    name: "Active formation",
    keywords: ["Infantry"],
    segments: [
      {
        id: "rapid-api-active-model",
        savedUnitId: "rapid-api-active",
        unitName: "Active formation",
        modelName: "Active model",
        role: "standalone",
        wounds: 2,
        startingModels: 5,
      },
    ],
  };
  const reserve = {
    ...active,
    id: "rapid-api-reserve",
    playerId: "player-2",
    sourceFormationId: "rapid-api-reserve",
    name: "Reserve formation",
    segments: [
      {
        ...active.segments[0],
        id: "rapid-api-reserve-model",
        savedUnitId: "rapid-api-reserve",
        unitName: "Reserve formation",
      },
    ],
  };
  let state = createBattleState({
    id: "rapid-api-battle",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "rapid-list-1", listUpdatedAt: 1, name: "Active" },
      { id: "player-2", listId: "rapid-list-2", listUpdatedAt: 1, name: "Responder" },
    ],
  });
  state = registerBattleFormation(state, active, "rapid-api-register-active", 1);
  state = registerBattleFormation(state, reserve, "rapid-api-register-reserve", 2);
  state = configureBattleMission(
    state,
    {
      name: "Rapid Ingress API",
      commandPointsPerCommandPhase: 0,
      startingCommandPoints: { "player-1": 0, "player-2": 1 },
      objectives: [],
    },
    "rapid-api-mission",
    3,
  );
  state = declareFormationDeployment(
    state,
    active.id,
    "battlefield",
    {},
    "rapid-api-declare-active",
    4,
  );
  state = declareFormationDeployment(
    state,
    reserve.id,
    "strategic_reserves",
    {
      points: 100,
      earliestBattleRound: 2,
      eligibilityConfirmed: true,
      eligibilityReason: "Core Strategic Reserves",
    },
    "rapid-api-declare-reserve",
    5,
  );
  state = deployFormation(
    state,
    active.id,
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "rapid-api-deploy-active",
    6,
  );
  state = startBattle(state, "player-1", "rapid-api-start", 7);
  while (
    !(
      replayBattleState(state).clock.battleRound === 2 &&
      replayBattleState(state).clock.activePlayerId === "player-1" &&
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "end"
    )
  ) {
    state = advanceBattleClock(
      state,
      `rapid-api-clock-${state.events.length}`,
      state.events.length + 1,
    );
  }
  state = resolveRapidIngress(
    state,
    reserve.id,
    {
      placementMethod: "strategic_reserves",
      placementConfirmed: true,
      placementReason: "Large model touches its own battlefield edge outside 9 inches",
      moreThanNineFromEnemyModels: true,
      largeModelEdgeException: true,
      touchingOwnBattlefieldEdge: true,
    },
    "rapid-api-resolved",
    state.events.length + 1,
  );

  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: reserve.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.equal(body.data.pendingRapidIngress, null);
  assert.equal(body.data.rapidIngresses.length, 1);
  assert.equal(body.data.rapidIngresses[0].canonical, true);
  assert.equal(body.data.rapidIngresses[0].formationId, reserve.id);
  assert.equal(body.data.rapidIngresses[0].placementMethod, "strategic_reserves");
  assert.equal(body.data.rapidIngresses[0].commandPointsBefore, 1);
  assert.equal(body.data.rapidIngresses[0].commandPointsAfter, 0);
  assert.equal(body.data.rapidIngresses[0].passengersCannotDisembarkThisPhase, true);
  assert.equal(body.data.rapidIngresses[0].largeModelRestrictedThisTurn, true);
  assert.deepEqual(body.data.rapidIngressPasses, []);
  assert.equal(
    body.data.movement.find((entry) => entry.formationId === reserve.id).rapidIngress,
    true,
  );
  assert.equal(body.data.deployment.deployedFormationIds.includes(reserve.id), true);
});

test("cross-checks destroyed Transport passenger damage through WebAssembly", async () => {
  const transport = {
    id: "transport",
    playerId: "player-1",
    sourceFormationId: "transport",
    name: "Transport",
    keywords: ["Transport"],
    segments: [
      {
        id: "transport-model",
        savedUnitId: "transport",
        unitName: "Transport",
        modelName: "Transport",
        role: "standalone",
        wounds: 2,
        startingModels: 1,
      },
    ],
  };
  const passenger = {
    id: "passenger",
    playerId: "player-1",
    sourceFormationId: "passenger",
    name: "Passenger",
    assignedTransportFormationId: "transport",
    keywords: ["Infantry"],
    transportOptions: [
      {
        transportFormationId: "transport",
        assignments: [
          {
            sourceSavedUnitId: "passenger",
            modelCost: 1,
            poolPosition: 0,
            poolKind: "primary",
            poolCapacity: 12,
            poolLabel: "Transport capacity",
            sharedAllowancePosition: null,
            sharedAllowanceMaximumModels: null,
            sharedAllowancePrimaryCapacityWhileUsed: null,
            sharedAllowanceNestedPassengerPolicy: null,
          },
        ],
      },
    ],
    segments: [
      {
        id: "passenger-model",
        savedUnitId: "passenger",
        unitName: "Passenger",
        modelName: "Passenger",
        role: "standalone",
        wounds: 2,
        startingModels: 1,
      },
    ],
  };
  const enemy = {
    ...structuredClone(transport),
    id: "enemy",
    playerId: "player-2",
    sourceFormationId: "enemy",
    name: "Enemy",
    keywords: ["Vehicle"],
    segments: [{ ...transport.segments[0], id: "enemy-model", savedUnitId: "enemy" }],
    weaponInventory: [
      {
        sourceSavedUnitId: "enemy",
        groupId: "anti-transport-group",
        name: "Anti-transport weapon",
        count: 1,
        profiles: [
          {
            weaponId: "anti-transport-weapon",
            name: "Anti-transport weapon",
            type: "Ranged",
            publishedRangeThousandths: 24000,
            hasAssault: false,
            hasIndirect: false,
          },
        ],
      },
    ],
  };
  let state = createBattleState({
    id: "transport-api",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", listUpdatedAt: 1, name: "Passengers" },
      { id: "player-2", listId: "list-2", listUpdatedAt: 2, name: "Attackers" },
    ],
  });
  state = registerBattleFormation(state, transport, "register-transport", 1);
  state = registerBattleFormation(state, passenger, "register-passenger", 2);
  state = registerBattleFormation(state, enemy, "register-enemy", 3);
  state = declareFormationDeployment(state, "transport", "battlefield", {}, "declare-transport", 4);
  state = declareFormationDeployment(
    state,
    "passenger",
    "embarked",
    { transportFormationId: "transport" },
    "declare-passenger",
    5,
  );
  state = declareFormationDeployment(state, "enemy", "battlefield", {}, "declare-enemy", 6);
  state = deployFormation(
    state,
    "transport",
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-transport",
    7,
  );
  state = deployFormation(
    state,
    "enemy",
    { placementConfirmed: true, placementReason: "Deployment zone" },
    "deploy-enemy",
    8,
  );
  state = startBattle(state, "player-2", "start", 9);
  const occupancyWorker = await loadWorker();
  const occupancyResponse = await occupancyWorker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: "passenger" }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(
    occupancyResponse.status,
    200,
    JSON.stringify(await occupancyResponse.clone().json()),
  );
  const occupancyBody = await occupancyResponse.json();
  assert.deepEqual(occupancyBody.data.transports.occupancy[0].occupantFormationIds, ["passenger"]);
  assert.equal(occupancyBody.data.transports.occupancy[0].poolLoads[0].used, 1);
  assert.equal(occupancyBody.data.transports.occupancy[0].poolLoads[0].capacity, 12);
  while (
    !(
      replayBattleState(state).clock.phase === "movement" &&
      replayBattleState(state).clock.step === "move_units"
    )
  ) {
    state = advanceBattleClock(
      state,
      `advance-movement-${state.events.length}`,
      state.events.length + 1,
    );
  }
  state = recordFormationMovement(state, "enemy", "stationary", "enemy-movement", 20);
  while (
    !(
      replayBattleState(state).clock.phase === "shooting" &&
      replayBattleState(state).clock.step === "resolve_attacks"
    )
  ) {
    state = advanceBattleClock(
      state,
      `advance-shooting-${state.events.length}`,
      state.events.length + 1,
    );
  }
  state = startFormationActivation(state, "enemy", {}, "activate-enemy", 30);
  state = recordRangedTargetEligibility(
    state,
    {
      attackerFormationId: "enemy",
      targetFormationId: "transport",
      weaponId: "anti-transport-weapon",
      weaponName: "Anti-transport weapon",
      weaponSourceFormationId: "enemy",
      sourceSavedUnitId: "enemy",
      weaponGroupId: "anti-transport-group",
      publishedRangeThousandths: 24000,
      effectiveRangeThousandths: 24000,
      measuredDistanceThousandths: 12000,
      visible: true,
      fullyVisible: true,
      eligibleWeaponCount: 1,
      declaredWeaponCount: 1,
      attackSnapshot: {
        attackProfiles: [{ weaponCount: 1 }],
        targets: [{ wounds: 2, modelCount: 1 }],
        segmentIds: ["transport-model"],
        initialWoundsLost: 0,
        weaponHasAssault: false,
        summary: {
          attacker: "Enemy",
          weapon: "Anti-transport weapon",
          target: "Transport",
        },
      },
      method: "manual",
      reviewedByPlayer: true,
      reviewReason: "Range and line of sight checked",
    },
    "target-eligibility",
    31,
  );
  state = closeRangedTargetDeclarations(state, "transport-targets-declared", 32);
  state = appendResolvedAttack(state, {
    id: "destroy-transport",
    at: 33,
    attackerFormationId: "enemy",
    targetFormationId: "transport",
    segmentIds: ["transport-model"],
    targets: [{ wounds: 2, modelCount: 1 }],
    initialWoundsLost: 0,
    result: { appliedDamage: 2, modelsDestroyed: 1 },
    summary: {
      attacker: "Enemy",
      weapon: "Weapon",
      target: "Transport",
      damage: 2,
      successful: 1,
    },
    weaponType: "Ranged",
    targetEligibilityConfirmed: true,
    targetEligibilityReason: "Visible and in range",
    targetEligibilityEventId: "target-eligibility",
    weaponId: "anti-transport-weapon",
    declaredWeaponCount: 1,
    weaponSourceFormationId: "enemy",
    sourceSavedUnitId: "enemy",
    weaponGroupId: "anti-transport-group",
  });
  state = resolveDestroyedTransport(
    state,
    "transport",
    [
      {
        formationId: "passenger",
        firstSegmentId: "passenger-model",
        emergency: false,
        unplacedModels: 0,
        placementConfirmed: true,
        placementReason: "Wholly within 3 inches",
      },
    ],
    "resolve-passenger",
    34,
    () => 0,
    {
      deadlyDemiseResolvedConfirmed: true,
      deadlyDemiseResolutionReason: "Transport has no Deadly Demise ability",
    },
  );
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: "passenger" }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.equal(body.data.transports.compatibility.length, 1);
  assert.equal(body.data.transports.compatibility[0].formationId, "passenger");
  assert.equal(body.data.transports.compatibility[0].transportFormationId, "transport");
  assert.equal(body.data.transports.compatibility[0].assigned, true);
  assert.equal(body.data.transports.occupancy.length, 1);
  assert.deepEqual(body.data.weaponDeclarations, [
    {
      attackEventId: "destroy-transport",
      weaponSourceFormationId: "enemy",
      sourceSavedUnitId: "enemy",
      weaponGroupId: "anti-transport-group",
      weaponId: "anti-transport-weapon",
      inventoryCount: 1,
      bearerTracking: "exact",
      survivingBearerCount: 1,
      usedBefore: 0,
      declaredWeaponCount: 1,
      eligible: true,
    },
  ]);
  assert.equal(body.data.targetEligibilityFacts.length, 1);
  assert.equal(body.data.targetEligibilityFacts[0].id, "target-eligibility");
  assert.equal(body.data.targetEligibilityFacts[0].measuredDistanceThousandths, 12000);
  assert.equal(body.data.targetEligibilityFacts[0].eligible, true);
  assert.deepEqual(body.data.health, {
    "passenger-model": { modelsRemaining: 1, woundsLost: 1 },
  });
  assert.deepEqual(body.data.transports.embarked, []);
  assert.equal(
    body.data.transports.destroyedTransportResolutions[0].causeEventId,
    "destroy-transport",
  );
  assert.equal(
    body.data.transports.destroyedTransportResolutions[0].deadlyDemiseResolvedConfirmed,
    true,
  );
  assert.equal(
    body.data.transports.destroyedTransportResolutions[0].passengers[0].firstSegmentId,
    "passenger-model",
  );
  assert.deepEqual(body.data.transports.destroyedTransportResolutions[0].passengers[0].rolls, [1]);
});

test("API replay exposes and cross-checks nested Transport deployment ancestry", async () => {
  const segment = (id, savedUnitId, name) => ({
    id,
    savedUnitId,
    unitName: name,
    modelName: name,
    role: "standalone",
    wounds: 3,
    startingModels: 1,
  });
  const transportOption = (transportFormationId, sourceSavedUnitId, capacity) => ({
    transportFormationId,
    assignments: [
      {
        sourceSavedUnitId,
        modelCost: 1,
        poolPosition: 0,
        poolKind: "primary",
        poolCapacity: capacity,
        poolLabel: "Transport capacity",
        sharedAllowancePosition: null,
        sharedAllowanceMaximumModels: null,
        sharedAllowancePrimaryCapacityWhileUsed: null,
        sharedAllowanceNestedPassengerPolicy: null,
      },
    ],
  });
  const outer = {
    id: "nested-outer",
    playerId: "player-1",
    sourceFormationId: "nested-outer",
    name: "Nested Outer",
    keywords: ["Transport"],
    segments: [segment("nested-outer-model", "nested-outer", "Nested Outer")],
  };
  const inner = {
    id: "nested-inner",
    playerId: "player-1",
    sourceFormationId: "nested-inner",
    name: "Nested Inner",
    keywords: ["Transport"],
    assignedTransportFormationId: outer.id,
    transportOptions: [transportOption(outer.id, "nested-inner", 1)],
    segments: [segment("nested-inner-model", "nested-inner", "Nested Inner")],
  };
  const passengers = {
    id: "nested-passengers",
    playerId: "player-1",
    sourceFormationId: "nested-passengers",
    name: "Nested Passengers",
    keywords: ["Infantry"],
    assignedTransportFormationId: inner.id,
    transportOptions: [transportOption(inner.id, "nested-passengers", 12)],
    segments: [segment("nested-passenger-model", "nested-passengers", "Nested Passenger")],
  };
  const enemy = {
    id: "nested-enemy",
    playerId: "player-2",
    sourceFormationId: "nested-enemy",
    name: "Nested Enemy",
    keywords: ["Infantry"],
    segments: [segment("nested-enemy-model", "nested-enemy", "Nested Enemy")],
  };
  let state = createBattleState({
    id: "nested-transport-api",
    createdAt: 1,
    rulesSnapshot: "catalogue:test",
    players: [
      { id: "player-1", listId: "list-1", listUpdatedAt: 1, name: "Nested Transports" },
      { id: "player-2", listId: "list-2", listUpdatedAt: 2, name: "Enemy" },
    ],
  });
  for (const formation of [outer, inner, passengers, enemy]) {
    state = registerBattleFormation(
      state,
      formation,
      `register-${formation.id}`,
      state.events.length + 1,
    );
  }
  state = declareFormationDeployment(
    state,
    passengers.id,
    "embarked",
    { transportFormationId: inner.id },
    "declare-api-nested-passengers",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    inner.id,
    "embarked",
    { transportFormationId: outer.id },
    "declare-api-nested-inner",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    outer.id,
    "battlefield",
    {},
    "declare-api-nested-outer",
    state.events.length + 1,
  );
  state = declareFormationDeployment(
    state,
    enemy.id,
    "battlefield",
    {},
    "declare-api-nested-enemy",
    state.events.length + 1,
  );
  state = deployFormation(
    state,
    outer.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-api-nested-outer",
    state.events.length + 1,
  );
  state = deployFormation(
    state,
    enemy.id,
    { placementConfirmed: true, placementReason: "Legal deployment-zone position" },
    "deploy-api-nested-enemy",
    state.events.length + 1,
  );
  state = startBattle(state, "player-1", "start-api-nested", state.events.length + 1);

  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/battle/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battleState: state, formationId: passengers.id }),
    }),
    testEnv,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.data.schemaVersion, BATTLE_STATE_VERSION);
  assert.deepEqual(body.data.transports.embarked, [
    { formationId: inner.id, transportFormationId: outer.id },
    { formationId: passengers.id, transportFormationId: inner.id },
  ]);
  const passengerChain = body.data.deployment.transportChains.find(
    (chain) => chain.formationId === passengers.id,
  );
  assert.deepEqual(passengerChain.formationIds, [passengers.id, inner.id, outer.id]);
  assert.equal(passengerChain.rootFormationId, outer.id);
  assert.equal(passengerChain.rootLocation, "battlefield");
  assert.equal(passengerChain.complete, true);
  assert.equal(passengerChain.valid, true);
  assert.deepEqual(body.data.deployment.destroyedInFirstRoundFormationIds, []);
  assert.equal(body.data.deployment.initialRules.length, 4);
  assert.equal(
    body.data.deployment.initialRules.every((report) => report.valid),
    true,
  );
  assert.equal(
    body.data.deployment.initialRules.every((report) => !Object.hasOwn(report, "values")),
    true,
  );
  assert.deepEqual(body.data.deployment.deployedFormationIds, [
    enemy.id,
    inner.id,
    outer.id,
    passengers.id,
  ]);
});

test("API exact and seeded simulation paths match the shared rules interaction corpus", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const profileFor = (testCase) => ({
    attackDice: 0,
    attackSides: 0,
    attacks: testCase.attacks,
    weaponCount: 1,
    hitOn: testCase.hitOn,
    strength: testCase.strength,
    ap: testCase.ap,
    damageDice: 0,
    damageSides: 0,
    damage: testCase.damage,
    criticalHits: testCase.criticalHits,
    toughness: testCase.toughness,
    save: testCase.save,
    invulnerable: testCase.invulnerable,
    feelNoPain: testCase.feelNoPain,
    wounds: testCase.wounds,
    targetModels: testCase.targetModels,
    criticalWounds: testCase.criticalWounds,
    sustainedHits: testCase.sustainedHits,
    hitModifier: testCase.hitModifier,
    woundModifier: testCase.woundModifier,
    lethalHits: (testCase.flags & 1) !== 0,
    devastatingWounds: (testCase.flags & 2) !== 0,
    twinLinked: (testCase.flags & 4) !== 0,
    rerollHits: (testCase.flags & 8) !== 0,
    torrent: (testCase.flags & 16) !== 0,
    heavyActive: (testCase.flags & 32) !== 0,
    lanceActive: (testCase.flags & 64) !== 0,
    ignoresCover: (testCase.flags & 2048) !== 0,
    indirect: (testCase.flags & 4096) !== 0,
    rerollHitOnes: (testCase.flags & 8192) !== 0,
    rerollWounds: (testCase.flags & 16384) !== 0,
    rerollWoundOnes: (testCase.flags & 32768) !== 0,
  });
  const targetFor = (testCase) => ({
    toughness: testCase.toughness,
    save: testCase.save,
    invulnerable: testCase.invulnerable,
    feelNoPain: testCase.feelNoPain,
    wounds: testCase.wounds,
    reduction: 0,
    modelCount: testCase.targetModels,
  });
  const fractionValue = (fraction) => Number(fraction.numerator) / Number(fraction.denominator);

  for (const [index, testCase] of rulesInteractionCases.entries()) {
    const profile = profileFor(testCase);
    const exactResponse = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      }),
      testEnv,
      context,
    );
    const exactText = await exactResponse.text();
    assert.equal(exactResponse.status, 200, `${testCase.name}: ${exactText}`);
    const exact = JSON.parse(exactText).data;
    assert.ok(Math.abs(exact.mean - fractionValue(testCase.expected)) < 1e-12, testCase.name);
    assert.ok(Math.abs(exact.applied.mean - fractionValue(testCase.applied)) < 1e-8, testCase.name);

    const simulationResponse = await worker.fetch(
      new Request("http://localhost/api/v1/volley/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profiles: [profile],
          targets: [targetFor(testCase)],
          seed: (0x51_7c_c1e5 + index * 0x9e_37_79b9) >>> 0,
          trials: 20_000,
        }),
      }),
      testEnv,
      context,
    );
    const simulationText = await simulationResponse.text();
    assert.equal(simulationResponse.status, 200, `${testCase.name}: ${simulationText}`);
    const simulation = JSON.parse(simulationText).data;
    assert.ok(
      Math.abs(simulation.mean - fractionValue(testCase.applied)) < 0.045,
      `${testCase.name}: simulated ${simulation.mean}`,
    );
  }
});

test("reports dependency health, retryable outages, and request diagnostics", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const unavailableEnv = {
    ARMY_DB: {
      prepare() {
        throw new Error("database unavailable");
      },
    },
    ASSETS: {
      async fetch() {
        return new Response("Unavailable", { status: 503 });
      },
    },
  };

  const degraded = await worker.fetch(
    new Request("http://localhost/api/v1/health"),
    unavailableEnv,
    context,
  );
  assert.equal(degraded.status, 503);
  assert.match(degraded.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const degradedBody = await degraded.json();
  assert.equal(degradedBody.status, "degraded");
  assert.deepEqual(
    degradedBody.checks.map((entry) => entry.code),
    [
      "PROFILE_CATALOGUE_UNAVAILABLE",
      undefined,
      "RULE_COVERAGE_UNAVAILABLE",
      "LIST_STORAGE_UNAVAILABLE",
    ],
  );
  assert.equal(degradedBody.checks[1].status, "ok");

  const recovered = await worker.fetch(
    new Request("http://localhost/api/v1/health"),
    testEnv,
    context,
  );
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json();
  assert.equal(recoveredBody.status, "ok");
  assert.deepEqual(
    recoveredBody.checks.map((entry) => entry.name),
    ["profile-catalogue", "calculator-engine", "rule-coverage", "list-storage"],
  );
  const { name, status, latencyMs, ...profileHealth } = recoveredBody.checks[0];
  assert.equal(name, "profile-catalogue");
  assert.equal(status, "ok");
  assert.ok(Number.isInteger(latencyMs));
  assert.deepEqual(profileHealth, {
    sourceUpdatedAt: "2026-06-13 12:02:41",
    factions: 26,
    detachments: 262,
    enhancements: 927,
    units: 1712,
  });

  const storageFailure = await worker.fetch(
    new Request("http://localhost/api/v1/lists"),
    unavailableEnv,
    context,
  );
  assert.equal(storageFailure.status, 503);
  assert.deepEqual((await storageFailure.json()).error, {
    message: "Cloud list storage is temporarily unavailable",
    status: 503,
    code: "LIST_STORAGE_UNAVAILABLE",
    retryable: true,
  });
});

test("generated API profiles preserve combat invariants and reject malformed fields", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  let state = 0x9e37_79b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const below = (maximum) => next() % maximum;
  const calculate = async (profile) => {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      }),
      testEnv,
      context,
    );
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text).data;
  };

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const rerollHits = below(2) === 1;
    const rerollWounds = below(2) === 1;
    const profile = {
      attackDice: 0,
      attackSides: 0,
      attacks: 1 + below(6),
      weaponCount: 1 + below(3),
      hitOn: 2 + below(5),
      strength: 1 + below(16),
      ap: below(4),
      damageDice: 0,
      damageSides: 0,
      damage: 1 + below(5),
      criticalHits: 5 + below(2),
      toughness: 1 + below(16),
      save: 2 + below(6),
      invulnerable: below(3) === 0 ? 0 : 4 + below(3),
      feelNoPain: 0,
      wounds: 1 + below(8),
      targetModels: 1 + below(4),
      reduction: below(3),
      hitModifier: below(5) - 2,
      woundModifier: below(5) - 2,
      lethalHits: below(2) === 1,
      devastatingWounds: below(2) === 1,
      twinLinked: below(2) === 1,
      rerollHits,
      rerollHitOnes: !rerollHits && below(2) === 1,
      rerollWounds,
      rerollWoundOnes: !rerollWounds && below(2) === 1,
    };
    const baseline = await calculate(profile);
    assert.ok(baseline.minimum <= baseline.firstQuartile);
    assert.ok(baseline.firstQuartile <= baseline.median);
    assert.ok(baseline.median <= baseline.thirdQuartile);
    assert.ok(baseline.thirdQuartile <= baseline.maximum);
    assert.ok(baseline.mean >= baseline.minimum && baseline.mean <= baseline.maximum);
    assert.ok(baseline.applied.minimum <= baseline.applied.firstQuartile);
    assert.ok(baseline.applied.firstQuartile <= baseline.applied.median);
    assert.ok(baseline.applied.median <= baseline.applied.thirdQuartile);
    assert.ok(baseline.applied.thirdQuartile <= baseline.applied.maximum);
    assert.ok(baseline.applied.mean <= baseline.mean + 1e-6 * Math.max(1, baseline.mean));

    const betterAp = await calculate({ ...profile, ap: profile.ap + 1 });
    assert.ok(betterAp.mean + 1e-12 >= baseline.mean);
    const withFnp = await calculate({ ...profile, feelNoPain: 5 });
    assert.ok(withFnp.mean <= baseline.mean + 1e-12);
  }

  const target = {
    toughness: 8,
    save: 3,
    invulnerable: 0,
    feelNoPain: 0,
    wounds: 4,
    reduction: 0,
    modelCount: 1,
  };
  const numericKeys = [
    "attacks",
    "weaponCount",
    "hitOn",
    "strength",
    "ap",
    "damage",
    "criticalHits",
    "toughness",
    "save",
    "wounds",
    "targetModels",
    "attackerUnitModels",
    "nearbyEnemyModels",
    "nearbyEnemyUnits",
    "enemyCharacterModelsDestroyed",
    "destructiveFightPhases",
    "embarkedModels",
    "embarkedWracksModels",
    "attackerSourceTargetDistance",
    "targetSourceAttackerDistance",
  ];
  const booleanKeys = [
    "attackerRemainedStationary",
    "attackerAttached",
    "targetAttached",
    "attackerWaaaghActive",
    "targetWaaaghActive",
    "targetOathOfMoment",
    "attackerOathWoundBonusEligible",
    "attackerOnObjective",
    "targetOnObjective",
    "attackerOnAttackerSelectedObjective",
    "targetOnAttackerSelectedObjective",
    "attackerOnTargetSelectedObjective",
    "targetOnTargetSelectedObjective",
    "attackerGuidedAgainstTarget",
    "targetSpotted",
    "targetSpottedByMarkerlightObserver",
    "targetClosestEligible",
    "attackerSourceCanSeeTarget",
    "targetSourceCanSeeAttacker",
    "torrent",
    "blast",
    "heavyActive",
    "targetCover",
    "lethalHits",
    "twinLinked",
  ];
  const invalidNumbers = [-1, 1.5, "3", null, {}, [], 1e20];
  const invalidBooleans = [0, 1, "true", null, {}, []];
  const endpoints = ["/api/v1/calculate", "/api/v1/volley", "/api/v1/volley/simulate"];

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const useBoolean = below(2) === 1;
    const keys = useBoolean ? booleanKeys : numericKeys;
    const values = useBoolean ? invalidBooleans : invalidNumbers;
    const profile = { [keys[below(keys.length)]]: values[below(values.length)] };
    const endpoint = endpoints[below(endpoints.length)];
    const body =
      endpoint === "/api/v1/calculate"
        ? { profile }
        : {
            profiles: [profile],
            targets: [target],
            initialWoundsLost: 0,
            ...(endpoint.endsWith("simulate") ? { seed: 1, trials: 100 } : {}),
          };
    const response = await worker.fetch(
      new Request(`http://localhost${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      testEnv,
      context,
    );
    const result = await response.json();
    assert.equal(response.status, 400, JSON.stringify({ endpoint, body, result }));
    assert.equal(result.error.status, 400);
    assert.equal(result.apiVersion, "v1");
  }
  for (const field of ["attackerObjectiveOwner", "targetObjectiveOwner"]) {
    const response = await worker.fetch(
      new Request("http://localhost/api/v1/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { [field]: "both" } }),
      }),
      testEnv,
      context,
    );
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.match(result.error.message, /unknown, attacker, target, or uncontrolled/i);
  }
  const impossiblePassengers = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { embarkedModels: 5, embarkedWracksModels: 6 } }),
    }),
    testEnv,
    context,
  );
  assert.equal(impossiblePassengers.status, 400);
  assert.match(
    (await impossiblePassengers.json()).error.message,
    /embarkedWracksModels cannot exceed embarkedModels/,
  );
});

test("creates, updates, lists, and deletes durable army lists", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const roster = {
    name: "Test phalanx",
    factionId: "NEC",
    units: [
      {
        id: "unit-1",
        unitId: "datasheet-1",
        name: "Test unit",
        modelCount: 10,
        weapons: [{ weaponId: 7, groupId: "datasheet-1:7", name: "Test weapon", count: 10 }],
        choiceSelections: { "datasheet-1:pool:1": 1 },
        loadoutSubjectCounts: { "datasheet-1:subject:1": 4 },
        combatPresetIds: ["datasheet-1:ability:2"],
        defensiveEquipmentCounts: {
          "unit-1::3::datasheet-1:equipment:1": 1,
        },
        defensiveEquipmentOverrides: {
          "datasheet-1:equipment:1": "narrative",
        },
      },
    ],
  };
  const createdResponse = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(roster),
    }),
    testEnv,
    context,
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data;
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.units[0].choiceSelections["datasheet-1:pool:1"], 1);
  assert.equal(created.units[0].loadoutSubjectCounts["datasheet-1:subject:1"], 4);
  assert.deepEqual(created.units[0].combatPresetIds, ["datasheet-1:ability:2"]);
  assert.deepEqual(created.units[0].defensiveEquipmentCounts, {
    "unit-1::3::datasheet-1:equipment:1": 1,
  });
  assert.deepEqual(created.units[0].defensiveEquipmentOverrides, {
    "datasheet-1:equipment:1": "narrative",
  });

  const sourceCatalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const veterans = sourceCatalogue.units.find((unit) => unit.name === "Deathwatch Veterans");
  const shield = veterans.defensiveEquipment.find((option) => option.name === "Astartes Shield");
  const shieldKey = `api-veterans::${veterans.models[0].id}::${shield.id}`;
  const invalidEquipmentRoster = {
    name: "Invalid shields",
    factionId: veterans.factionId,
    units: [
      {
        id: "api-veterans",
        unitId: veterans.id,
        name: veterans.name,
        modelCount: 5,
        weapons: [],
        defensiveEquipmentCounts: { [shieldKey]: 3 },
      },
    ],
  };
  const rejectedEquipment = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invalidEquipmentRoster),
    }),
    testEnv,
    context,
  );
  assert.equal(rejectedEquipment.status, 400);
  assert.match((await rejectedEquipment.json()).error.message, /casualty or narrative/i);
  const acknowledgedEquipment = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...invalidEquipmentRoster,
        units: [
          {
            ...invalidEquipmentRoster.units[0],
            defensiveEquipmentOverrides: { [shield.id]: "narrative" },
          },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(acknowledgedEquipment.status, 201);
  const acknowledgedRecord = (await acknowledgedEquipment.json()).data;
  assert.equal(
    (
      await worker.fetch(
        new Request(`http://localhost/api/v1/lists/${acknowledgedRecord.id}`, {
          method: "DELETE",
        }),
        testEnv,
        context,
      )
    ).status,
    200,
  );

  const command = sourceCatalogue.units.find((unit) => unit.name === "Command Squad");
  const commandShield = command.defensiveEquipment.find(
    (option) => option.name === "Astartes Shield",
  );
  const champion = command.models.find((model) => model.name === "Company Champion");
  const companyVeterans = command.models.find((model) => model.name === "Company Veterans");
  const rejectedGroupedEquipment = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid Command Squad shields",
        factionId: command.factionId,
        units: [
          {
            id: "api-command",
            unitId: command.id,
            name: command.name,
            modelCount: 5,
            weapons: [],
            choiceSelections: {
              [commandShield.choiceLinks.find((link) => link.quantityDelta === 1).alternativeId]: 3,
            },
            defensiveEquipmentCounts: {
              [`api-command::${champion.id}::${commandShield.id}`]: 1,
              [`api-command::${companyVeterans.id}::${commandShield.id}`]: 3,
            },
          },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(rejectedGroupedEquipment.status, 400);
  assert.match((await rejectedGroupedEquipment.json()).error.message, /maximum of 3/i);

  const listed = await worker.fetch(new Request("http://localhost/api/v1/lists"), testEnv, context);
  assert.equal((await listed.json()).data.length, 1);

  const exported = await worker.fetch(
    new Request("http://localhost/api/v1/lists/export"),
    testEnv,
    context,
  );
  const backup = await exported.json();
  assert.equal(backup.kind, "warhammer-calculator-army-lists");
  assert.equal(backup.version, 1);
  assert.equal(typeof backup.profileSourceUpdatedAt, "string");
  assert.equal(backup.lists[0].id, created.id);
  assert.deepEqual(
    backup.lists[0].units[0].defensiveEquipmentCounts,
    created.units[0].defensiveEquipmentCounts,
  );
  assert.deepEqual(
    backup.lists[0].units[0].defensiveEquipmentOverrides,
    created.units[0].defensiveEquipmentOverrides,
  );

  const updated = await worker.fetch(
    new Request(`http://localhost/api/v1/lists/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...roster, name: "Updated phalanx" }),
    }),
    testEnv,
    context,
  );
  assert.equal((await updated.json()).data.name, "Updated phalanx");

  const deleted = await worker.fetch(
    new Request(`http://localhost/api/v1/lists/${created.id}`, { method: "DELETE" }),
    testEnv,
    context,
  );
  assert.equal(deleted.status, 200);

  const imported = await worker.fetch(
    new Request("http://localhost/api/v1/lists/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(backup),
    }),
    testEnv,
    context,
  );
  const importedBody = await imported.json();
  assert.equal(imported.status, 200);
  assert.equal(importedBody.imported, 1);
  assert.equal(importedBody.data[0].id, created.id);
  assert.deepEqual(
    importedBody.data[0].units[0].defensiveEquipmentCounts,
    created.units[0].defensiveEquipmentCounts,
  );
  assert.deepEqual(
    importedBody.data[0].units[0].defensiveEquipmentOverrides,
    created.units[0].defensiveEquipmentOverrides,
  );

  const incompatible = await worker.fetch(
    new Request("http://localhost/api/v1/lists/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...backup, version: 2 }),
    }),
    testEnv,
    context,
  );
  assert.equal(incompatible.status, 400);
  assert.match((await incompatible.json()).error.message, /unsupported/i);

  const invalid = await worker.fetch(
    new Request("http://localhost/api/v1/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...roster,
        units: [
          {
            ...roster.units[0],
            weapons: [{ weaponId: 7, name: "Test weapon", count: 101 }],
          },
        ],
      }),
    }),
    testEnv,
    context,
  );
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error.message, /0 to 100 equipped copies/i);
});

test("rejects Torrent attacks fired indirectly without visibility", async () => {
  const worker = await loadWorker();
  const context = { waitUntil() {}, passThroughOnException() {} };
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/calculate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { torrent: true, indirect: true } }),
    }),
    testEnv,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /exceeds|indirect|torrent/i);
});

test("ships the WebAssembly calculator assets", async () => {
  await Promise.all([
    access(new URL("public/wasm/calculator.js", projectRoot)),
    access(new URL("public/wasm/calculator.wasm", projectRoot)),
  ]);

  const workerBundle = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(workerBundle, /import calculatorWasm from ["'].+\.wasm["']/);
  assert.doesNotMatch(workerBundle, /ASSETS\.fetch\(.+calculator\.wasm/s);
});

test("applies Anti only to matching target keywords", () => {
  const abilities = [
    { name: "anti-infantry", value: "3+" },
    { name: "anti-vehicle", value: "4+" },
  ];

  assert.equal(antiWoundThreshold(abilities, ["Infantry", "Character"]), 3);
  assert.equal(antiWoundThreshold(abilities, ["VEHICLE"]), 4);
  assert.equal(antiWoundThreshold(abilities, ["Monster"]), 0);
});

test("catalogue includes target keywords for Anti rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const models = catalogue.units.flatMap((unit) => unit.models);

  assert.ok(models.length > 0);
  assert.ok(models.every((model) => Array.isArray(model.keywords)));
  assert.ok(models.some((model) => model.keywords.includes("vehicle")));
  assert.ok(models.some((model) => model.keywords.includes("infantry")));
});
