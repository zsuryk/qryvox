import type { SlimEvent } from "./events.js";
import { Citation } from "./finding.js";

// Find similar, first answer (#60): the passages most like a card's, ranked from the statements the case's
// latest unseeded extract run already holds, by BM25 over their words. Nothing new is stored and no model
// is called, so the neighbours are instant, free, the same on every replay, and grounded by construction:
// every one is a statement extract already found verbatim on its page. A seeded re-run (#64) stays the
// way to look further, for what extraction missed.

export type Neighbour = { citation: Citation; score: number };

// BM25's usual constants: how fast a repeated word stops adding, and how much a long passage is discounted.
const K1 = 1.2;
const B = 0.75;

export function nearestStatements(events: readonly SlimEvent[], citation: Citation, k = 5): Neighbour[] {
  const statements = latestStatements(events);
  if (statements.length === 0 || k <= 0) return [];
  const docs = statements.map((s) => tokens(s.quote));
  const avgLength = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const frequency = new Map<string, number>();
  for (const doc of docs) for (const term of new Set(doc)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const idf = (term: string) => {
    const df = frequency.get(term) ?? 0;
    return Math.log(1 + (statements.length - df + 0.5) / (df + 0.5));
  };

  const query = [...new Set(tokens(citation.quote))];
  const own = squash(citation.quote);
  return statements
    .flatMap((statement, i): Neighbour[] => {
      if (squash(statement.quote) === own) return [];
      const doc = docs[i]!;
      const score = query.reduce((sum, term) => {
        const tf = doc.filter((t) => t === term).length;
        if (tf === 0) return sum;
        return sum + (idf(term) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLength));
      }, 0);
      return score > 0 ? [{ citation: statement, score }] : [];
    })
    .sort((a, b) => b.score - a.score || order(a.citation, b.citation))
    .slice(0, k);
}

// The statements of the latest completed extract run that was not a find-similar run, once each. A seeded
// run answers one passage, not the pack, so its statements are candidates rather than the case's corpus.
function latestStatements(events: readonly SlimEvent[]): Citation[] {
  const latest = [...events]
    .sort((a, b) => b.seq - a.seq)
    .find((e) => e.type === "step.completed" && e.payload.step === "extract" && e.payload.seed === undefined);
  const parsed = latest?.type === "step.completed" ? Citation.array().safeParse(latest.payload.output.statements) : undefined;
  if (!parsed?.success) return [];
  const seen = new Set<string>();
  return parsed.data.filter((s) => {
    const key = `${s.document_id}\u0000${s.page}\u0000${squash(s.quote)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Words that say nothing about what a passage is about.
const STOP_WORDS = new Set(
  "a all an and any are as at be been by can each every for from has have if in into is it its may must not of on or our per such than that the their them there these this those to was were which will with would you your".split(
    " ",
  ),
);

// English words and numbers, lowercased. A number keeps its decimals and percent sign ("2.00%") and is
// compared by value, so "2%" matches it, as explain compares numbers; a plural is folded to its singular
// ("charges", "redemptions"), the only stemming. A PPM's leading clause number ("7.2 ") is its paragraph's
// name, not its content, and is left out.
export function tokens(text: string): string[] {
  const body = text.toLowerCase().replace(/^\s*\d+(?:\.\d+)+\s+/, "");
  return [...body.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?|[\p{L}\p{N}]+/gu)].flatMap(([word]) => {
    if (/^\d/.test(word)) {
      const percent = word.endsWith("%");
      return [`${Number(word.replace(/[,%]/g, ""))}${percent ? "%" : ""}`];
    }
    if (STOP_WORDS.has(word)) return [];
    return [singular(word)];
  });
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// Ties broken by where the passage is, so the order never depends on the order of the run's output.
function order(a: Citation, b: Citation): number {
  return a.document_id.localeCompare(b.document_id) || a.page - b.page || a.quote.localeCompare(b.quote);
}
