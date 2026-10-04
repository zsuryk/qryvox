import type { IntentChip } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { chipLabel, intentCards } from "../lib/intent-chips";

// The chips filter and focus the cards the case has (#70): a pure function of the log and the chips.

const events = fixtureEvents();
const view = canvasView(events);
const chip = (category: IntentChip["category"], authority: IntentChip["authority"], step_kind: IntentChip["step_kind"]): IntentChip => ({
  category,
  authority,
  step_kind,
});
const select = (...chips: IntentChip[]) => intentCards(view, events, chips);
const board = view.state.board;
const own = new Set([...board.docked, ...board.pinned, ...board.discarded].map((e) => e.cardId));
const kindsOf = (card: (typeof view.all)[number]) => {
  const cited = card.kind === "finding" ? [card.finding.citation, card.finding.counterpart] : [card.citation];
  return cited.flatMap((d) => view.state.documents.filter((x) => d && x.documentId === d.document_id).map((x) => x.kind));
};

describe("intent chips", () => {
  it("show the default canvas when there are no chips", () => {
    const shown = select();
    expect(shown.cards).toBe(view.cards);
    expect(shown.nothing).toBe(false);
  });

  it("a category chip shows that category's finding cards and their excerpts", () => {
    const shown = select(chip("risk", null, null));
    const theirs = shown.cards.filter((c) => !own.has(c.cardId));
    expect(theirs.some((c) => c.kind === "finding")).toBe(true);
    expect(theirs.some((c) => c.kind === "excerpt")).toBe(true);
    for (const card of theirs) if (card.kind === "finding") expect(card.finding.category).toBe("risk");
    expect(shown.cards.length).toBeLessThan(view.all.length);
  });

  it("an authority chip shows the cards citing that document kind", () => {
    const shown = select(chip(null, "fee_table", null));
    const theirs = shown.cards.filter((c) => !own.has(c.cardId));
    expect(theirs.length).toBeGreaterThan(0);
    for (const card of theirs) expect(kindsOf(card)).toContain("fee_table");
  });

  it("a contradictions chip shows the cross-check's findings; policy gaps are the compliance chip's", () => {
    const shown = select(chip(null, null, "contradictions")).cards.filter((c) => c.kind === "finding" && !own.has(c.cardId));
    expect(shown.length).toBeGreaterThan(0);
    for (const card of shown) if (card.kind === "finding") expect(card.finding.kind).not.toBe("policy_gap");
    expect(select(chip(null, null, "compliance")).nothing).toBe(true);
  });

  it("an extract chip brings the latest extract run's statements on, the latent ones too, and no findings", () => {
    const shown = select(chip(null, null, "extract"));
    const latent = view.all.filter((c) => c.kind === "excerpt" && c.latent);
    for (const card of latent) expect(shown.cards.map((c) => c.cardId)).toContain(card.cardId);
    expect(shown.matched).toBeGreaterThanOrEqual(latent.length);
    expect(shown.cards.some((c) => c.kind === "finding" && !own.has(c.cardId))).toBe(false);
    expect(view.cards.some((c) => c.kind === "excerpt" && c.latent)).toBe(false);
  });

  it("every field of a chip has to match", () => {
    const narrow = select(chip("risk", "ppm", "contradictions")).matched;
    expect(narrow).toBeGreaterThan(0);
    // No fee finding cites the PPM, so asking for fees in the PPM selects nothing.
    expect(select(chip("fees", "ppm", "contradictions")).matched).toBe(0);
    expect(narrow).toBeLessThanOrEqual(select(chip("risk", null, null)).matched);
    expect(narrow).toBeLessThanOrEqual(select(chip(null, "ppm", null)).matched);
    expect(narrow).toBeLessThanOrEqual(select(chip(null, null, "contradictions")).matched);
  });

  it("chips together show what any of them names", () => {
    const a = select(chip("fees", null, null)).matched;
    const b = select(chip(null, "ppm", null)).matched;
    const both = select(chip("fees", null, null), chip(null, "ppm", null)).matched;
    expect(both).toBeGreaterThanOrEqual(Math.max(a, b));
    expect(both).toBeLessThanOrEqual(a + b);
  });

  it("chips that match nothing say so, and the analyst's own cards still show", () => {
    const shown = select(chip(null, null, "attributes"));
    expect(shown.nothing).toBe(true);
    expect(shown.matched).toBe(0);
    expect(shown.cards.map((c) => c.cardId).sort()).toEqual(view.all.filter((c) => own.has(c.cardId)).map((c) => c.cardId).sort());
  });

  it("keep a pinned, a docked and a discarded card whatever the chips say", () => {
    const shown = select(chip(null, null, "decompose")).cards.map((c) => c.cardId);
    expect(board.pinned.length + board.docked.length + board.discarded.length).toBeGreaterThanOrEqual(3);
    for (const entry of [...board.docked, ...board.pinned, ...board.discarded]) expect(shown).toContain(entry.cardId);
  });

  it("read the log and leave it as it was", () => {
    const before = JSON.stringify(events);
    select(chip("risk", "ppm", "contradictions"));
    expect(JSON.stringify(events)).toBe(before);
  });

  it("name a chip in words", () => {
    expect(chipLabel(chip("fees", "ppm", "contradictions"))).toBe("Fees · PPM · Contradictions");
    expect(chipLabel(chip(null, "fee_table", null))).toBe("Fee table");
  });
});
