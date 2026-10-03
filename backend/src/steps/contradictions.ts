import { FindingCategory, FindingKind, type IngestedDocument, ProductRuleId } from "@qryvox/shared";
import { z } from "zod";
import { type Claim, DecomposeOutput } from "./decompose.js";
import { loadCompletedOutput, loadDocuments } from "./inputs.js";
import type { StepDefinition } from "./step.js";

// contradictions@1 — compares claims across the pack and names the issues: contradictions between
// documents, marketing claims the PPM does not support, and promises missing their risk disclosure.

export const Issue = z.object({
  kind: FindingKind,
  category: FindingCategory,
  // The claim the issue is about: the one in the less authoritative document.
  claim_id: z.string().min(1),
  // The claim it conflicts with or lacks; null when nothing in the pack speaks to it.
  counterpart_claim_id: z.string().min(1).nullable(),
  explanation: z.string().min(1),
  // The product rule a policy_gap breaks; only the compliance step sets it.
  rule: ProductRuleId.optional(),
});
export type Issue = z.infer<typeof Issue>;

export const ContradictionsOutput = z.object({ issues: z.array(Issue) });
export type ContradictionsOutput = z.infer<typeof ContradictionsOutput>;

type ContradictionsInput = { claims: Claim[]; documents: IngestedDocument[] };

export const CONTRADICTIONS_SYSTEM_PROMPT = `You review the claims made by one investment product's documents: a factsheet, a private placement memorandum (PPM), a marketing deck and a fee table. The PPM is the legal document. Authority runs PPM, then fee table, then factsheet, then marketing deck.

Find every issue of these three kinds:
1. contradiction: two claims in different documents state the same subject differently, for example a different fee, a charge one document says does not exist, an investment limit another document breaks, or a different dealing frequency.
2. unsupported_claim: a claim in the marketing deck or factsheet about how the fund invests, what it holds or screens out, or what it guarantees, that no claim in the PPM supports.
3. disclosure_gap: the marketing deck promises a benefit (income, returns, safety, easy access to money) and carries none of the risk warning the PPM attaches to it.

For each issue give:
- kind: contradiction, unsupported_claim or disclosure_gap.
- category: fees, strategy, risk or terms: the area the issue concerns. A disclosure_gap is always risk.
- claim_id: the claim in the less authoritative document.
- counterpart_claim_id: for a contradiction, the conflicting claim in the more authoritative document; for a disclosure_gap, the PPM risk claim the promise lacks, if there is one; otherwise null.
- explanation: one sentence on what conflicts, keeping every number exactly as written.

Report each issue once. Ignore claims that agree, and wording differences that do not change the meaning. Do not compute anything, give advice or judge the product's merits.

Respond with only a JSON object and no other text, in exactly this shape:
{"issues":[{"kind":"contradiction","category":"fees","claim_id":"c3","counterpart_claim_id":"c21","explanation":"<one sentence>"}]}`;

export const contradictions: StepDefinition<ContradictionsInput, ContradictionsOutput> = {
  name: "contradictions",

  async loadInput(db, caseId, inputRunId) {
    const { output } = await loadCompletedOutput(db, caseId, inputRunId, "decompose", DecomposeOutput);
    return { claims: output.claims, documents: await loadDocuments(db, caseId) };
  },

  messages({ claims, documents }) {
    const kinds = new Map(documents.map((d) => [d.document_id, d.kind]));
    const text = claims
      .map(
        (c) =>
          `- ${c.id} [${kinds.get(c.document_id)} p${c.page}] ${c.category} / ${c.topic}: ${c.assertion} (quote: "${c.quote}")`,
      )
      .join("\n");
    return [
      { role: "system", content: CONTRADICTIONS_SYSTEM_PROMPT },
      { role: "user", content: `Claims:\n${text}` },
    ];
  },

  output: ContradictionsOutput,

  // Keeps issues that point at real claims, whose contradictions span two documents, once per claim and
  // kind. A pack can legitimately have no issues, so an empty list is not a failure.
  ground(output, { claims }) {
    const byId = new Map(claims.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const issues = output.issues.filter((issue) => {
      const claim = byId.get(issue.claim_id);
      const counterpart = issue.counterpart_claim_id === null ? null : byId.get(issue.counterpart_claim_id);
      const key = `${issue.kind}:${issue.claim_id}`;
      if (!claim || counterpart === undefined || seen.has(key)) return false;
      if (issue.kind === "contradiction" && counterpart?.document_id === claim.document_id) return false;
      if (issue.kind === "contradiction" && counterpart === null) return false;
      seen.add(key);
      return true;
    });
    return { output: { issues } };
  },
};
