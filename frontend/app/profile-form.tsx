"use client";

import { type ReactNode, useState } from "react";
import { type ClientGoal, type ClientProfile, Exclusion, type KnowledgeLevel } from "@qryvox/shared";
import { answersFor, EXCLUSION, GOAL, KNOWLEDGE, RISK_QUESTIONS, riskLevelFrom } from "../lib/advice";
import { Field, Segmented, Stepper } from "./ui";

// The questionnaire's form, in one of two voices: the adviser's, asking about "the client", or the
// client's own, asking about "you" (#32, client self-service). Every answer is chosen with a control, none
// typed, and the risk level is what three questions produce, shown as the level they produced.

export type Voice = "adviser" | "client";

const WORDS = {
  adviser: {
    goal: "What is the money for?",
    horizon: "How long can it stay invested?",
    risk: "Attitude to risk",
    riskHint: "Three questions. The level is what the answers produce.",
    knowledge: "Investing knowledge",
    knowledgeHint: "Also how deep the explanation goes.",
    circumstances: "Circumstances",
    income: "Relies on the income it pays",
    cash: "May need the money at short notice",
    exclusions: "Will not invest in",
  },
  client: {
    goal: "What is this money for?",
    horizon: "How long can you leave it invested?",
    risk: "How you feel about losses",
    riskHint: "Three quick questions. There are no wrong answers.",
    knowledge: "How much do you know about investing?",
    knowledgeHint: "Your advice will be explained at this level. You can change it when you read it.",
    circumstances: "Your situation",
    income: "I rely on the income it pays",
    cash: "I may need the money at short notice",
    exclusions: "I will not invest in",
  },
} as const;

export default function ProfileForm({
  initial,
  voice,
  before,
  submitLabel,
  busyLabel,
  onSubmit,
  onLoaded,
}: {
  initial: ClientProfile;
  voice: Voice;
  // Anything above the questions, such as the adviser's persona chips; handed the setter so it can fill them.
  before?: (load: (profile: ClientProfile) => void, current: ClientProfile) => ReactNode;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (profile: ClientProfile) => Promise<void>;
  onLoaded?: () => void;
}) {
  const w = WORDS[voice];
  const [profile, setProfile] = useState<ClientProfile>(initial);
  const [answers, setAnswers] = useState<(number | null)[]>(voice === "client" ? RISK_QUESTIONS.map(() => null) : answersFor(initial.risk_level));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) => setProfile((p) => ({ ...p, [key]: value }));
  const level = riskLevelFrom(answers);

  const load = (next: ClientProfile) => {
    setProfile(next);
    setAnswers(answersFor(next.risk_level));
    onLoaded?.();
  };

  async function submit() {
    if (level === null) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({ ...profile, risk_level: level });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ "--stack-gap": "1.5rem" } as React.CSSProperties}>
      {before?.(load, profile)}

      <Field label={w.goal}>
        <Segmented<ClientGoal>
          label="Goal"
          value={profile.goal}
          options={(["income", "growth", "preservation"] as const).map((g) => ({ value: g, label: GOAL[g] }))}
          onChange={(g) => set("goal", g)}
        />
      </Field>

      <Field label={w.horizon}>
        <Stepper
          label="Years"
          value={profile.horizon_years}
          min={1}
          max={40}
          unit={(n) => `${n} ${n === 1 ? "year" : "years"}`}
          presets={[1, 2, 5, 10]}
          onChange={(n) => set("horizon_years", n)}
        />
      </Field>

      <Field label={w.risk} hint={w.riskHint}>
        <div className="stack" style={{ "--stack-gap": "0.875rem" } as React.CSSProperties}>
          {RISK_QUESTIONS.map((q, qi) => (
            <div key={q.id} role="group" aria-label={q.question[voice]} className="stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
              <p className="t-callout">{q.question[voice]}</p>
              <div className="choices">
                {q.options.map((option, oi) => (
                  <button
                    key={option}
                    type="button"
                    className="chip"
                    aria-pressed={answers[qi] === oi}
                    onClick={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="t-callout" aria-live="polite">
            {level === null ? (
              <span className="muted">Answer all three to set the level.</span>
            ) : (
              <>
                {voice === "client" ? "Your answers give" : "These answers give"} <strong>risk level {level} of 5</strong>.
              </>
            )}
          </p>
        </div>
      </Field>

      <Field label={w.knowledge} hint={w.knowledgeHint}>
        <Segmented<KnowledgeLevel>
          label="Knowledge"
          value={profile.knowledge}
          options={(["novice", "informed", "expert"] as const).map((k) => ({ value: k, label: KNOWLEDGE[k] }))}
          onChange={(k) => set("knowledge", k)}
        />
      </Field>

      <Field label={w.circumstances}>
        <div className="stack" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
          <label className="switch">
            <input type="checkbox" checked={profile.relies_on_income} onChange={(e) => set("relies_on_income", e.target.checked)} />
            <span className="t-callout">{w.income}</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={profile.may_need_cash_at_short_notice} onChange={(e) => set("may_need_cash_at_short_notice", e.target.checked)} />
            <span className="t-callout">{w.cash}</span>
          </label>
        </div>
      </Field>

      <Field label={w.exclusions}>
        <div className="choices">
          {Exclusion.options.map((e) => (
            <button
              key={e}
              type="button"
              className="chip"
              aria-pressed={profile.exclusions.includes(e)}
              onClick={() => set("exclusions", profile.exclusions.includes(e) ? profile.exclusions.filter((x) => x !== e) : [...profile.exclusions, e])}
            >
              {EXCLUSION[e]}
            </button>
          ))}
        </div>
      </Field>

      <div className="row spread">
        {problem ? (
          <p className="t-footnote text-negative" role="alert">
            Not recorded: {problem}
          </p>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn--primary" disabled={level === null || busy} aria-busy={busy} onClick={() => void submit()}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}
