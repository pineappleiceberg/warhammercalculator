import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const armyLists = sqliteTable("army_lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  factionId: text("faction_id").notNull(),
  roster: text("roster", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
