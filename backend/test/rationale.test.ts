import { randomUUID } from "node:crypto";
import { activeFindings, EventPage, fold, rationaleFor, RationaleOutput, StepFailure, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/llm";
import { caseWithPack, pipelineLlm, runPipeline, step } from "./fake-pipeline";
import { setup, type TestApp } from "./helpers";
import { larkspurLlm, pack } from "./larkspur";

// The rationale step (#62) on the real Larkspur pack, whose findings run puts two fee findings on the
// board: f1, the management fee the factsheet and the fee table state differently; f2, the exit charge the
// deck denies and the fee table charges.
const MANAGEMENT_FEE = 'The fee table\'s "1.25% of net asset value" means an investor pays more than the factsheet suggests.';
const EXIT_CHARGE = "An investor who leaves within 24 months could pay 2% they were told they would not.";

let reply: unknown = {};
let answer: (messages: ChatMessage[]) => unknown = () => reply;

async function larkspurFindings() {
  const t = await setup({ llm: larkspurLlm((messages) => answer(messages)) });
  const caseId = await t.openCase();
  for (const document of pack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  let input: string | null = null;
  for (const step of ["extract", "decompose", "contradictions", "findings"]) input = await run(t, caseId, step, input);
  const state = fold(await events(t, caseId));
  const [fee, exit] = activeFindings(state);
  expect(fee!.citation.quote).toContain("0.85%");
  expect(exit!.citation.document_id).toBe("deck");
  return { t, caseId, findingsRunId: input!, fee: fee!, exit: exit! };
}

async function run(t: TestApp, caseId: string, step: string, input: string | null) {
  const res = await t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });
  expect(res.status, await res.clone().text()).toBe(200);
  return StepResult.parse(await res.json()).step_run_id;
}

async function events(t: TestApp, caseId: string) {
  return EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json()).events;
}

const rationaleCall = (t: TestApp, caseId: string, inputRunId: string | null) =>
  t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step: "rationale", input_run_id: inputRunId });

async function rationalesFrom(entries: unknown[]) {
  const { t, caseId, findingsRunId, fee, exit } = await larkspurFindings();
  reply = { rationales: entries };
  const res = await rationaleCall(t, caseId, findingsRunId);
  return { res, t, caseId, fee, exit };
}

describe("the rationale step", () => {
  it("words every finding of the run in one call, under rationale@1, and the card reads it back", async () => {
    let calls = 0;
    answer = () => {
      calls++;
      return reply;
    };
    try {
      const { res, t, caseId, fee, exit } = await rationalesFrom([
        { finding: "f1", text: MANAGEMENT_FEE },
        { finding: "f2", text: EXIT_CHARGE },
      ]);
      expect(res.status, await res.clone().text()).toBe(200);
      const result = StepResult.parse(await res.json());
      expect(result.prompt_version).toBe("rationale@1");
      expect(calls).toBe(1);
      expect(RationaleOutput.parse(result.output).rationales).toEqual([
        { finding_id: fee.finding_id, text: MANAGEMENT_FEE },
        { finding_id: exit.finding_id, text: EXIT_CHARGE },
      ]);
      const log = await events(t, caseId);
      expect(rationaleFor(log, fee.finding_id)).toBe(MANAGEMENT_FEE);
      expect(rationaleFor(log, exit.finding_id)).toBe(EXIT_CHARGE);
    } finally {
      answer = () => reply;
    }
  });

  it("shows the model each finding's ref, claim and both quotes", async () => {
    let sent = "";
    answer = (messages) => {
      sent = messages.at(-1)!.content;
      return { rationales: [{ finding: "f1", text: MANAGEMENT_FEE }] };
    };
    try {
      expect((await rationalesFrom([])).res.status).toBe(200);
    } finally {
      answer = () => reply;
    }
    expect(sent).toContain("- f1: contradiction, fees, high severity: The factsheet states a 0.85% management fee");
    expect(sent).toContain('quote (factsheet, page 1): "Annual management fee: 0.85% per annum"');
    expect(sent).toContain('counterpart (fee-table, page 1): "Annual management fee: 1.25% of net asset value"');
    expect(sent).toContain("- f2:");
  });

  it("drops a rationale for a finding the run does not have, and keeps one rationale per finding", async () => {
    const { res, fee } = await rationalesFrom([
      { finding: "f9", text: "A finding nobody raised." },
      { finding: "f1", text: MANAGEMENT_FEE },
      { finding: "F1", text: "A second go at the same finding." },
      { text: "No ref at all." },
    ]);
    expect(res.status).toBe(200);
    expect(RationaleOutput.parse(StepResult.parse(await res.json()).output).rationales).toEqual([{ finding_id: fee.finding_id, text: MANAGEMENT_FEE }]);
  });

  it("may name a document its finding's claim names, though the finding does not cite it", async () => {
    // An unsupported claim is about what the PPM does not say, and its card shows the claim saying so.
    const claim = "The factsheet states a 0.85% management fee that no PPM statement supports.";
    // (This pack has no deck; that a document neither cited nor named is refused is tested on Larkspur below.)
    const named = async (text: string) => {
      const findings = { findings: [{ issue: 1, severity: "high", claim }] };
      const t = await setup({ llm: pipelineLlm({ findings, rationale: { rationales: [{ finding: "f1", text }] } }) });
      const caseId = await caseWithPack(t);
      const runs = await runPipeline(t, caseId);
      return (await step(t, caseId, "rationale", runs.findings.step_run_id)).status;
    };
    expect(await named("Nothing in the PPM backs the fee the factsheet shows.")).toBe(200);
  });

  it("compares numbers by value: the fee table's 2.00% may be written 2%", async () => {
    const { res, exit } = await rationalesFrom([{ finding: "f2", text: EXIT_CHARGE }]);
    expect(res.status).toBe(200);
    expect(RationaleOutput.parse(StepResult.parse(await res.json()).output).rationales[0]!.finding_id).toBe(exit.finding_id);
  });
});

