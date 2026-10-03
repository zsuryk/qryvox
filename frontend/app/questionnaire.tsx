"use client";

import { useEffect, useState } from "react";
import { type ClientGoal, type ClientProfile, Exclusion, type KnowledgeLevel, PersonaSet } from "@qryvox/shared";
import { answersFor, EXCLUSION, GOAL, KNOWLEDGE, RISK_QUESTIONS, riskLevelFrom } from "../lib/advice";
import { Field, Segmented, Sheet, Stepper } from "./ui";

// The client questionnaire (#32): every answer chosen with a control, none typed. The risk level is what
// three questions produce, shown as the level they produced. A client is known only by a pseudonymous id
// the screen makes up; names never enter the record, which cannot forget them (CONTEXT.md).

type Persona = { name: string; summary: string; profile: ClientProfile };

export default function Questionnaire({
  initial,
  editing,
  onSave,
  onClose,
}: {
  initial: ClientProfile;
  // True when these are new answers for a client already on the case: saving supersedes their advice.
  editing: boolean;
  onSave: (profile: ClientProfile) => Promise<void>;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<ClientProfile>(initial);
  const [answers, setAnswers] = useState<(number | null)[]>(answersFor(initial.risk_level));
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The fabricated personas, from the same answer key the eval reads. Loading one fills the answers; it
  // is a starting point the adviser can change, not an input to anything.
  useEffect(() => {
    if (editing) return;
    void fetch("/eval/personas.json")
      .then((res) => res.json())
      .then((json) => setPersonas(PersonaSet.parse(json).personas))
      .catch(() => setPersonas([]));
  }, [editing]);

  const set = <K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) => setProfile((p) => ({ ...p, [key]: value }));
  const level = riskLevelFrom(answers);

  const load = (persona: Persona) => {
    setProfile(persona.profile);
    setAnswers(answersFor(persona.profile.risk_level));
  };

  async function save() {
    if (level === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await onSave({ ...profile, risk_level: level });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }

  return (
    <Sheet title={editing ? "New answers" : "Add a client"} onClose={onClose}>
      <div className="stack" style={{ "--stack-gap": "1.5rem" } as React.CSSProperties}>
        <p className="t-footnote muted">
          Recorded as <code>{profile.client_id}</code>, a pseudonymous id. Names never enter the record.
          {editing && " Saving records a new version of the answers and sets aside advice drafted on the old one."}
        </p>

        {personas.length > 0 && (
          <Field label="Start from a persona" hint="Fabricated clients for the demonstration. Every answer can be changed.">
            <div className="choices">
              {personas.map((persona) => (
                <button
                  key={persona.profile.client_id}
                  type="button"
                  className="chip"
                  aria-pressed={profile.client_id === persona.profile.client_id}
                  title={persona.summary}
                  onClick={() => load(persona)}
                >
                  {persona.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="What is the money for?">
          <Segmented<ClientGoal>
            label="Goal"
            value={profile.goal}
            options={(["income", "growth", "preservation"] as const).map((g) => ({ value: g, label: GOAL[g] }))}
            onChange={(g) => set("goal", g)}
          />
        </Field>

        <Field label="How long can it stay invested?">
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

        <Field label="Attitude to risk" hint="Three questions. The level is what the answers produce.">
          <div className="stack" style={{ "--stack-gap": "0.875rem" } as React.CSSProperties}>
            {RISK_QUESTIONS.map((q, qi) => (
              <div key={q.id} role="group" aria-label={q.question} className="stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
                <p className="t-callout">{q.question}</p>
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
                  These answers give <strong>risk level {level} of 5</strong>.
                </>
              )}
            </p>
          </div>
        </Field>

        <Field label="Investing knowledge" hint="Also how deep the explanation goes.">
          <Segmented<KnowledgeLevel>
            label="Knowledge"
            value={profile.knowledge}
            options={(["novice", "informed", "expert"] as const).map((k) => ({ value: k, label: KNOWLEDGE[k] }))}
            onChange={(k) => set("knowledge", k)}
          />
        </Field>

        <Field label="Circumstances">
          <div className="stack" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
            <label className="switch">
              <input type="checkbox" checked={profile.relies_on_income} onChange={(e) => set("relies_on_income", e.target.checked)} />
              <span className="t-callout">Relies on the income it pays</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={profile.may_need_cash_at_short_notice}
                onChange={(e) => set("may_need_cash_at_short_notice", e.target.checked)}
              />
              <span className="t-callout">May need the money at short notice</span>
            </label>
          </div>
        </Field>

        <Field label="Will not invest in">
          <div className="choices">
            {Exclusion.options.map((e) => (
              <button
                key={e}
                type="button"
                className="chip"
                aria-pressed={profile.exclusions.includes(e)}
                onClick={() =>
                  set("exclusions", profile.exclusions.includes(e) ? profile.exclusions.filter((x) => x !== e) : [...profile.exclusions, e])
                }
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
          <button type="button" className="btn btn--primary" disabled={level === null || saving} aria-busy={saving} onClick={() => void save()}>
            {saving ? "Recording…" : editing ? "Record new answers" : "Record answers"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
