import { randomUUID } from "node:crypto";
import { EVENT_TYPES, EventPage, EventPayloadResponse, VerifyResponse } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { sampleDocument, setup, type TestApp } from "./helpers";

async function page(res: Response) {
  expect(res.status).toBe(200);
  return EventPage.parse(await res.json());
}

function ingest({ request }: TestApp, caseId: string, document = sampleDocument(), eventId = randomUUID()) {
  return request("POST", `/cases/${caseId}/documents`, { event_id: eventId, document });
}

async function verify({ request }: TestApp, caseId: string) {
  const res = await request("GET", `/cases/${caseId}/verify`);
  expect(res.status).toBe(200);
  return VerifyResponse.parse(await res.json());
}

describe("opening a case", () => {
  it("appends exactly one case.opened and returns the case id", async () => {
    const t = await setup();
    const caseId = await t.openCase();

    const { events } = await page(await t.request("GET", `/cases/${caseId}/events`));
    expect(events.map((e) => [e.seq, e.type, e.case_id])).toEqual([[1, "case.opened", caseId]]);
  });

  it("a retried open with the same event id returns the same case without appending again", async () => {
    const t = await setup();
    const eventId = randomUUID();
    const first = await t.openCase(eventId);
    const second = await t.openCase(eventId);

    expect(second).toBe(first);
    expect((await page(await t.request("GET", `/cases/${first}/events`))).events).toHaveLength(1);
  });

  it("rejects a request without a valid event id", async () => {
    const t = await setup();
    expect((await t.request("POST", "/cases", { event_id: "nope" })).status).toBe(400);
  });
});

describe("ingesting a document", () => {
  it("appends document.ingested carrying the document identity, text and pdf.js version", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    const document = sampleDocument();

    const res = await ingest(t, caseId, document);
    expect(res.status).toBe(201);
    const { seq } = (await res.json()) as { seq: number };

    const payload = await t.request("GET", `/cases/${caseId}/events/${seq}/payload`);
    expect(EventPayloadResponse.parse(await payload.json())).toEqual({ seq: 2, payload: document });
  });

  it("a retried ingest with the same event id appends nothing new", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    const eventId = randomUUID();

    const first = await ingest(t, caseId, sampleDocument(), eventId);
    const second = await ingest(t, caseId, sampleDocument(), eventId);

    expect(await second.json()).toEqual(await first.json());
    expect((await page(await t.request("GET", `/cases/${caseId}/events`))).events).toHaveLength(2);
  });

  it("is rejected for a case that was never opened", async () => {
    const t = await setup();
    expect((await ingest(t, randomUUID())).status).toBe(404);
  });

  it("is rejected when the page count disagrees with the pages sent", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    expect((await ingest(t, caseId, sampleDocument({ page_count: 3 }))).status).toBe(400);
  });
});

describe("the event list", () => {
  it("returns slim payloads: extracted text stays behind the payload endpoint", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    await ingest(t, caseId, sampleDocument({ page_count: 1, pages: ["x".repeat(1_000_000)] }));

    const res = await t.request("GET", `/cases/${caseId}/events`);
    const size = (await res.clone().text()).length;
    const { events } = await page(res);

    expect(size).toBeLessThan(2_000);
    expect(events[1]?.payload).not.toHaveProperty("pages");
    expect(events[1]?.payload).toMatchObject({ filename: "factsheet.pdf", page_count: 1 });

    const full = await (await t.request("GET", `/cases/${caseId}/events/2/payload`)).text();
    expect(full.length).toBeGreaterThan(1_000_000);
  });

  it("pages by seq with after and limit", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    for (let i = 0; i < 4; i++) await ingest(t, caseId);

    const first = await page(await t.request("GET", `/cases/${caseId}/events?after=0&limit=2`));
    const second = await page(await t.request("GET", `/cases/${caseId}/events?after=2&limit=2`));
    const last = await page(await t.request("GET", `/cases/${caseId}/events?after=4&limit=2`));

    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.has_more).toBe(true);
    expect(second.events.map((e) => e.seq)).toEqual([3, 4]);
    expect(last.events.map((e) => e.seq)).toEqual([5]);
    expect(last.has_more).toBe(false);
  });

  it("is 404 for an unknown case", async () => {
    const t = await setup();
    expect((await t.request("GET", `/cases/${randomUUID()}/events`)).status).toBe(404);
  });
});

describe("the hash chain", () => {
  it("verifies intact and reports the latest hash, which moves with every append", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    const before = await verify(t, caseId);
    await ingest(t, caseId);
    const after = await verify(t, caseId);

    expect(before).toMatchObject({ intact: true, event_count: 1, broken_at_seq: null });
    expect(after).toMatchObject({ intact: true, event_count: 2, broken_at_seq: null });
    expect(after.latest_hash).not.toBe(before.latest_hash);
  });

  it("reports tampering when a row is modified with the triggers dropped", async () => {
    const t = await setup();
    const caseId = await t.openCase();
    await ingest(t, caseId);
    await ingest(t, caseId);

    await t.client.execute("DROP TRIGGER events_no_update");
    await t.client.execute({
      sql: "UPDATE events SET payload = json_set(payload, '$.filename', 'forged.pdf') WHERE case_id = ? AND seq = 2",
      args: [caseId],
    });

    expect(await verify(t, caseId)).toMatchObject({ intact: false, broken_at_seq: 2 });
  });

  it("concurrent appends to one case serialize into one unbroken chain", async () => {
    const t = await setup();
    const caseId = await t.openCase();

    const results = await Promise.all(Array.from({ length: 8 }, () => ingest(t, caseId)));

    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const { events } = await page(await t.request("GET", `/cases/${caseId}/events`));
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await verify(t, caseId)).toMatchObject({ intact: true, event_count: 9 });
  });
});

describe("the events table is append-only", () => {
  it("rejects UPDATE and DELETE at the database", async () => {
    const t = await setup();
    const caseId = await t.openCase();

    await expect(
      t.client.execute({ sql: "UPDATE events SET actor = 'mallory' WHERE case_id = ?", args: [caseId] }),
    ).rejects.toThrow(/append-only: UPDATE rejected/);
    await expect(
      t.client.execute({ sql: "DELETE FROM events WHERE case_id = ?", args: [caseId] }),
    ).rejects.toThrow(/append-only: DELETE rejected/);
  });

  it("refuses to serve when a trigger has gone missing", async () => {
    const t = await setup();
    await t.client.execute("DROP TRIGGER events_no_delete");

    const res = await t.request("GET", "/health");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: expect.stringContaining("missing trigger(s) events_no_delete") });
  });
});

describe("GET /health", () => {
  it("responds ok with the shared event vocabulary", async () => {
    const t = await setup();
    const res = await t.request("GET", "/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", eventTypes: [...EVENT_TYPES] });
    expect(EVENT_TYPES).toContain("case.opened");
  });
});
