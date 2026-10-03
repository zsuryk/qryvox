import {
  adviceToRedraft,
  type CaseAdvice,
  type CaseClient,
  type ClientGoal,
  type ClientProfile,
  type Exclusion,
  type Explanation,
  explanationFor,
  fold,
  type KnowledgeLevel,
  ProductAttributes,
  productRiskLevel,
  type ProfileField,
  type ReasonEffect,
  type SlimEvent,
  type SupersedeCause,
  type Verdict,
} from "@qryvox/shared";

// The advice section, as the browser derives it from the case's log: whether the pack is verified, what the
// product is as read, and each client with the advice in play for them. Nothing here is fetched or stored:
// it is a fold of the events, so a reload, a shared link and the replay all read the same (ADR-0002).

// --- Words ---------------------------------------------------------------------------------------

// Every verdict and outcome has a word; the tone only repeats it.
export const VERDICT: Record<Verdict, { label: string; tone: "positive" | "caution" | "negative" }> = {
  suitable: { label: "Suitable", tone: "positive" },
  conditional: { label: "Suitable if confirmed", tone: "caution" },
  not_suitable: { label: "Not suitable", tone: "negative" },
};

export const EFFECT: Record<ReasonEffect, { label: string; tone: "positive" | "caution" | "negative" }> = {
  meets: { label: "Meets", tone: "positive" },
  warns: { label: "Warning", tone: "caution" },
  conditional: { label: "Needs confirmation", tone: "caution" },
  blocks: { label: "Fails", tone: "negative" },
};

export const GOAL: Record<ClientGoal, string> = { income: "Income", growth: "Growth", preservation: "Keeping capital safe" };
export const KNOWLEDGE: Record<KnowledgeLevel, string> = { novice: "New to investing", informed: "Some experience", expert: "Experienced" };
export const EXCLUSION: Record<Exclusion, string> = { fossil_fuels: "Fossil fuels", tobacco: "Tobacco", weapons: "Weapons" };
export const CAUSE: Record<SupersedeCause, string> = {
  profile_changed: "the client's answers changed",
  product_changed: "the product's facts were read again",
};

// One answer, said the way the adviser would say it back to the client.
export function answerText(profile: ClientProfile, field: ProfileField): string {
  switch (field) {
    case "goal":
      return GOAL[profile.goal];
    case "horizon_years":
      return `${profile.horizon_years} ${profile.horizon_years === 1 ? "year" : "years"}`;
    case "risk_level":
      return `Risk level ${profile.risk_level} of 5`;
    case "knowledge":
      return KNOWLEDGE[profile.knowledge];
    case "relies_on_income":
      return profile.relies_on_income ? "Relies on the income" : "Does not rely on the income";
    case "may_need_cash_at_short_notice":
      return profile.may_need_cash_at_short_notice ? "May need the money at short notice" : "Will not need the money at short notice";
    case "exclusions":
      return profile.exclusions.length === 0 ? "No exclusions" : `Excludes ${profile.exclusions.map((e) => EXCLUSION[e].toLowerCase()).join(", ")}`;
  }
}

// The client in a line of short facts, for a card.
export function profileSummary(profile: ClientProfile): string[] {
  return [
    GOAL[profile.goal],
    answerText(profile, "horizon_years"),
    answerText(profile, "risk_level"),
    KNOWLEDGE[profile.knowledge],
    ...(profile.relies_on_income ? ["Relies on the income"] : []),
    ...(profile.may_need_cash_at_short_notice ? ["May need cash quickly"] : []),
    ...profile.exclusions.map((e) => `No ${EXCLUSION[e].toLowerCase()}`),
  ];
}

// --- The risk questionnaire ----------------------------------------------------------------------

// Three questions, each answered by choosing, each answer worth 1 (most cautious) to 5. The level is
// their mean, rounded: the questionnaire produces it and the adviser sees what it produced.
export const RISK_QUESTIONS = [
  {
    id: "fall",
    question: "If this investment fell by a fifth in a year, what would the client do?",
    options: ["Sell everything", "Sell some", "Wait and see", "Hold calmly", "Buy more"],
  },
  {
    id: "priority",
    question: "Which matters more to them?",
    options: ["Never losing money", "Mostly safety", "A balance", "Mostly growth", "The most growth"],
  },
  {
    id: "loss",
    question: "How would a large loss affect their plans?",
    options: ["It would change their life", "It would hurt a lot", "They could manage", "A setback, no more", "They could absorb it"],
  },
] as const;

// The level the answers produce, or null until every question is answered.
export function riskLevelFrom(answers: readonly (number | null)[]): number | null {
  if (answers.length !== RISK_QUESTIONS.length || answers.some((a) => a === null)) return null;
  const mean = (answers as number[]).reduce((sum, a) => sum + a + 1, 0) / answers.length;
  return Math.min(5, Math.max(1, Math.round(mean)));
}

// Answers that produce a given level, for a profile loaded from elsewhere (a persona, an earlier version).
export function answersFor(level: number): number[] {
  return RISK_QUESTIONS.map(() => level - 1);
}

