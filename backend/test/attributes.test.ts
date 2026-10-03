import { randomUUID } from "node:crypto";
import { ProductAttributes, StepFailure, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { FakeLlm, setup, type TestApp } from "./helpers";
import { ATTRIBUTES_REPLY as REPLY, deckScreen, pack } from "./larkspur";

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

  it("requires the product's primary objective, cited (S7, rules@2)", async () => {
    const out = ProductAttributes.parse(StepResult.parse(await (await run(REPLY)).json()).output);
    expect(out.primary_objective?.value).toBe("income");
    expect(await failure({ ...REPLY, primary_objective: undefined })).toMatch(/primary_objective \(not given/);
  });

  it("reads the documents, so it takes no input run", async () => {
    expect((await run(REPLY, randomUUID())).status).toBe(409);
  });
});
