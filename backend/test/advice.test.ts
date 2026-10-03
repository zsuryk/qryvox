import { randomUUID } from "node:crypto";
import {
  activeFindings,
  approvedAdviceFor,
  type ClientProfile,
  ErrorResponse,
  EventPage,
  fold,
  StepResult,
  VerifyResponse,
} from "@qryvox/shared";
import { describe, expect, it } from "vitest";
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

async function stepRun(t: TestApp, caseId: string, step: string, input: string | null) {
  const res = await t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });
  expect(res.status, await res.clone().text()).toBe(200);
  return StepResult.parse(await res.json()).step_run_id;
}

// A Larkspur case taken as far as asked: documents, then the verified board, then the attributes.
async function larkspurCase({ verified = true, attributes = true } = {}) {
  const t = await setup({ llm: larkspurLlm() });
  const caseId = await t.openCase();
  for (const document of pack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  if (verified) {
    let input: string | null = null;
    for (const step of ["extract", "decompose", "contradictions", "findings"]) input = await stepRun(t, caseId, step, input);
  }
  if (attributes) await stepRun(t, caseId, "attributes", null);
  return { t, caseId };
}

const profile = (t: TestApp, caseId: string, p: ClientProfile, eventId = randomUUID()) =>
  t.request("POST", `/cases/${caseId}/clients`, { event_id: eventId, profile: p });
const draft = (t: TestApp, caseId: string, clientId: string, eventId = randomUUID()) =>
  t.request("POST", `/cases/${caseId}/advice`, { event_id: eventId, client_id: clientId });
// As the console sends it: a rejection with its reason, an approval with the direct-explanation
// confirmation (Mrs Chan is a vulnerable client). The controls themselves are tested on their own below.
const decide = (t: TestApp, caseId: string, adviceId: string, decision: string, eventId = randomUUID()) =>
  t.request("POST", `/cases/${caseId}/advice/${adviceId}/decision`, {
    event_id: eventId,
    decision,
    ...(decision === "rejected" ? { reason: "needs_discussion_first" } : {}),
    ...(decision === "approved" ? { confirmations: ["explained_directly"] } : {}),
  });

async function state(t: TestApp, caseId: string) {
  const { events } = EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json());
  return { events, state: fold(events) };
}

async function conflict(res: Response) {
  expect(res.status).toBe(409);
  return ErrorResponse.parse(await res.json()).error;
}

describe("advice on a verified pack", () => {
  it("drafts Mrs Chan's advice by the rules, and shows it to her only once the adviser approves", async () => {
    const { t, caseId } = await larkspurCase();
    expect((await profile(t, caseId, chan)).status).toBe(201);
    const adviceId = randomUUID();

    expect((await draft(t, caseId, "persona-chan", adviceId)).status).toBe(201);
    const drafted = (await state(t, caseId)).state.advice[0]!;
    expect(drafted).toMatchObject({ adviceId, verdict: "not_suitable", rules_version: "rules@2", decision: null });
    expect(drafted.reasons.filter((r) => r.effect === "blocks").map((r) => r.rule)).toEqual(["S1", "S2", "S4", "S4", "S4"]);
    // Both fee findings on the board are disclosed, citing the fee table.
    expect(drafted.disclosures.map((d) => d.citation.document_id)).toEqual(["fee-table", "fee-table"]);
    expect(approvedAdviceFor((await state(t, caseId)).state, "persona-chan")).toEqual([]);

    expect((await decide(t, caseId, adviceId, "approved")).status).toBe(201);
    const after = (await state(t, caseId)).state;
    expect(approvedAdviceFor(after, "persona-chan").map((a) => a.adviceId)).toEqual([adviceId]);
    expect(after.advice[0]!.decision).toMatchObject({ decision: "approved", actor: "demo-analyst" });

    const verify = VerifyResponse.parse(await (await t.request("GET", `/cases/${caseId}/verify`)).json());
    expect(verify.intact).toBe(true);
  });

  it("a retried draft returns the stored one and appends nothing", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    const adviceId = randomUUID();

    const first = await (await draft(t, caseId, "persona-chan", adviceId)).json();
    const before = (await state(t, caseId)).events.length;
    const again = await draft(t, caseId, "persona-chan", adviceId);

    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    expect((await state(t, caseId)).events).toHaveLength(before);
  });

  it("does not disclose a finding the analyst dismissed", async () => {
    const { t, caseId } = await larkspurCase();
    const [dismissed] = activeFindings((await state(t, caseId)).state);
    await t.request("POST", `/cases/${caseId}/dispositions`, {
      event_id: randomUUID(),
      finding_id: dismissed!.finding_id,
      disposition: "dismissed",
    });
    await profile(t, caseId, chan);
    await draft(t, caseId, "persona-chan");

    const disclosed = (await state(t, caseId)).state.advice[0]!.disclosures.map((d) => d.finding_id);
    expect(disclosed).not.toContain(dismissed!.finding_id);
    expect(disclosed).toHaveLength(1);
  });
});

