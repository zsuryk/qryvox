import { type Disclosure, type Reason, verdictFor, type Verdict } from "./advice.js";
import { type ClientProfile, type DealingFrequency, type ProductAttributes, productRiskLevel } from "./client.js";
import type { Citation, Finding } from "./finding.js";

// The suitability rules (rules.ts), applied. A pure function, beside fold: the server drafts advice with
// it and the browser's replay recomputes the same verdict, because nothing here calls a model, reads the
// clock or computes a return. Every comparison is between a client's answer and a value the documents
// state.

// "At short notice" (S4), made concrete: money back within about a week, without a charge for leaving.
const SHORT_NOTICE_DEALING: readonly DealingFrequency[] = ["daily", "weekly"];
const SHORT_NOTICE_MAX_DAYS = 7;

export type Assessment = { verdict: Verdict; reasons: Reason[]; disclosures: Disclosure[] };

// findings: the findings on the board that the analyst has not dismissed (undismissedFindings). S6
// discloses those in fees or terms.
export function assessSuitability(
  profile: ClientProfile,
  attributes: ProductAttributes,
  findings: readonly Finding[],
): Assessment {
  const reasons: Reason[] = [
    horizon(profile, attributes),
    risk(profile, attributes),
    ...income(profile, attributes),
    ...cashAtShortNotice(profile, attributes),
    ...exclusions(profile, attributes),
    ...goal(profile, attributes),
  ];
  return { verdict: verdictFor(reasons), reasons, disclosures: disclose(findings) };
}

// S1: the horizon must reach the product's minimum holding period.
function horizon(profile: ClientProfile, a: ProductAttributes): Reason {
  return {
    rule: "S1",
    effect: profile.horizon_years >= a.min_holding_years.value ? "meets" : "blocks",
    profile_field: "horizon_years",
    citation: a.min_holding_years.citation,
  };
}

// S2: the product's mapped risk level must not exceed the client's. Cites the attribute that set the level.
function risk(profile: ClientProfile, a: ProductAttributes): Reason {
  return {
    rule: "S2",
    effect: productRiskLevel(a) <= profile.risk_level ? "meets" : "blocks",
    profile_field: "risk_level",
    citation: riskDriver(a),
  };
}

function riskDriver(a: ProductAttributes): Citation {
  if (a.derivatives_use.value === "investment") return a.derivatives_use.citation;
  if (a.sub_investment_grade_max_pct.value > 0) return a.sub_investment_grade_max_pct.citation;
  return a.capital_protected.citation;
}

// S3: only for a client who relies on the income; a warning, never a block.
function income(profile: ClientProfile, a: ProductAttributes): Reason[] {
  if (!profile.relies_on_income) return [];
  return [
    {
      rule: "S3",
      effect: a.distributions_may_use_capital.value ? "warns" : "meets",
      profile_field: "relies_on_income",
      citation: a.distributions_may_use_capital.citation,
    },
  ];
}

// S4: only for a client who may need the money at short notice. One reason per dealing term that stands
// in the way, so each cites its own passage; one "meets" when none does.
function cashAtShortNotice(profile: ClientProfile, a: ProductAttributes): Reason[] {
  if (!profile.may_need_cash_at_short_notice) return [];
  const blocking = [
    SHORT_NOTICE_DEALING.includes(a.dealing_frequency.value) ? null : a.dealing_frequency.citation,
    a.redemption_notice_days.value <= SHORT_NOTICE_MAX_DAYS ? null : a.redemption_notice_days.citation,
    a.exit_charge_within_months.value === 0 ? null : a.exit_charge_within_months.citation,
  ].filter((c) => c !== null);
  const reason = (effect: Reason["effect"], citation: Citation): Reason => ({
    rule: "S4",
    effect,
    profile_field: "may_need_cash_at_short_notice",
    citation,
  });
  return blocking.length > 0 ? blocking.map((c) => reason("blocks", c)) : [reason("meets", a.dealing_frequency.citation)];
}

// S5: each exclusion the client holds. A screen the PPM backs meets it; one only marketing claims leaves it
// for the adviser to confirm; no screen at all means nothing keeps those holdings out.
function exclusions(profile: ClientProfile, a: ProductAttributes): Reason[] {
  return profile.exclusions.map((exclusion) => {
    const screen = a.exclusion_screens.find((s) => s.exclusion === exclusion);
    return {
      rule: "S5",
      effect: screen === undefined ? "blocks" : screen.backed_by_ppm ? "meets" : "conditional",
      profile_field: "exclusions",
      citation: screen?.citation ?? null,
    };
  });
}

// S7 (#41): the client's goal against what the product is built for. A mismatch is a warning, never a
// block: an income fund is not unsuitable for a growth investor on that alone, but they are told plainly.
// Silent when the attributes predate it (no primary objective read).
function goal(profile: ClientProfile, a: ProductAttributes): Reason[] {
  if (!a.primary_objective) return [];
  return [
    {
      rule: "S7",
      effect: a.primary_objective.value === profile.goal ? "meets" : "warns",
      profile_field: "goal",
      citation: a.primary_objective.citation,
    },
  ];
}

// S6: every fees or terms finding still open is disclosed, citing the more authoritative side — the
// counterpart when there is one, since a finding is cited on the less authoritative document (CONTEXT.md).
function disclose(findings: readonly Finding[]): Disclosure[] {
  return findings
    .filter((f) => f.category === "fees" || f.category === "terms")
    .map((f) => ({ rule: "S6", finding_id: f.finding_id, citation: f.counterpart ?? f.citation }));
}
