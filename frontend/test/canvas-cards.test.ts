import { findingCardId, isDiscarded, pinOf, planGroups, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { rationale } from "../lib/board";
import { cardModel, dockableCategories, naturalSlot } from "../lib/canvas-cards";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { appendOp, canvasLog, type PendingOp, reread, rolledBack, sent, settled, shownLog } from "../lib/canvas-store";

// The card component's model (#54) and the canvas store: both kinds read off the fixture, and card
// operations appended to the log and folded back, never kept anywhere else.

const view = canvasView(fixtureEvents());
const findingCard = view.cards.find((c) => c.kind === "finding")!;
const excerptCard = view.cards.find((c) => c.kind === "excerpt")!;
const envelope = (n: number) => ({ eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "9")}`, at: "2026-10-03T12:00:00.000Z" });

describe("the card model", () => {
  it("gives a finding card the model's rationale where a rationale run wrote one (#62), marked written", () => {
    const f = findingCard.kind === "finding" ? findingCard.finding : null;
    const model = cardModel(findingCard, view.state, new Map([[f!.finding_id, "An investor could pay more than they were told."]]));
    expect(model).toMatchObject({ kind: "finding", rationale: "An investor could pay more than they were told.", written: true });
    expect(cardModel(findingCard, view.state)).toMatchObject({ rationale: rationale(f!), written: false });
  });

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
    expect(naturalSlot(findingCard, view)).toEqual({ category: "fees", authority: "factsheet" });
    expect(naturalSlot(excerptCard, view)).toEqual({ category: "fees", authority: "factsheet" });
    expect(dockableCategories(excerptCard, view)).toEqual(["fees"]);
    // A passage no finding cites has no category, so it has no slot.
    const loose = { cardId: "excerpt:ppm:9:0000beef", kind: "excerpt", citation: { document_id: "ppm", page: 9, quote: "x" } } as const;
    expect(naturalSlot(loose, view)).toBeNull();
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

  it("undocks on the fixture like any other operation", () => {
    const docked = appendOp(fixtureEvents(), { type: "card.undocked", payload: { card_id: findingCard.cardId } }, envelope(5));
    expect(planGroups(canvasView(docked).state)).toEqual([]);
  });
});

// On a live case (#65): an operation is shown at once, as the event it will be, and the server's answer
// either confirms it or takes it back. What is shown is always the confirmed log plus what is in flight.
describe("the live store", () => {
  const events = fixtureEvents();
  const [, , third] = canvasView(events).cards.filter((c) => c.kind === "finding");
  const restore: PendingOp = { op: { type: "card.restored", payload: { card_id: third!.cardId } }, envelope: envelope(6) };
  const pin: PendingOp = { op: { type: "card.pinned", payload: { card_id: third!.cardId, world_pos: { x: 48, y: 960 } } }, envelope: envelope(7) };
  // The event the server would answer with, at the seq it was given there.
  const recorded = (p: PendingOp, seq: number) => {
    const event = appendOp(events, p.op, p.envelope).at(-1)!;
    return { ...event, seq } as Extract<SlimEvent, { type: "card.restored" | "card.pinned" }>;
  };

  it("shows a sent operation before the answer, after what the server confirmed", () => {
    const log = sent(sent(canvasLog(events), restore), pin);
    const shown = shownLog(log);
    expect(shown.slice(0, events.length)).toEqual(events);
    expect(shown.slice(events.length).map((e) => [e.seq, e.type])).toEqual([
      [31, "card.restored"],
      [32, "card.pinned"],
    ]);
    expect(pinOf(canvasView(shown).state, third!.cardId)).toEqual({ x: 48, y: 960 });
  });

  it("confirms an answered operation with the event the server wrote", () => {
    const log = settled(sent(sent(canvasLog(events), restore), pin), recorded(restore, 31));
    expect(log).not.toBe("stale");
    if (log === "stale") return;
    expect(log.confirmed).toHaveLength(events.length + 1);
    expect(log.pending).toEqual([pin]);
    expect(shownLog(log).at(-1)).toMatchObject({ seq: 32, type: "card.pinned" });
  });

  it("takes a refused operation back, leaving the canvas as the server has it plus what is still in flight", () => {
    const log = rolledBack(sent(sent(canvasLog(events), restore), pin), restore.envelope.eventId);
    const state = canvasView(shownLog(log)).state;
    expect(isDiscarded(state, third!.cardId)).toBe(true);
    expect(shownLog(log).at(-1)).toMatchObject({ seq: 31, type: "card.pinned" });
  });

  it("asks for the log again when the answer is not the next event, and a re-read settles what it holds", () => {
    const log = sent(canvasLog(events), pin);
    expect(settled(log, recorded(pin, 32))).toBe("stale");
    const elsewhere = appendOp(events, restore.op, restore.envelope);
    const fresh = [...elsewhere, recorded(pin, 32)];
    expect(reread(log, fresh)).toEqual({ confirmed: fresh, pending: [] });
  });
});
