import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const testEnv = {
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

async function render() {
  const worker = await loadWorker();

  return worker.fetch(
    new Request("http://localhost/", {
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

test("ships the WebAssembly calculator assets", async () => {
  await Promise.all([
    access(new URL("public/wasm/calculator.js", projectRoot)),
    access(new URL("public/wasm/calculator.wasm", projectRoot)),
  ]);
});
