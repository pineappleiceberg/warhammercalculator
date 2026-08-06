import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.ARMY_DB) {
    throw new Error(
      "Cloudflare D1 binding `ARMY_DB` is unavailable. Set the `d1` field in .openai/hosting.json to `ARMY_DB` or let your control plane inject the real binding values before using the database.",
    );
  }

  return drizzle(env.ARMY_DB, { schema });
}
