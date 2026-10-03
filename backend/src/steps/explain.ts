import {
  type CaseAdvice,
  type CaseClient,
  type CaseDocument,
  type CaseFinding,
  Explanation,
  type ExplanationDepth,
  KnowledgeLevel,
  productRiskLevel,
  type ProductAttributes,
  ruleById,
  RULES,
} from "@qryvox/shared";
import { z } from "zod";
import { attributesOf } from "../advice.js";
import { foldCase } from "../log.js";
import { normalize } from "./inputs.js";
import { StepPrecondition, type StepDefinition } from "./step.js";

// explain@1 — words one advice's verdict at the three knowledge depths (#30). The rules decided the
// verdict; this step may only restate it. Every passage is checked against the advice it explains:
// all of it covered, nothing quoted that its citation does not say, no rule or document it does not
// cite, no number that is neither in its quote nor the client's own answer.

// One reason or disclosure of the advice, as the model sees it and the checks hold it to.
type Item = {
  ref: string;
  rule: string;
  // The documents and quotes it rests on: one for a reason (none when nothing speaks to it), both sides of
  // the finding for a disclosure.
  documents: string[];
  quotes: string[];
  // Numbers this passage may state: those in its quote, the pages it cites, and the client's answer it
  // compares against.
  numbers: Set<string>;
  // What the model is told about it.
  brief: string;
};

type ExplainInput = { adviceId: string; advice: CaseAdvice; items: Item[]; documents: CaseDocument[] };

const ExplainReply = z.object({ depths: z.record(z.string(), z.unknown()) });
type ExplainReply = z.infer<typeof ExplainReply>;

export const EXPLAIN_SYSTEM_PROMPT = `You explain a suitability verdict on an investment product to a client. The verdict is already decided by fixed rules. You never change it, add to it, or give advice of your own.

Write the explanation three times, for three readers:
- novice: plain everyday words, no jargon, short sentences.
- informed: plain words; financial terms are fine when you say what they mean.
- expert: concise and precise.

For each reader write:
- summary: one or two sentences saying what the verdict is and, in general terms, why. No numbers.
- passages: exactly one passage for every item you are given (reasons r0, r1, … and disclosures d0, d1, …), with that item's ref.

Each passage explains only its own item:
- Use only the facts given for that item. Do not mention any other rule, document, product or fact.
- When you quote the document, copy the words exactly and put them in double quotes.
- Any number you write must appear in that item's quote or be the client's own answer given for it.
- Never compute anything, compare returns, predict performance or recommend another product.

Respond with only a JSON object and no other text, in exactly this shape:
{"depths":{"novice":{"summary":"…","passages":[{"ref":"r0","text":"…"}]},"informed":{…},"expert":{…}}}`;

export const explain: StepDefinition<ExplainInput, Explanation, ExplainReply> = {
  name: "explain",

  async loadInput(db, caseId, inputRunId) {
    if (inputRunId === null) throw new StepPrecondition("explain needs input_run_id: the id of the advice to explain");
    const state = await foldCase(db, caseId);
    const advice = state.advice.find((a) => a.adviceId === inputRunId);
    if (!advice) throw new StepPrecondition(`advice ${inputRunId} not found in this case`);
    if (advice.supersededAtSeq !== null) throw new StepPrecondition(`advice ${inputRunId} has been superseded`);
    const client = state.clients.find((c) => c.clientId === advice.client_id)!;
    const attributes = await attributesOf(db, caseId, advice.attributes_run_id);
    return { adviceId: inputRunId, advice, items: items(advice, client, attributes, state.findings), documents: state.documents };
  },

  messages({ advice, items }) {
    const lines = [`Verdict: ${advice.verdict.replace("_", " ")}`, "", "Items:", ...items.map((i) => i.brief)];
    return [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
    ];
  },

  output: ExplainReply,

  ground(reply, { adviceId, items, documents }) {
    const problems: string[] = [];
    const depths: Partial<Record<KnowledgeLevel, ExplanationDepth>> = {};
    for (const depth of KnowledgeLevel.options) {
      const parsed = Explanation.shape.depths.shape[depth].safeParse(reply.depths[depth]);
      if (!parsed.success) {
        problems.push(`${depth}: missing or not in the expected form`);
        continue;
      }
      problems.push(...check(depth, parsed.data, items, documents));
      depths[depth] = parsed.data;
    }
    if (problems.length > 0) return { error: `the explanation does not hold to the advice: ${problems.join("; ")}` };
    return { output: Explanation.parse({ advice_id: adviceId, depths }) };
  },
};

