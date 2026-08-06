import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { antiWoundThreshold } from "../lib/anti.mjs";

const projectRoot = new URL("../", import.meta.url);

function createD1Mock() {
  const rows = [];
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async run() {
          if (sql.startsWith("INSERT")) {
            rows.push({
              id: values[0],
              name: values[1],
              faction_id: values[2],
              roster: values[3],
              created_at: values[4],
              updated_at: values[5],
            });
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
    assert.match(await response.text(), new RegExp(heading, "i"));
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

  const listed = await worker.fetch(new Request("http://localhost/api/v1/lists"), testEnv, context);
  assert.equal((await listed.json()).data.length, 1);

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
