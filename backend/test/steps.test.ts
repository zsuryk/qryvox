import { randomUUID } from "node:crypto";
import { EventPage, EventPayloadResponse, StepFailure, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { EXTRACT_REPLY, FakeLlm, sampleDocument, setup, type TestApp } from "./helpers";

async function caseWithDocument(t: TestApp) {
  const caseId = await t.openCase();
  await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document: sampleDocument() });
  return caseId;
}

function runExtract(t: TestApp, caseId: string, stepRunId = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, step: "extract", input_run_id: null });
}

async function eventTypes(t: TestApp, caseId: string) {
  const { events } = EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json());
  return events.map((e) => e.type);
}

describe("running a step", () => {
  it("appends step.started and step.completed carrying the step, model and prompt version", async () => {
    const llm = new FakeLlm(() => EXTRACT_REPLY);
    const t = await setup({ llm });
    const caseId = await caseWithDocument(t);

    const res = await runExtract(t, caseId);

    expect(res.status).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result).toMatchObject({ step: "extract", model: "fake-model", prompt_version: "extract@1" });
    expect(result.output).toEqual(JSON.parse(EXTRACT_REPLY));
    expect(await eventTypes(t, caseId)).toEqual(["case.opened", "document.ingested", "step.started", "step.completed"]);

    const completed = EventPayloadResponse.parse(
      await (await t.request("GET", `/cases/${caseId}/events/${result.seq}/payload`)).json(),
    );
    expect(completed.payload).toMatchObject({ step: "extract", model: "fake-model", prompt_version: "extract@1" });
    expect(completed.payload.raw_response).toEqual({ choices: [{ message: { content: EXTRACT_REPLY } }] });
  });

  it("a repeated step call spends no tokens and returns the identical result", async () => {
    const llm = new FakeLlm(() => EXTRACT_REPLY);
    const t = await setup({ llm });
    const caseId = await caseWithDocument(t);
    const stepRunId = randomUUID();

    const first = await (await runExtract(t, caseId, stepRunId)).json();
    const second = await runExtract(t, caseId, stepRunId);

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(first);
    expect(llm.calls).toHaveLength(1);
    expect(await eventTypes(t, caseId)).toEqual(["case.opened", "document.ingested", "step.started", "step.completed"]);
  });

  it("two concurrent identical calls complete the run once and both callers get the same result", async () => {
    // Both calls pass the "already completed?" check before either commits.
    const llm = new FakeLlm(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return EXTRACT_REPLY;
    });
    const t = await setup({ llm });
    const caseId = await caseWithDocument(t);
    const stepRunId = randomUUID();

    const [a, b] = await Promise.all([runExtract(t, caseId, stepRunId), runExtract(t, caseId, stepRunId)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    const types = await eventTypes(t, caseId);
    expect(types.filter((type) => type === "step.completed")).toHaveLength(1);
    // The loser's transaction rolled back whole: nothing of it is left but its step.started.
    expect(types).toEqual(["case.opened", "document.ingested", "step.started", "step.started", "step.completed"]);
  });

  it("holds no write lock across the model call", async () => {
    // While the model is thinking, another request appends to the log. If the step held the write
    // lock during the call this append would wait for the step, which waits for it: a deadlock.
    const ctx = {} as { t: TestApp; otherCase: string };
    const llm = new FakeLlm(async () => {
      const res = await ctx.t.request("POST", `/cases/${ctx.otherCase}/documents`, {
        event_id: randomUUID(),
        document: sampleDocument(),
      });
      expect(res.status).toBe(201);
      return EXTRACT_REPLY;
    });
    const t = (ctx.t = await setup({ llm }));
    const caseId = await caseWithDocument(t);
    ctx.otherCase = await t.openCase();

    expect((await runExtract(t, caseId)).status).toBe(200);
    expect(await eventTypes(t, ctx.otherCase)).toEqual(["case.opened", "document.ingested"]);
  });

  it("never exposes the prompt: events carry only its version", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY) });
    const caseId = await caseWithDocument(t);
    await runExtract(t, caseId);

    const bodies = await Promise.all(
      [1, 2, 3, 4].map(async (seq) => (await t.request("GET", `/cases/${caseId}/events/${seq}/payload`)).text()),
    );
    const list = await (await t.request("GET", `/cases/${caseId}/events`)).text();
    for (const body of [...bodies, list]) {
      expect(body).not.toContain(EXTRACT_SYSTEM_PROMPT.slice(0, 60));
    }
  });
});