function check(depth: string, text: ExplanationDepth, items: Item[], documents: CaseDocument[]): string[] {
  const problems: string[] = [];
  const refs = text.passages.map((p) => p.ref);
  for (const item of items) {
    const n = refs.filter((r) => r === item.ref).length;
    if (n !== 1) problems.push(`${depth}: ${item.ref} is explained ${n} times, not once`);
  }
  for (const ref of refs) if (!items.some((i) => i.ref === ref)) problems.push(`${depth}: ${ref} is not in the advice`);
  if (/\d/.test(text.summary.replace(/\b[PS]\d+\b/g, ""))) problems.push(`${depth}: the summary states a number`);

  const cited = new Set(items.flatMap((i) => i.documents));
  const rules = new Set(items.map((i) => i.rule));
  for (const passage of text.passages) {
    const item = items.find((i) => i.ref === passage.ref);
    if (!item) continue;
    const where = `${depth} ${passage.ref}`;
    for (const quoted of quotations(passage.text)) {
      if (!item.quotes.some((q) => normalize(q).toLowerCase().includes(normalize(quoted).toLowerCase()))) {
        problems.push(`${where} quotes "${quoted}", which its citation does not say`);
      }
    }
    for (const id of passage.text.match(/\b[PS]\d+\b/g) ?? []) {
      if (RULES.some((r) => r.id === id) && !rules.has(id)) problems.push(`${where} names rule ${id}, which the advice does not apply`);
    }
    for (const d of documents) {
      if (!cited.has(d.documentId) && new RegExp(`\\b${d.documentId}\\b`, "i").test(passage.text)) {
        problems.push(`${where} names ${d.documentId}, which the advice does not cite`);
      }
    }
    // Rule ids (S1, P4) are names, not stated numbers.
    for (const n of passage.text.replace(/\b[PS]\d+\b/g, "").match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!item.numbers.has(n)) problems.push(`${where} states ${n}, which is neither in its quote nor the client's answer`);
    }
  }
  return problems;
}

// Spans in double quotes, straight or curly, long enough to be a quotation rather than a word.
function quotations(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]{8,})["”]/g)].map((m) => m[1]!);
}

function numbersIn(...texts: (string | number | null)[]): Set<string> {
  return new Set(texts.flatMap((t) => (t === null ? [] : String(t).match(/\d+(?:\.\d+)?/g) ?? [])));
}

function items(advice: CaseAdvice, client: CaseClient, attributes: ProductAttributes, findings: readonly CaseFinding[]): Item[] {
  const reasons = advice.reasons.map((reason, i): Item => {
    const rule = ruleById(reason.rule);
    const answer = client.profile[reason.profile_field];
    const productLevel = reason.rule === "S2" ? productRiskLevel(attributes) : null;
    return {
      ref: `r${i}`,
      rule: reason.rule,
      documents: reason.citation ? [reason.citation.document_id] : [],
      quotes: reason.citation ? [reason.citation.quote] : [],
      numbers: numbersIn(
        reason.citation?.quote ?? null,
        reason.citation?.page ?? null,
        Array.isArray(answer) ? answer.join(" ") : String(answer),
        productLevel,
      ),
      brief: [
        `- r${i}: rule ${reason.rule} "${rule.title}": ${rule.text}`,
        `  outcome: ${reason.effect}`,
        `  client's answer (${reason.profile_field}): ${JSON.stringify(answer)}`,
        productLevel === null ? null : `  product risk level, mapped from its attributes: ${productLevel}`,
        reason.citation
          ? `  quote (${reason.citation.document_id}, page ${reason.citation.page}): "${reason.citation.quote}"`
          : "  quote: none; nothing in the documents speaks to this",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  });
  const disclosures = advice.disclosures.map((d, i): Item => {
    const finding = findings.find((f) => f.finding_id === d.finding_id);
    const sides = [d.citation, ...(finding ? [finding.citation, finding.counterpart] : [])].filter((c) => c !== null);
    const unique = sides.filter((c, j) => sides.findIndex((o) => o.quote === c.quote) === j);
    return {
      ref: `d${i}`,
      rule: d.rule,
      documents: unique.map((c) => c.document_id),
      quotes: unique.map((c) => c.quote),
      numbers: numbersIn(...unique.flatMap((c) => [c.quote, c.page])),
      brief: [
        `- d${i}: disclosure under rule ${d.rule}: ${finding?.claim ?? d.finding_id}`,
        ...unique.map((c) => `  quote (${c.document_id}, page ${c.page}): "${c.quote}"`),
      ].join("\n"),
    };
  });
  return [...reasons, ...disclosures];
}

