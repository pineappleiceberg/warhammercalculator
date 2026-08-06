import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { antiWoundThreshold } from "../lib/anti.mjs";

const projectRoot = new URL("../", import.meta.url);

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
  assert.match(html, /LIVE RESOLUTION/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders every battle workflow", async () => {
  for (const [pathname, heading] of [
    ["/model-vs-model", "Damage Calculator"],
    ["/unit-vs-unit", "Unit vs Unit"],
    ["/lists", "Army Lists"],
    ["/play", "Play Mode"],
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
      assert.match(html, /recover automatically/i);
      assert.match(html, /<legend>Attacker<\/legend>/);
      assert.match(html, /<legend>Target<\/legend>/);
      assert.match(html, /role="status"/);
      assert.match(html, /aria-live="polite"/);
      assert.match(html, /Quick overrides/);
      assert.match(html, /play-action-hint/);
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
  assert.match(documented.endpoints.volleySimulate, /POST \/api\/v1\/volley\/simulate/);
  assert.match(documented.endpoints.lists, /lists\/export/);

  const factions = await worker.fetch(
    new Request("http://localhost/api/v1/factions"),
    testEnv,
    context,
  );
  assert.equal(factions.status, 200);
  assert.ok((await factions.json()).data.length > 20);

  const profiles = await worker.fetch(
    new Request("http://localhost/api/v1/profiles"),
    testEnv,
    context,
  );
  const catalogue = await profiles.json();
  const warriors = catalogue.units.find((unit) => unit.name === "Necron Warriors");
  assert.ok(warriors);
  const loadout = await worker.fetch(
    new Request(`http://localhost/api/v1/loadout?unit=${warriors.id}`),
    testEnv,
    context,
  );
  assert.equal(loadout.status, 200);
  const loadoutData = (await loadout.json()).data;
  assert.equal(loadoutData.suggestedModelCount, 10);
  assert.equal(loadoutData.maximumModelCount, 20);
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
    ["PROFILE_CATALOGUE_UNAVAILABLE", "CALCULATOR_ENGINE_UNAVAILABLE", "LIST_STORAGE_UNAVAILABLE"],
  );

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
    ["profile-catalogue", "calculator-engine", "list-storage"],
  );

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
  ];
  const booleanKeys = [
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
