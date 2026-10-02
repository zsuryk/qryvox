import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { IngestedDocument } from "@qryvox/shared";
import { afterEach } from "vitest";
import { createApp } from "../src/app";
import { openDatabase, runMigrations, type Database } from "../src/db/client";

export const ALLOWED_ORIGIN = "http://localhost:3000";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

// Every test gets its own temporary database file, so tests never share state.
export async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "qryvox-test-"));
  const database: Database = openDatabase(pathToFileURL(join(dir, "test.db")).href);
  await runMigrations(database.db);
  cleanups.push(() => {
    database.client.close();
    // Best effort: on Windows the native driver can hold the file open briefly after close().
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // left for the OS temp cleaner
    }
  });

  const app = createApp({ ...database, allowedOrigin: ALLOWED_ORIGIN });

  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function openCase(eventId: string = randomUUID()): Promise<string> {
    const res = await request("POST", "/cases", { event_id: eventId });
    if (res.status !== 201) throw new Error(`open case failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { case_id: string }).case_id;
  }

  return { app, client: database.client, request, openCase };
}

export type TestApp = Awaited<ReturnType<typeof setup>>;

export function sampleDocument(overrides: Partial<IngestedDocument> = {}): IngestedDocument {
  return {
    document_id: "factsheet",
    sha256: "a".repeat(64),
    filename: "factsheet.pdf",
    kind: "factsheet",
    page_count: 2,
    pages: ["Management fee: 0.85% per annum.", "Past performance is not a guide to future returns."],
    pdfjs_version: "5.0.0",
    ...overrides,
  };
}
