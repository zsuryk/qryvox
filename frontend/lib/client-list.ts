import { type CaseAdvice, type ClientProfile, fold, type SlimEvent, VERDICT_ORDER } from "@qryvox/shared";
import { productName } from "./case";

// A client's list (#71, ADR-0008), folded from the logs of the cases that hold their answers: one advice per
// verified product, shown only once the adviser has approved the whole list. Everything short of that is
// said as where things stand, never shown, as on the single-product page (#34).

export type ListProduct = {
  caseId: string;
  product: string;
  advice: CaseAdvice;
  // The adviser marked this one when approving (#71): the only product the page calls recommended.
  pick: boolean;
  // The product's own events, which hold the documents its citations open.
  events: readonly SlimEvent[];
};

export type ClientList =
  | { status: "approved"; profile: ClientProfile; products: ListProduct[] }
  | { status: "reviewing" | "rejected" | "none"; profile: ClientProfile | null; products: []; total: number };

export type CaseLog = { caseId: string; events: readonly SlimEvent[] };

// The client's advice in play in each case, whatever its decision: what the adviser decides, and what the
// client's list is made of once it is decided. Newest answers win where cases differ.
export function listEntries(cases: readonly CaseLog[], clientId: string) {
  const found = cases.flatMap(({ caseId, events }) => {
    const state = fold(events);
    const advice = state.advice.filter((a) => a.client_id === clientId && a.supersededAtSeq === null).at(-1);
    return advice ? [{ caseId, events, advice, product: productName(events) ?? caseId }] : [];
  });
  const profile = cases.map((c) => fold(c.events).clients.find((x) => x.clientId === clientId)?.profile).find((p) => p !== undefined) ?? null;
  return { found, profile };
}

export function clientList(cases: readonly CaseLog[], clientId: string): ClientList {
  const { found, profile } = listEntries(cases, clientId);
  if (found.length === 0) return { status: "none", profile, products: [], total: 0 };
  if (found.some((f) => f.advice.decision === null)) return { status: "reviewing", profile, products: [], total: found.length };
  if (found.some((f) => f.advice.decision?.decision === "rejected")) return { status: "rejected", profile, products: [], total: found.length };
  return {
    status: "approved",
    profile: profile!,
    products: found
      .map((f): ListProduct => ({ caseId: f.caseId, product: f.product, advice: f.advice, pick: f.advice.decision?.adviserPick === true, events: f.events }))
      .sort((a, b) => VERDICT_ORDER[a.advice.verdict] - VERDICT_ORDER[b.advice.verdict] || Number(b.pick) - Number(a.pick) || a.product.localeCompare(b.product)),
  };
}

// The filter "only the ones that suit me": the products the rules find suitable.
export function suiting(products: readonly ListProduct[]): ListProduct[] {
  return products.filter((p) => p.advice.verdict === "suitable");
}
