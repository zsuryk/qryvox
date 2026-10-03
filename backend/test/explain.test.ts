import { randomUUID } from "node:crypto";
import {
  activeFindings,
  type CaseAdvice,
  type ClientProfile,
  EventPage,
  Explanation,
  fold,
  StepFailure,
  StepResult,
} from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/llm";
import { setup, type TestApp } from "./helpers";
import { larkspurLlm, pack } from "./larkspur";

const chan: ClientProfile = {
  client_id: "persona-chan",
  goal: "income",
  horizon_years: 2,
  risk_level: 2,
  knowledge: "novice",
  relies_on_income: true,
  may_need_cash_at_short_notice: true,
  exclusions: [],
};

type Depth = { summary: string; passages: { ref: string; text: string }[] };

// A faithful explanation: every reason and disclosure once, quoting only its own citation, stating only
// numbers its quote or the client's answer holds. Tests bend one piece of it at a time.
function faithful(advice: CaseAdvice): Record<string, Depth> {
  const passages = [
    ...advice.reasons.map((r, i) => ({ ref: `r${i}`, text: `This is about rule ${r.rule}; the outcome is ${r.effect}.` })),
    ...advice.disclosures.map((_, i) => ({ ref: `d${i}`, text: "You should know about this charge." })),
  ];
  const depth = (summary: string): Depth => ({ summary, passages });
  return {
    novice: depth("This fund does not fit what you told us."),
    informed: depth("The fund does not suit your horizon, risk level or need for access to cash."),
    expert: depth("Not suitable: horizon, risk level and liquidity rules fail."),
  };
}

const bend = (advice: CaseAdvice, fn: (passages: Depth["passages"], depth: Depth) => void) => {
  const depths = faithful(advice);
  const novice = depths.novice!;
  depths.novice = { ...novice, passages: novice.passages.map((p) => ({ ...p })) };
  fn(depths.novice.passages, depths.novice);
  return { depths };
};

let reply: unknown = {};
// How the fake model answers explain; tests that need to see the prompt replace it.
let answer: (messages: ChatMessage[]) => unknown = () => reply;

// A verified Larkspur case with Mrs Chan's advice drafted; optionally a finding dismissed first.
async function chanAdvice({ dismissExitCharge = false, compliance = false, profile = chan } = {}) {
  const t = await setup({ llm: larkspurLlm((messages) => answer(messages)) });
  const caseId = await t.openCase();
  for (const document of pack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  let input: string | null = null;
  const steps = compliance ? ["extract", "decompose", "contradictions", "compliance", "findings"] : ["extract", "decompose", "contradictions", "findings"];
  for (const step of steps) input = await run(t, caseId, step, input);
  await run(t, caseId, "attributes", null);
  if (dismissExitCharge) {
    const exit = activeFindings(await folded(t, caseId)).find((f) => f.citation.document_id === "deck")!;
    await t.request("POST", `/cases/${caseId}/dispositions`, { event_id: randomUUID(), finding_id: exit.finding_id, disposition: "dismissed" });
  }
  await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile });
  const adviceId = randomUUID();
  await t.request("POST", `/cases/${caseId}/advice`, { event_id: adviceId, client_id: "persona-chan" });
  const advice = (await folded(t, caseId)).advice.find((a) => a.adviceId === adviceId)!;
  return { t, caseId, adviceId, advice };
}

async function run(t: TestApp, caseId: string, step: string, input: string | null) {
  const res = await t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });
  expect(res.status, await res.clone().text()).toBe(200);
  return StepResult.parse(await res.json()).step_run_id;
}

async function folded(t: TestApp, caseId: string) {
  return fold(EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json()).events);
}

const explainCall = (t: TestApp, caseId: string, adviceId: string | null) =>
  t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step: "explain", input_run_id: adviceId });

async function refused(fn: (passages: Depth["passages"], depth: Depth) => void) {
  const { t, caseId, adviceId, advice } = await chanAdvice();
  reply = bend(advice, fn);
  const res = await explainCall(t, caseId, adviceId);
  expect(res.status).toBe(422);
  return StepFailure.parse(await res.json()).error;
}

describe("the explain step", () => {
  it("stores all three depths for the advice under explain@1", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice();
    reply = { depths: faithful(advice) };

    const res = await explainCall(t, caseId, adviceId);
    expect(res.status, await res.clone().text()).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result.prompt_version).toBe("explain@1");
    const explanation = Explanation.parse(result.output);
    expect(explanation.advice_id).toBe(adviceId);
    expect(explanation.depths.novice.passages).toHaveLength(advice.reasons.length + advice.disclosures.length);
  });

  it("shows the model each reason's rule, outcome, the client's answer and its quote, and records the advice", async () => {
    let sent = "";
    const { t, caseId, adviceId, advice } = await chanAdvice();
    answer = (messages) => {
      sent = messages.at(-1)!.content;
      return { depths: faithful(advice) };
    };
    try {
      expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
    } finally {
      answer = () => reply;
    }

    expect(sent).toContain("Verdict: not suitable");
    expect(sent).toContain('- r0: rule S1 "Long enough horizon"');
    expect(sent).toContain("outcome: blocks");
    expect(sent).toContain("client's answer (horizon_years): 2");
    expect(sent).toContain("over at least five years");
    expect(sent).toContain("product risk level, mapped from its attributes: 3");
    expect((await folded(t, caseId)).stepRuns.find((r) => r.step === "explain")?.inputRunId).toBe(adviceId);
  });

  it("accepts a passage that quotes its citation exactly and states the numbers it holds", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice();
    reply = bend(advice, (passages) => {
      passages[0]!.text = 'The fund is meant to be held "over at least five years", and you told us two.';
      passages[1]!.text = "You chose risk level 2; this fund is level 3.";
      const fee = advice.disclosures.findIndex((d) => d.citation.quote.includes("1.25%"));
      passages[advice.reasons.length + fee]!.text = "The factsheet says 0.85% a year, but the fee table charges 1.25%.";
    });

    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
  });
});

