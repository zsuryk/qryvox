import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { IngestedDocument } from "@qryvox/shared";
import { afterEach } from "vitest";
import { createApp } from "../src/app";
import type { Guards } from "../src/guards";
import { openDatabase, runMigrations, type Database } from "../src/db/client";
import { LlmError, type ChatMessage, type Completion, type Llm } from "../src/llm";

export const ALLOWED_ORIGIN = "http://localhost:3000";

export const TEST_GUARDS: Guards = {
  allowedOrigins: [ALLOWED_ORIGIN],
  ipHashSecret: "test-secret",
  limits: { windowSeconds: 3600, stepsPerIp: 1000, stepsPerCase: 1000 },
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

// Every test gets its own temporary database file, so tests never share state.
export async function setup({ llm = null, guards = TEST_GUARDS }: { llm?: Llm | null; guards?: Guards } = {}) {
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

  const app = createApp({ ...database, llm, guards });

  const request = requester(app);

  async function openCase(eventId: string = randomUUID()): Promise<string> {
    const res = await request("POST", "/cases", { event_id: eventId });
    if (res.status !== 201) throw new Error(`open case failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { case_id: string }).case_id;
  }

  return { app, client: database.client, database, request, openCase };
}

export type TestApp = Awaited<ReturnType<typeof setup>>;

// JSON requests against an app in-process.
export function requester(app: { request: (path: string, init: RequestInit) => Response | Promise<Response> }) {
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

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

// A fake model: counts invocations (so "a retry spends no tokens" is testable) and answers from a script.
export class FakeLlm implements Llm {
  readonly model = "fake-model";
  calls: ChatMessage[][] = [];

  constructor(private readonly reply: (messages: ChatMessage[], call: number) => string | Promise<string> | Error) {}

  async complete(messages: ChatMessage[]): Promise<Completion> {
    this.calls.push(messages);
    const content = await this.reply(messages, this.calls.length);
    if (content instanceof Error) throw new LlmError(content.message);
    return { content, raw: { choices: [{ message: { content } }] } };
  }
}

// A valid extract reply for sampleDocument(): both statements are verbatim on their pages.
export const EXTRACT_REPLY = JSON.stringify({
  statements: [
    { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." },
    { document_id: "factsheet", page: 2, quote: "Past performance is not a guide to future returns." },
  ],
});