describe("advice it refuses to draft", () => {
  it("for a client with no profile", async () => {
    const { t, caseId } = await larkspurCase();
    expect(await conflict(await draft(t, caseId, "persona-chan"))).toMatch(/no profile/);
  });

  it("on a pack that has not been verified", async () => {
    const { t, caseId } = await larkspurCase({ verified: false });
    await profile(t, caseId, chan);
    expect(await conflict(await draft(t, caseId, "persona-chan"))).toMatch(/not been verified/);
  });

  it("before the attributes have been read", async () => {
    const { t, caseId } = await larkspurCase({ attributes: false });
    await profile(t, caseId, chan);
    expect(await conflict(await draft(t, caseId, "persona-chan"))).toMatch(/attributes/);
  });

  it("twice on the same profile and attributes", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    await draft(t, caseId, "persona-chan");
    expect(await conflict(await draft(t, caseId, "persona-chan"))).toMatch(/already drafted/);
    expect((await state(t, caseId)).state.advice).toHaveLength(1);
  });
});

describe("advice that adapts", () => {
  it("a new profile supersedes the advice in play; Mr Lee redrafted on a two-year horizon is not suitable", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, lee);
    const first = randomUUID();
    await draft(t, caseId, "persona-lee", first);
    expect((await state(t, caseId)).state.advice[0]!.verdict).toBe("conditional");

    await profile(t, caseId, { ...lee, horizon_years: 2 });
    let s = (await state(t, caseId)).state;
    expect(s.advice[0]).toMatchObject({ adviceId: first, supersededBecause: "profile_changed" });

    await draft(t, caseId, "persona-lee");
    s = (await state(t, caseId)).state;
    expect(s.advice.filter((a) => a.supersededAtSeq === null).map((a) => a.verdict)).toEqual(["not_suitable"]);
  });

  it("a newer attributes run supersedes advice on the old one when the client's advice is redrafted", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    const first = randomUUID();
    await draft(t, caseId, "persona-chan", first);

    await stepRun(t, caseId, "attributes", null);
    expect((await draft(t, caseId, "persona-chan")).status).toBe(201);

    const s = (await state(t, caseId)).state;
    expect(s.advice[0]).toMatchObject({ adviceId: first, supersededBecause: "product_changed" });
    expect(s.advice.filter((a) => a.supersededAtSeq === null)).toHaveLength(1);
  });
});

describe("the adviser's decision", () => {
  it("is refused on superseded advice, but a retry of a decision already made still returns it", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    const adviceId = randomUUID();
    await draft(t, caseId, "persona-chan", adviceId);
    const decisionId = randomUUID();
    const first = await (await decide(t, caseId, adviceId, "approved", decisionId)).json();

    await profile(t, caseId, { ...chan, horizon_years: 6 });

    expect(await conflict(await decide(t, caseId, adviceId, "rejected"))).toMatch(/superseded/);
    const retried = await decide(t, caseId, adviceId, "approved", decisionId);
    expect(retried.status).toBe(201);
    expect(await retried.json()).toEqual(first);
  });

  it("is 404 for advice the case does not have", async () => {
    const { t, caseId } = await larkspurCase();
    expect((await decide(t, caseId, randomUUID(), "approved")).status).toBe(404);
  });

  it("takes approve or reject and nothing else", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    const adviceId = randomUUID();
    await draft(t, caseId, "persona-chan", adviceId);
    expect((await decide(t, caseId, adviceId, "auto-approved")).status).toBe(400);
  });
});

