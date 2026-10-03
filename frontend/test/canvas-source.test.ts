import { activeFindings, findingCardId, fold, isDiscarded, pinOf, planGroups, SlimEvent } from "@qryvox/shared";
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
