import { describe, expect, it } from "vitest";
import {
  activeAdvice,
  Advice,
  adviceToRedraft,
  explanationFor,
  explanationLanguages,
  isAbandoned,
  ABANDONED_MARGIN_MS,
  STEP_TIMEOUT_MS,
  approvedAdviceFor,
  ClientProfile,
  fold,
  knowledgeSuggestion,
  ProductAttributes,
  productRiskLevel,
  type Reason,
  SlimEvent,
  verdictFor,
  vulnerability,
} from "../src";
import recorded from "../fixtures/case-recorded.json";
import { larkspurAttributes } from "./larkspur";

const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;

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

const horizonBlocks: Reason = {
  rule: "S1",
  effect: "blocks",
  profile_field: "horizon_years",
  citation: larkspurAttributes.min_holding_years.citation,
};

// Events appended after the recorded pipeline run, one seq at a time, as the browser and server would.
function after(...appended: { type: string; payload: unknown; event_id?: string }[]): SlimEvent[] {
  return [
    ...events,
    ...appended.map((e, i) => {
      const seq = events.length + i + 1;
      return SlimEvent.parse({
        seq,
        event_id: e.event_id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        case_id: caseId,
        actor: "demo-analyst",
        at: "2026-10-03T12:00:00.000Z",
        step_run_id: null,
        type: e.type,
        v: 1,
        payload: e.payload,
      });
    }),
  ];
}

const ADVICE_ID = "00000000-0000-4000-8000-0000000000aa";
const draft = (profileSeq: number): Advice => ({
  client_id: "persona-chan",
  profile_seq: profileSeq,
  attributes_run_id: "run-attributes-1",
  verdict: "not_suitable",
  reasons: [horizonBlocks],
  disclosures: [],
  rules_version: "rules@2",
});

describe("the client profile", () => {
  it("takes a pseudonymous id and refuses a name", () => {
    expect(ClientProfile.safeParse(chan).success).toBe(true);
    expect(ClientProfile.safeParse({ ...chan, client_id: "Mrs Chan" }).success).toBe(false);
  });

  it("holds only chosen answers: every field but the id is an enum, a number, a flag or a list of enums", () => {
    const shapes = Object.entries(ClientProfile.shape)
      .filter(([field]) => field !== "client_id")
      // An optional answer is still a chosen one: look inside it.
      .map(([, schema]) => (schema.def.type === "optional" ? (schema.def as unknown as { innerType: { def: { type: string } } }).innerType.def.type : schema.def.type));
    expect(shapes.every((t) => ["enum", "number", "boolean", "array"].includes(t))).toBe(true);
  });
});

describe("product attributes", () => {
  it("carry a citation on every value", () => {
    expect(ProductAttributes.safeParse(larkspurAttributes).success).toBe(true);
    const uncited = { value: larkspurAttributes.min_holding_years.value };
    expect(ProductAttributes.safeParse({ ...larkspurAttributes, min_holding_years: uncited }).success).toBe(false);
  });

  it("map to a risk level by the fixed table: Larkspur, up to 40% sub-investment-grade, is 3", () => {
    const at = (subIg: number, protectedCapital: boolean, derivatives: "none" | "hedging" | "investment" = "none") =>
      productRiskLevel({
        ...larkspurAttributes,
        sub_investment_grade_max_pct: { ...larkspurAttributes.sub_investment_grade_max_pct, value: subIg },
        capital_protected: { ...larkspurAttributes.capital_protected, value: protectedCapital },
        derivatives_use: { ...larkspurAttributes.derivatives_use, value: derivatives },
      });

    expect(productRiskLevel(larkspurAttributes)).toBe(3);
    expect(at(0, true)).toBe(1);
    expect(at(0, false)).toBe(2);
    expect(at(50, false)).toBe(3);
    expect(at(51, false)).toBe(4);
    expect(at(0, true, "investment")).toBe(4);
  });
});

describe("advice", () => {
  it("has the verdict its reasons amount to: a block, then a condition, then suitable", () => {
    const r = (effect: Reason["effect"]): Reason => ({ ...horizonBlocks, effect });
    expect(verdictFor([r("meets"), r("warns")])).toBe("suitable");
    expect(verdictFor([r("meets"), r("conditional")])).toBe("conditional");
    expect(verdictFor([r("conditional"), r("blocks")])).toBe("not_suitable");
  });

  it("refuses a drafted verdict its reasons do not support", () => {
    expect(Advice.safeParse(draft(1)).success).toBe(true);
    expect(Advice.safeParse({ ...draft(1), verdict: "suitable" }).success).toBe(false);
  });
});