describe("the client profile endpoint", () => {
  it("refuses a name where the pseudonymous id goes", async () => {
    const { t, caseId } = await larkspurCase({ verified: false, attributes: false });
    expect((await profile(t, caseId, { ...chan, client_id: "Mrs Chan" })).status).toBe(400);
  });
});

describe("a client's readings (#38)", () => {
  it("records the depth a client chose, under their own pseudonymous id, and refuses an unknown client", async () => {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, chan);
    const adviceId = randomUUID();
    await draft(t, caseId, "persona-chan", adviceId);
    const reading = (clientId: string) =>
      t.request("POST", `/cases/${caseId}/clients/${clientId}/readings`, { event_id: randomUUID(), advice_id: adviceId, depth: "informed" });

    expect((await reading("persona-chan")).status).toBe(201);
    expect((await state(t, caseId)).state.readings).toMatchObject([{ clientId: "persona-chan", depth: "informed" }]);
    const last = (await state(t, caseId)).events.at(-1)!;
    expect(last).toMatchObject({ type: "client.read", actor: "persona-chan" });
    expect((await reading("persona-nobody")).status).toBe(404);
  });
});

describe("answers a client gives themselves", () => {
  it("are recorded with the client as their actor, and the adviser's as before", async () => {
    const { t, caseId } = await larkspurCase({ verified: false, attributes: false });
    await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile: chan, by_client: true });
    await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile: lee });

    const profiled = (await state(t, caseId)).events.filter((e) => e.type === "client.profiled");
    expect(profiled.map((e) => e.actor)).toEqual(["persona-chan", "demo-analyst"]);
  });
});

describe("the adviser's accountable decision (#42)", () => {
  async function drafted(p: ClientProfile) {
    const { t, caseId } = await larkspurCase();
    await profile(t, caseId, p);
    const adviceId = randomUUID();
    await draft(t, caseId, p.client_id, adviceId);
    const raw = (body: Record<string, unknown>) =>
      t.request("POST", `/cases/${caseId}/advice/${adviceId}/decision`, { event_id: randomUUID(), ...body });
    return { t, caseId, raw };
  }

  it("refuses a rejection without its reason, and records the reason when given", async () => {
    const { t, caseId, raw } = await drafted(lee);
    const bare = await raw({ decision: "rejected" });
    expect(bare.status).toBe(400);
    expect(ErrorResponse.parse(await bare.json()).error).toMatch(/needs its reason/);

    expect((await raw({ decision: "rejected", reason: "client_prefers_another_product" })).status).toBe(201);
    expect((await state(t, caseId)).state.advice[0]!.decision).toMatchObject({ decision: "rejected", reason: "client_prefers_another_product" });
  });

  it("approves a vulnerable client's advice only with the adviser's confirmation, and says why", async () => {
    const { t, caseId, raw } = await drafted({ ...chan, aged_65_or_over: true });
    const unconfirmed = await raw({ decision: "approved" });
    expect(unconfirmed.status).toBe(409);
    expect(ErrorResponse.parse(await unconfirmed.json()).error).toMatch(/65 or over; new to investing and relies on the income/);

    expect((await raw({ decision: "approved", confirmations: ["explained_directly"] })).status).toBe(201);
    expect((await state(t, caseId)).state.advice[0]!.decision).toMatchObject({ confirmations: ["explained_directly"] });
  });

  it("asks nothing extra for a client who is not vulnerable", async () => {
    const { raw } = await drafted(lee);
    expect((await raw({ decision: "approved" })).status).toBe(201);
  });
});
