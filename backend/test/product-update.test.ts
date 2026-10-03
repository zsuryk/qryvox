import { randomUUID } from "node:crypto";
import {
  activeFindings,
  adviceToRedraft,
  type ClientProfile,
  EventPage,
  fold,
  type IngestedDocument,
  StepResult,
  VerifyResponse,
} from "@qryvox/shared";
import { LARKSPUR_V2 } from "@qryvox/shared/pack-source-v2";
import { describe, expect, it } from "vitest";
import { ATTRIBUTES_SYSTEM_PROMPT } from "../src/steps/attributes";
import { FakeLlm, setup, type TestApp } from "./helpers";
import { ATTRIBUTES_REPLY, larkspurLlm, pack } from "./larkspur";

// The revised pack, ingested under v1's document ids so each document replaces its v1 version.
const v2: IngestedDocument[] = LARKSPUR_V2.documents.map((d, i) => ({
  document_id: d.document_id,
  sha256: String(i + 5).repeat(64),
  filename: d.filename,
  kind: d.kind,
  page_count: d.pages.length,
  pages: d.pages.map((lines) => lines.join("\n")),
  pdfjs_version: "5.0.0",
}));

const ppmScreen = { document_id: "ppm", page: 1, quote: "3.6 The Fund excludes companies that derive revenue from fossil fuels." };

const lee: ClientProfile = {
  client_id: "persona-lee",
  goal: "growth",
  horizon_years: 10,
  risk_level: 4,
  knowledge: "informed",
  relies_on_income: false,
  may_need_cash_at_short_notice: false,
  exclusions: ["fossil_fuels"],
};

// The Larkspur fake, reading the attributes of whichever pack is in the case: once v2 is in, the PPM
// states the screen and a correct model cites it there.
function fake() {
  const usual = larkspurLlm();
  let revised = false;
  const llm = new FakeLlm(async (messages) =>
    messages[0]?.content === ATTRIBUTES_SYSTEM_PROMPT && revised
      ? JSON.stringify({ ...ATTRIBUTES_REPLY, exclusion_screens: [{ exclusion: "fossil_fuels", citation: ppmScreen }] })
      : (await usual.complete(messages)).content,
  );
  return { llm, revise: () => (revised = true) };
}

async function run(t: TestApp, caseId: string, steps: string[]) {
  let input: string | null = null;
  for (const step of steps) {
    const res = await t.request("POST", `/cases/${caseId}/steps`, {
      step_run_id: randomUUID(),
      step,
      input_run_id: step === "attributes" ? null : input,
    });
    expect(res.status, `${step}: ${await res.clone().text()}`).toBe(200);
    input = StepResult.parse(await res.json()).step_run_id;
  }
}

async function log(t: TestApp, caseId: string) {
  return EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json()).events;
}

const ingest = (t: TestApp, caseId: string, documents: IngestedDocument[]) =>
  Promise.all(documents.map((document) => t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document })));

// Mr Lee's approved v1 advice, then the v2 pack ingested into the same case.
async function updatedCase() {
  const { llm, revise } = fake();
  const t = await setup({ llm });
  const caseId = await t.openCase();
  await ingest(t, caseId, pack);
  await run(t, caseId, ["extract", "decompose", "contradictions", "findings", "attributes"]);
  await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile: lee });
  const v1Advice = randomUUID();
  await t.request("POST", `/cases/${caseId}/advice`, { event_id: v1Advice, client_id: "persona-lee" });
  await t.request("POST", `/cases/${caseId}/advice/${v1Advice}/decision`, { event_id: randomUUID(), decision: "approved" });
  const beforeUpdate = (await log(t, caseId)).length;

  for (const document of v2) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  revise();
  return { t, caseId, v1Advice, beforeUpdate };
}

describe("a product update", () => {
  it("replaces each document in the case with its revised version", async () => {
    const { t, caseId } = await updatedCase();
    const state = fold(await log(t, caseId));

    expect(state.documents.map((d) => d.filename)).toEqual(LARKSPUR_V2.documents.map((d) => d.filename));
  });

  it("re-verifying supersedes the v1 findings, and the corrected fee no longer grounds a contradiction", async () => {
    const { t, caseId } = await updatedCase();
    await run(t, caseId, ["extract", "decompose", "contradictions", "findings"]);
    const board = activeFindings(fold(await log(t, caseId)));

    // The factsheet now says 1.25%, so the 0.85% claim cannot be quoted and only the exit charge remains.
    expect(board.map((f) => f.citation.quote)).toEqual(["No entry or exit charges."]);
  });

  it("a new attributes run supersedes the advice drafted on the old one, in the same transaction", async () => {
    const { t, caseId, v1Advice } = await updatedCase();
    await run(t, caseId, ["attributes"]);
    const events = await log(t, caseId);

    const completed = events.filter((e) => e.type === "step.completed").at(-1)!;
    const superseded = events.find((e) => e.type === "advice.superseded")!;
    expect(superseded.payload).toEqual({ advice_id: v1Advice, cause: "product_changed" });
    expect(superseded.seq).toBe(completed.seq + 1);
    expect(adviceToRedraft(fold(events))).toEqual([{ clientId: "persona-lee", cause: "product_changed", supersededAtSeq: superseded.seq }]);
  });

  it("redrafted on v2, Mr Lee is suitable: the PPM now backs the screen he asked for", async () => {
    const { t, caseId } = await updatedCase();
    await run(t, caseId, ["extract", "decompose", "contradictions", "findings", "attributes"]);
    expect((await t.request("POST", `/cases/${caseId}/advice`, { event_id: randomUUID(), client_id: "persona-lee" })).status).toBe(201);

    const state = fold(await log(t, caseId));
    const inPlay = state.advice.filter((a) => a.supersededAtSeq === null);
    expect(inPlay.map((a) => a.verdict)).toEqual(["suitable"]);
    expect(inPlay[0]!.reasons.find((r) => r.rule === "S5")).toMatchObject({ effect: "meets", citation: ppmScreen });
    expect(adviceToRedraft(state)).toEqual([]);
  });

  it("replay still shows the advice as it stood before the update: approved and conditional", async () => {
    const { t, caseId, v1Advice, beforeUpdate } = await updatedCase();
    await run(t, caseId, ["attributes"]);
    const before = fold((await log(t, caseId)).filter((e) => e.seq <= beforeUpdate));

    expect(before.advice.find((a) => a.adviceId === v1Advice)).toMatchObject({
      verdict: "conditional",
      supersededAtSeq: null,
      decision: { decision: "approved" },
    });
    const verify = VerifyResponse.parse(await (await t.request("GET", `/cases/${caseId}/verify`)).json());
    expect(verify.intact).toBe(true);
  });
});
