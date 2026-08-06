import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  simulateAttack,
  type CombatProfile,
} from "../lib/combat";
import { createArmyList, deleteArmyList, listArmyLists, updateArmyList } from "../db/army-lists";
import type { ArmyListInput } from "../lib/army-list";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type Catalogue = {
  sourceUpdatedAt: string;
  factions: Array<{ id: string; name: string }>;
  units: Array<{
    id: string;
    factionId: string;
    name: string;
    models: unknown[];
    weapons: unknown[];
  }>;
};

type CalculatorExports = {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  whc_calculate_summary(...values: number[]): number;
};

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

let cataloguePromise: Promise<Catalogue> | null = null;
let calculatorPromise: Promise<CalculatorExports> | null = null;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, ...headers },
  });
}

function apiError(message: string, status = 400) {
  return json({ error: { message, status }, apiVersion: "v1" }, status);
}

async function loadCatalogue(request: Request, env: Env) {
  cataloguePromise ??= env.ASSETS.fetch(
    new Request(new URL("/profile-data.json", request.url)),
  ).then(async (response) => {
    if (!response.ok) throw new Error("Profile catalogue is unavailable");
    return response.json() as Promise<Catalogue>;
  });
  return cataloguePromise;
}

async function loadCalculator(request: Request, env: Env) {
  calculatorPromise ??= (async () => {
    const response = await env.ASSETS.fetch(
      new Request(new URL("/wasm/calculator.wasm", request.url)),
    );
    if (!response.ok) throw new Error("Calculator engine is unavailable");
    let calculator: CalculatorExports | null = null;
    const imports = {
      env: {
        emscripten_resize_heap(requestedSize: number) {
          if (!calculator) return 0;
          const memory = calculator.memory;
          const missing = requestedSize - memory.buffer.byteLength;
          if (missing <= 0) return 1;
          try {
            memory.grow(Math.ceil(missing / 65_536));
            return 1;
          } catch {
            return 0;
          }
        },
        emscripten_memcpy_big(destination: number, source: number, count: number) {
          if (!calculator) return destination;
          new Uint8Array(calculator.memory.buffer).copyWithin(destination, source, source + count);
          return destination;
        },
      },
    };
    const instantiated = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    calculator = instantiated.instance.exports as unknown as CalculatorExports;
    calculator.__wasm_call_ctors();
    return calculator;
  })();
  return calculatorPromise;
}

async function exactCalculation(profile: CombatProfile, request: Request, env: Env) {
  const calculator = await loadCalculator(request, env);
  const output = calculator.malloc(36);
  const flags =
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && profile.rapidFire > 0 ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0);

  try {
    const ok = calculator.whc_calculate_summary(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
      profile.weaponCount,
      profile.hitOn,
      profile.strength,
      profile.ap,
      profile.damageDice,
      profile.damageSides,
      profile.damage,
      profile.criticalHits,
      profile.toughness,
      profile.save,
      profile.invulnerable,
      profile.feelNoPain,
      profile.wounds,
      profile.reduction,
      flags,
      profile.criticalWounds,
      profile.targetModels,
      profile.sustainedHits,
      profile.rapidFire,
      profile.melta,
      output,
    );
    if (!ok) throw new Error("Profile exceeds the calculator's exact-distribution limits");
    const view = new DataView(calculator.memory.buffer);
    const read = (index: number) => view.getUint32(output + index * 4, true);
    const numerator = (BigInt(read(6)) << 32n) | BigInt(read(5));
    const denominator = (BigInt(read(8)) << 32n) | BigInt(read(7));
    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      mean: Number(numerator) / Number(denominator),
      exact: { numerator: numerator.toString(), denominator: denominator.toString() },
    };
  } finally {
    calculator.free(output);
  }
}

async function requestProfile(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  const candidate =
    body && typeof body === "object" && "profile" in body
      ? (body as { profile: unknown }).profile
      : body;
  return normalizeProfile(candidate);
}

