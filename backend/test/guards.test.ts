import { randomUUID } from "node:crypto";
import { ErrorResponse } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { checkRateLimit, hashIp } from "../src/guards";
import {
  ALLOWED_ORIGIN,
  EXTRACT_REPLY,
  FakeLlm,
  requester,
  sampleDocument,
  setup,
  TEST_GUARDS,
  type TestApp,
} from "./helpers";

const limits = (stepsPerCase: number, stepsPerIp: number) => ({
  ...TEST_GUARDS,
  limits: { windowSeconds: 3600, stepsPerCase, stepsPerIp },
});

async function caseWithDocument(t: TestApp) {
  const caseId = await t.openCase();
  await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document: sampleDocument() });
  return caseId;
}

function extract(t: TestApp, caseId: string, ip = "203.0.113.7", stepRunId = randomUUID()) {
  return t.request(
    "POST",
    `/cases/${caseId}/steps`,
    { step_run_id: stepRunId, step: "extract", input_run_id: null },
    { "x-forwarded-for": `${ip}, 10.0.0.1` },
  );
}

describe("the origin allow-list", () => {
  it("accepts the frontend origin and answers with its CORS header", async () => {
    const t = await setup();
    const res = await t.request("POST", "/cases", { event_id: randomUUID() }, { origin: ALLOWED_ORIGIN });

    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("rejects a request from any other origin before it does anything", async () => {
    const t = await setup();
    const eventId = randomUUID();

    const res = await t.request("POST", "/cases", { event_id: eventId }, { origin: "https://evil.example" });

    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await t.request("GET", `/cases/${eventId}/events`)).status).toBe(404);
  });

  it("answers a preflight from the allowed origin and refuses one from elsewhere", async () => {
    const t = await setup();
    const preflight = (origin: string) =>
      t.app.request("/cases", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      });

    const allowed = await preflight(ALLOWED_ORIGIN);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect((await preflight("https://evil.example")).status).toBe(403);
  });
});

describe("the client IP", () => {
  it("is stored on step events only as a keyed HMAC; the raw address is never persisted", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY) });
    const caseId = await caseWithDocument(t);

    expect((await extract(t, caseId, "203.0.113.7")).status).toBe(200);

    const rs = await t.client.execute("SELECT * FROM events");
    const stepRows = rs.rows.filter((r) => String(r.type).startsWith("step."));
    expect(stepRows).toHaveLength(2);
    for (const row of stepRows) expect(row.ip_hash).toBe(hashIp("test-secret", "203.0.113.7"));
    expect(JSON.stringify(rs.rows)).not.toContain("203.0.113.7");
  });

  it("hashes with the server-side secret, so the hash cannot be recomputed without it", () => {
    expect(hashIp("secret-a", "203.0.113.7")).not.toBe(hashIp("secret-b", "203.0.113.7"));
    expect(hashIp("secret-a", "203.0.113.7")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the rate limit", () => {
  it("rejects a case's steps over the limit with 429, Retry-After and no model call", async () => {
    const llm = new FakeLlm(() => EXTRACT_REPLY);
    const t = await setup({ llm, guards: limits(2, 100) });
    const caseId = await caseWithDocument(t);

    await extract(t, caseId);
    await extract(t, caseId);
    const third = await extract(t, caseId);

    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(ErrorResponse.parse(await third.json()).error).toMatch(/2 analysis steps per 3600 s for this case/);
    expect(llm.calls).toHaveLength(2);
  });

  it("limits one client across cases, while another client is unaffected", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY), guards: limits(100, 2) });
    const [a, b] = [await caseWithDocument(t), await caseWithDocument(t)];

    await extract(t, a, "203.0.113.7");
    await extract(t, b, "203.0.113.7");

    expect((await extract(t, b, "203.0.113.7")).status).toBe(429);
    expect((await extract(t, b, "198.51.100.4")).status).toBe(200);
  });

  it("never blocks a retry of a completed run: returning a stored result spends nothing", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY), guards: limits(1, 100) });
    const caseId = await caseWithDocument(t);
    const stepRunId = randomUUID();

    expect((await extract(t, caseId, undefined, stepRunId)).status).toBe(200);
    expect((await extract(t, caseId)).status).toBe(429);
    expect((await extract(t, caseId, undefined, stepRunId)).status).toBe(200);
  });

  it("is derived from the events table, so it holds across separate app instances", async () => {
    // Two instances share the database and nothing else, as serverless instances do.
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY), guards: limits(2, 100) });
    const caseId = await caseWithDocument(t);
    const other = createApp({ ...t.database, llm: new FakeLlm(() => EXTRACT_REPLY), guards: limits(2, 100) });
    const onOther = { ...t, app: other, request: requester(other) };

    await extract(t, caseId);
    await extract(onOther, caseId);

    expect((await extract(t, caseId)).status).toBe(429);
    expect((await extract(onOther, caseId)).status).toBe(429);
  });

  it("forgets step starts once they age out of the window", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY) });
    const caseId = await caseWithDocument(t);
    await extract(t, caseId);
    const ipHash = hashIp("test-secret", "203.0.113.7");
    const tight = { windowSeconds: 60, stepsPerIp: 1, stepsPerCase: 1 };

    await expect(checkRateLimit(t.database.db, caseId, ipHash, tight)).rejects.toThrow(/rate limit/);
    const later = new Date(Date.now() + 61_000);
    await expect(checkRateLimit(t.database.db, caseId, ipHash, tight, later)).resolves.toBeUndefined();
  });
});