describe("explanations it refuses", () => {
  it("one that leaves a reason unexplained", async () => {
    expect(await refused((p) => p.splice(2, 1))).toMatch(/novice: r2 is explained 0 times, not once/);
  });

  it("one that invents a reason the advice does not have", async () => {
    expect(await refused((p) => p.push({ ref: "r99", text: "Also, it is a great fund." }))).toMatch(/r99 is not in the advice/);
  });

  it("one that quotes words its citation does not say", async () => {
    const error = await refused((p) => (p[0]!.text = 'The fund promises "guaranteed growth every single year".'));
    expect(error).toMatch(/r0 quotes "guaranteed growth every single year"/);
  });

  it("one that names a rule the advice does not apply", async () => {
    expect(await refused((p) => (p[0]!.text = "Under S5 this fails."))).toMatch(/names rule S5/);
  });

  it("forgives punctuation at the ends of a quote, which is the sentence's, but not a changed word", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice();
    const quote = advice.reasons[0]!.citation!.quote;
    // Kimi K3: its own comma inside the quotation marks, the clause number dropped.
    reply = bend(advice, (p) => (p[0]!.text = `The fund says "${quote.replace(/^3\.1 /, "").replace(/\.$/, "")}," and you said two.`));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);

    reply = bend(advice, (p) => (p[0]!.text = `The fund says "${quote.replace("five", "three")}".`));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(422);
  });

  it("lets a disclosure name the rule its own policy gap breaks", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice({ compliance: true });
    const gap = advice.disclosures.findIndex((d) => d.citation.quote.startsWith("7.2"));
    expect(gap).toBeGreaterThanOrEqual(0);
    reply = bend(advice, (p) => (p[advice.reasons.length + gap]!.text = "Under the institution's rule P3, the factsheet should list this charge."));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
  });

  it("lets a passage quote the client's own answer back to them", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice({ profile: { ...chan, client_id: "persona-chan", exclusions: ["fossil_fuels"] } });
    const s5 = advice.reasons.findIndex((r) => r.rule === "S5");
    reply = bend(advice, (p) => (p[s5]!.text = 'You told us "fossil_fuels" are out; only the deck claims a screen.'));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
  });

  it("accepts the page a passage cites, written as a number", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice();
    reply = bend(advice, (p) => (p[0]!.text = `The PPM, p.${advice.reasons[0]!.citation!.page}, sets the minimum.`));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
  });

  it("one that states a number neither its quote nor the client's answer holds", async () => {
    expect(await refused((p) => (p[0]!.text = "You would need to hold it for 7 years."))).toMatch(/r0 states 7/);
  });

  it("a summary that states a number nothing in the advice holds", async () => {
    expect(await refused((_, depth) => (depth.summary = "Three rules fail, so 0 of 4 hold."))).toMatch(/summary states 0, which nothing in the advice holds/);
  });

  it("accepts a summary that states a number the advice holds", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice();
    reply = bend(advice, (_, depth) => (depth.summary = "This fund asks for longer than the 2 years you have."));
    expect((await explainCall(t, caseId, adviceId)).status).toBe(200);
  });

  it("one that names a document the advice does not cite", async () => {
    const { t, caseId, adviceId, advice } = await chanAdvice({ dismissExitCharge: true });
    expect(advice.disclosures.some((d) => d.citation.document_id === "deck")).toBe(false);
    reply = bend(advice, (p) => (p[0]!.text = "The deck says otherwise."));

    const res = await explainCall(t, caseId, adviceId);
    expect(res.status).toBe(422);
    expect(StepFailure.parse(await res.json()).error).toMatch(/names deck/);
  });
});

describe("what it explains", () => {
  it("needs an advice id", async () => {
    const { t, caseId } = await chanAdvice();
    expect((await explainCall(t, caseId, null)).status).toBe(409);
  });

  it("refuses advice the case does not have, or advice that has been superseded", async () => {
    const { t, caseId, adviceId } = await chanAdvice();
    expect((await explainCall(t, caseId, randomUUID())).status).toBe(409);

    await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile: { ...chan, horizon_years: 6 } });
    expect((await explainCall(t, caseId, adviceId)).status).toBe(409);
  });
});
