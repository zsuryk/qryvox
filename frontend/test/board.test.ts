import { describe, expect, it } from "vitest";
import { activeFindings, fold, type FindingCategory, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { boardView, CATEGORIES } from "../lib/board";

// The recorded case, folded by the board exactly as the browser folds it: no model call, no state store.
const events = SlimEvent.array().parse(recorded);
const all = [...CATEGORIES];
const selected = (...categories: FindingCategory[]) => categories;

// The seq the first findings run put its finding on the board; the re-run supersedes it and puts six up.
const supersededSeq = events.find((e) => e.type === "finding.created")!.seq;

describe("the board", () => {
  it("shows every active finding as a card, with its category, claim, rationale and quote", () => {
    const { cards, active, visible, counts } = boardView(events, all);

    expect(active).toBe(6);
    expect(visible).toBe(6);
    expect(counts).toEqual({ fees: 2, strategy: 2, risk: 1, terms: 1 });
    expect(cards).toHaveLength(6);
    expect(cards[0]).toEqual({
      findingId: expect.any(String),
      category: "fees",
      categoryLabel: "Fees",
      kind: "contradiction",
      kindLabel: "Contradiction",
      severity: "high",
      severityLabel: "High",
      claim: "The factsheet states a 0.85% management fee per annum; the fee table states 1.25% of net asset value.",
      rationale: "Two documents state the same fact differently: factsheet and fee-table.",
      rationaleWritten: false,
      rule: null,
      citation: {
        documentId: "factsheet",
        documentName: "larkspur-factsheet.pdf",
        page: 1,
        quote: "Annual management fee: 0.85% per annum",
      },
      counterpart: {
        documentId: "fee-table",
        documentName: "larkspur-fee-table.pdf",
        page: 1,
        quote: "Annual management fee: 1.25% of net asset value",
      },
      runId: expect.any(String),
      seq: 22,
    });
  });

  it("gives every card a rationale in its own terms, naming the documents it runs into", () => {
    const { cards } = boardView(events, all);

    expect(cards.filter((card) => card.category === "fees").map((card) => card.rationale)).toEqual([
      "Two documents state the same fact differently: factsheet and fee-table.",
      "Two documents state the same fact differently: deck and fee-table.",
    ]);
    expect(cards.find((card) => card.kind === "disclosure_gap")!.rationale).toBe(
      "deck promises it without the risk disclosure ppm attaches to it.",
    );
    expect(cards.find((card) => card.kind === "unsupported_claim")!.rationale).toBe(
      "Nothing else in the pack backs what deck states.",
    );
    // Two findings can run between the same pair of documents; the quote under the rationale is what tells
    // them apart, so the cards stay distinguishable even when the sentence is the same.
    const factsheetAgainstPpm = cards.filter(
      (card) => card.rationale === "Two documents state the same fact differently: factsheet and ppm.",
    );
    expect(factsheetAgainstPpm.map((card) => card.citation!.quote)).toEqual([
      "The Fund invests only in investment-grade bonds.",
      "Dealing: daily, on any business day",
    ]);
  });

  it("leaves a superseded finding off the board while it stays in the log", () => {
    const superseded = fold(events.filter((e) => e.seq <= supersededSeq)).findings[0]!;
    const { cards } = boardView(events, all);

    expect(fold(events).findings.map((f) => f.finding_id)).toContain(superseded.finding_id);
    expect(cards.map((card) => card.findingId)).not.toContain(superseded.finding_id);
  });

  it("orders cards by severity, then by category", () => {
    expect(boardView(events, all).cards.map((card) => [card.severity, card.category])).toEqual([
      ["high", "fees"],
      ["high", "fees"],
      ["high", "strategy"],
      ["high", "risk"],
      ["medium", "strategy"],
      ["medium", "terms"],
    ]);
  });

  it("narrows the board and the count to the categories selected", () => {
    const fees = boardView(events, selected("fees"));
    const feesAndTerms = boardView(events, selected("fees", "terms"));

    expect(fees.cards.map((card) => card.category)).toEqual(["fees", "fees"]);
    expect(fees.visible).toBe(2);
    expect(fees.active).toBe(6);
    // The count follows the filter, and the per-category counts still say what is held back.
    expect(feesAndTerms.visible).toBe(3);
    expect(feesAndTerms.cards.map((card) => card.category)).toEqual(["fees", "fees", "terms"]);
  });

  it("says plainly that a filter with no findings is empty", () => {
    // The board as the first findings run left it: one fee finding, so nothing in strategy.
    const firstRun = events.filter((e) => e.seq <= supersededSeq);

    expect(boardView(firstRun, selected("strategy")).notice).toEqual({
      headline: "No strategy findings.",
      detail: "The board holds 1 finding in other categories.",
    });
  });

  it("says plainly that a case with no findings yet is empty", () => {
    const beforeFindings = events.filter((e) => e.seq < supersededSeq);

    expect(boardView(beforeFindings, all)).toMatchObject({
      cards: [],
      active: 0,
      visible: 0,
      notice: {
        headline: "No findings on this case yet.",
        detail: "Nothing has been recorded to the board, so there is nothing to filter.",
      },
    });
  });

  it("says plainly that a board with every category turned off is empty", () => {
    expect(boardView(events, []).notice).toEqual({
      headline: "No categories selected.",
      detail: "The board holds 6 findings in other categories. Turn a category on to see them.",
    });
  });

  it("names the run that put the board up, and what it superseded", () => {
    const { scope } = boardView(events, all);
    const secondRun = events.filter((e) => e.type === "finding.created").at(-1)!.step_run_id;

    expect(scope).toEqual({
      runIds: [secondRun],
      step: "findings",
      model: "recorded-fake-model",
      promptVersion: "findings@1",
      firstSeq: 22,
      lastSeq: 27,
      superseded: 1,
    });
  });

  it("keeps the run scope the same whatever the filter shows", () => {
    const scope = boardView(events, all).scope;

    expect(boardView(events, selected("terms")).scope).toEqual(scope);
    expect(boardView(events, []).scope).toEqual(scope);
  });

  it("folds the log it is given rather than holding findings of its own", () => {
    const board = events.filter((e) => e.seq <= supersededSeq);

    expect(boardView(board, all).active).toBe(1);
    expect(boardView(events, all).active).toBe(6);
  });
});

describe("a policy gap on the board", () => {
  it("names the institutional rule it breaks, in the rule's own words", () => {
    const seq = events.length + 1;
    const gap = SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: events[0]!.case_id,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: activeFindings(fold(events))[0]!.stepRunId,
      type: "finding.created",
      v: 1,
      payload: {
        finding_id: "policy-credit-risk",
        category: "risk",
        kind: "policy_gap",
        severity: "medium",
        claim: "The factsheet names interest-rate and currency risk but not credit risk.",
        citation: { document_id: "factsheet", page: 2, quote: "Bond prices generally fall when interest rates rise." },
        counterpart: { document_id: "ppm", page: 2, quote: "5.4 The Fund is exposed to interest rate, credit and currency risk." },
        rule: "P1",
      },
    });
    const card = boardView([...events, gap], all).cards.find((c) => c.findingId === "policy-credit-risk")!;

    expect(card.kindLabel).toBe("Policy gap");
    expect(card.rule).toEqual({ id: "P1", title: "Marketing names every PPM risk", text: expect.stringContaining("every type of risk") });
    expect(card.rationale).toBe(
      "factsheet falls short of the institution's rule: The factsheet and the marketing deck each name every type of risk listed in the PPM's risk factors.",
    );
  });

  it("shows the rationale the model wrote when one held, the derived line otherwise, and a superseded run's line never (#75)", () => {
    const findings = boardView(events, all).cards;
    const target = findings.find((c) => c.kind === "contradiction")!;
    const last = events.at(-1)!;
    const run = { step: "rationale", model: "fake-model", prompt_version: "rationale@1", input_run_id: target.runId };
    const at = (n: number, type: string, payload: object) =>
      SlimEvent.parse({ ...last, seq: last.seq + n, event_id: `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`, step_run_id: "rationale-run", type, payload });
    const written = "An investor could pay a charge the deck does not mention.";
    const log = [...events, at(1, "step.started", run), at(2, "step.completed", { ...run, output: { rationales: [{ finding_id: target.findingId, text: written }] } })];

    const cards = boardView(log, all).cards;
    const now = cards.find((c) => c.findingId === target.findingId)!;
    expect(now).toMatchObject({ rationale: written, rationaleWritten: true });
    // Every other card keeps the line derived from its own kind and documents.
    const other = cards.find((c) => c.findingId !== target.findingId)!;
    expect(other.rationaleWritten).toBe(false);
    expect(other.rationale).toBe(boardView(events, all).cards.find((c) => c.findingId === other.findingId)!.rationale);
  });
});