describe("fold: clients and advice", () => {
  it("a log folds with no clients and no advice", () => {
    expect(fold(events)).toMatchObject({ clients: [], advice: [] });
  });

  it("keeps each client's latest profile and counts its versions", () => {
    const state = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "client.profiled", payload: { ...chan, horizon_years: 6 } },
    ));

    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]).toMatchObject({ clientId: "persona-chan", version: 2, profile: { horizon_years: 6 } });
  });

  it("shows a client only advice an adviser approved, and a superseded one never", () => {
    const profiledAt = events.length + 1;
    const drafted = after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
    );
    expect(approvedAdviceFor(fold(drafted), "persona-chan")).toEqual([]);

    const decided = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.decided", payload: { advice_id: ADVICE_ID, decision: "approved" } },
    ));
    expect(approvedAdviceFor(decided, "persona-chan").map((a) => a.adviceId)).toEqual([ADVICE_ID]);
    expect(decided.advice[0]!.decision).toMatchObject({ decision: "approved", actor: "demo-analyst" });

    const superseded = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.decided", payload: { advice_id: ADVICE_ID, decision: "approved" } },
      { type: "client.profiled", payload: { ...chan, horizon_years: 6 } },
      { type: "advice.superseded", payload: { advice_id: ADVICE_ID, cause: "profile_changed" } },
    ));
    expect(activeAdvice(superseded)).toEqual([]);
    expect(approvedAdviceFor(superseded, "persona-chan")).toEqual([]);
    // Out of the client's view, still in the log with its decision.
    expect(superseded.advice[0]).toMatchObject({ supersededBecause: "profile_changed", decision: { decision: "approved" } });
  });
});

describe("explanationFor", () => {
  const depth = { summary: "It does not fit.", passages: [{ ref: "r0", text: "Too short a horizon." }] };
  const explained = (seq: number, runId: string, summary: string) =>
    SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      case_id: caseId,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: runId,
      type: "step.completed",
      v: 1,
      payload: {
        step: "explain",
        model: "fake-model",
        prompt_version: "explain@1",
        input_run_id: ADVICE_ID,
        output: { advice_id: ADVICE_ID, depths: { novice: { ...depth, summary }, informed: depth, expert: depth } },
      },
    });

  it("is null before any explain run, and the latest run's output after", () => {
    expect(explanationFor(events, ADVICE_ID)).toBeNull();
    const n = events.length;
    const later = [...events, explained(n + 1, "run-1", "First."), explained(n + 2, "run-2", "Second.")];

    expect(explanationFor(later, ADVICE_ID)?.depths.novice.summary).toBe("Second.");
    expect(explanationFor(later, "00000000-0000-4000-8000-0000000000bb")).toBeNull();
  });

  it("finds the explanation in the language asked for, and none when it was never written in it (#75)", () => {
    const n = events.length;
    const inLanguage = (seq: number, language?: "en" | "zh-Hant") => {
      const e = explained(seq, `run-${seq}`, language === "zh-Hant" ? "不適合。" : "English.");
      if (e.type !== "step.completed") throw new Error("completed");
      return SlimEvent.parse({ ...e, payload: { ...e.payload, output: { ...e.payload.output, ...(language ? { language } : {}) } } });
    };
    // One written before languages were recorded counts as English.
    const english = [...events, inLanguage(n + 1)];
    expect(explanationFor(english, ADVICE_ID, "en")?.depths.novice.summary).toBe("English.");
    expect(explanationFor(english, ADVICE_ID, "zh-Hant")).toBeNull();
    expect(explanationLanguages(english, ADVICE_ID)).toEqual(["en"]);

    const both = [...english, inLanguage(n + 2, "zh-Hant")];
    expect(explanationFor(both, ADVICE_ID, "zh-Hant")?.depths.novice.summary).toBe("不適合。");
    expect(explanationFor(both, ADVICE_ID, "en")?.depths.novice.summary).toBe("English.");
    // With no language asked for, the latest written is the one, as before.
    expect(explanationFor(both, ADVICE_ID)?.language).toBe("zh-Hant");
    expect(explanationLanguages(both, ADVICE_ID).sort()).toEqual(["en", "zh-Hant"]);
  });
});

describe("an abandoned run (#75)", () => {
  const started = (at: string) =>
    SlimEvent.parse({
      seq: 1,
      event_id: "00000000-0000-4000-8000-000000000001",
      case_id: caseId,
      actor: "demo-analyst",
      at,
      step_run_id: "run-1",
      type: "step.started",
      v: 1,
      payload: { step: "rationale", model: "m", prompt_version: "rationale@1", input_run_id: "f" },
    });
  const t0 = Date.parse("2026-10-04T10:00:00.000Z");

  it("is a run still running after the step timeout and a margin, never one that is merely slow", () => {
    const log = [started("2026-10-04T10:00:00.000Z")];
    const run = fold(log).stepRuns[0]!;
    expect(isAbandoned(log, run, t0 + 60_000)).toBe(false);
    expect(isAbandoned(log, run, t0 + STEP_TIMEOUT_MS)).toBe(false);
    expect(isAbandoned(log, run, t0 + STEP_TIMEOUT_MS + ABANDONED_MARGIN_MS + 1)).toBe(true);
  });

  it("is never a run that settled", () => {
    const log = [started("2026-10-04T10:00:00.000Z")];
    const run = { ...fold(log).stepRuns[0]!, status: "completed" as const };
    expect(isAbandoned(log, run, t0 + 10 * STEP_TIMEOUT_MS)).toBe(false);
  });
});

