// pnpm record:fixture — drives the real API against a throwaway database and records the slim event
// stream into shared/test/fixtures, so the fold tests fold what the API actually emits.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EventPage, type IngestedDocument } from "@qryvox/shared";
import { createApp } from "../src/app";
import { openDatabase, runMigrations } from "../src/db/client";
import { LlmError, type Llm } from "../src/llm";

const out = fileURLToPath(new URL("../../shared/test/fixtures/case-recorded.json", import.meta.url));

const database = openDatabase(pathToFileURL(join(mkdtempSync(join(tmpdir(), "qryvox-fixture-")), "fixture.db")).href);
await runMigrations(database.db);
// A scripted model: the first extract call fails as if the endpoint were down, the retry succeeds.
let calls = 0;
const llm: Llm = {
  model: "recorded-fake-model",
  async complete() {
    calls += 1;
    if (calls === 1) throw new LlmError("model endpoint unreachable: recorded outage");
    const content = JSON.stringify({
      statements: [
        { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." },
        { document_id: "ppm", page: 2, quote: "The management fee is 1.10% per annum." },
      ],
    });
    return { content, raw: { choices: [{ message: { content } }] } };
  },
};
const app = createApp({ ...database, allowedOrigin: "http://localhost:3000", llm });

async function call(method: string, path: string, body?: unknown, ok = [200, 201]): Promise<unknown> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!ok.includes(res.status)) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const documents: IngestedDocument[] = [
  {
    document_id: "factsheet",
    sha256: "1f".repeat(32),
    filename: "factsheet.pdf",
    kind: "factsheet",
    page_count: 1,
    pages: ["Management fee: 0.85% per annum."],
    pdfjs_version: "5.0.0",
  },
  {
    document_id: "ppm",
    sha256: "2e".repeat(32),
    filename: "ppm-excerpt.pdf",
    kind: "ppm",
    page_count: 2,
    pages: ["Investment objective.", "The management fee is 1.10% per annum."],
    pdfjs_version: "5.0.0",
  },
];

const { case_id } = (await call("POST", "/cases", { event_id: randomUUID() })) as { case_id: string };
for (const document of documents) {
  await call("POST", `/cases/${case_id}/documents`, { event_id: randomUUID(), document });
}
const extract = { step_run_id: randomUUID(), step: "extract", input_run_id: null };
await call("POST", `/cases/${case_id}/steps`, extract, [502]);
await call("POST", `/cases/${case_id}/steps`, extract);

const { events } = EventPage.parse(await call("GET", `/cases/${case_id}/events`));

writeFileSync(out, JSON.stringify(events, null, 2) + "\n");
database.client.close();
console.log(`recorded ${events.length} events to ${out}`);
