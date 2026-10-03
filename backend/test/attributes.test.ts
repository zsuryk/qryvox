import { randomUUID } from "node:crypto";
import { type IngestedDocument, ProductAttributes, StepFailure, StepResult } from "@qryvox/shared";
import { DOCUMENTS } from "@qryvox/shared/pack-source";
import { describe, expect, it } from "vitest";
import { FakeLlm, setup, type TestApp } from "./helpers";

// The real Larkspur pack, page text as the source writes it, so the canned reply quotes real passages.
const pack: IngestedDocument[] = DOCUMENTS.map((d, i) => ({
  document_id: d.document_id,
  sha256: String(i).repeat(64),
  filename: d.filename,
  kind: d.kind,
  page_count: d.pages.length,
  pages: d.pages.map((lines) => lines.join("\n")),
  pdfjs_version: "5.0.0",
}));

const ppm = (page: number, quote: string) => ({ document_id: "ppm", page, quote });
const deckScreen = { document_id: "deck", page: 1, quote: "Every holding is screened to exclude fossil fuel companies." };

// What a correct model answers for Larkspur.
const REPLY = {
  min_holding_years: { value: 5, citation: ppm(1, "3.1 The Fund aims to provide a regular income with the potential for modest capital growth over at least five years.") },
  sub_investment_grade_max_pct: { value: 40, citation: ppm(1, "3.3 The Fund may invest up to 40% of its net assets in sub-investment-grade bonds.") },
  capital_protected: { value: false, citation: ppm(2, "5.1 The Fund is not capital protected. Investors may lose some or all of the amount invested.") },
  distributions_may_use_capital: { value: true, citation: ppm(2, "5.2 Distributions are not guaranteed and may be paid out of capital.") },
  dealing_frequency: { value: "monthly", citation: ppm(3, "7.3 Redemptions are processed monthly, on the last business day of each month.") },
  redemption_notice_days: { value: 30, citation: ppm(3, "7.4 Redemption requests must be received at least 30 calendar days before the dealing day.") },
  exit_charge_within_months: { value: 24, citation: ppm(3, "7.2 A redemption charge of 2.00% applies to units redeemed within 24 months of purchase.") },
  derivatives_use: { value: "hedging", citation: ppm(1, "3.5 The Fund may use derivatives for hedging purposes only.") },
  exclusion_screens: [{ exclusion: "fossil_fuels", citation: deckScreen }],
};

async function caseWithLarkspur(t: TestApp) {
  const caseId = await t.openCase();
  for (const document of pack) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  return caseId;
}

async function run(reply: unknown, inputRunId: string | null = null) {
  const t = await setup({ llm: new FakeLlm(() => JSON.stringify(reply)) });
  const caseId = await caseWithLarkspur(t);
  return t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step: "attributes", input_run_id: inputRunId });
}

async function failure(reply: unknown) {
  const res = await run(reply);
  expect(res.status).toBe(422);
  return StepFailure.parse(await res.json()).error;
}

describe("the attributes step", () => {
  it("reads Larkspur's attributes, every one cited on the PPM, under attributes@1", async () => {
    const res = await run(REPLY);

    expect(res.status).toBe(200);
    const result = StepResult.parse(await res.json());
    expect(result.prompt_version).toBe("attributes@1");
    const out = ProductAttributes.parse(result.output);
    expect(out.min_holding_years.value).toBe(5);
    expect(out.sub_investment_grade_max_pct.value).toBe(40);
    expect(out.exit_charge_within_months.value).toBe(24);
  });

  it("decides whether the PPM backs a screen itself: a deck-only screen is unbacked whatever the model says", async () => {
    const claimed = { ...REPLY, exclusion_screens: [{ exclusion: "fossil_fuels", backed_by_ppm: true, citation: deckScreen }] };
    const out = ProductAttributes.parse(StepResult.parse(await (await run(claimed)).json()).output);

    expect(out.exclusion_screens).toEqual([{ exclusion: "fossil_fuels", backed_by_ppm: false, citation: deckScreen }]);
  });

  it("drops a screen whose quote does not ground, without failing the run", async () => {
    const invented = { ...REPLY, exclusion_screens: [{ exclusion: "tobacco", citation: { ...deckScreen, quote: "No tobacco." } }] };
    const out = ProductAttributes.parse(StepResult.parse(await (await run(invented)).json()).output);

    expect(out.exclusion_screens).toEqual([]);
  });

  it("stores a sloppy document id as the real one", async () => {
    const sloppy = { ...REPLY, min_holding_years: { ...REPLY.min_holding_years, citation: { ...REPLY.min_holding_years.citation, document_id: "ppm (ppm)" } } };
    const out = ProductAttributes.parse(StepResult.parse(await (await run(sloppy)).json()).output);

    expect(out.min_holding_years.citation.document_id).toBe("ppm");
  });

  it("refuses a number its own quote does not state: read, never computed", async () => {
    const error = await failure({ ...REPLY, min_holding_years: { ...REPLY.min_holding_years, value: 7 } });
    expect(error).toMatch(/min_holding_years \(its quote does not state 7\)/);
  });

  it("does not find 4 inside 40%", async () => {
    const error = await failure({ ...REPLY, sub_investment_grade_max_pct: { ...REPLY.sub_investment_grade_max_pct, value: 4 } });
    expect(error).toMatch(/sub_investment_grade_max_pct/);
  });

  it("fails naming every attribute it could not establish, and only those", async () => {
    const error = await failure({
      ...REPLY,
      capital_protected: undefined,
      dealing_frequency: { ...REPLY.dealing_frequency, citation: { ...REPLY.dealing_frequency.citation, quote: "Dealing is weekly." } },
    });

    expect(error).toMatch(/capital_protected \(not given in the expected form\)/);
    expect(error).toMatch(/dealing_frequency \(its quote is not on the cited page\)/);
    expect(error).not.toMatch(/min_holding_years/);
  });

  it("reads the documents, so it takes no input run", async () => {
    expect((await run(REPLY, randomUUID())).status).toBe(409);
  });
});
