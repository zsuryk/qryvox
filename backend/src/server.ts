import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { assertAppendOnly } from "./db/append-only";
import { openDatabase, runMigrations } from "./db/client";
import { env } from "./env";
import { createLlm } from "./llm";

const database = openDatabase(env.databaseUrl, env.databaseAuthToken);
await runMigrations(database.db);
await assertAppendOnly(database.client);

const llm = env.llm ? createLlm(env.llm) : null;
const app = createApp({ ...database, allowedOrigin: env.allowedOrigin, llm });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`backend listening on http://localhost:${info.port} (${env.databaseUrl})`);
  console.log(llm ? `model: ${llm.model} at ${env.llm?.baseUrl}` : "model: not configured (LLM_BASE_URL / LLM_MODEL)");
});
