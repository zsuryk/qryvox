import { ChangeDispositionRequest, IngestedDocument, PDFJS_VERSION, StepResult } from "@qryvox/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL, changeDisposition, ingestDocument, openCase, recordCardOperation, runStep } from "../lib/api";

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

describe("running a step", () => {
  const request = { step_run_id: crypto.randomUUID(), step: "extract", input_run_id: null } as const;
  const result = StepResult.parse({
    step_run_id: request.step_run_id,
    step: "extract",
    seq: 7,
    prompt_version: "extract@1",
    model: "fake-model",
    output: { statements: [] },
  });

  it("posts the run id the browser named, so a retry lands on the same run", async () => {
    const caseId = crypto.randomUUID();
    const fetch = stubFetch(result, 200);

    expect(await runStep(caseId, request)).toEqual(result);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/cases/${caseId}/steps`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(request) });
  });

  it("raises a failed run with what the server said and the seq it logged", async () => {
    stubFetch({ error: "model endpoint unreachable", step_run_id: request.step_run_id, seq: 8 }, 502);

    await expect(runStep(crypto.randomUUID(), request)).rejects.toMatchObject({
      name: "StepFailureError",
      message: "model endpoint unreachable",
      failure: { step_run_id: request.step_run_id, seq: 8 },
    });
  });

  it("raises what the server said, path and all, when the failure is not the contract's shape", async () => {
    const caseId = crypto.randomUUID();
    // stubFetch stringifies its body, so the wire text is a JSON string rather than the failure contract.
    stubFetch("gateway timeout", 504);

    await expect(runStep(caseId, request)).rejects.toThrow(`POST /cases/${caseId}/steps: 504 "gateway timeout"`);
  });
});

describe("changing a disposition", () => {
  it("posts the analyst's decision under the browser's event id, and nothing else", async () => {
    const caseId = crypto.randomUUID();
    const decision = ChangeDispositionRequest.parse({
      event_id: crypto.randomUUID(),
      finding_id: "finding-1",
      disposition: "dismissed",
    });
    const fetch = stubFetch({ seq: 31 });

    expect(await changeDisposition(caseId, decision)).toEqual({ seq: 31 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/cases/${caseId}/dispositions`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(decision) });
  });

  it("carries the server's reason on a refusal, because a status code is not a reason", async () => {
    // The backend answers 409 when a later findings run superseded the finding. The analyst has to be told
    // that in words, and a bare 404 would leave them pressing a button that will never work.
    stubFetch({ error: "finding f-1 was superseded by a later findings run and is off the board" }, 409);

    await expect(
      changeDisposition("case", ChangeDispositionRequest.parse({ event_id: crypto.randomUUID(), finding_id: "f-1", disposition: "approved" })),
    ).rejects.toThrow("was superseded by a later findings run and is off the board");
  });

  it("carries the server's reason on a 404 too", async () => {
    stubFetch({ error: "finding f-1 not found in case case" }, 404);

    await expect(
      changeDisposition("case", ChangeDispositionRequest.parse({ event_id: crypto.randomUUID(), finding_id: "f-1", disposition: "approved" })),
    ).rejects.toThrow("not found in case case");
  });
});

describe("recording a card operation", () => {
  const caseId = crypto.randomUUID();
  const request = { event_id: crypto.randomUUID(), type: "card.discarded" as const, payload: { card_id: "finding:f-1" } };

  it("posts the operation under the browser's event id and answers with the event the log recorded", async () => {
    const event = { ...request, seq: 31, case_id: caseId, actor: "demo-analyst", at: "2026-10-03T12:00:00.000Z", step_run_id: null, v: 1 };
    const fetch = stubFetch(event);

    expect(await recordCardOperation(caseId, request)).toEqual(event);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/cases/${caseId}/cards`);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify(request) });
  });

  it("raises the server's reason, not its status line", async () => {
    stubFetch({ error: "card finding:f-1 is not on this case's canvas" }, 409);
    await expect(recordCardOperation(caseId, request)).rejects.toThrow(/^card finding:f-1 is not on this case's canvas$/);
  });
});

describe("the judge-link token", () => {
  function browser(search: string, stored: Record<string, string> = {}) {
    const storage = new Map(Object.entries(stored));
    const replaced: string[] = [];
    vi.stubGlobal("window", {
      location: { href: `https://qryvox.vercel.app/${search}` },
      history: { state: null, replaceState: (_: unknown, __: string, url: URL) => replaced.push(String(url)) },
      sessionStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
    });
    return { storage, replaced };
  }
  const step = { step_run_id: crypto.randomUUID(), step: "extract" as const, input_run_id: null };

  it("is taken off the demo link into the tab's storage, and out of the address bar", async () => {
    const { storage, replaced } = browser("?k=judge-secret&x=1");
    const { captureJudgeToken } = await import("../lib/api");
    captureJudgeToken();
    expect([...storage.values()]).toEqual(["judge-secret"]);
    expect(replaced).toEqual(["https://qryvox.vercel.app/?x=1"]);
  });

  it("travels with every call once captured", async () => {
    browser("", { "qryvox.judge-token": "judge-secret" });
    const fetch = stubFetch(StepResult.parse({ step_run_id: step.step_run_id, step: "extract", seq: 3, prompt_version: "extract@1", model: "m", output: {} }), 200);
    await runStep("case-1", step);
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ "x-judge-token": "judge-secret" });
  });

  it("is not asked for without one: no header is sent", async () => {
    browser("");
    const fetch = stubFetch({ case_id: "c", seq: 1 });
    await openCase(crypto.randomUUID());
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({ "content-type": "application/json" });
  });

  it("says what to do when a step is refused for want of it", async () => {
    browser("");
    stubFetch({ error: "this demo link is missing its access token, or the token is wrong" }, 401);
    await expect(runStep("case-1", step)).rejects.toThrow(/Open the link you were given again/);
  });
});
