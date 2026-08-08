import assert from "node:assert/strict";
import test from "node:test";
import { checkDeployment } from "../scripts/check-deployment.mjs";

const profiles = {
  sourceUpdatedAt: "2026-06-13 12:02:41",
  factions: [{ id: "NEC", name: "Necrons" }],
  units: [{ id: "1", name: "Doomsday Ark", leaderBodyguardIds: [] }],
};

function healthyFetch(request) {
  const url = new URL(request);
  if (url.pathname.endsWith("/profile-data.json")) return Response.json(profiles);
  if (url.pathname.endsWith("/wasm/calculator.wasm")) {
    return new Response(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
  }
  if (url.pathname.endsWith("/api/v1/health")) {
    return Response.json({
      status: "ok",
      checks: [
        { name: "profile-catalogue", status: "ok", latencyMs: 1 },
        { name: "calculator-engine", status: "ok", latencyMs: 2 },
        { name: "list-storage", status: "ok", latencyMs: 3 },
      ],
    });
  }
  return new Response("<title>Warhammer Damage Calculator</title>", {
    headers: { "content-type": "text/html" },
  });
}

test("accepts healthy API and static deployments", async () => {
  const api = await checkDeployment("https://example.test/calculator", {
    fetchImpl: healthyFetch,
  });
  const staticSite = await checkDeployment("https://example.test/calculator/", {
    surface: "static",
    fetchImpl: healthyFetch,
  });

  assert.equal(api.status, "ok");
  assert.equal(api.checks.length, 4);
  assert.equal(staticSite.status, "ok");
  assert.equal(staticSite.checks.length, 3);
  assert.equal(api.baseUrl, "https://example.test/calculator/");
});

test("identifies HTTP, profile schema, and Wasm deployment failures", async () => {
  const report = await checkDeployment("https://example.test/", {
    surface: "static",
    fetchImpl: async (request) => {
      const pathname = new URL(request).pathname;
      if (pathname === "/") return new Response("Unavailable", { status: 503 });
      if (pathname === "/profile-data.json") return Response.json({ factions: [] });
      return new Response("not wasm");
    },
  });

  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.checks.map((entry) => entry.code),
    ["HTTP_503", "INVALID_PROFILE_SCHEMA", "INVALID_WASM"],
  );
});

test("identifies DNS failures without hiding the failed check", async () => {
  const report = await checkDeployment("https://missing.example/", {
    surface: "static",
    fetchImpl: async () => {
      throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    },
  });

  assert.equal(report.status, "failed");
  assert.ok(report.checks.every((entry) => entry.code === "DNS_FAILURE"));
});

test("preserves failed API dependency codes from a degraded health response", async () => {
  const report = await checkDeployment("https://example.test/", {
    fetchImpl: async (request) => {
      const url = new URL(request);
      if (url.pathname === "/api/v1/health") {
        return Response.json(
          {
            status: "degraded",
            checks: [
              { name: "profile-catalogue", status: "ok" },
              {
                name: "list-storage",
                status: "failed",
                code: "LIST_STORAGE_UNAVAILABLE",
              },
            ],
          },
          { status: 503 },
        );
      }
      return healthyFetch(request);
    },
  });

  assert.equal(report.status, "failed");
  const api = report.checks.find((entry) => entry.name === "api-dependencies");
  assert.equal(api.code, "UNHEALTHY_API");
  assert.deepEqual(api.details, {
    httpStatus: 503,
    dependencies: [{ name: "list-storage", code: "LIST_STORAGE_UNAVAILABLE" }],
  });
});
