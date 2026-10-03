import { findingCardId, isDiscarded, pinOf, planGroups, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { rationale } from "../lib/board";
import { cardModel, dockableCategories, naturalSlot } from "../lib/canvas-cards";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { appendOp, operations } from "../lib/canvas-store";

// The card component's model (#54) and the canvas store: both kinds read off the fixture, and card
// operations appended to the log and folded back, never kept anywhere else.

const view = canvasView(fixtureEvents());
const findingCard = view.cards.find((c) => c.kind === "finding")!;
const excerptCard = view.cards.find((c) => c.kind === "excerpt")!;
const envelope = (n: number) => ({ eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "9")}`, at: "2026-10-03T12:00:00.000Z" });

describe("the card model", () => {
  it("gives a finding card its badges, its sentence, the board's rationale and the passage it is cited on", () => {
    const model = cardModel(findingCard, view.state);
    expect(model).toMatchObject({
      kind: "finding",
      category: "Fees",
      severityLabel: "High",
      authority: "Factsheet",
      title: findingCard.kind === "finding" ? findingCard.finding.claim : "",
      citation: { documentName: "larkspur-factsheet.pdf", kind: "factsheet", citation: { page: 1 } },
    });
    // The rationale is the claim board's, reused, not a new sentence.
    expect(model.kind === "finding" && findingCard.kind === "finding" && model.rationale).toBe(rationale(findingCard.finding));
  });

  it("gives an excerpt card its document, kind, page, quote and the findings that cite it", () => {
    expect(cardModel(excerptCard, view.state)).toMatchObject({
      kind: "excerpt",
      documentName: "larkspur-factsheet.pdf",
      documentKind: "Factsheet",
      page: 1,
      quote: "Annual management fee: 0.85% per annum",
      linked: [{ cardId: findingCard.cardId, label: "Fees · contradiction" }],
      candidate: false,
    });
  });

  it("docks a card in its category, under the authority of the document it cites", () => {
    expect(naturalSlot(findingCard, view.state)).toEqual({ category: "fees", authority: "factsheet" });
    expect(naturalSlot(excerptCard, view.state)).toEqual({ category: "fees", authority: "factsheet" });
    expect(dockableCategories(excerptCard, view.state)).toEqual(["fees"]);
    // A passage no finding cites has no category, so it has no slot.
    const loose = { cardId: "excerpt:ppm:9:0000beef", kind: "excerpt", citation: { document_id: "ppm", page: 9, quote: "x" } } as const;
    expect(naturalSlot(loose, view.state)).toBeNull();
  });
});

describe("the canvas store", () => {
  it("appends a card operation at the next seq, and the fold reads it like any other event", () => {
    const events = fixtureEvents();
    const [, , third] = canvasView(events).cards.filter((c) => c.kind === "finding");
    const restored = appendOp(events, { type: "card.restored", payload: { card_id: third!.cardId } }, envelope(1));
    const pinned = appendOp(restored, { type: "card.pinned", payload: { card_id: third!.cardId, world_pos: { x: 48, y: 960 } } }, envelope(2));

    expect(pinned.slice(-2).map((e) => [e.seq, e.type, e.actor, e.step_run_id])).toEqual([
      [31, "card.restored", "demo-analyst", null],
      [32, "card.pinned", "demo-analyst", null],
    ]);
    const state = canvasView(pinned).state;
    expect(isDiscarded(state, third!.cardId)).toBe(false);
    expect(pinOf(state, third!.cardId)).toEqual({ x: 48, y: 960 });
    // The log it was given is untouched.
    expect(events).toEqual(fixtureEvents());
  });

  it("refuses an operation the contract refuses, before it reaches the fold", () => {
    const events = SlimEvent.array().parse(recorded);
    expect(() =>
      appendOp(events, { type: "card.docked", payload: { card_id: findingCardId("x"), plan_slot: { category: "fees", authority: "prospectus" as "ppm" } } }, envelope(3)),
    ).toThrow();
    expect(() => appendOp([], { type: "card.undocked", payload: { card_id: findingCardId("x") } }, envelope(4))).toThrow();
  });

  it("records on the fixture, and says why not on a live case", () => {
    expect(operations({ kind: "fixture" })).toEqual({ enabled: true });
    expect(operations({ kind: "live", caseId: "c" })).toEqual({ enabled: false, reason: expect.stringContaining("backend") });
    const docked = appendOp(fixtureEvents(), { type: "card.undocked", payload: { card_id: findingCard.cardId } }, envelope(5));
    expect(planGroups(canvasView(docked).state)).toEqual([]);
  });
});
