import { randomUUID } from "node:crypto";
import { EventPage, type IntentChip, resolveIntent, StepFailure, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/llm";
import { PARSE_SYSTEM_PROMPT } from "../src/steps/parse";
import { FakeLlm, setup, type TestApp } from "./helpers";

// The parse step (#63): the analyst's words to intent chips. The fake model answers by the words it is
// given, as a correct model would.
const feesInPpm: IntentChip = { category: "fees", authority: "ppm", step_kind: null };
const ANSWERS: Record<string, unknown> = {
  "fees in the PPM": { chips: [feesInPpm] },
  "what a lovely afternoon": { chips: [] },
};

function wordsOf(messages: ChatMessage[]) {
  return messages[1]!.content.replace("The analyst typed:\n", "");
}

function parseLlm(reply: (words: string) => unknown = (words) => ANSWERS[words]) {
  return new FakeLlm((messages) => {
    expect(messages[0]!.content).toBe(PARSE_SYSTEM_PROMPT);
    const answer = reply(wordsOf(messages));
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  });
}

function runParse(t: TestApp, caseId: string, intent: string, stepRunId = randomUUID()) {
  return t.request("POST", `/cases/${caseId}/steps`, { step_run_id: stepRunId, step: "parse", input_run_id: null, intent });
}

async function events(t: TestApp, caseId: string) {
  return EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json()).events;
}

describe("the parse step", () => {
  it("reads 'fees in the PPM' as one chip, and records the words on the run's events", async () => {
    const t = await setup({ llm: parseLlm() });
    const caseId = await t.openCase();

    const res = await runParse(t, caseId, "fees in the PPM");

    expect(res.status).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result).toMatchObject({ step: "parse", prompt_version: "parse@1", output: { chips: [feesInPpm] } });
    const log = await events(t, caseId);
    expect(log.slice(1).map((e) => [e.type, "intent" in e.payload && e.payload.intent])).toEqual([
      ["step.started", "fees in the PPM"],
      ["step.completed", "fees in the PPM"],
    ]);
  });

  it("gives no chips for words that name nothing, and that is a completed run", async () => {
    const t = await setup({ llm: parseLlm() });
    const caseId = await t.openCase();

    const res = await runParse(t, caseId, "what a lovely afternoon");

    expect(res.status).toBe(200);
    expect(StepResult.parse(await res.json()).output).toEqual({ chips: [] });
  });

  it("fails a malformed reply with 422 and step.failed", async () => {
    for (const reply of ["the fees, I think", { chip: feesInPpm }, { chips: [{ category: 3 }] }]) {
      const t = await setup({ llm: parseLlm(() => reply) });
      const caseId = await t.openCase();

      const res = await runParse(t, caseId, "fees in the PPM");

      expect(res.status).toBe(422);
      expect(StepFailure.parse(await res.json()).error).toBe("model output did not match the parse schema");
      expect((await events(t, caseId)).map((e) => e.type)).toEqual(["case.opened", "step.started", "step.failed"]);
    }
  });

  it("keeps only chips within the vocabulary, spelled as it spells them, once each", async () => {
    const reply = {
      chips: [
        { category: "Fees", authority: "PPM", step_kind: null },
        { category: "fees", authority: "ppm" },
        { category: null, authority: "Fee table", step_kind: "" },
        { category: "liquidity", authority: "ppm", step_kind: null },
        { category: null, authority: null, step_kind: "parse" },
        { category: null, authority: null, step_kind: null },
      ],
    };
    const t = await setup({ llm: parseLlm(() => reply) });
    const caseId = await t.openCase();

    const result = StepResult.parse(await (await runParse(t, caseId, "fees in the PPM, and the fee table")).json());

    expect(result.output).toEqual({ chips: [feesInPpm, { category: null, authority: "fee_table", step_kind: null }] });
  });

  it("a retry with the same step_run_id makes no second model call", async () => {
    const llm = parseLlm();
    const t = await setup({ llm });
    const caseId = await t.openCase();
    const stepRunId = randomUUID();

    const first = await (await runParse(t, caseId, "fees in the PPM", stepRunId)).json();
    const second = await runParse(t, caseId, "fees in the PPM", stepRunId);

    expect(await second.json()).toEqual(first);
    expect(llm.calls).toHaveLength(1);
  });

  it("takes no input run", async () => {
    const llm = parseLlm();
    const t = await setup({ llm });
    const caseId = await t.openCase();

    const res = await t.request("POST", `/cases/${caseId}/steps`, {
      step_run_id: randomUUID(),
      step: "parse",
      input_run_id: randomUUID(),
      intent: "fees in the PPM",
    });

    expect(res.status).toBe(409);
    expect(llm.calls).toHaveLength(0);
  });

  it("resolves to the analyst's own chips plus the parsed ones", async () => {
    const t = await setup({ llm: parseLlm() });
    const caseId = await t.openCase();
    const manual: IntentChip[] = [{ category: "risk", authority: null, step_kind: null }];

    const result = StepResult.parse(await (await runParse(t, caseId, "fees in the PPM")).json());

    expect(resolveIntent(await events(t, caseId), result.step_run_id, manual)).toEqual({ chips: [...manual, feesInPpm], source: "parse" });
  });
});
