import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const output = new URL("../dist-pages/", import.meta.url);

test("builds a GitHub Pages application with its calculator assets", async () => {
  const index = await readFile(new URL("index.html", output), "utf8");

  assert.match(index, /Warhammer Damage Calculator/);
  assert.match(index, /\/warhammercalculator\/assets\//);
  await access(new URL("profile-data.json", output));
  await access(new URL("battle-rule-coverage.json", output));
  await access(new URL("chapter-approved-2025-26-v1.4.json", output));
  await access(new URL("battle-rule-sources.json", output));
  await access(new URL("wasm/calculator.js", output));
  await access(new URL("wasm/calculator.wasm", output));
  await Promise.all([
    access(new URL("unit-vs-unit/index.html", output)),
    access(new URL("lists/index.html", output)),
    access(new URL("play/index.html", output)),
    access(new URL("agent/index.html", output)),
  ]);
});
