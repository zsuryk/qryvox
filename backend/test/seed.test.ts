import { randomUUID } from "node:crypto";
import { EventPayloadResponse, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { CONTRADICTIONS_SYSTEM_PROMPT } from "../src/steps/contradictions";
import { EXTRACT_SYSTEM_PROMPT } from "../src/steps/extract";
import { board, caseWithPack, pipelineLlm, REPLIES, runPipeline } from "./fake-pipeline";
import { setup, type TestApp } from "./helpers";

// Find-similar's seeded re-run (#64): extract or contradictions, looking for more like one passage.
const seed = { document_id: "factsheet", page: 1, quote: "Management fee: 0.85% per annum." };

function seeded(t: TestApp, caseId: string, step: string, inputRunId: string | null, body: object = { seed }, stepRunId = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, step, input_run_id: inputRunId, ...body });
}

async function payloadAt(t: TestApp, caseId: string, seq: number) {
  return EventPayloadResponse.parse(await (await t.request("GET", `/cases/${caseId}/events/${seq}/payload`)).json()).payload;
}

describe("a seeded extract", () => {
  it("reads the documents, puts the seed in the prompt, and records it on step.started and step.completed", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);

    const res = await seeded(t, caseId, "extract", null);

    expect(res.status).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result).toMatchObject({ step: "extract", prompt_version: "extract@1" });
    expect(result.output).toEqual(REPLIES.extract);

    const system = llm.calls[0]![0]!.content;
    expect(system.startsWith(EXTRACT_SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain(`document_id: factsheet (factsheet), page 1\n"${seed.quote}"`);
    // The documents are still the whole pack.
    expect(llm.calls[0]![1]!.content).toContain("=== document_id: fee-table ===");

    const { events, state } = await board(t, caseId);
    const runEvents = events.filter((e) => e.step_run_id === result.step_run_id);
    expect(runEvents.map((e) => [e.type, "seed" in e.payload && e.payload.seed])).toEqual([
      ["step.started", seed],
      ["step.completed", seed],
    ]);
    expect(await payloadAt(t, caseId, result.seq)).toMatchObject({ seed, input_run_id: null });
    expect(state.stepRuns).toEqual([]);
    expect(state.seededRuns).toEqual([expect.objectContaining({ step: "extract", status: "completed", seed })]);
  });

  it("leaves the unseeded prompt exactly as it was", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);

    await seeded(t, caseId, "extract", null, {});

    expect(llm.calls[0]![0]!.content).toBe(EXTRACT_SYSTEM_PROMPT);
  });
});

describe("a seeded contradictions run", () => {
  it("consumes the decompose run it is given, with the seed in the prompt, and leaves the findings as they were", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const before = await board(t, caseId);

    const res = await seeded(t, caseId, "contradictions", runs.decompose.step_run_id);

    expect(res.status).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result.output).toEqual(REPLIES.contradictions);
    const system = llm.calls.at(-1)![0]!.content;
    expect(system.startsWith(CONTRADICTIONS_SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain(`"${seed.quote}"`);

    const after = await board(t, caseId);
    const appended = after.events.slice(before.events.length);
    expect(appended.map((e) => e.type)).toEqual(["step.started", "step.completed"]);
    expect(appended.every((e) => e.type.startsWith("step.") && "seed" in e.payload)).toBe(true);
    expect(after.state.findings).toEqual(before.state.findings);
    expect(after.state.stepRuns).toEqual(before.state.stepRuns);
  });

  it("is no step's input: a findings or compliance run fed it is refused before any model call", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const run = StepResult.parse(await (await seeded(t, caseId, "contradictions", runs.decompose.step_run_id)).json());
    const calls = llm.calls.length;

    for (const step of ["findings", "compliance"]) {
      const res = await seeded(t, caseId, step, run.step_run_id, {});
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/seeded find-similar run/);
    }
    const extract = StepResult.parse(await (await seeded(t, caseId, "extract", null)).json());
    expect((await seeded(t, caseId, "decompose", extract.step_run_id, {})).status).toBe(409);
    expect(llm.calls).toHaveLength(calls + 1);
  });

  it("a retry under the same step_run_id makes no second model call", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const stepRunId = randomUUID();

    const first = await (await seeded(t, caseId, "contradictions", runs.decompose.step_run_id, { seed }, stepRunId)).json();
    const second = await seeded(t, caseId, "contradictions", runs.decompose.step_run_id, { seed }, stepRunId);

    expect(await second.json()).toEqual(first);
    expect(llm.calls).toHaveLength(5);
  });
});

describe("a seed the server refuses", () => {
  it("is 400 on any step but extract and contradictions, with nothing appended", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const runs = await runPipeline(t, caseId);
    const before = (await board(t, caseId)).events.length;

    for (const [step, input] of [
      ["decompose", runs.extract.step_run_id],
      ["findings", runs.contradictions.step_run_id],
      ["compliance", runs.contradictions.step_run_id],
      ["attributes", null],
    ] as const) {
      const res = await seeded(t, caseId, step, input);
      expect(res.status, step).toBe(400);
    }
    expect(llm.calls).toHaveLength(4);
    expect((await board(t, caseId)).events).toHaveLength(before);
  });

  it("is 400 when the quote is not on its cited page, before any model call or event", async () => {
    const llm = pipelineLlm();
    const t = await setup({ llm });
    const caseId = await caseWithPack(t);
    const before = (await board(t, caseId)).events.length;

    for (const wrong of [
      { ...seed, page: 2 },
      { ...seed, quote: "Management fee: 0.75% per annum." },
      { ...seed, document_id: "deck" },
    ]) {
      const res = await seeded(t, caseId, "extract", null, { seed: wrong });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/seed's quote does not appear/);
    }
    expect(llm.calls).toHaveLength(0);
    expect((await board(t, caseId)).events).toHaveLength(before);
  });

  it("compares the quote with whitespace normalised, as grounding does", async () => {
    const t = await setup({ llm: pipelineLlm() });
    const caseId = await caseWithPack(t);

    const res = await seeded(t, caseId, "extract", null, { seed: { ...seed, quote: "  Management   fee:\n0.85% per annum. " } });

    expect(res.status).toBe(200);
  });
});