describe("a failing step", () => {
  it("records unparseable model output as step.failed, not a partial success", async () => {
    const t = await setup({ llm: new FakeLlm(() => "I could not find any statements, sorry.") });
    const caseId = await caseWithDocument(t);

    const res = await runExtract(t, caseId);

    expect(res.status).toBe(422);
    expect(StepFailure.parse(await res.json()).error).toMatch(/did not match the extract schema/);
    expect(await eventTypes(t, caseId)).toEqual(["case.opened", "document.ingested", "step.started", "step.failed"]);
  });

  it("fails the run when no extracted quote appears on its cited page", async () => {
    const invented = JSON.stringify({ statements: [{ document_id: "factsheet", page: 1, quote: "Guaranteed 12% returns." }] });
    const t = await setup({ llm: new FakeLlm(() => invented) });
    const caseId = await caseWithDocument(t);

    const res = await runExtract(t, caseId);

    expect(res.status).toBe(422);
    expect(StepFailure.parse(await res.json()).error).toMatch(/appear verbatim/);
  });

  it("drops quotes that are not on their cited page and keeps the grounded ones", async () => {
    const mixed = JSON.stringify({
      statements: [
        { document_id: "factsheet", page: 1, quote: "Management fee:   0.85% per annum." },
        { document_id: "factsheet", page: 2, quote: "Management fee: 0.85% per annum." },
        { document_id: "ppm", page: 1, quote: "Management fee: 0.85% per annum." },
      ],
    });
    const t = await setup({ llm: new FakeLlm(() => mixed) });
    const caseId = await caseWithDocument(t);

    const result = StepResult.parse(await (await runExtract(t, caseId)).json());

    expect(result.output).toEqual({
      statements: [{ document_id: "factsheet", page: 1, quote: "Management fee:   0.85% per annum." }],
    });
  });

  it("records an unreachable model as step.failed and lets the same run id retry", async () => {
    const llm = new FakeLlm((_, call) => (call === 1 ? new Error("connect ECONNREFUSED") : EXTRACT_REPLY));
    const t = await setup({ llm });
    const caseId = await caseWithDocument(t);
    const stepRunId = randomUUID();

    const failed = await runExtract(t, caseId, stepRunId);
    const retried = await runExtract(t, caseId, stepRunId);

    expect(failed.status).toBe(502);
    expect(retried.status).toBe(200);
    expect(llm.calls).toHaveLength(2);
    expect(await eventTypes(t, caseId)).toEqual([
      "case.opened",
      "document.ingested",
      "step.started",
      "step.failed",
      "step.started",
      "step.completed",
    ]);
  });
});

describe("a step that cannot run", () => {
  it("is 409 before any documents are ingested, with nothing appended and no model call", async () => {
    const llm = new FakeLlm(() => EXTRACT_REPLY);
    const t = await setup({ llm });
    const caseId = await t.openCase();

    expect((await runExtract(t, caseId)).status).toBe(409);
    expect(llm.calls).toHaveLength(0);
    expect(await eventTypes(t, caseId)).toEqual(["case.opened"]);
  });

  it("is 503 when no model is configured", async () => {
    const t = await setup({ llm: null });
    const caseId = await caseWithDocument(t);

    expect((await runExtract(t, caseId)).status).toBe(503);
  });

  it("is 404 for an unknown case", async () => {
    const t = await setup({ llm: new FakeLlm(() => EXTRACT_REPLY) });
    expect((await runExtract(t, randomUUID())).status).toBe(404);
  });
});