describe("rationales it drops", () => {
  // Each is dropped while a faithful one for the other finding stands; alone, it fails the run.
  async function dropped(text: string) {
    const { res, exit } = await rationalesFrom([
      { finding: "f1", text },
      { finding: "f2", text: EXIT_CHARGE },
    ]);
    expect(res.status).toBe(200);
    expect(RationaleOutput.parse(StepResult.parse(await res.json()).output).rationales.map((r) => r.finding_id)).toEqual([exit.finding_id]);
  }

  it("one that quotes words its finding's passages do not say", async () => {
    await dropped('The factsheet promises "no hidden charges of any kind", which the fee table contradicts.');
  });

  it("one that quotes the other finding's passage", async () => {
    await dropped('Like "No entry or exit charges.", this understates what an investor pays.');
  });

  it("one that states a number its passages do not hold", async () => {
    await dropped("An investor could pay 0.4% a year more than the factsheet shows.");
  });

  it("one that names a document its finding does not cite", async () => {
    await dropped("Unlike the deck, the factsheet understates what an investor pays.");
  });

  it("and fails the run when none holds, recording why", async () => {
    const { res } = await rationalesFrom([
      { finding: "f1", text: "An investor could pay 0.4% a year more." },
      { finding: "f3", text: "Nothing." },
    ]);
    expect(res.status).toBe(422);
    const error = StepFailure.parse(await res.json()).error;
    expect(error).toMatch(/f1 states 0.4, which its finding's passages do not/);
    expect(error).toMatch(/f3 is not a finding of this run/);
  });

  it("fails the run on a reply that is not a list of rationales", async () => {
    const { res } = await rationalesFrom("nonsense" as unknown as unknown[]);
    expect(res.status).toBe(422);
  });
});

describe("what it words", () => {
  it("needs a completed findings run", async () => {
    const { t, caseId } = await larkspurFindings();
    expect((await rationaleCall(t, caseId, null)).status).toBe(409);
    expect((await rationaleCall(t, caseId, randomUUID())).status).toBe(409);
    const extract = fold(await events(t, caseId)).stepRuns.find((r) => r.step === "extract")!;
    expect((await rationaleCall(t, caseId, extract.stepRunId)).status).toBe(409);
  });

  it("refuses a superseded findings run, and a card of a superseded finding shows no rationale", async () => {
    const { t, caseId, findingsRunId, fee } = await larkspurFindings();
    reply = { rationales: [{ finding: "f1", text: MANAGEMENT_FEE }] };
    expect((await rationaleCall(t, caseId, findingsRunId)).status).toBe(200);
    const contradictions = fold(await events(t, caseId)).stepRuns.find((r) => r.step === "contradictions")!;
    await run(t, caseId, "findings", contradictions.stepRunId);

    expect((await rationaleCall(t, caseId, findingsRunId)).status).toBe(409);
    expect(rationaleFor(await events(t, caseId), fee.finding_id)).toBeNull();
  });
});
