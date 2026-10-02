import { randomUUID } from "node:crypto";
import { type Citation, Finding, Severity } from "@qryvox/shared";
import { z } from "zod";
import { ContradictionsOutput, type Issue } from "./contradictions";
import { type Claim, DecomposeOutput } from "./decompose";
import { loadCompletedOutput } from "./inputs";
import type { StepDefinition } from "./step";

// findings@1 — the model rates and words each issue; the server attaches the citations. Every quote on
// the board therefore comes from a grounded claim, never from model prose.

const FindingsReply = z.object({
  findings: z.array(
    z.object({
      issue: z.number().int().positive(),
      severity: Severity,
      claim: z.string().min(1),
    }),
  ),
});
type FindingsReply = z.infer<typeof FindingsReply>;

export const FindingsOutput = z.object({ findings: z.array(Finding) });
export type FindingsOutput = z.infer<typeof FindingsOutput>;

type FindingsInput = { issues: Issue[]; claims: Claim[] };

export const FINDINGS_SYSTEM_PROMPT = `You write the findings an investment analyst will review, one for each numbered issue found in an investment product's documents.

For each issue give:
- issue: its number.
- severity: high if an investor could be misled about cost, risk or access to their money; medium if a material policy or term is misstated; low otherwise.
- claim: one sentence of at most 30 words stating what the documents say and where they conflict. Name the documents and keep every number exactly as written. No advice, no recommendation, no computed numbers.

Respond with only a JSON object and no other text, in exactly this shape:
{"findings":[{"issue":1,"severity":"high","claim":"<one sentence>"}]}`;

export const findings: StepDefinition<FindingsInput, FindingsOutput, FindingsReply> = {
  name: "findings",

  async loadInput(db, caseId, inputRunId) {
    const found = await loadCompletedOutput(db, caseId, inputRunId, "contradictions", ContradictionsOutput);
    const { output } = await loadCompletedOutput(db, caseId, found.inputRunId, "decompose", DecomposeOutput);
    return { issues: found.output.issues, claims: output.claims };
  },

  messages({ issues, claims }) {
    const byId = new Map(claims.map((c) => [c.id, c]));
    const describe = (id: string | null) => {
      const c = id === null ? undefined : byId.get(id);
      return c ? `${c.document_id} page ${c.page}: "${c.quote}"` : "none";
    };
    const text = issues
      .map((issue, i) =>
        [
          `${i + 1}. ${issue.kind}, ${issue.category}: ${issue.explanation}`,
          `   claim: ${describe(issue.claim_id)}`,
          `   counterpart: ${describe(issue.counterpart_claim_id)}`,
        ].join("\n"),
      )
      .join("\n");
    return [
      { role: "system", content: FINDINGS_SYSTEM_PROMPT },
      { role: "user", content: `Issues:\n${text}` },
    ];
  },

  output: FindingsReply,

  // Every issue becomes exactly one finding. The model supplies severity and wording; an issue it skipped
  // falls back to medium severity and the issue's own explanation, so nothing found is silently lost.
  ground(reply, { issues, claims }) {
    const byId = new Map(claims.map((c) => [c.id, c]));
    const cite = (id: string | null): Citation | null => {
      const c = id === null ? undefined : byId.get(id);
      return c ? { document_id: c.document_id, page: c.page, quote: c.quote } : null;
    };
    const rated = new Map(reply.findings.map((f) => [f.issue, f]));

    const built = issues.flatMap((issue, i) => {
      const citation = cite(issue.claim_id);
      if (!citation) return [];
      const r = rated.get(i + 1);
      return [
        Finding.parse({
          finding_id: randomUUID(),
          category: issue.category,
          kind: issue.kind,
          severity: r?.severity ?? "medium",
          claim: r?.claim ?? issue.explanation,
          citation,
          counterpart: cite(issue.counterpart_claim_id),
        }),
      ];
    });
    return { output: { findings: built } };
  },

  toFindings: (output) => output.findings,
};
