import { describe, expect, it } from "vitest";
import { Citation, nearestStatements, PROMPT_VERSIONS, SlimEvent } from "../src";
import { tokens } from "../src/similar";
import recorded from "../fixtures/case-recorded.json";

// The recorded Larkspur case: one extract run of eleven statements, four of them about fees.
const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const statement = (quote: string): Citation => {
  const extract = events.find((e) => e.type === "step.completed" && e.payload.step === "extract");
  const found = Citation.array().parse(extract?.type === "step.completed" && extract.payload.output.statements).find((s) => s.quote === quote);
  if (!found) throw new Error(`no statement ${quote}`);
  return found;
};
const managementFee = statement("Annual management fee: 0.85% per annum");
const redemptionCharge = statement("Redemption charge: 2.00% on units redeemed within 24 months of purchase");
const FEES = ["Annual management fee: 1.25% of net asset value", "No entry or exit charges.", redemptionCharge.quote, managementFee.quote];

// A further extract run appended to the log, seeded (a find-similar run) or not.
function extractRun(statements: Citation[], seed?: Citation): SlimEvent[] {
  const runId = `extract-${events.length + 1}`;
  const run = { step: "extract", model: "fake-model", prompt_version: PROMPT_VERSIONS.extract, input_run_id: null, ...(seed && { seed }) };
  const event = (seq: number, type: string, payload: object) =>
    SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: caseId,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: runId,
      type,
      v: 1,
      payload,
    });
  return [event(events.length + 1, "step.started", run), event(events.length + 2, "step.completed", { ...run, output: { statements } })];
}

describe("nearestStatements (#60)", () => {
  it("ranks a fee passage's neighbours from the fee passages: the other document's management fee first", () => {
    const neighbours = nearestStatements(events, managementFee);
    expect(neighbours[0]!.citation).toEqual({ document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" });
    expect(neighbours.every((n) => FEES.includes(n.citation.quote))).toBe(true);
  });

  it("finds the deck's 'No entry or exit charges.' for the fee table's redemption charge, a plural apart", () => {
    const quotes = nearestStatements(events, redemptionCharge).map((n) => n.citation.quote);
    expect(quotes).toContain("No entry or exit charges.");
    expect(quotes).not.toContain(redemptionCharge.quote);
  });

  it("leaves out the card's own passage, scores in descending order, and returns at most k", () => {
    const neighbours = nearestStatements(events, redemptionCharge);
    expect(neighbours.length).toBeGreaterThan(1);
    expect(neighbours.map((n) => n.score)).toEqual([...neighbours.map((n) => n.score)].sort((a, b) => b - a));
    expect(neighbours.every((n) => n.score > 0)).toBe(true);
    expect(nearestStatements(events, redemptionCharge, 1)).toEqual(neighbours.slice(0, 1));
    expect(nearestStatements(events, redemptionCharge, 0)).toEqual([]);
  });

  it("is deterministic: the same answer for the log in any order", () => {
    expect(nearestStatements([...events].reverse(), managementFee)).toEqual(nearestStatements(events, managementFee));
  });

  it("compares numbers by value: a charge of 2% finds the 2.00% charge before the charges with no number", () => {
    const passage = { document_id: "factsheet", page: 1, quote: "A charge of 2% applies." };
    expect(nearestStatements(events, passage)[0]!.citation).toEqual(redemptionCharge);
  });

  it("reads the latest unseeded extract run, never a find-similar run's candidates", () => {
    const seeded = extractRun([{ document_id: "deck", page: 2, quote: "Annual management fee waived for the first year" }], managementFee);
    expect(nearestStatements([...events, ...seeded], managementFee)).toEqual(nearestStatements(events, managementFee));

    const rerun = extractRun([managementFee, { document_id: "deck", page: 2, quote: "Annual management fee waived for the first year" }]);
    expect(nearestStatements([...events, ...rerun], managementFee).map((n) => n.citation.quote)).toEqual(["Annual management fee waived for the first year"]);
  });

  it("is empty before any extract run has completed", () => {
    expect(nearestStatements(events.slice(0, 8), managementFee)).toEqual([]);
  });
});

describe("the tokens BM25 ranks by", () => {
  it("lowercases, drops stop words and the PPM's clause number, folds plurals, and keeps numbers by value", () => {
    expect(tokens("7.2 A redemption charge of 2.00% applies to Units redeemed within 24 months.")).toEqual([
      "redemption",
      "charge",
      "2%",
      "apply",
      "unit",
      "redeemed",
      "within",
      "24",
      "month",
    ]);
    expect(tokens("Minimum initial investment: USD 1,000")).toEqual(["minimum", "initial", "investment", "usd", "1000"]);
  });
});
