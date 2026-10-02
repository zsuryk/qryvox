import type { Client } from "@libsql/client";

export const APPEND_ONLY_TRIGGERS = ["events_no_update", "events_no_delete"] as const;

// Startup/CI check (ADR-0002): a migration that recreated the table would drop the triggers silently.
export async function assertAppendOnly(client: Client): Promise<void> {
  const rs = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'",
  );
  const present = new Set(rs.rows.map((r) => String(r.name)));
  const missing = APPEND_ONLY_TRIGGERS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`events table is not append-only: missing trigger(s) ${missing.join(", ")}`);
  }
}
