import {
  type CaseAdvice,
  type CaseClient,
  type CaseDocument,
  type CaseFinding,
  type ClientLanguage,
  Explanation,
  type ExplanationDepth,
  KnowledgeLevel,
  productRiskLevel,
  type ProductAttributes,
  ruleById,
  RULES,
  VERDICT_HEADLINE,
} from "@qryvox/shared";
import { z } from "zod";
import { attributesOf } from "../advice.js";
import { foldCase } from "../log.js";
import { normalize, numbersIn, quotations, quotedFrom, statedNumbers, value } from "./inputs.js";
import { StepPrecondition, type StepDefinition } from "./step.js";

// explain@1 — words one advice's verdict at the three knowledge depths (#30). The rules decided the
// verdict; this step may only restate it. Every passage is checked against the advice it explains:
// all of it covered, nothing quoted that its citation does not say, no rule or document it does not
// cite, no number that is neither in its quote nor the client's own answer.
// A client may ask for it in the other language (#75): the same prompt, with the language note for that one.
// explain@2 (#67): the client's page already headlines the verdict right above the summary, so the summary
// starts from the main reason instead of saying the verdict again, and a summary that opens with the
// headline is refused.
// explain@3 (#78): Kimi K3 was refused too often by the checks (computed gaps, "5y", paraphrases in quotation marks).
// The checks are unchanged; the prompt now states them, each item lists the numbers it may state, and a refused
// first attempt gets one retry inside the same run with the refusal reason fed back (retryOnRefusal).

