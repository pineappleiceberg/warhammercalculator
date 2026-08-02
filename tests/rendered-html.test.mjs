import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
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
  assert.match(html, /LIVE RESOLUTION/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the WebAssembly calculator assets", async () => {
  await Promise.all([
    access(new URL("public/wasm/calculator.js", projectRoot)),
    access(new URL("public/wasm/calculator.wasm", projectRoot)),
  ]);
});
