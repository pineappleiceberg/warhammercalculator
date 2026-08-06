import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(rolled.data.details.length, 4);
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
        weapons: [{ weaponId: 7, name: "Test weapon", count: 10 }],
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
});

test("ships the WebAssembly calculator assets", async () => {
  await Promise.all([
    access(new URL("public/wasm/calculator.js", projectRoot)),
    access(new URL("public/wasm/calculator.wasm", projectRoot)),
  ]);
});
