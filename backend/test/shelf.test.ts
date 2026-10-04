import { randomUUID } from "node:crypto";
import { type ClientProfile, EventPage, fold, StepResult } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { setup, type TestApp } from "./helpers";
import { pack as larkspurPack } from "./larkspur";
import { shelfLlm, wrenfieldPack } from "./wrenfield";

const chan: ClientProfile = {
  client_id: "persona-chan",
  goal: "income",
  horizon_years: 2,
  risk_level: 2,
  knowledge: "novice",
  relies_on_income: true,
  may_need_cash_at_short_notice: true,
  exclusions: [],
};
const lee: ClientProfile = { ...chan, client_id: "persona-lee", goal: "growth", horizon_years: 10, risk_level: 4, knowledge: "informed", relies_on_income: false, may_need_cash_at_short_notice: false, exclusions: ["fossil_fuels"] };
const wong: ClientProfile = { ...chan, client_id: "persona-wong", horizon_years: 6, risk_level: 3, knowledge: "expert", relies_on_income: false, may_need_cash_at_short_notice: false };

// One product verified in its own case: documents, the four steps, then (unless left out) its attributes.
async function verify(t: TestApp, documents: typeof larkspurPack, { findings = true } = {}) {
  const caseId = await t.openCase();
  for (const document of documents) await t.request("POST", `/cases/${caseId}/documents`, { event_id: randomUUID(), document });
  let input: string | null = null;
  for (const step of findings ? ["extract", "decompose", "contradictions", "findings"] : ["extract"]) {
    input = await run(t, caseId, step, input);
  }
  await run(t, caseId, "attributes", null);
  return caseId;
}

async function run(t: TestApp, caseId: string, step: string, input: string | null) {
  const res = await t.request("POST", `/cases/${caseId}/steps`, { step_run_id: randomUUID(), step, input_run_id: input });
  expect(res.status, `${step}: ${await res.clone().text()}`).toBe(200);
  return StepResult.parse(await res.json()).step_run_id;
}

async function advise(t: TestApp, caseId: string, profile: ClientProfile) {
  await t.request("POST", `/cases/${caseId}/clients`, { event_id: randomUUID(), profile });
  const res = await t.request("POST", `/cases/${caseId}/advice`, { event_id: randomUUID(), client_id: profile.client_id });
  expect(res.status, await res.clone().text()).toBe(201);
  const { events } = EventPage.parse(await (await t.request("GET", `/cases/${caseId}/events`)).json());
  return fold(events).advice.at(-1)!;
}

describe("advice that points along the shelf", () => {
  it("Mrs Chan's Larkspur advice names Wrenfield as suitable, with its own reasons and citations", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    const wrenfield = await verify(t, wrenfieldPack);

    const advice = await advise(t, larkspur, chan);

    expect(advice.verdict).toBe("not_suitable");
    expect(advice.alternatives).toHaveLength(1);
    const [alternative] = advice.alternatives!;
    expect(alternative).toMatchObject({ case_id: wrenfield, product_name: "Wrenfield Short Duration Fund", verdict: "suitable" });
    expect(alternative!.reasons.map((r) => `${r.rule}:${r.effect}`)).toEqual(["S1:meets", "S2:meets", "S3:meets", "S4:meets", "S7:warns"]);
    // Still offered: S7 tells her Wrenfield is built first to keep capital safe, while her goal is income.
    expect(alternative!.reasons[0]!.citation?.quote).toContain("at least one year");
    // Wrenfield's own fee finding is disclosed with it.
    expect(alternative!.disclosures.map((d) => d.citation.quote)).toEqual(["Annual management fee: 0.45% of net asset value"]);
  });

  it("says plainly when nothing on the shelf fits: Mr Lee excludes fossil fuels and Wrenfield screens none", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, wrenfieldPack);

    const advice = await advise(t, larkspur, lee);
    expect(advice.verdict).toBe("conditional");
    expect(advice.alternatives).toEqual([]);
  });

  it("does not look along the shelf for advice that is already suitable", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, wrenfieldPack);

    expect((await advise(t, larkspur, wong)).alternatives).toBeUndefined();
  });

  it("offers only verified products: a pack whose findings have not run is not on the shelf", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, wrenfieldPack, { findings: false });

    expect((await advise(t, larkspur, chan)).alternatives).toEqual([]);
  });

  it("never offers the product the advice is about, from another case of it", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, larkspurPack);

    expect((await advise(t, larkspur, chan)).alternatives).toEqual([]);
  });

  it("works the other way round: on Wrenfield, Mrs Chan is suitable and Mr Lee is pointed nowhere", async () => {
    const t = await setup({ llm: shelfLlm() });
    await verify(t, larkspurPack);
    const wrenfield = await verify(t, wrenfieldPack);

    expect((await advise(t, wrenfield, chan)).verdict).toBe("suitable");
    // Larkspur's screen is only in its deck, so for Mr Lee it is conditional, not suitable: not offered.
    expect((await advise(t, wrenfield, lee))).toMatchObject({ verdict: "not_suitable", alternatives: [] });
  });
});

describe("advice that compares the whole shelf (#68)", () => {
  it("gives every verdict a shelf: Mr Lee's carries Wrenfield with the verdict the rules reach, though it is no alternative", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    const wrenfield = await verify(t, wrenfieldPack);

    const advice = await advise(t, larkspur, lee);

    expect(advice.alternatives).toEqual([]);
    expect(advice.shelf).toHaveLength(1);
    const [entry] = advice.shelf!;
    expect(entry).toMatchObject({ case_id: wrenfield, product_name: "Wrenfield Short Duration Fund", verdict: "not_suitable" });
    expect(entry!.reasons.some((r) => r.effect === "blocks")).toBe(true);
  });

  it("shows Mrs Chan Wrenfield as suitable, the same entry her alternatives hold", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, wrenfieldPack);

    const advice = await advise(t, larkspur, chan);

    expect(advice.shelf!.map((e) => `${e.product_name}:${e.verdict}`)).toEqual(["Wrenfield Short Duration Fund:suitable"]);
    expect(advice.shelf).toEqual(advice.alternatives);
  });

  it("keeps the shelf for advice that is already suitable, without writing alternatives", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    await verify(t, wrenfieldPack);

    const advice = await advise(t, larkspur, wong);

    expect(advice.alternatives).toBeUndefined();
    expect(advice.shelf).toHaveLength(1);
  });

  it("carries a product that does not suit with its blocking reasons and their citations", async () => {
    const t = await setup({ llm: shelfLlm() });
    await verify(t, larkspurPack);
    const wrenfield = await verify(t, wrenfieldPack);

    const advice = await advise(t, wrenfield, chan);
    const [larkspurEntry] = advice.shelf!;

    expect(larkspurEntry).toMatchObject({ verdict: "not_suitable" });
    const blocks = larkspurEntry!.reasons.filter((r) => r.effect === "blocks");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((r) => r.citation !== null)).toBe(true);
  });

  it("leaves the shelf empty when no other product is verified", async () => {
    const t = await setup({ llm: shelfLlm() });
    const larkspur = await verify(t, larkspurPack);
    expect((await advise(t, larkspur, chan)).shelf).toEqual([]);
  });
});

