import { randomUUID } from "node:crypto";
import { activeFindings, AppendResponse, dispositionOf, ErrorResponse } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { board, caseWithPack, pipelineLlm, runPipeline, step } from "./fake-pipeline";
import { setup, type TestApp } from "./helpers";

// A case through all four steps, with the one finding it produced.
async function caseWithFinding() {
  const t = await setup({ llm: pipelineLlm() });
  const caseId = await caseWithPack(t);
  const runs = await runPipeline(t, caseId);
  const [finding] = activeFindings((await board(t, caseId)).state);
  return { t, caseId, runs, findingId: finding!.finding_id };
}

function decide(t: TestApp, caseId: string, findingId: string, disposition: string, eventId = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/dispositions`, { event_id: eventId, finding_id: findingId, disposition });
}

async function countDispositions(t: TestApp, caseId: string) {
  return (await board(t, caseId)).events.filter((e) => e.type === "disposition.changed").length;
}

describe("disposing a finding", () => {
  it("appends one disposition.changed attributed to the analyst", async () => {
    const { t, caseId, findingId } = await caseWithFinding();

    const res = await decide(t, caseId, findingId, "approved");

    expect(res.status).toBe(201);
    const { seq } = AppendResponse.parse(await res.json());
    const { events, state } = await board(t, caseId);
    expect(events.at(-1)).toMatchObject({
      seq,
      type: "disposition.changed",
      actor: "demo-analyst",
      step_run_id: null,
      payload: { finding_id: findingId, disposition: "approved" },
    });
    expect(dispositionOf(state, findingId)).toMatchObject({ disposition: "approved", actor: "demo-analyst" });
  });

  it("lets the analyst change their mind; the latest decision wins and both stay in the log", async () => {
    const { t, caseId, findingId } = await caseWithFinding();

    await decide(t, caseId, findingId, "approved");
    await decide(t, caseId, findingId, "dismissed");

    const { state } = await board(t, caseId);
    expect(dispositionOf(state, findingId)?.disposition).toBe("dismissed");
    expect(await countDispositions(t, caseId)).toBe(2);
  });

  it("keeps a dismissed finding on the board, marked dismissed", async () => {
    const { t, caseId, findingId } = await caseWithFinding();

    await decide(t, caseId, findingId, "dismissed");

    const { state } = await board(t, caseId);
    expect(activeFindings(state).map((f) => f.finding_id)).toEqual([findingId]);
    expect(dispositionOf(state, findingId)?.disposition).toBe("dismissed");
  });

  it("a retried decision with the same event id appends nothing", async () => {
    const { t, caseId, findingId } = await caseWithFinding();
    const eventId = randomUUID();

    const first = await decide(t, caseId, findingId, "approved", eventId);
    const second = await decide(t, caseId, findingId, "approved", eventId);

    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(await countDispositions(t, caseId)).toBe(1);
  });
});

describe("a decision that cannot be recorded", () => {
  it("is 404 for a finding the case never produced, and appends nothing", async () => {
    const { t, caseId } = await caseWithFinding();

    const res = await decide(t, caseId, randomUUID(), "approved");

    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json()).error).toMatch(/not found/);
    expect(await countDispositions(t, caseId)).toBe(0);
  });

  it("is 409 for a finding a later run superseded, though a retry of an earlier decision still succeeds", async () => {
    const { t, caseId, runs, findingId } = await caseWithFinding();
    const eventId = randomUUID();
    await decide(t, caseId, findingId, "approved", eventId);
    await step(t, caseId, "findings", runs.contradictions.step_run_id);

    const late = await decide(t, caseId, findingId, "dismissed");
    const retry = await decide(t, caseId, findingId, "approved", eventId);

    expect(late.status).toBe(409);
    expect(retry.status).toBe(201);
    expect(await countDispositions(t, caseId)).toBe(1);
  });

  it("is 400 for anything but approved or dismissed", async () => {
    const { t, caseId, findingId } = await caseWithFinding();

    expect((await decide(t, caseId, findingId, "rejected")).status).toBe(400);
    expect((await decide(t, caseId, findingId, "pending")).status).toBe(400);
  });

  it("is 404 for an unknown case", async () => {
    const t = await setup();
    expect((await decide(t, randomUUID(), randomUUID(), "approved")).status).toBe(404);
  });
});

describe("no step decides", () => {
  it("a full pipeline run leaves every finding undecided until the analyst acts", async () => {
    const { t, caseId } = await caseWithFinding();

    const { state } = await board(t, caseId);
    expect(state.dispositions).toEqual([]);
    expect(await countDispositions(t, caseId)).toBe(0);
  });
});
