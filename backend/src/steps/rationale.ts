import { type CaseDocument, type CaseFinding, type Rationale, RATIONALE_MAX_LENGTH, RationaleOutput, ruleById } from "@qryvox/shared";
import { z } from "zod";
import { foldCase } from "../log.js";
import { numbersIn, quotations, quotedFrom, statedNumbers, value } from "./inputs.js";
import { StepPrecondition, type StepDefinition } from "./step.js";

// rationale@1 — one plain-language sentence per finding on why it matters, for every finding of one
// completed findings run in a single model call (#62). Optional: a card without one shows the line the board
// derives from the finding's kind. Grounded like explain, one finding at a time: anything it quotes must be
// verbatim in that finding's citation or counterpart, and any number it states must be in them. A rationale
// that does not hold is dropped, not the run; a run with none left fails.

type RationaleInput = { findings: CaseFinding[]; documents: CaseDocument[] };

// The model names each finding by a short ref (f1, f2, …) rather than copying its id; ground maps it back.
// Entries are checked one by one, so a malformed one loses only itself.
const RationaleReply = z.object({ rationales: z.array(z.unknown()) });
type RationaleReply = z.infer<typeof RationaleReply>;
const ReplyEntry = z.object({ finding: z.string(), text: z.string() });

export const RATIONALE_SYSTEM_PROMPT = `You write one plain-language sentence for each finding an investment analyst is reviewing in one product's documents, saying why it matters to someone who invests in the product. The analyst reads it on the finding's card, right under the finding itself, so do not repeat the finding: say what it could mean for an investor.

For each finding (f1, f2, …) write:
- finding: its ref.
- text: one sentence of at most 35 words.

Each sentence is about its own finding only:
- Use only that finding and its quoted passages. Do not mention any other finding, document, product or fact.
- When you quote a passage, copy the words exactly and put them in double quotes.
- Any number you write must appear in that finding's quoted passages. Never compute a number, compare returns or predict performance.
- Do not advise, recommend, or say whether to invest. Do not judge whether the finding is right; the analyst decides that.

Respond with only a JSON object and no other text, in exactly this shape:
{"rationales":[{"finding":"f1","text":"<one sentence>"}]}`;

export const rationale: StepDefinition<RationaleInput, RationaleOutput, RationaleReply> = {
  name: "rationale",

  async loadInput(db, caseId, inputRunId) {
    if (inputRunId === null) throw new StepPrecondition("rationale needs input_run_id: a completed findings run");
    const state = await foldCase(db, caseId);
    const run = state.stepRuns.find((r) => r.stepRunId === inputRunId);
    if (!run || run.step !== "findings" || run.status !== "completed") {
      throw new StepPrecondition("input_run_id must name a completed findings run in this case");
    }
    const findings = state.findings.filter((f) => f.stepRunId === inputRunId);
    if (findings.length === 0) throw new StepPrecondition(`findings run ${inputRunId} found nothing to explain`);
    // A later findings run replaced the board; its rationales would never be shown (rationaleFor).
    if (findings.some((f) => f.supersededAtSeq !== null)) throw new StepPrecondition(`findings run ${inputRunId} has been superseded`);
    return { findings, documents: state.documents };
  },

  messages({ findings }) {
    const lines = findings.map((f, i) =>
      [
        `- f${i + 1}: ${f.kind.replace("_", " ")}, ${f.category}, ${f.severity} severity: ${f.claim}`,
        f.rule ? `  rule ${f.rule} "${ruleById(f.rule).title}": ${ruleById(f.rule).text}` : null,
        `  quote (${f.citation.document_id}, page ${f.citation.page}): "${f.citation.quote}"`,
        f.counterpart
          ? `  counterpart (${f.counterpart.document_id}, page ${f.counterpart.page}): "${f.counterpart.quote}"`
          : "  counterpart: none; nothing in the documents speaks to it",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    );
    return [
      { role: "system", content: RATIONALE_SYSTEM_PROMPT },
      { role: "user", content: ["Findings:", ...lines].join("\n") },
    ];
  },

  output: RationaleReply,

  // Keeps, for each finding, the first rationale that holds to it, in the order of the findings. An entry
  // naming no finding of the run, or one already given a rationale, is dropped.
  ground(reply, { findings, documents }) {
    const problems: string[] = [];
    const kept = new Map<string, Rationale>();
    for (const raw of reply.rationales) {
      const entry = ReplyEntry.safeParse(raw);
      if (!entry.success) {
        problems.push("an entry not in the expected form");
        continue;
      }
      const ref = entry.data.finding.trim().toLowerCase();
      const finding = /^f\d+$/.test(ref) ? findings[Number(ref.slice(1)) - 1] : undefined;
      if (!finding) {
        problems.push(`${entry.data.finding} is not a finding of this run`);
        continue;
      }
      if (kept.has(finding.finding_id)) continue;
      const text = entry.data.text.replace(/\s+/g, " ").trim();
      const wrong = check(ref, text, finding, documents);
      if (wrong.length > 0) {
        problems.push(...wrong);
        continue;
      }
      kept.set(finding.finding_id, { finding_id: finding.finding_id, text });
    }
    if (kept.size === 0) return { error: `no rationale holds to its finding${problems.length ? `: ${problems.join("; ")}` : ""}` };
    const rationales = findings.flatMap((f) => kept.get(f.finding_id) ?? []);
    return { output: RationaleOutput.parse({ rationales }) };
  },
};

function check(ref: string, text: string, finding: CaseFinding, documents: CaseDocument[]): string[] {
  const problems: string[] = [];
  if (text.length === 0 || text.length > RATIONALE_MAX_LENGTH) problems.push(`${ref} is empty or longer than one sentence`);
  const sides = [finding.citation, ...(finding.counterpart ? [finding.counterpart] : [])];
  const quotes = [...sides.map((c) => c.quote), ...(finding.rule ? [ruleById(finding.rule).title, ruleById(finding.rule).text] : [])];
  for (const quoted of quotations(text)) {
    if (!quotedFrom(quoted, quotes)) problems.push(`${ref} quotes "${quoted}", which its finding's passages do not say`);
  }
  const numbers = numbersIn(...sides.map((c) => c.quote));
  for (const n of statedNumbers(text)) {
    if (!numbers.has(value(n))) problems.push(`${ref} states ${n}, which its finding's passages do not`);
  }
  // The documents it cites, and those its own wording names: an unsupported claim cites only the deck, yet
  // is about what the PPM does not say, and the card already shows that.
  const names = (document: CaseDocument, words: string) => new RegExp(`\\b${document.documentId}\\b`, "i").test(words);
  for (const d of documents) {
    if (!sides.some((c) => c.document_id === d.documentId) && !names(d, finding.claim) && names(d, text)) {
      problems.push(`${ref} names ${d.documentId}, which its finding neither cites nor names`);
    }
  }
  return problems;
}
