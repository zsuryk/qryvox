import { type DocumentKind, type FindingCategory, type IngestedDocument, ProductRuleId, RULES } from "@qryvox/shared";
import { z } from "zod";
import { ContradictionsOutput, type Issue } from "./contradictions.js";
import { type Claim, DecomposeOutput } from "./decompose.js";
import { loadCompletedOutput, loadDocuments } from "./inputs.js";
import type { StepDefinition } from "./step.js";

// compliance@1 — checks the pack's documents against the institution's product rules (rules@1, P1–P4)
// and adds a policy_gap issue for each place a document falls short (#24). It runs between contradictions
// and findings: its output is the contradictions run's issues followed by its own, in the same shape, so
// the findings step words and cites them all alike.
//
// The model chooses the rule, the claims and the wording. The server decides the rest: the category each
// rule belongs to, which documents a rule may be applied to, and that a claim already raised by an earlier
// issue is not raised again (so P4 on the deck's income promise does not double the disclosure gap).

const PRODUCT_RULES = RULES.filter((r) => r.group === "product");

// What each rule is about, and the documents it governs.
const SCOPE: Record<ProductRuleId, { category: FindingCategory; documents: readonly DocumentKind[] }> = {
  P1: { category: "risk", documents: ["factsheet", "deck"] },
  P2: { category: "risk", documents: ["factsheet"] },
  P3: { category: "fees", documents: ["factsheet"] },
  P4: { category: "risk", documents: ["factsheet", "deck", "fee_table"] },
};

const ComplianceReply = z.object({
  gaps: z.array(
    z.object({
      // Checked per gap in ground(), so one unknown rule drops that gap rather than the whole reply.
      rule: z.string(),
      claim_id: z.string().min(1),
      counterpart_claim_id: z.string().min(1).nullable(),
      explanation: z.string().min(1),
    }),
  ),
});
type ComplianceReply = z.infer<typeof ComplianceReply>;

type ComplianceInput = { issues: Issue[]; claims: Claim[]; documents: IngestedDocument[] };

export const COMPLIANCE_SYSTEM_PROMPT = `You check one investment product's documents against the institution's own product rules. The documents are a factsheet, a private placement memorandum (PPM), a marketing deck and a fee table; the PPM is the legal document.

Rules:
${PRODUCT_RULES.map((r) => `- ${r.id} (${r.title}): ${r.text}`).join("\n")}

Find every place a document falls short of a rule. Most gaps are something missing: report them on the claim where the missing text belongs (for example the factsheet's risk section, or its key facts), with the PPM claim it should have carried as the counterpart.

For each gap give:
- rule: the rule's id.
- claim_id: the claim in the document that falls short.
- counterpart_claim_id: the PPM claim that states what is missing, or null if there is none.
- explanation: one sentence on what is missing, keeping every number exactly as written.

Report each gap once. Do not report a document for a rule it already meets. Do not compute anything, give advice or judge the product's merits.

Respond with only a JSON object and no other text, in exactly this shape:
{"gaps":[{"rule":"P1","claim_id":"c4","counterpart_claim_id":"c18","explanation":"<one sentence>"}]}`;

export const compliance: StepDefinition<ComplianceInput, ContradictionsOutput, ComplianceReply> = {
  name: "compliance",

  async loadInput(db, caseId, inputRunId) {
    const found = await loadCompletedOutput(db, caseId, inputRunId, "contradictions", ContradictionsOutput);
    const { output } = await loadCompletedOutput(db, caseId, found.inputRunId, "decompose", DecomposeOutput);
    return { issues: found.output.issues, claims: output.claims, documents: await loadDocuments(db, caseId) };
  },

  messages({ claims, documents }) {
    const kinds = new Map(documents.map((d) => [d.document_id, d.kind]));
    const text = claims
      .map((c) => `- ${c.id} [${kinds.get(c.document_id)} p${c.page}] ${c.category} / ${c.topic}: ${c.assertion} (quote: "${c.quote}")`)
      .join("\n");
    return [
      { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
      { role: "user", content: `Claims:\n${text}` },
    ];
  },

  output: ComplianceReply,

  // Keeps gaps on real claims, in a document the rule governs, with a counterpart in the PPM when one is
  // named; once per rule and claim; never on a claim an earlier issue already raised. A pack can meet every
  // rule, so an empty list is not a failure.
  ground(reply, { issues, claims, documents }) {
    const byId = new Map(claims.map((c) => [c.id, c]));
    const kinds = new Map(documents.map((d) => [d.document_id, d.kind]));
    const raised = new Set(issues.map((i) => i.claim_id));
    const seen = new Set<string>();
    const gaps = reply.gaps.flatMap((gap): Issue[] => {
      const rule = ProductRuleId.safeParse(gap.rule);
      if (!rule.success) return [];
      const claim = byId.get(gap.claim_id);
      const counterpart = gap.counterpart_claim_id === null ? null : byId.get(gap.counterpart_claim_id);
      const scope = SCOPE[rule.data];
      const key = `${rule.data}:${gap.claim_id}`;
      if (!claim || counterpart === undefined || seen.has(key) || raised.has(gap.claim_id)) return [];
      if (!scope.documents.includes(kinds.get(claim.document_id)!)) return [];
      if (counterpart !== null && kinds.get(counterpart.document_id) !== "ppm") return [];
      seen.add(key);
      return [
        {
          kind: "policy_gap",
          category: scope.category,
          claim_id: gap.claim_id,
          counterpart_claim_id: gap.counterpart_claim_id,
          explanation: gap.explanation,
          rule: rule.data,
        },
      ];
    });
    return { output: { issues: [...issues, ...gaps] } };
  },
};