// A pseudonymous id, never a name: the event log cannot forget, so it is never given one (CONTEXT.md).
export function newClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `client-${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 6)}`;
}

export function blankProfile(clientId: string): ClientProfile {
  return {
    client_id: clientId,
    goal: "income",
    horizon_years: 5,
    risk_level: 3,
    knowledge: "informed",
    relies_on_income: false,
    may_need_cash_at_short_notice: false,
    exclusions: [],
  };
}

// --- The view ------------------------------------------------------------------------------------

export type ProductFacts = { runId: string; attributes: ProductAttributes; riskLevel: number };

export type ClientRow = {
  client: CaseClient;
  // The advice in play for this client, if any: the one the adviser decides and the client may see.
  advice: CaseAdvice | null;
  // Why earlier advice left play, when it did and nothing has replaced it yet.
  redraft: SupersedeCause | null;
  // The latest explanation written for the advice in play.
  explanation: Explanation | null;
  // How many earlier drafts the log holds for this client.
  earlier: number;
};

export type AdviceView = {
  verified: boolean;
  facts: ProductFacts | null;
  clients: ClientRow[];
  // Whether advice can be drafted on this case yet, and if not, the one thing missing.
  blocked: string | null;
};

export function adviceView(events: readonly SlimEvent[]): AdviceView {
  const state = fold(events);
  const completed = (step: string) => state.stepRuns.filter((r) => r.step === step && r.status === "completed");
  const verified = completed("findings").length > 0;
  const facts = productFacts(events);
  const redraft = new Map(adviceToRedraft(state).map((r) => [r.clientId, r.cause]));

  const clients = state.clients.map((client): ClientRow => {
    const theirs = state.advice.filter((a) => a.client_id === client.clientId);
    const advice = theirs.find((a) => a.supersededAtSeq === null) ?? null;
    return {
      client,
      advice,
      redraft: redraft.get(client.clientId) ?? null,
      explanation: advice ? explanationFor(events, advice.adviceId) : null,
      earlier: theirs.filter((a) => a.supersededAtSeq !== null).length,
    };
  });

  const blocked = !verified
    ? "The pack is not verified yet: run the steps on the Review tab first."
    : facts === null
      ? "The product's facts have not been read yet."
      : null;
  return { verified, facts, clients, blocked };
}

// The latest completed attributes run, read off the log: the fold keeps no step outputs.
export function productFacts(events: readonly SlimEvent[]): ProductFacts | null {
  const runs = [...events].filter((e) => e.type === "step.completed" && e.payload.step === "attributes");
  const latest = runs.at(-1);
  if (latest?.type !== "step.completed" || latest.step_run_id === null) return null;
  const parsed = ProductAttributes.safeParse(latest.payload.output);
  if (!parsed.success) return null;
  return { runId: latest.step_run_id, attributes: parsed.data, riskLevel: productRiskLevel(parsed.data) };
}

// The product as read, fact by fact, in words, each with where it was read.
export function factLines(attributes: ProductAttributes): { label: string; value: string; where: string }[] {
  const where = (c: { document_id: string; page: number }) => `${c.document_id} p${c.page}`;
  const a = attributes;
  return [
    {
      label: "Hold for at least",
      value: `${a.min_holding_years.value} ${a.min_holding_years.value === 1 ? "year" : "years"}`,
      where: where(a.min_holding_years.citation),
    },
    {
      label: "Sub-investment-grade",
      value: a.sub_investment_grade_max_pct.value === 0 ? "None" : `Up to ${a.sub_investment_grade_max_pct.value}%`,
      where: where(a.sub_investment_grade_max_pct.citation),
    },
    { label: "Capital protected", value: a.capital_protected.value ? "Yes" : "No", where: where(a.capital_protected.citation) },
    {
      label: "Income may come from capital",
      value: a.distributions_may_use_capital.value ? "Yes" : "No",
      where: where(a.distributions_may_use_capital.citation),
    },
    {
      label: "Dealing",
      value: `${a.dealing_frequency.value[0]!.toUpperCase()}${a.dealing_frequency.value.slice(1)}, ${
        a.redemption_notice_days.value === 0 ? "no notice" : `${a.redemption_notice_days.value} days' notice`
      }`,
      where: where(a.dealing_frequency.citation),
    },
    {
      label: "Exit charge",
      value: a.exit_charge_within_months.value === 0 ? "None" : `Within ${a.exit_charge_within_months.value} months`,
      where: where(a.exit_charge_within_months.citation),
    },
    { label: "Derivatives", value: a.derivatives_use.value === "none" ? "Not used" : `For ${a.derivatives_use.value}`, where: where(a.derivatives_use.citation) },
    ...a.exclusion_screens.map((s) => ({
      label: `Excludes ${EXCLUSION[s.exclusion].toLowerCase()}`,
      value: s.backed_by_ppm ? "Stated in the PPM" : "Claimed in marketing only",
      where: where(s.citation),
    })),
  ];
}
