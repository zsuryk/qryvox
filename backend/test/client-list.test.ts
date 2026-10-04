import { randomUUID } from "node:crypto";
import { approvedAdviceFor, type ClientProfile, ClientCasesResponse, ClientListResponse, ClientQueueResponse, ErrorResponse, EventPage, fold, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { setup, type TestApp } from "./helpers";
import { pack as larkspurPack } from "./larkspur";
import { shelfLlm, wrenfieldPack } from "./wrenfield";

// #71: the questionnaire answered once, reaching every verified product's case, and the adviser's one decision.

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
const wong: ClientProfile = { ...chan, client_id: "persona-wong", horizon_years: 6, risk_level: 3, knowledge: "expert", relies_on_income: false, may_need_cash_at_short_notice: false };

async function run(t: TestApp, caseId: string, step: string, input: string | null) {
  const res = await t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });
  expect(res.status, `${step}: ${await res.clone().text()}`).toBe(200);
  return StepResult.parse(await res.json()).step_run_id;
}

async function verify(t: TestApp, documents: typeof larkspurPack) {
  const caseId = await t.openCase();
  for (const document of documents) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  let input: string | null = null;
  for (const step of ["extract", "decompose", "contradictions", "findings"]) input = await run(t, caseId, step, input);
  await run(t, caseId, "attributes", null);
  return caseId;
}

async function shelfOfTwo() {
  const t = await setup({ llm: shelfLlm() });
  const larkspur = await verify(t, larkspurPack);
  const wrenfield = await verify(t, wrenfieldPack);
  return { t, larkspur, wrenfield };
}

async function stateOf(t: TestApp, caseId: string) {
  const { events } = EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json());
  return { events, state: fold(events) };
}

const answer = (t: TestApp, profile: ClientProfile, eventId = randomUUID()) => t.request("POST", "/clients", { event_id: eventId, profile });
const decideList = (t: TestApp, clientId: string, body: Record<string, unknown>) =>
  t.request("POST", `/clients/${clientId}/decision`, { event_id: randomUUID(), ...body });
const error = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  return ErrorResponse.parse(await res.json()).error;
};

describe("one questionnaire, every product (#71)", () => {
  it("records the answers in every verified product's case and drafts each product's advice", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();

    const res = await answer(t, chan);
    expect(res.status).toBe(201);
    const list = ClientListResponse.parse(await res.json());
    expect(list.products.map((p) => p.case_id).sort()).toEqual([larkspur, wrenfield].sort());

    const verdicts: Record<string, string | undefined> = {};
    for (const { case_id, advice_id } of list.products) {
      const { state } = await stateOf(t, case_id);
      expect(state.clients).toHaveLength(1);
      expect(state.clients[0]!.profile).toEqual(chan);
      const advice = state.advice.filter((a) => a.supersededAtSeq === null);
      expect(advice.map((a) => a.adviceId)).toEqual([advice_id]);
      verdicts[case_id] = advice[0]!.verdict;
    }
    expect(verdicts[larkspur]).toBe("not_suitable");
    expect(verdicts[wrenfield]).toBe("suitable");
  });

  it("is safe to repeat: the same request appends nothing twice", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    const eventId = randomUUID();
    const first = ClientListResponse.parse(await (await answer(t, chan, eventId)).json());
    const before = [(await stateOf(t, larkspur)).events.length, (await stateOf(t, wrenfield)).events.length];

    const again = ClientListResponse.parse(await (await answer(t, chan, eventId)).json());

    expect(again).toEqual(first);
    expect([(await stateOf(t, larkspur)).events.length, (await stateOf(t, wrenfield)).events.length]).toEqual(before);
  });

  it("finds the client's cases by their pseudonymous id, and says so for one nobody recorded", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    await answer(t, chan);

    const found = ClientCasesResponse.parse(await (await t.request("GET", "/clients/persona-chan")).json());
    expect(found.case_ids.sort()).toEqual([larkspur, wrenfield].sort());
    await error(await t.request("GET", "/clients/persona-nobody"), 404);
  });

  it("lists the clients with advice in play for the adviser, oldest first, and where each decision stands", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    const queue = async () => ClientQueueResponse.parse(await (await t.request("GET", "/clients")).json()).clients;
    expect(await queue()).toEqual([]);

    await answer(t, chan);
    await answer(t, wong);
    const before = await queue();
    expect(before.map((c) => [c.client_id, c.vulnerable])).toEqual([
      ["persona-chan", true],
      ["persona-wong", false],
    ]);
    expect(before[0]!.cases.map((c) => c.case_id).sort()).toEqual([larkspur, wrenfield].sort());
    expect(before.flatMap((c) => c.cases.map((x) => x.decision))).toEqual([null, null, null, null]);

    await decideList(t, "persona-wong", { decision: "approved" });
    const after = await queue();
    expect(after.find((c) => c.client_id === "persona-wong")!.cases.every((c) => c.decision === "approved")).toBe(true);
    expect(after.find((c) => c.client_id === "persona-chan")!.cases.every((c) => c.decision === null)).toBe(true);
  });

  it("refuses when no product is verified", async () => {
    const t = await setup({ llm: shelfLlm() });
    const why = await error(await answer(t, chan), 409);
    expect(why).toContain("no product has been verified yet");
    expect(why).toContain("reading the product's facts");
    // Nothing was recorded for the client: the queue is still empty.
    expect(ClientQueueResponse.parse(await (await t.request("GET", "/clients")).json()).clients).toEqual([]);
  });

  it("refuses when a product has findings but its facts were never read", async () => {
    const t = await setup({ llm: shelfLlm() });
    const caseId = await t.openCase();
    for (const document of larkspurPack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
    let input: string | null = null;
    for (const step of ["extract", "decompose", "contradictions", "findings"]) input = await run(t, caseId, step, input);
    await error(await answer(t, chan), 409);
  });

  it("answering again supersedes the advice in every case, as it does in one", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    await answer(t, chan);
    await answer(t, { ...chan, horizon_years: 6 });
    for (const id of [larkspur, wrenfield]) {
      const { state } = await stateOf(t, id);
      expect(state.advice.filter((a) => a.supersededAtSeq === null)).toHaveLength(1);
      expect(state.advice).toHaveLength(2);
    }
  });
});

