import type { ArmyListInput, ArmyListRecord, ArmyListUnit } from "../lib/army-list";

type ArmyListRow = {
  id: string;
  name: string;
  faction_id: string;
  roster: string;
  created_at: number;
  updated_at: number;
};

const initialized = new WeakSet<object>();

export async function ensureArmyLists(db: D1Database) {
  if (initialized.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS army_lists_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        faction_id TEXT NOT NULL,
        roster TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS army_lists_v2_updated_at_idx ON army_lists_v2 (updated_at DESC)",
    )
    .run();
  initialized.add(db);
}

function fromRow(row: ArmyListRow): ArmyListRecord {
  return {
    id: row.id,
    name: row.name,
    factionId: row.faction_id,
    units: JSON.parse(row.roster) as ArmyListUnit[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listArmyLists(db: D1Database) {
  await ensureArmyLists(db);
  const result = await db
    .prepare(
      "SELECT id, name, faction_id, roster, created_at, updated_at FROM army_lists_v2 ORDER BY updated_at DESC",
    )
    .all<ArmyListRow>();
  return result.results.map(fromRow);
}

export async function createArmyList(db: D1Database, input: ArmyListInput) {
  await ensureArmyLists(db);
  const now = Date.now();
  const record: ArmyListRecord = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await db
    .prepare(
      "INSERT INTO army_lists_v2 (id, name, faction_id, roster, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(record.id, record.name, record.factionId, JSON.stringify(record.units), now, now)
    .run();
  return record;
}

export async function updateArmyList(db: D1Database, id: string, input: ArmyListInput) {
  await ensureArmyLists(db);
  const updatedAt = Date.now();
  const result = await db
    .prepare(
      "UPDATE army_lists_v2 SET name = ?, faction_id = ?, roster = ?, updated_at = ? WHERE id = ?",
    )
    .bind(input.name, input.factionId, JSON.stringify(input.units), updatedAt, id)
    .run();
  if (!result.meta.changes) return null;
  const row = await db
    .prepare(
      "SELECT id, name, faction_id, roster, created_at, updated_at FROM army_lists_v2 WHERE id = ?",
    )
    .bind(id)
    .first<ArmyListRow>();
  return row ? fromRow(row) : null;
}

export async function deleteArmyList(db: D1Database, id: string) {
  await ensureArmyLists(db);
  const result = await db.prepare("DELETE FROM army_lists_v2 WHERE id = ?").bind(id).run();
  return Boolean(result.meta.changes);
}