describe("re-ingesting a document", () => {
  it("replaces the earlier version in place; the earlier stays in the log", () => {
    const factsheet = events.find((e) => e.type === "document.ingested")!;
    const revised = SlimEvent.parse({
      ...factsheet,
      seq: events.length + 1,
      event_id: "00000000-0000-4000-8000-0000000000cc",
      payload: { ...factsheet.payload, sha256: "c".repeat(64), filename: "larkspur-factsheet-v2.pdf" },
    });
    const state = fold([...events, revised]);

    expect(state.documents.map((d) => d.documentId)).toEqual(["factsheet", "ppm", "deck", "fee-table"]);
    expect(state.documents[0]).toMatchObject({ filename: "larkspur-factsheet-v2.pdf", ingestedAtSeq: events.length + 1 });
  });
});

describe("adviceToRedraft", () => {
  it("lists a client whose advice was superseded and not redrafted, with why", () => {
    const profiledAt = events.length + 1;
    const superseded = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.superseded", payload: { advice_id: ADVICE_ID, cause: "product_changed" } },
    ));
    expect(adviceToRedraft(superseded)).toEqual([
      { clientId: "persona-chan", cause: "product_changed", supersededAtSeq: events.length + 3 },
    ]);

    const redrafted = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.superseded", payload: { advice_id: ADVICE_ID, cause: "product_changed" } },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: "00000000-0000-4000-8000-0000000000ab" },
    ));
    expect(adviceToRedraft(redrafted)).toEqual([]);
  });
});

describe("readings and the knowledge suggestion (#38)", () => {
  const read = (depth: "novice" | "informed" | "expert") => ({ type: "client.read", payload: { client_id: "persona-chan", advice_id: ADVICE_ID, depth } });

  it("suggests nothing until the client has chosen another depth three times in a row", () => {
    const two = fold(after({ type: "client.profiled", payload: chan }, read("informed"), read("informed")));
    expect(knowledgeSuggestion(two, "persona-chan")).toBeNull();

    const three = fold(after({ type: "client.profiled", payload: chan }, read("informed"), read("informed"), read("informed")));
    expect(knowledgeSuggestion(three, "persona-chan")).toEqual({ depth: "informed", count: 3 });
  });

  it("suggests nothing when the choices are the level the answers give, or not consistent", () => {
    expect(knowledgeSuggestion(fold(after({ type: "client.profiled", payload: chan }, read("novice"), read("novice"), read("novice"))), "persona-chan")).toBeNull();
    expect(knowledgeSuggestion(fold(after({ type: "client.profiled", payload: chan }, read("informed"), read("expert"), read("informed"))), "persona-chan")).toBeNull();
  });

  it("starts counting again once new answers are recorded", () => {
    const state = fold(after(
      { type: "client.profiled", payload: chan },
      read("informed"),
      read("informed"),
      read("informed"),
      { type: "client.profiled", payload: { ...chan, knowledge: "informed" } },
    ));
    expect(knowledgeSuggestion(state, "persona-chan")).toBeNull();
  });
});

describe("a vulnerable client (#42)", () => {
  it("is 65 or over, or new to investing while relying on the income, and says which", () => {
    expect(vulnerability({ ...chan, aged_65_or_over: true })).toEqual(["65 or over", "new to investing and relies on the income"]);
    expect(vulnerability({ ...chan, knowledge: "informed" })).toEqual([]);
    expect(vulnerability({ ...chan, relies_on_income: false, aged_65_or_over: false })).toEqual([]);
  });

  it("carries a decision's reason and confirmations through the fold, and older decisions without them", () => {
    const profiledAt = events.length + 1;
    const state = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.decided", payload: { advice_id: ADVICE_ID, decision: "rejected", reason: "needs_discussion_first" } },
    ));
    expect(state.advice[0]!.decision).toMatchObject({ decision: "rejected", reason: "needs_discussion_first", confirmations: [] });
  });
});

describe("the adviser's pick (#71)", () => {
  it("is carried through the fold from the decision that made it, and is false on every older decision", () => {
    const profiledAt = events.length + 1;
    const picked = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.decided", payload: { advice_id: ADVICE_ID, decision: "approved", adviser_pick: true } },
    ));
    expect(picked.advice[0]!.decision).toMatchObject({ decision: "approved", adviserPick: true });

    const plain = fold(after(
      { type: "client.profiled", payload: chan },
      { type: "advice.drafted", payload: draft(profiledAt), event_id: ADVICE_ID },
      { type: "advice.decided", payload: { advice_id: ADVICE_ID, decision: "approved" } },
    ));
    expect(plain.advice[0]!.decision).toMatchObject({ adviserPick: false });
  });

  it("still folds the recorded case, whose decisions know nothing of a pick", () => {
    const decided = fold(events).advice.filter((a) => a.decision !== null);
    expect(decided.every((a) => a.decision!.adviserPick === false)).toBe(true);
  });
});
