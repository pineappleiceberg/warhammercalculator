#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  MISSION_PACK_SCHEMA_VERSION,
  normalizeMissionPackCatalogue,
} from "../lib/mission-pack.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Deployment URL must use HTTP or HTTPS");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url;
}

function failureCode(error) {
  if (error?.name === "AbortError") return "TIMEOUT";
  const causeCode = error?.cause?.code;
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") return "DNS_FAILURE";
  if (causeCode === "ECONNREFUSED") return "CONNECTION_REFUSED";
  if (causeCode === "CERT_HAS_EXPIRED" || causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "TLS_FAILURE";
  }
  return "NETWORK_FAILURE";
}

async function timedFetch(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json, text/html;q=0.9, */*;q=0.1" },
      redirect: "follow",
      signal: controller.signal,
    });
    return { response, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, operation) {
  try {
    return { name, status: "ok", ...(await operation()) };
  } catch (error) {
    return {
      name,
      status: "failed",
      code: error.code ?? failureCode(error),
      message: error instanceof Error ? error.message : "Unknown deployment failure",
      ...(error.details ? { details: error.details } : {}),
    };
  }
}

function httpError(response) {
  const error = new Error(`Received HTTP ${response.status}`);
  error.code = `HTTP_${response.status}`;
  return error;
}

async function responseCheck(fetchImpl, url, timeoutMs, validate) {
  const { response, latencyMs } = await timedFetch(fetchImpl, url, timeoutMs);
  if (!response.ok) throw httpError(response);
  return { httpStatus: response.status, latencyMs, ...(await validate(response)) };
}

async function checkHome(fetchImpl, baseUrl, timeoutMs) {
  return responseCheck(fetchImpl, baseUrl, timeoutMs, async (response) => {
    const html = await response.text();
    if (!/Warhammer Damage Calculator/i.test(html)) {
      const error = new Error("Calculator marker is missing from the deployed page");
      error.code = "UNEXPECTED_HTML";
      throw error;
    }
    return { content: "calculator-html" };
  });
}

async function checkProfiles(fetchImpl, baseUrl, timeoutMs) {
  return responseCheck(
    fetchImpl,
    new URL("profile-data.json", baseUrl),
    timeoutMs,
    async (response) => {
      let body;
      try {
        body = await response.json();
      } catch {
        const error = new Error("Profile catalogue is not valid JSON");
        error.code = "INVALID_PROFILE_JSON";
        throw error;
      }
      if (
        typeof body?.sourceUpdatedAt !== "string" ||
        typeof body?.leaderFormationRules?.maximumLeaders !== "number" ||
        typeof body?.leaderFormationRules?.sourceUrl !== "string" ||
        typeof body?.leaderFormationRules?.sourceSha256 !== "string" ||
        !Array.isArray(body?.factions) ||
        !Array.isArray(body?.units) ||
        !body.units.every(
          (unit) =>
            Array.isArray(unit?.leaderBodyguardIds) &&
            Array.isArray(unit?.leaderAttachmentConditions) &&
            typeof unit?.leaderFooter === "string" &&
            (unit?.leaderAttachmentException === null ||
              typeof unit?.leaderAttachmentException === "object") &&
            (unit?.bodyguardLeaderRule === null || typeof unit?.bodyguardLeaderRule === "object") &&
            Array.isArray(unit?.bodyguardJoinOptions),
        )
      ) {
        const error = new Error("Profile catalogue schema is incomplete");
        error.code = "INVALID_PROFILE_SCHEMA";
        throw error;
      }
      return {
        sourceUpdatedAt: body.sourceUpdatedAt,
        factions: body.factions.length,
        units: body.units.length,
      };
    },
  );
}

async function checkRuleCoverage(fetchImpl, baseUrl, timeoutMs) {
  return responseCheck(
    fetchImpl,
    new URL("battle-rule-coverage.json", baseUrl),
    timeoutMs,
    async (response) => {
      let body;
      try {
        body = await response.json();
      } catch {
        const error = new Error("Rule coverage catalogue is not valid JSON");
        error.code = "INVALID_RULE_COVERAGE_JSON";
        throw error;
      }
      if (
        body?.schemaVersion !== 1 ||
        typeof body?.snapshotId !== "string" ||
        !Array.isArray(body?.sourceLocks) ||
        body.sourceLocks.length === 0 ||
        !Array.isArray(body?.rules) ||
        body.rules.length === 0 ||
        !body.rules.every(
          (rule) =>
            typeof rule?.id === "string" &&
            typeof rule?.status === "string" &&
            Array.isArray(rule?.sources) &&
            rule.sources.length > 0,
        )
      ) {
        const error = new Error("Rule coverage catalogue schema is incomplete");
        error.code = "INVALID_RULE_COVERAGE_SCHEMA";
        throw error;
      }
      return {
        snapshotId: body.snapshotId,
        rules: body.rules.length,
        sourceLocks: body.sourceLocks.length,
      };
    },
  );
}

async function checkMissionPack(fetchImpl, baseUrl, timeoutMs) {
  return responseCheck(
    fetchImpl,
    new URL("chapter-approved-2025-26-v1.4.json", baseUrl),
    timeoutMs,
    async (response) => {
      let body;
      try {
        body = await response.json();
      } catch {
        const error = new Error("Mission pack catalogue is not valid JSON");
        error.code = "INVALID_MISSION_PACK_JSON";
        throw error;
      }
      let catalogue;
      try {
        catalogue = normalizeMissionPackCatalogue(body);
      } catch {
        const error = new Error("Mission pack catalogue schema is incomplete");
        error.code = "INVALID_MISSION_PACK_SCHEMA";
        throw error;
      }
      return {
        schemaVersion: MISSION_PACK_SCHEMA_VERSION,
        id: catalogue.id,
        version: catalogue.version,
        missions: catalogue.missions.length,
        terrainLayouts: catalogue.terrainLayouts.length,
      };
    },
  );
}

async function checkWasm(fetchImpl, baseUrl, timeoutMs) {
  return responseCheck(
    fetchImpl,
    new URL("wasm/calculator.wasm", baseUrl),
    timeoutMs,
    async (response) => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.length < 8 ||
        bytes[0] !== 0x00 ||
        bytes[1] !== 0x61 ||
        bytes[2] !== 0x73 ||
        bytes[3] !== 0x6d
      ) {
        const error = new Error("Calculator engine is not a valid WebAssembly binary");
        error.code = "INVALID_WASM";
        throw error;
      }
      return { bytes: bytes.length };
    },
  );
}

async function checkApi(fetchImpl, baseUrl, timeoutMs) {
  const { response, latencyMs } = await timedFetch(
    fetchImpl,
    new URL("api/v1/health", baseUrl),
    timeoutMs,
  );
  let body;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw httpError(response);
    const error = new Error("Health endpoint did not return valid JSON");
    error.code = "INVALID_HEALTH_JSON";
    throw error;
  }
  if (body?.status !== "ok" || !Array.isArray(body?.checks)) {
    const failed = Array.isArray(body?.checks)
      ? body.checks
          .filter((entry) => entry?.status !== "ok")
          .map((entry) => ({ name: entry?.name, code: entry?.code }))
      : [];
    const error = new Error(
      failed.length > 0
        ? `Health endpoint reports failed dependencies: ${failed.map((entry) => entry.code).join(", ")}`
        : "Health endpoint schema is incomplete",
    );
    error.code = "UNHEALTHY_API";
    error.details = { httpStatus: response.status, dependencies: failed };
    throw error;
  }
  return {
    httpStatus: response.status,
    latencyMs,
    dependencies: body.checks.map((entry) => ({
      name: entry.name,
      status: entry.status,
      latencyMs: entry.latencyMs,
    })),
  };
}

export async function checkDeployment(
  baseUrlValue,
  { surface = "api", fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (surface !== "api" && surface !== "static") {
    throw new Error("surface must be api or static");
  }
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  const checks = await Promise.all([
    check("homepage", () => checkHome(fetchImpl, baseUrl, timeoutMs)),
    check("profile-catalogue", () => checkProfiles(fetchImpl, baseUrl, timeoutMs)),
    check("rule-coverage", () => checkRuleCoverage(fetchImpl, baseUrl, timeoutMs)),
    check("mission-pack", () => checkMissionPack(fetchImpl, baseUrl, timeoutMs)),
    check("calculator-wasm", () => checkWasm(fetchImpl, baseUrl, timeoutMs)),
    ...(surface === "api"
      ? [check("api-dependencies", () => checkApi(fetchImpl, baseUrl, timeoutMs))]
      : []),
  ]);
  return {
    schemaVersion: 1,
    status: checks.every((entry) => entry.status === "ok") ? "ok" : "failed",
    surface,
    baseUrl: baseUrl.href,
    checkedAt: new Date().toISOString(),
    checks,
  };
}

async function main() {
  const baseUrl = process.argv[2];
  const surfaceArgument = process.argv.find((argument) => argument.startsWith("--surface="));
  const surface = surfaceArgument?.slice("--surface=".length) ?? "api";
  if (!baseUrl) {
    console.error("usage: node scripts/check-deployment.mjs URL [--surface=api|static]");
    process.exitCode = 2;
    return;
  }
  try {
    const report = await checkDeployment(baseUrl, { surface });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "ok") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment check failed");
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
