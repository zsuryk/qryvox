"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ANALYST_ACTOR, type Citation, type ClientProfile, type KnowledgeLevel, ruleById, type SlimEvent, vulnerability } from "@qryvox/shared";
import { answerText, EFFECT } from "../lib/advice";
import { when } from "../lib/case";
import { recordReading } from "../lib/api";
import { clientView, DEPTH, HEADLINE } from "../lib/client-view";
import CitationSheet from "./citation-sheet";
import { Segmented } from "./ui";

// The client's page (#34): the key client journey. Calm and plain — the verdict as a sentence, each reason
// at the depth the client reads at (they can change it), what they must know as prominently as the
// verdict, and where every statement comes from one tap away. Only advice an adviser approved is shown.

export default function ClientAdvice({ caseId, events, clientId }: { caseId: string; events: readonly SlimEvent[]; clientId: string }) {
  const view = clientView(events, clientId);
  const [depth, setDepth] = useState<KnowledgeLevel>(view.profile?.knowledge ?? "novice");
  const [citing, setCiting] = useState<{ citation: Citation; label: string } | null>(null);
  // Whether the client lets their adviser see which depth they choose (#38). Off until they turn it on,
  // and said on the page: nothing about how they read is recorded otherwise.
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(0);

  if (view.status !== "approved") {
    const message = {
      reviewing: "Your answers are in, and the institution's rules have been applied. Your adviser is checking the result; it appears here as soon as they confirm it.",
      rejected: "Your adviser is preparing new advice for you.",
      none: "There is no advice for you here yet.",
    }[view.status];
    return (
      <main className="page page--narrow">
        <p className="t-eyebrow">Your advice</p>
        <h1 className="t-large" style={{ marginTop: "0.5rem" }}>
          {view.product}
        </h1>
        <div className="card stack" style={{ "--stack-gap": "0.5rem", marginTop: "2rem" } as React.CSSProperties}>
          <p className="t-body">{message}</p>
          {view.status === "reviewing" && view.profile && vulnerability(view.profile).length > 0 && (
            <p className="t-callout">Your adviser will speak with you before confirming it, to make sure it is explained properly.</p>
          )}
          {view.status === "reviewing" && <Waiting />}
        </div>
        {view.profile && <YourAnswers profile={view.profile} open />}
      </main>
    );
  }

  const { advice, explanation, product } = view;
  const text = explanation?.depths[depth];
  const passage = (ref: string) => text?.passages.find((p) => p.ref === ref)?.text ?? null;
  // When the adviser approved it, as the log recorded it: the decision event's own time.
  const decidedAt = events.find((e) => e.seq === advice.decision!.decidedAtSeq)?.at ?? null;

  return (
    <main className="page page--narrow">
      <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Your advice</p>
        <h1 className="t-large">{product}</h1>
      </div>

      <section className={`card verdict-hero verdict-hero--${advice.verdict}`} aria-labelledby="verdict" style={{ marginTop: "1.75rem" }}>
        <p id="verdict" className="t-title">
          {HEADLINE[advice.verdict]}
        </p>
        {text && <p className="t-body" style={{ marginTop: "0.625rem" }}>{text.summary}</p>}
      </section>

      <div className="row spread" style={{ margin: "2rem 0 1rem" }}>
        <h2 className="t-title">Why</h2>
        {explanation && (
          <Segmented<KnowledgeLevel>
            label="How much detail"
            value={depth}
            options={(["novice", "informed", "expert"] as const).map((d) => ({ value: d, label: DEPTH[d] }))}
            onChange={(next) => {
              setDepth(next);
              if (sharing) void recordReading(caseId, clientId, advice.adviceId, next).then(() => setShared((n) => n + 1)).catch(() => {});
            }}
          />
        )}
      </div>

      <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
        {advice.reasons.map((reason, i) => {
          const rule = ruleById(reason.rule);
          const words = passage(`r${i}`);
          return (
            <li key={i} className="card stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
              <div className="row" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
                <span className={`badge badge--strong badge--${EFFECT[reason.effect].tone}`}>
                  <span className="dot" />
                  {EFFECT[reason.effect].label}
                </span>
                <span className="t-callout strong">{rule.title}</span>
              </div>
              {/* The words change with the depth; the evidence under them does not. */}
              <p key={depth} className="t-body materialize" style={{ "--origin": "top center" } as React.CSSProperties}>
                {words ?? rule.text}
              </p>
              {reason.citation ? (
                <div>
                  <button type="button" className="chip chip--link" onClick={() => setCiting({ citation: reason.citation!, label: rule.title })}>
                    Where this comes from · {reason.citation.document_id} page {reason.citation.page}
                  </button>
                </div>
              ) : (
                <p className="t-footnote muted">Nothing in the product&apos;s documents speaks to this.</p>
              )}
            </li>
          );
        })}
      </ol>

      {advice.disclosures.length > 0 && (
        <section aria-labelledby="know" className="card notice--caution stack" style={{ "--stack-gap": "0.625rem", marginTop: "1.5rem" } as React.CSSProperties}>
          <h2 id="know" className="t-title" style={{ color: "var(--label)" }}>
            Things you should know
          </h2>
          {advice.disclosures.map((d, i) => (
            <div key={d.finding_id} className="stack" style={{ "--stack-gap": "0.375rem", color: "var(--label)" } as React.CSSProperties}>
              <p className="t-body">{passage(`d${i}`) ?? d.citation.quote}</p>
              <div>
                <button type="button" className="chip chip--link" onClick={() => setCiting({ citation: d.citation, label: "Things you should know" })}>
                  Where this comes from · {d.citation.document_id} page {d.citation.page}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {advice.alternatives && advice.alternatives.length > 0 && (
        <section aria-labelledby="fits" className="card stack" style={{ "--stack-gap": "0.5rem", marginTop: "1.5rem" } as React.CSSProperties}>
          <p id="fits" className="t-eyebrow">
            {advice.alternatives.length === 1 ? "A product that fits you" : "Products that fit you"}
          </p>
          {advice.alternatives.map((alt) => (
            <div key={alt.case_id}>
              <h3 className="t-title">{alt.product_name}</h3>
              <p className="t-callout muted" style={{ marginTop: "0.25rem" }}>
                Checked by the same rules, it suits you on every one. Ask your adviser about it.
              </p>
            </div>
          ))}
        </section>
      )}
      {advice.alternatives && advice.alternatives.length === 0 && advice.verdict === "not_suitable" && (
        <p className="t-callout muted" style={{ marginTop: "1.5rem" }}>
          Nothing else your adviser has checked fits you either. They will talk you through what to do next.
        </p>
      )}

      <YourAnswers profile={view.profile} />

      {explanation && (
        <label className="switch" style={{ marginTop: "2rem" }}>
          <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
          <span className="t-footnote">
            Let my adviser see which level of detail I choose, so they can explain things my way.
            {sharing && <span className="muted"> {shared > 0 ? `Shared ${shared} ${shared === 1 ? "choice" : "choices"}.` : "Nothing shared yet."}</span>}
          </span>
        </label>
      )}

      <footer className="t-footnote muted stack" style={{ "--stack-gap": "0.25rem", marginTop: "2.5rem" } as React.CSSProperties}>
        <p>
          Approved by your adviser ({ANALYST_ACTOR})
          {decidedAt ? ` on ${when(decidedAt, "date")}` : ""}. Drafted by the
          institution&apos;s rules, {advice.rules_version}.
        </p>
        <p className="faint">The product, its issuer and this client are fabricated for a demonstration. Nothing here is an offer.</p>
      </footer>

      {citing && <CitationSheet events={events} citation={citing.citation} label={citing.label} onClose={() => setCiting(null)} />}
    </main>
  );
}

// While the adviser checks: the page reads itself again every few seconds, so the advice appears without
// the client having to do anything, and says that it is doing so.
function Waiting() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);
  return (
    <p className="row t-footnote muted" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
      <span className="step__index step__index--doing" aria-hidden>
        …
      </span>
      Waiting for your adviser. This page updates by itself.
    </p>
  );
}

// What the client told us, in their words back to them: the advice rests on these answers, so they can
// check them.
function YourAnswers({ profile, open = false }: { profile: ClientProfile; open?: boolean }) {
  const fields = ["goal", "horizon_years", "risk_level", "knowledge", "relies_on_income", "may_need_cash_at_short_notice", "aged_65_or_over", "exclusions"] as const;
  return (
    <details className="card" open={open} style={{ marginTop: "1.5rem" }}>
      <summary>What you told us</summary>
      <dl className="facts" style={{ marginTop: "0.75rem" }}>
        {fields.map((field) => (
          <div key={field}>
            <dt>{FIELD[field]}</dt>
            <dd>{answerText(profile, field)}</dd>
          </div>
        ))}
      </dl>
      <p className="t-caption faint" style={{ marginTop: "0.75rem" }}>
        Something wrong? Tell your adviser: new answers set this advice aside and the rules are applied again.
      </p>
    </details>
  );
}

const FIELD = {
  goal: "The money is for",
  horizon_years: "You can leave it invested",
  risk_level: "Your attitude to risk",
  knowledge: "Your investing knowledge",
  relies_on_income: "Income",
  may_need_cash_at_short_notice: "Access to your money",
  exclusions: "You will not invest in",
  aged_65_or_over: "Your age",
} as const;
