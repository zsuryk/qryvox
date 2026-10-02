// pnpm db:migrate — apply migrations, then assert the append-only triggers survived.
// pnpm db:check   — assert only; for CI and after migrating the production database.
import { assertAppendOnly } from "../src/db/append-only";
import { openDatabase, runMigrations } from "../src/db/client";
import { env } from "../src/env";

const command = process.argv[2];
const { client, db } = openDatabase(env.databaseUrl, env.databaseAuthToken);
try {
  if (command === "migrate") await runMigrations(db);
  else if (command !== "check") throw new Error(`unknown command ${command}; expected migrate or check`);
  await assertAppendOnly(client);
  console.log(`${env.databaseUrl}: append-only triggers present`);
} finally {
  client.close();
}