// One reason or disclosure of the advice, as the model sees it and the checks hold it to.
type Item = {
  ref: string;
  // The rules it may name: its own, and for a disclosure of a policy gap, the product rule the gap breaks.
  rules: string[];
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

type ExplainInput = { adviceId: string; advice: CaseAdvice; items: Item[]; documents: CaseDocument[]; language: ClientLanguage };

// The language the explanation is written in (#43). Quoted document text stays as the document has it, in
// straight double quotes, so every grounding check below holds whatever the language around it.
const LANGUAGE_NOTE: Record<ClientLanguage, string> = {
  en: "",
  "zh-Hant":
    "\n\nWrite every summary and passage in Traditional Chinese, as used in Hong Kong (繁體中文). Keep any text you quote from a document exactly as the document has it, in English, inside straight double quotes \"…\". Rule ids (S1, P3) and numbers stay as they are.",
};

const ExplainReply = z.object({ depths: z.record(z.string(), z.unknown()) });
type ExplainReply = z.infer<typeof ExplainReply>;

export const EXPLAIN_SYSTEM_PROMPT = `You explain a suitability verdict on an investment product to a client. The verdict is already decided by fixed rules. You never change it, add to it, or give advice of your own.

Write the explanation three times, for three readers:
- novice: plain everyday words, no jargon, short sentences.
- informed: plain words; financial terms are fine when you say what they mean.
- expert: concise and precise.

For each reader write:
- summary: one or two sentences saying, in general terms, why the verdict is what it is. The client already reads the verdict as a headline right above the summary, so never restate it: start from the main reason, in words. Write no numbers in the summary, not even the client's own; the passages give the figures.
- passages: exactly one passage for every item you are given (reasons r0, r1, … and disclosures d0, d1, …), with that item's ref.

Each passage explains only its own item. The reply is checked mechanically against the advice, and a reply that fails any check is thrown away, so keep to these rules exactly:
- Use only the facts given for that item. Do not mention any other rule, document, product or fact.
- Quotation marks are only for words copied letter for letter from one place: that item's quote line, its rule text, or the client's answer. Copy one unbroken stretch: no "…", no joining two pieces, no changed word, no added word. Never put your own wording, the outcome, a document's name or a paraphrase inside quotation marks. When in doubt, say it in your own words with no quotation marks at all.
- Numbers: each item lists the numbers you may write. Write a number only as it appears in that item's quote or the client's answer, and only when it is on that list. Never calculate: no differences, sums, ratios, averages or percentages of percentages; if the item gives two fees, say which is higher or lower in words, never by how much. Never round, convert or restate a number in another form.
- Never abbreviate: write "five years" as the quote has it, never "5y", "5 yrs" or "5 yr"; write "per annum", "percent" and "months" out as the source does.
- Write no number that is not on the list, not even a year, a count or a page unless the list has it. The summaries contain no digits at all.
- Never predict performance, compare returns, or recommend another product.

Respond with only a JSON object and no other text, in exactly this shape:
{"depths":{"novice":{"summary":"…","passages":[{"ref":"r0","text":"…"}]},"informed":{…},"expert":{…}}}`;

export const explain: StepDefinition<ExplainInput, Explanation, ExplainReply> = {
  name: "explain",
  retryOnRefusal: true,

  async loadInput(db, caseId, inputRunId, _intent, requested) {
    if (inputRunId === null) throw new StepPrecondition("explain needs input_run_id: the id of the advice to explain");
    const state = await foldCase(db, caseId);
    const advice = state.advice.find((a) => a.adviceId === inputRunId);
    if (!advice) throw new StepPrecondition(`advice ${inputRunId} not found in this case`);
    if (advice.supersededAtSeq !== null) throw new StepPrecondition(`advice ${inputRunId} has been superseded`);
    const client = state.clients.find((c) => c.clientId === advice.client_id)!;
    const attributes = await attributesOf(db, caseId, advice.attributes_run_id);
    return {
      adviceId: inputRunId,
      advice,
      items: items(advice, client, attributes, state.findings),
      documents: state.documents,
      // The language asked for (#75), else the client's own (#43).
      language: requested ?? client.profile.language ?? "en",
    };
  },

  messages({ advice, items, language }) {
    const lines = [
      `Verdict: ${advice.verdict.replace("_", " ")}`,
      `Headline the client already sees above the summary, not to be repeated: "${VERDICT_HEADLINE[language][advice.verdict]}"`,
      "",
      "Items:",
      ...items.map((i) => i.brief),
    ];
    return [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT + LANGUAGE_NOTE[language] },
      { role: "user", content: lines.join("\n") },
    ];
  },

  output: ExplainReply,

  ground(reply, { adviceId, items, documents, language }) {
    const problems: string[] = [];
    const depths: Partial<Record<KnowledgeLevel, ExplanationDepth>> = {};
    for (const depth of KnowledgeLevel.options) {
      const parsed = Explanation.shape.depths.shape[depth].safeParse(reply.depths[depth]);
      if (!parsed.success) {
        problems.push(`${depth}: missing or not in the expected form`);
        continue;
      }
      problems.push(...check(depth, parsed.data, items, documents));
      if (repeatsHeadline(parsed.data.summary)) problems.push(`${depth}: the summary opens by repeating the verdict headline`);
      depths[depth] = parsed.data;
    }
    if (problems.length > 0) return { error: `the explanation does not hold to the advice: ${problems.join("; ")}` };
    return { output: Explanation.parse({ advice_id: adviceId, language, depths }) };
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
  // The summary may state a number only if some item of the advice may: a quote, a page, a client's answer.
  const grounded = new Set(items.flatMap((i) => [...i.numbers]));
  for (const n of statedNumbers(text.summary)) {
    if (!grounded.has(value(n))) problems.push(`${depth}: the summary states ${n}, which nothing in the advice holds`);
  }

  const cited = new Set(items.flatMap((i) => i.documents));
  const rules = new Set(items.flatMap((i) => i.rules));
  for (const passage of text.passages) {
    const item = items.find((i) => i.ref === passage.ref);
    if (!item) continue;
    const where = `${depth} ${passage.ref}`;
    for (const quoted of quotations(passage.text)) {
      if (!quotedFrom(quoted, item.quotes)) {
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
    for (const n of statedNumbers(passage.text)) {
      if (!item.numbers.has(value(n))) problems.push(`${where} states ${n}, which is neither in its quote nor the client's answer`);
    }
  }
  return problems;
}

// Whether a summary's first sentence is a verdict headline, in either language, as the page shows it right
// above: the client would read it twice (#67). Any verdict's headline counts, since opening with another
// verdict's would be worse. Compared with whitespace, case and the final punctuation set aside.
function repeatsHeadline(summary: string): boolean {
  const headlines = Object.values(VERDICT_HEADLINE).flatMap((byVerdict) => Object.values(byVerdict).map(sentence));
  return headlines.includes(sentence(firstSentence(summary)));
}

// Up to the first full stop, question or exclamation mark: an English one only before a space or the end,
// so "0.85%" does not end a sentence; a Chinese one wherever it stands.
function firstSentence(text: string): string {
  return text.trim().match(/^.*?(?:[.!?](?=\s|$)|[。！？])/su)?.[0] ?? text;
}

const sentence = (text: string) => normalize(text).replace(/[\s.!?。！？]+$/u, "").toLowerCase();

// What the model is told about the numbers an item may state: exactly the set the check holds it to.
const allowed = (numbers: Set<string>) =>
  numbers.size === 0 ? "  numbers you may write: none" : `  numbers you may write (only as written in the quote or answer, never computed): ${[...numbers].join(", ")}`;

function items(advice: CaseAdvice, client: CaseClient, attributes: ProductAttributes, findings: readonly CaseFinding[]): Item[] {
  const reasons = advice.reasons.map((reason, i): Item => {
    const rule = ruleById(reason.rule);
    const answer = client.profile[reason.profile_field];
    const productLevel = reason.rule === "S2" ? productRiskLevel(attributes) : null;
    const numbers = numbersIn(
      reason.citation?.quote ?? null,
      reason.citation?.page ?? null,
      Array.isArray(answer) ? answer.join(" ") : String(answer),
      productLevel,
    );
    return {
      ref: `r${i}`,
      rules: [reason.rule],
      documents: reason.citation ? [reason.citation.document_id] : [],
      // The client's own answer, and the rule it was shown, may be quoted as well as the document.
      quotes: [
        ...(reason.citation ? [reason.citation.quote] : []),
        ...(Array.isArray(answer) ? answer.map(String) : [String(answer)]),
        rule.title,
        rule.text,
      ],
      numbers,
      brief: [
        `- r${i}: rule ${reason.rule} "${rule.title}": ${rule.text}`,
        `  outcome: ${reason.effect}`,
        `  client's answer (${reason.profile_field}): ${JSON.stringify(answer)}`,
        productLevel === null ? null : `  product risk level, mapped from its attributes: ${productLevel}`,
        reason.citation
          ? `  quote (${reason.citation.document_id}, page ${reason.citation.page}): "${reason.citation.quote}"`
          : "  quote: none; nothing in the documents speaks to this",
        allowed(numbers),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  });
  const disclosures = advice.disclosures.map((d, i): Item => {
    const finding = findings.find((f) => f.finding_id === d.finding_id);
    const sides = [d.citation, ...(finding ? [finding.citation, finding.counterpart] : [])].filter((c) => c !== null);
    const unique = sides.filter((c, j) => sides.findIndex((o) => o.quote === c.quote) === j);
    const numbers = numbersIn(...unique.flatMap((c) => [c.quote, c.page]));
    return {
      ref: `d${i}`,
      rules: [d.rule, ...(finding?.rule ? [finding.rule] : [])],
      documents: unique.map((c) => c.document_id),
      quotes: [...unique.map((c) => c.quote), ruleById(d.rule).title, ruleById(d.rule).text, ...(finding?.rule ? [ruleById(finding.rule).title, ruleById(finding.rule).text] : [])],
      numbers,
      brief: [
        `- d${i}: disclosure under rule ${d.rule}: ${finding?.claim ?? d.finding_id}`,
        ...unique.map((c) => `  quote (${c.document_id}, page ${c.page}): "${c.quote}"`),
        allowed(numbers),
      ].join("\n"),
    };
  });
  return [...reasons, ...disclosures];
}

