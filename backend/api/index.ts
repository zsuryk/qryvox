// Vercel serverless entry. server.ts is the local dev server; this is what the deployed function runs.
// Migrations are deliberately not applied here — scripts/deploy.sh applies them before deploying, so a
// cold start never issues DDL and concurrent cold starts cannot race each other (ADR-0001).
// assertAppendOnly needs no entry-level call: app.ts runs it before the first request touches the log.
import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { env } from "../src/env.js";
import { createLlm } from "../src/llm.js";

const database = openDatabase(env.databaseUrl, env.databaseAuthToken);

export default {
  fetch: handle(
    createApp({ ...database, llm: env.llm ? createLlm(env.llm) : null, guards: env.guards }),
  ),
};
