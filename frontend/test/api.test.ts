import { IngestedDocument, PDFJS_VERSION } from "@qryvox/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL, ingestDocument, openCase } from "../lib/api";

// What intake hands the wire. Parsed against the real schema, so this test fails if a field the event
// needs is ever dropped between the browser and the log.

const document = IngestedDocument.parse({
  document_id: "larkspur-fee-table",
  sha256: "7e5a28f6".repeat(8),
  filename: "larkspur-fee-table.pdf",
  kind: "fee_table",
  page_count: 1,
  pages: ["Schedule of Fees"],
  pdfjs_version: PDFJS_VERSION,
});

function stubFetch(body: unknown, status = 201) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("opening a case", () => {
  it("posts the browser's own event id, because the case is named after it", async () => {
    const eventId = crypto.randomUUID();
    const fetch = stubFetch({ case_id: eventId, seq: 1 });

    expect(await openCase(eventId)).toEqual({ case_id: eventId, seq: 1 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/cases`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ event_id: eventId }) });
  });
});

describe("ingesting a document", () => {
  it("posts the extracted text under the browser's event id, and no file", async () => {
    const caseId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const fetch = stubFetch({ seq: 2 });

    expect(await ingestDocument(caseId, eventId, document)).toEqual({ seq: 2 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/cases/${caseId}/documents`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ event_id: eventId, document }) });
    expect(JSON.parse(init!.body as string).document.pages).toEqual(["Schedule of Fees"]);
  });

  it("raises what the server said, so the tile can show it", async () => {
    stubFetch({ error: "case nope not found" }, 404);
    await expect(ingestDocument("nope", crypto.randomUUID(), document)).rejects.toThrow("404");
  });

  it("rejects a response that is not the append the contract describes", async () => {
    stubFetch({ seq: "two" });
    await expect(ingestDocument("case", crypto.randomUUID(), document)).rejects.toThrow();
  });
});