describe("the adviser decides the whole list, with a pick (#71)", () => {
  it("approves every product in one decision and marks the suitable one as the pick", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    await answer(t, chan);

    // Mrs Chan is a vulnerable client: the direct-explanation confirmation applies to the list.
    const needs = await error(await decideList(t, "persona-chan", { decision: "approved", pick_case_id: wrenfield }), 409);
    expect(needs).toContain("explained");
    expect((await stateOf(t, wrenfield)).state.advice[0]!.decision).toBeNull();

    const res = await decideList(t, "persona-chan", { decision: "approved", confirmations: ["explained_directly"], pick_case_id: wrenfield });
    expect(res.status).toBe(201);
    expect(ClientListResponse.parse(await res.json()).products).toHaveLength(2);

    const picked = (await stateOf(t, wrenfield)).state;
    expect(approvedAdviceFor(picked, "persona-chan")[0]!.decision).toMatchObject({ decision: "approved", adviserPick: true });
    const other = (await stateOf(t, larkspur)).state;
    expect(approvedAdviceFor(other, "persona-chan")[0]!.decision).toMatchObject({ decision: "approved", adviserPick: false });
  });

  it("is safe to repeat", async () => {
    const { t, wrenfield } = await shelfOfTwo();
    await answer(t, wong);
    const body = { event_id: randomUUID(), decision: "approved", pick_case_id: wrenfield };
    expect((await t.request("POST", "/clients/persona-wong/decision", body)).status).toBe(201);
    const count = (await stateOf(t, wrenfield)).events.length;
    expect((await t.request("POST", "/clients/persona-wong/decision", body)).status).toBe(201);
    expect((await stateOf(t, wrenfield)).events.length).toBe(count);
  });

  it("refuses a pick that is not suitable, and leaves every product undecided", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    await answer(t, chan);

    const why = await error(await decideList(t, "persona-chan", { decision: "approved", confirmations: ["explained_directly"], pick_case_id: larkspur }), 409);
    expect(why).toContain("suitable");
    for (const id of [larkspur, wrenfield]) expect((await stateOf(t, id)).state.advice[0]!.decision).toBeNull();
  });

  it("refuses a pick from a case that is not on the list, or on a rejection", async () => {
    const { t, wrenfield } = await shelfOfTwo();
    await answer(t, wong);
    await error(await decideList(t, "persona-wong", { decision: "approved", pick_case_id: randomUUID() }), 409);
    await error(await decideList(t, "persona-wong", { decision: "rejected", reason: "needs_discussion_first", pick_case_id: wrenfield }), 409);
  });

  it("rejects the whole list with its one reason, and refuses a rejection without one", async () => {
    const { t, larkspur, wrenfield } = await shelfOfTwo();
    await answer(t, wong);
    await error(await decideList(t, "persona-wong", { decision: "rejected" }), 400);

    expect((await decideList(t, "persona-wong", { decision: "rejected", reason: "needs_discussion_first" })).status).toBe(201);
    for (const id of [larkspur, wrenfield]) {
      expect((await stateOf(t, id)).state.advice[0]!.decision).toMatchObject({ decision: "rejected", reason: "needs_discussion_first", adviserPick: false });
    }
  });

  it("says plainly when the client has no list to decide", async () => {
    const { t } = await shelfOfTwo();
    await error(await decideList(t, "persona-nobody", { decision: "approved" }), 404);
  });
});
