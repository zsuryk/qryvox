import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;
export type Database = { client: Client; db: Db };

// file: locally, libsql:// + auth token on Vercel — same schema and queries (ADR-0001).
export function openDatabase(url: string, authToken?: string): Database {
  const client = createClient({
    url,
    authToken,
    // Local file only: wait for a lock held by another process (e.g. db:migrate) instead of failing
    // with SQLITE_BUSY. In-process writers are queued in log.ts.
    timeout: 5_000,
  });
  return { client, db: drizzle(client, { schema }) };
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
