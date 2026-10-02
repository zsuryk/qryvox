import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { assertAppendOnly } from "./db/append-only";
import { openDatabase, runMigrations } from "./db/client";
import { env } from "./env";

const database = openDatabase(env.databaseUrl, env.databaseAuthToken);
await runMigrations(database.db);
await assertAppendOnly(database.client);

serve({ fetch: createApp({ ...database, allowedOrigin: env.allowedOrigin }).fetch, port: env.port }, (info) => {
  console.log(`backend listening on http://localhost:${info.port} (${env.databaseUrl})`);
});