async function requestArmyList(request: Request): Promise<ArmyListInput> {
  const body = (await request.json()) as Partial<ArmyListInput> | null;
  if (!body || typeof body !== "object") throw new Error("Request body must be a JSON object");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) {
    throw new Error("name must contain 1 to 100 characters");
  }
  if (typeof body.factionId !== "string" || !body.factionId) {
    throw new Error("factionId is required");
  }
  if (!Array.isArray(body.units) || body.units.length > 100) {
    throw new Error("units must be an array containing at most 100 entries");
  }
  for (const unit of body.units) {
    if (
      !unit ||
      typeof unit.id !== "string" ||
      typeof unit.unitId !== "string" ||
      typeof unit.name !== "string" ||
      !Number.isInteger(unit.modelCount) ||
      unit.modelCount < 1 ||
      unit.modelCount > 1000 ||
      !Array.isArray(unit.weapons)
    ) {
      throw new Error("Each unit must have an id, unitId, name, model count, and weapons");
    }
  }
  return { name: body.name.trim(), factionId: body.factionId, units: body.units };
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: API_HEADERS });

  try {
    if (url.pathname === "/api/v1" && request.method === "GET") {
      return json({
        name: "Warhammer Damage Calculator API",
        apiVersion: "v1",
        endpoints: {
          factions: "GET /api/v1/factions",
          units: "GET /api/v1/units?faction={factionId}&kind={attacker|target|all}",
          weapons: "GET /api/v1/weapons?unit={datasheetId}",
          targets: "GET /api/v1/targets?unit={datasheetId}",
          profiles: "GET /api/v1/profiles",
          calculate: "POST /api/v1/calculate",
          roll: "POST /api/v1/roll?details={true|false}",
          lists: "GET|POST /api/v1/lists; PUT|DELETE /api/v1/lists/{id}",
        },
        request: { profile: DEFAULT_PROFILE },
      });
    }

    if (url.pathname === "/api/v1/profiles" && request.method === "GET") {
      return json(await loadCatalogue(request, env), 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    if (url.pathname === "/api/v1/factions" && request.method === "GET") {
      const catalogue = await loadCatalogue(request, env);
      return json({ data: catalogue.factions, sourceUpdatedAt: catalogue.sourceUpdatedAt });
    }

    if (url.pathname === "/api/v1/units" && request.method === "GET") {
      const faction = url.searchParams.get("faction");
      if (!faction) return apiError("Missing required faction query parameter");
      const kind = url.searchParams.get("kind") ?? "all";
      if (!["attacker", "target", "all"].includes(kind)) {
        return apiError("kind must be attacker, target, or all");
      }
      const catalogue = await loadCatalogue(request, env);
      const data = catalogue.units
        .filter((unit) => unit.factionId === faction)
        .filter(
          (unit) =>
            kind === "all" ||
            (kind === "attacker" ? unit.weapons.length > 0 : unit.models.length > 0),
        )
        .map((unit) => ({
          id: unit.id,
          factionId: unit.factionId,
          name: unit.name,
          modelProfileCount: unit.models.length,
          weaponProfileCount: unit.weapons.length,
        }));
      return json({ data, faction });
    }

    if (
      (url.pathname === "/api/v1/weapons" || url.pathname === "/api/v1/targets") &&
      request.method === "GET"
    ) {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === unitId);
      if (!unit) return apiError("Unit not found", 404);
      const data = url.pathname.endsWith("weapons") ? unit.weapons : unit.models;
      return json({ data, unit: { id: unit.id, name: unit.name, factionId: unit.factionId } });
    }

    if (url.pathname === "/api/v1/calculate" && request.method === "POST") {
      const profile = await requestProfile(request);
      return json({
        data: await exactCalculation(profile, request, env),
        profile,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/roll" && request.method === "POST") {
      const profile = await requestProfile(request);
      const rolled = simulateAttack(profile);
      if (url.searchParams.get("details") === "false") rolled.details = [];
      return json({ data: rolled, profile, apiVersion: "v1" });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "GET") {
      return json({ data: await listArmyLists(env.DB), apiVersion: "v1" });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "POST") {
      return json({ data: await createArmyList(env.DB, await requestArmyList(request)) }, 201);
    }

    const listMatch = /^\/api\/v1\/lists\/([0-9a-f-]+)$/i.exec(url.pathname);
    if (listMatch && request.method === "PUT") {
      const updated = await updateArmyList(env.DB, listMatch[1], await requestArmyList(request));
      return updated ? json({ data: updated }) : apiError("Army list not found", 404);
    }
    if (listMatch && request.method === "DELETE") {
      return (await deleteArmyList(env.DB, listMatch[1]))
        ? json({ deleted: true })
        : apiError("Army list not found", 404);
    }

    return apiError("API endpoint not found", 404);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Request failed");
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname === "/api/") {
      return Response.redirect(new URL("/api/v1", request.url), 308);
    }
    if (url.pathname.startsWith("/api/v1")) return handleApi(request, env);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
