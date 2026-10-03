import { activeFindings, excerptCardId, findingCardId, fold, isDiscarded, pinOf, planGroups, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasMode, canvasView, fixtureEvents, loadCanvasEvents } from "../lib/canvas-source";

// The canvas's one data seam (#49). Nothing here touches the network: fetch is stubbed to fail loudly, and
// the live source is handed its transport.
const recordedEvents = SlimEvent.array().parse(recorded);

afterEach(() => vi.unstubAllGlobals());

function forbidNetwork() {
  const fetch = vi.fn(async () => {
    throw new Error("the canvas fixture must not touch the network");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("the switch", () => {
  it("is the fixture with no case in the address, and that case live with one", () => {
    expect(canvasMode(new URLSearchParams(""))).toEqual({ kind: "fixture" });
    expect(canvasMode(new URLSearchParams("case=abc"))).toEqual({ kind: "live", caseId: "abc" });
  });
});

describe("the fixture source", () => {
  it("is the recorded case and three card operations after it, with no network", async () => {
    const fetch = forbidNetwork();
    const events = await loadCanvasEvents({ kind: "fixture" });

    expect(fetch).not.toHaveBeenCalled();
    expect(events.slice(0, recordedEvents.length)).toEqual(recordedEvents);
    expect(events.slice(recordedEvents.length).map((e) => [e.seq, e.type])).toEqual([
      [28, "card.docked"],
      [29, "card.pinned"],
      [30, "card.discarded"],
    ]);
    // The same on every load.
    expect(fixtureEvents()).toEqual(events);
  });

  it("drives the golden path: cards on the board, one docked to the plan region, one pinned, one discarded", async () => {
    const { state, cards } = canvasView(await loadCanvasEvents({ kind: "fixture" }));
    const [fees, second, third] = activeFindings(state).map((f) => findingCardId(f.finding_id));

    expect(cards.filter((c) => c.kind === "finding")).toHaveLength(6);
    expect(planGroups(state)).toEqual([
      expect.objectContaining({ category: "fees", authority: "factsheet", cards: [expect.objectContaining({ cardId: fees })] }),
    ]);
    expect(pinOf(state, second!)).toEqual({ x: 0, y: 0 });
    expect(isDiscarded(state, third!)).toBe(true);
    // The discarded card's finding is still on the board, as the fold keeps it.
    expect(activeFindings(state)).toEqual(activeFindings(fold(recordedEvents)));
  });

  it("lists each finding then its passages, one excerpt card per passage", () => {
    const { cards } = canvasView(fixtureEvents());
    const ids = cards.map((c) => c.cardId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(cards[0]).toMatchObject({ kind: "finding", finding: { category: "fees" } });
    expect(cards.slice(1, 3)).toEqual([
      expect.objectContaining({ kind: "excerpt", citation: { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" } }),
      expect.objectContaining({ kind: "excerpt", citation: expect.objectContaining({ document_id: "fee-table" }) }),
    ]);
    expect(cards.every((c) => c.kind === "finding" || /^excerpt:/.test(c.cardId))).toBe(true);
  });
});

// A find-similar run (#64) as the backend records it: step.started and step.completed under one run id,
// with its seed on both, appended after the given log.
const SEEDED = "5e2a9c47-1d3b-4f60-8a7e-0c9b6d2f4e18";
const feeSeed = { document_id: "factsheet", page: 1, quote: "Annual management fee: 0.85% per annum" };

function withSeededRun(log: readonly SlimEvent[], step: "extract" | "contradictions", inputRunId: string | null, output: object) {
  const run = { step, model: "recorded-fake-model", prompt_version: `${step}@1`, input_run_id: inputRunId, seed: feeSeed };
  const event = (type: "step.started" | "step.completed", payload: object) => {
    const seq = log.length + (type === "step.started" ? 1 : 2);
    return SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: log[0]!.case_id,
      actor: "demo-analyst",
      at: log.at(-1)!.at,
      step_run_id: SEEDED,
      type,
      v: 1,
      payload,
    });
  };
  return [...log, event("step.started", run), event("step.completed", { ...run, output })];
}

describe("find-similar candidates", () => {
  const minimum = { document_id: "factsheet", page: 1, quote: "Minimum initial investment: USD 1,000" };

  it("turns a seeded extract's statements into excerpt cards after the board's, naming the run", () => {
    const base = canvasView(fixtureEvents());
    const { state, cards } = canvasView(withSeededRun(fixtureEvents(), "extract", null, { statements: [feeSeed, minimum] }));

    // The seed's own passage already has a card; only the new passage is added, as a candidate.
    expect(cards.slice(0, base.cards.length)).toEqual(base.cards);
    expect(cards.slice(base.cards.length)).toEqual([
      { cardId: excerptCardId(minimum), kind: "excerpt", citation: minimum, candidateOf: SEEDED },
    ]);
    // The board is untouched: the same findings, and no step's latest run is the seeded one.
    expect(activeFindings(state)).toEqual(activeFindings(base.state));
    expect(state.stepRuns).toEqual(base.state.stepRuns);
  });

  it("turns a seeded contradictions run's issues into excerpt cards for the claims they point at", () => {
    // The recorded case as it stood after decompose, before any finding: every card is a candidate.
    const decomposed = recordedEvents.slice(0, 11);
    const decompose = fold(decomposed).stepRuns.find((r) => r.step === "decompose")!;
    const issues = [{ kind: "contradiction", category: "fees", claim_id: "c1", counterpart_claim_id: "c2", explanation: "0.85% against 1.25%." }];

    const { cards } = canvasView(withSeededRun(decomposed, "contradictions", decompose.stepRunId, { issues }));

    expect(cards).toEqual([
      { cardId: excerptCardId(feeSeed), kind: "excerpt", citation: feeSeed, candidateOf: SEEDED },
      expect.objectContaining({
        kind: "excerpt",
        citation: { document_id: "fee-table", page: 1, quote: "Annual management fee: 1.25% of net asset value" },
        candidateOf: SEEDED,
      }),
    ]);
  });

  it("offers nothing from a seeded run that has not completed", () => {
    const log = withSeededRun(fixtureEvents(), "extract", null, { statements: [minimum] }).slice(0, -1);
    expect(canvasView(log).cards).toEqual(canvasView(fixtureEvents()).cards);
  });
});

describe("the live source", () => {
  it("reads the case's events through the transport it is given, and folds them the same way", async () => {
    forbidNetwork();
    const fetchEvents = vi.fn(async () => recordedEvents);

    const events = await loadCanvasEvents({ kind: "live", caseId: "case-1" }, { fetchEvents });

    expect(fetchEvents).toHaveBeenCalledWith("case-1");
    expect(events).toBe(recordedEvents);
    expect(canvasView(events).cards).toEqual(canvasView(fixtureEvents()).cards);
  });
});
