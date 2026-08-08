import {
  createArmyListBackup,
  mergeArmyListRecords,
  normalizeArmyListInput,
  normalizeArmyListRecord,
  parseArmyListBackup,
} from "./army-list-codec.mjs";

export type ArmyListWeapon = {
  weaponId: number;
  groupId?: string;
  name: string;
  count: number;
  optionCount?: number;
};

export type ArmyListUnit = {
  id: string;
  unitId: string;
  name: string;
  modelCount: number;
  weapons: ArmyListWeapon[];
  choiceSelections?: Record<string, number>;
  loadoutSubjectCounts?: Record<string, number>;
  combatPresetIds?: string[];
  transportId?: string;
  attachedToId?: string;
};

export type ArmyListInput = {
  name: string;
  factionId: string;
  units: ArmyListUnit[];
};

export type ArmyListRecord = ArmyListInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

const CACHE_KEY = "warhammer-calculator:army-lists:v1";
const TOMBSTONE_KEY = "warhammer-calculator:army-list-deletions:v1";

export type ArmyListStorageSource = "cloud" | "device";

function readCache(): ArmyListRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value) || value.length > 100) return [];
    const deleted = new Set(readTombstones());
    return value
      .map((entry) => normalizeArmyListRecord(entry) as ArmyListRecord)
      .filter((entry) => !deleted.has(entry.id));
  } catch {
    return [];
  }
}

function writeCache(lists: ArmyListRecord[]) {
  if (typeof window === "undefined") return false;
  if (lists.length > 100) return false;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(lists));
    return true;
  } catch {
    return false;
  }
}

function readTombstones() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const value = JSON.parse(window.localStorage.getItem(TOMBSTONE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value) || value.length > 100) return [];
    return value.filter(
      (entry): entry is string => typeof entry === "string" && /^[0-9a-f-]{36}$/i.test(entry),
    );
  } catch {
    return [];
  }
}

function writeTombstones(ids: string[]) {
  if (typeof window === "undefined") return false;
  try {
    if (ids.length === 0) window.localStorage.removeItem(TOMBSTONE_KEY);
    else
      window.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...new Set(ids)].slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadArmyLists(): Promise<{
  lists: ArmyListRecord[];
  source: ArmyListStorageSource;
}> {
  try {
    const response = await fetch("/api/v1/lists");
    if (!response.ok) throw new Error("Cloud list storage is unavailable");
    const cloudLists = ((await response.json()) as { data: unknown[] }).data.map(
      (entry) => normalizeArmyListRecord(entry) as ArmyListRecord,
    );
    const tombstones = readTombstones();
    if (tombstones.length > 0) {
      const deleted = await Promise.all(
        tombstones.map((id) => fetch(`/api/v1/lists/${id}`, { method: "DELETE" })),
      );
      if (deleted.some((entry) => !entry.ok && entry.status !== 404)) {
        throw new Error("Cloud list deletion synchronization is unavailable");
      }
      writeTombstones([]);
    }
    let lists = mergeArmyListRecords(cloudLists, readCache(), tombstones) as ArmyListRecord[];
    if (
      lists.length !== cloudLists.length ||
      lists.some(
        (entry, index) =>
          entry.id !== cloudLists[index]?.id || entry.updatedAt !== cloudLists[index]?.updatedAt,
      )
    ) {
      const sync = await fetch("/api/v1/lists/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createArmyListBackup(lists)),
      });
      if (!sync.ok) throw new Error("Cloud list synchronization is unavailable");
      lists = ((await sync.json()) as { data: unknown[] }).data.map(
        (entry) => normalizeArmyListRecord(entry) as ArmyListRecord,
      );
    }
    writeCache(lists);
    return { lists, source: "cloud" };
  } catch {
    return { lists: readCache(), source: "device" };
  }
}

export async function fetchArmyLists() {
  return (await loadArmyLists()).lists;
}

export async function saveArmyList(input: ArmyListInput, id = "") {
  const normalized = normalizeArmyListInput(input) as ArmyListInput;
  try {
    const response = await fetch(id ? `/api/v1/lists/${id}` : "/api/v1/lists", {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalized),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 404) {
        throw new Error(await responseError(response, "Could not save this list"));
      }
      throw new TypeError("Cloud list storage is unavailable");
    }
    const record = normalizeArmyListRecord(
      ((await response.json()) as { data: unknown }).data,
    ) as ArmyListRecord;
    const tombstoneCleared = writeTombstones(
      readTombstones().filter((entry) => entry !== record.id),
    );
    const cached = writeCache([record, ...readCache().filter((entry) => entry.id !== record.id)]);
    return { record, source: "cloud" as const, cached: tombstoneCleared && cached };
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    const now = Date.now();
    const current = readCache().find((entry) => entry.id === id);
    if (!current && readCache().length >= 100) {
      throw new Error("Device storage supports at most 100 army lists");
    }
    const record: ArmyListRecord = {
      ...normalized,
      id: current?.id ?? crypto.randomUUID(),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    if (!writeCache([record, ...readCache().filter((entry) => entry.id !== record.id)])) {
      throw new Error("Device storage is full; export a backup before clearing browser data");
    }
    return { record, source: "device" as const, cached: true };
  }
}

export async function removeArmyList(id: string) {
  let source: ArmyListStorageSource = "cloud";
  try {
    const response = await fetch(`/api/v1/lists/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error("Could not delete this list");
    if (response.status === 404) source = "device";
  } catch {
    source = "device";
  }
  if (source === "device" && !writeTombstones([...readTombstones(), id])) {
    throw new Error("This device could not record the deletion");
  } else writeTombstones(readTombstones().filter((entry) => entry !== id));
  writeCache(readCache().filter((entry) => entry.id !== id));
  return source;
}

export function serializeArmyLists(lists: ArmyListRecord[], profileSourceUpdatedAt: string | null) {
  return JSON.stringify(
    createArmyListBackup(lists, new Date().toISOString(), profileSourceUpdatedAt),
    null,
    2,
  );
}

export async function importArmyLists(value: unknown) {
  const backup = parseArmyListBackup(value) as {
    lists: ArmyListRecord[];
    profileSourceUpdatedAt: string | null;
  };
  const importedIds = new Set(backup.lists.map((entry) => entry.id));
  const tombstonesCleared = writeTombstones(
    readTombstones().filter((entry) => !importedIds.has(entry)),
  );
  try {
    const response = await fetch("/api/v1/lists/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(backup),
    });
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(await responseError(response, "Backup could not be imported"));
      }
      throw new TypeError("Cloud list storage is unavailable");
    }
    const lists = ((await response.json()) as { data: unknown[] }).data.map(
      (entry) => normalizeArmyListRecord(entry) as ArmyListRecord,
    );
    return {
      lists,
      source: "cloud" as const,
      cached: tombstonesCleared && writeCache(lists),
      profileSourceUpdatedAt: backup.profileSourceUpdatedAt,
    };
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    const imported = backup.lists.map((entry) => normalizeArmyListRecord(entry) as ArmyListRecord);
    const lists = [...imported, ...readCache().filter((entry) => !importedIds.has(entry.id))].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
    if (lists.length > 100) throw new Error("Device storage supports at most 100 army lists");
    if (!tombstonesCleared || !writeCache(lists)) {
      throw new Error("Device storage is full; the backup was not imported");
    }
    return {
      lists,
      source: "device" as const,
      cached: true,
      profileSourceUpdatedAt: backup.profileSourceUpdatedAt,
    };
  }
}
