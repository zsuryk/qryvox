import { z } from "zod";
import type { DocumentKind } from "./events.js";
import { type Citation, FindingCategory } from "./finding.js";

// The canvas (#48): findings and evidence excerpts laid out as cards on an infinite board. What the analyst
// does to a card (dock, pin, discard, find similar) is an event in the log like any other human decision,
// and the board state is folded from those events (fold.ts). None of it touches the finding underneath.

// A card's id says what kind of card it is and is derived from what it shows, so the same finding or the
// same passage is the same card in every browser and on every replay, with nothing stored to look it up:
//   finding:<finding_id>                        — a finding card;
//   excerpt:<document_id>:<page>:<quote hash>   — an excerpt card, one cited passage. The hash is FNV-1a
//                                                 over the quote with whitespace normalised (as grounding
//                                                 does), as 8 hex digits: short, stable, and synchronous in
//                                                 the browser and in Node alike. It is an id, not a check.
export const CardId = z.string().regex(/^(finding:.+|excerpt:.+:[1-9]\d*:[0-9a-f]{8})$/, "not a card id");
export type CardId = z.infer<typeof CardId>;

export function findingCardId(findingId: string): CardId {
  return `finding:${findingId}`;
}

export function excerptCardId(citation: Citation): CardId {
  return `excerpt:${citation.document_id}:${citation.page}:${quoteHash(citation.quote)}`;
}

// The finding a finding card shows, or null for an excerpt card.
export function findingIdOfCard(cardId: CardId): string | null {
  return cardId.startsWith("finding:") ? cardId.slice("finding:".length) : null;
}

function quoteHash(quote: string): string {
  let hash = 0x811c9dc5;
  for (const char of quote.replace(/\s+/g, " ").trim()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Authority runs PPM, fee table, factsheet, deck (CONTEXT.md, PPM): the plan region lists its groups in
// this order within each category, most authoritative first.
export const AUTHORITY_ORDER = ["ppm", "fee_table", "factsheet", "deck"] as const satisfies readonly DocumentKind[];

// Where a docked card sits in the plan region: one category × authority group. Recorded on the dock event
// rather than derived from the card, so an excerpt card (which has no category of its own) docks the same
// way a finding card does, and the fold needs nothing but the log.
export const PlanSlot = z.object({
  category: FindingCategory,
  authority: z.enum(AUTHORITY_ORDER),
});
export type PlanSlot = z.infer<typeof PlanSlot>;

// A point on the board in world coordinates, the viewport's to map to the screen (#52). Never pixels.
export const WorldPos = z.object({ x: z.number().finite(), y: z.number().finite() });
export type WorldPos = z.infer<typeof WorldPos>;
