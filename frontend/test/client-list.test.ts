import { SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { clientList, suiting } from "../lib/client-list";

// #71: a client's list is folded from the logs of the cases that hold their answers.

const base = SlimEvent.array().parse(recorded);
const profile = {
  client_id: "persona-x",
  goal: "income",
  horizon_years: 5,
  risk_level: 3,
  knowledge: "informed",
  relies_on_income: false,
  may_need_cash_at_short_notice: false,
  exclusions: [],
};
const reason = (effect: "meets" | "blocks" | "conditional") => ({ rule: "S1", effect, profile_field: "horizon_years", citation: null });

// A case's log: the recorded one under another id, plus the client's answers, advice and decision.
function caseLog(caseId: string, effect: "meets" | "blocks" | "conditional", decision?: { decision: "approved" | "rejected"; adviser_pick?: boolean; reason?: string }): { caseId: string; events: SlimEvent[] } {
  const id = (n: number) => `00000000-0000-4000-8000-${caseId.charCodeAt(0).toString(16).padStart(4, "0")}${String(n).padStart(8, "0")}`;
  const root = base.map((e) => ({ ...e, case_id: caseId, event_id: `${e.event_id.slice(0, 24)}${caseId.charCodeAt(0).toString(16).padStart(4, "0")}${e.event_id.slice(28)}` }));
  const n = root.length;
  const adviceId = id(2);
  const extra = [
    { seq: n + 1, event_id: id(1), type: "client.profiled", payload: profile },
    {
      seq: n + 2,
      event_id: adviceId,
      type: "advice.drafted",
      payload: { client_id: "persona-x", profile_seq: n + 1, attributes_run_id: "run", verdict: effect === "meets" ? "suitable" : effect === "blocks" ? "not_suitable" : "conditional", reasons: [reason(effect)], disclosures: [], rules_version: "rules@2" },
    },
    ...(decision ? [{ seq: n + 3, event_id: id(3), type: "advice.decided", payload: { advice_id: adviceId, ...decision } }] : []),
  ].map((e) => SlimEvent.parse({ ...e, case_id: caseId, v: 1, actor: "demo-analyst", at: "2026-10-04T00:00:00.000Z", step_run_id: null }));
  return { caseId, events: [...root, ...extra] };
}

const approved = { decision: "approved" as const };

describe("a client's list (#71)", () => {
  it("shows nothing as advice until a product is approved, and says where things stand", () => {
    expect(clientList([], "persona-x")).toMatchObject({ status: "none", products: [] });
    const waiting = clientList([caseLog("a", "meets"), caseLog("b", "blocks")], "persona-x");
    expect(waiting).toMatchObject({ status: "reviewing", total: 2, products: [] });
  });

  it("shows the approved products as soon as one is, and counts the ones still undecided", () => {
    const list = clientList([caseLog("a", "meets", approved), caseLog("b", "blocks")], "persona-x");
    if (list.status !== "approved") throw new Error("approved");
    expect(list.products.map((p) => p.caseId)).toEqual(["a"]);
    expect(list.pending).toBe(1);
    const done = clientList([caseLog("a", "meets", approved), caseLog("b", "blocks", approved)], "persona-x");
    expect(done).toMatchObject({ status: "approved", pending: 0 });
  });

  it("leaves a rejected product out of the list", () => {
    const list = clientList([caseLog("a", "meets", approved), caseLog("b", "blocks", { decision: "rejected", reason: "needs_discussion_first" })], "persona-x");
    if (list.status !== "approved") throw new Error("approved");
    expect(list.products.map((p) => p.caseId)).toEqual(["a"]);
    expect(list.pending).toBe(0);
  });

  it("is rejected when the adviser rejected the list", () => {
    const rejected = clientList([caseLog("a", "meets", { decision: "rejected", reason: "needs_discussion_first" }), caseLog("b", "blocks", { decision: "rejected", reason: "needs_discussion_first" })], "persona-x");
    expect(rejected.status).toBe("rejected");
  });

  it("orders suitable, then needs your adviser, then not suitable, with the pick first among its kind", () => {
    const list = clientList(
      [caseLog("a", "blocks", approved), caseLog("b", "conditional", approved), caseLog("c", "meets", approved), caseLog("d", "meets", { ...approved, adviser_pick: true })],
      "persona-x",
    );
    if (list.status !== "approved") throw new Error("approved");
    expect(list.products.map((p) => `${p.caseId}:${p.advice.verdict}:${p.pick}`)).toEqual([
      "d:suitable:true",
      "c:suitable:false",
      "b:conditional:false",
      "a:not_suitable:false",
    ]);
  });

  it("filters to the products that suit, and marks no pick unless the adviser did", () => {
    const list = clientList([caseLog("a", "blocks", approved), caseLog("c", "meets", approved)], "persona-x");
    if (list.status !== "approved") throw new Error("approved");
    expect(suiting(list.products).map((p) => p.caseId)).toEqual(["c"]);
    expect(list.products.some((p) => p.pick)).toBe(false);
  });
});
