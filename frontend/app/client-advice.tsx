"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ANALYST_ACTOR, type Citation, type ClientProfile, explanationFor, type KnowledgeLevel, ruleById, shelfFor, type SlimEvent, vulnerability } from "@qryvox/shared";
import { EFFECT } from "../lib/advice";
import { recordReading, runStep } from "../lib/api";
import { clientView } from "../lib/client-view";
import { answerIn, dateIn, type Lang, WORDS } from "../lib/i18n";
import CitationSheet from "./citation-sheet";
import LanguageSwitch from "./language-switch";
import ShelfComparison, { type Cited } from "./shelf-comparison";
import { Segmented } from "./ui";

// The client's page (#34): the key client journey. Calm and plain — the verdict as a sentence, each reason
// at the depth the client reads at (they can change it), what they must know as prominently as the
// verdict, and where every statement comes from one tap away. Only advice an adviser approved is shown.
// In the client's language (#43): the one they answered in, and switchable here. The explanation itself
// is written once, in the language they chose; quoted document text stays in the document's language.

export default function ClientAdvice({
  caseId,
  events,
  clientId,
  shelfEvents = {},
  fromList = false,
}: {
  caseId: string;
  events: readonly SlimEvent[];
  clientId: string;
  // The events of every other case on the shelf comparison, by case id: their citations open their own pages.
  shelfEvents?: Record<string, readonly SlimEvent[]>;
  // Opened from the client's list (#71): a way back to it, no second comparison, and the explanation is
  // written now, on open, if no one has written it.
  fromList?: boolean;
}) {
  const view = clientView(events, clientId);
  const [lang, setLang] = useState<Lang>(view.profile?.language ?? "en");
  const [depth, setDepth] = useState<KnowledgeLevel>(view.profile?.knowledge ?? "novice");
  const [citing, setCiting] = useState<Cited | null>(null);
  // Whether the client lets their adviser see which depth they choose (#38). Off until they turn it on,
  // and said on the page: nothing about how they read is recorded otherwise.
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(0);
  const w = WORDS[lang];
  const pageLang = lang === "en" ? "en" : "zh-Hant-HK";
  const approvedAdviceId = view.status === "approved" ? view.advice.adviceId : null;
  const needsExplanation = fromList && view.status === "approved" && view.explanation === null;
  const writing = useWriteOnOpen(needsExplanation, caseId, approvedAdviceId);

  const header = (
    <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
      {fromList && (
        <p className="t-callout">
          <Link href={`/list/${clientId}`}>{w.list.back}</Link>
        </p>
      )}
      <div className="row spread">
        <p className="t-eyebrow">{w.advice.eyebrow}</p>
        <LanguageSwitch lang={lang} onChange={setLang} />
      </div>
      <h1 className="t-large">{view.product}</h1>
    </div>
  );

  if (view.status !== "approved") {
    return (
      <main className="page page--narrow" lang={pageLang}>
        {header}
        <div className="card stack" style={{ "--stack-gap": "0.5rem", marginTop: "2rem" } as React.CSSProperties}>
          <p className="t-body">{w.advice[view.status]}</p>
          {view.status === "reviewing" && view.profile && vulnerability(view.profile).length > 0 && <p className="t-callout">{w.advice.vulnerable}</p>}
          {view.status === "reviewing" && <Waiting text={w.advice.waiting} />}
        </div>
        {view.profile && <YourAnswers profile={view.profile} lang={lang} open />}
      </main>
    );
  }

  const { advice } = view;
  // The explanation in the language the page is read in; failing that, the one that was written, with an
  // offer to write this one (#75). Written once per language and kept on the log.
  const inLanguage = explanationFor(events, advice.adviceId, lang);
  const explanation = inLanguage ?? view.explanation;
  const writtenIn = explanation?.language ?? "en";
  const text = explanation?.depths[depth];
  const passage = (ref: string) => text?.passages.find((p) => p.ref === ref)?.text ?? null;
  // When the adviser approved it, as the log recorded it: the decision event's own time.
  const decidedAt = events.find((e) => e.seq === advice.decision!.decidedAtSeq)?.at ?? null;
  const source = (citation: Citation, label: string) => (
    <div>
      <button type="button" className="chip chip--link" onClick={() => setCiting({ citation, label, caseId: null })}>
        {w.advice.source(citation.document_id, citation.page)}
      </button>
    </div>
  );

  return (
    <main className="page page--narrow" lang={pageLang}>
      {header}

      <section className={`card verdict-hero verdict-hero--${advice.verdict}`} aria-labelledby="verdict" style={{ marginTop: "1.75rem" }}>
        <p id="verdict" className="t-title">
          {w.verdict[advice.verdict]}
        </p>
        {text && (
          <p className="t-body" style={{ marginTop: "0.625rem" }}>
            {text.summary}
          </p>
        )}
        {/* Only the adviser's own pick is recommended: the verdict above is the rules' result (ADR-0008). */}
        {advice.decision?.adviserPick && (
          <p className="row" style={{ "--row-gap": "0.5rem", marginTop: "0.75rem" } as React.CSSProperties}>
            <span className="badge badge--strong badge--positive">
              <span className="dot" />
              {w.list.recommended}
            </span>
          </p>
        )}
      </section>

      {explanation && inLanguage === null && (
        <OtherLanguage caseId={caseId} adviceId={advice.adviceId} lang={lang} writtenIn={writtenIn} />
      )}

      {writing.state !== "idle" && (
        <div className="card stack" aria-live="polite" style={{ "--stack-gap": "0.375rem", marginTop: "1rem" } as React.CSSProperties}>
          {writing.state === "writing" ? (
            <>
              <p className="row t-callout" style={{ "--row-gap": "0.625rem" } as React.CSSProperties}>
                <span className="step__index step__index--doing" aria-hidden>
                  …
                </span>
                {w.list.writing}
              </p>
              <p className="t-footnote muted">{w.list.writingNote}</p>
            </>
          ) : (
            <>
              <p className="t-callout">{w.list.writeFailed}</p>
              <div>
                <button type="button" className="btn btn--small" onClick={writing.retry}>
                  {w.list.retry}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!fromList && shelfFor(advice).length > 0 && (
        <p className="t-callout" style={{ marginTop: "1rem" }}>
          <a href="#shelf">{w.list.compare}</a>
        </p>
      )}

      <div className="row spread" style={{ margin: "2rem 0 1rem" }}>
        <h2 className="t-title">{w.advice.why}</h2>
        {explanation && (
          <Segmented<KnowledgeLevel>
            label={w.advice.detail}
            value={depth}
            options={(["novice", "informed", "expert"] as const).map((d) => ({ value: d, label: w.depth[d] }))}
            onChange={(next) => {
              setDepth(next);
              if (sharing) void recordReading(caseId, clientId, advice.adviceId, next).then(() => setShared((n) => n + 1)).catch(() => {});
            }}
          />
        )}
      </div>

      <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
        {advice.reasons.map((reason, i) => {
          const title = w.rule[reason.rule];
          const words = passage(`r${i}`);
          return (
            <li key={i} className="card stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
              <div className="row" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
                <span className={`badge badge--strong badge--${EFFECT[reason.effect].tone}`}>
                  <span className="dot" />
                  {w.effect[reason.effect]}
                </span>
                <span className="t-callout strong">{title}</span>
              </div>
              {/* The words change with the depth; the evidence under them does not. */}
              <p key={depth} className="t-body materialize" style={{ "--origin": "top center" } as React.CSSProperties}>
                {words ?? (lang === "en" ? ruleById(reason.rule).text : title)}
              </p>
              {reason.citation ? source(reason.citation, title) : <p className="t-footnote muted">{w.advice.noSource}</p>}
            </li>
          );
        })}
      </ol>

      {advice.disclosures.length > 0 && (
        <section aria-labelledby="know" className="card notice--caution stack" style={{ "--stack-gap": "0.625rem", marginTop: "1.5rem" } as React.CSSProperties}>
          <h2 id="know" className="t-title" style={{ color: "var(--label)" }}>
            {w.advice.know}
          </h2>
          {advice.disclosures.map((d, i) => (
            <div key={d.finding_id} className="stack" style={{ "--stack-gap": "0.375rem", color: "var(--label)" } as React.CSSProperties}>
              <p className="t-body">{passage(`d${i}`) ?? d.citation.quote}</p>
              {source(d.citation, w.advice.knowSource)}
            </div>
          ))}
        </section>
      )}

      {fromList ? null : shelfFor(advice).length > 0 ? (
        <ShelfComparison advice={advice} product={view.product} lang={lang} onCite={(cited) => setCiting(cited)} />
      ) : (
        advice.verdict === "not_suitable" &&
        (advice.shelf ?? advice.alternatives) !== undefined && (
          <p className="t-callout muted" style={{ marginTop: "1.5rem" }}>
            {w.advice.noneFit}
          </p>
        )
      )}

      <YourAnswers profile={view.profile} lang={lang} />

      {explanation && (
        <label className="switch" style={{ marginTop: "2rem" }}>
          <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
          <span className="t-footnote">
            {w.advice.share}
            {sharing && <span className="muted"> {w.advice.shared(shared)}</span>}
          </span>
        </label>
      )}

      <footer className="t-footnote muted stack" style={{ "--stack-gap": "0.25rem", marginTop: "2.5rem" } as React.CSSProperties}>
        <p>{w.advice.approved(ANALYST_ACTOR, decidedAt ? dateIn(lang, decidedAt) : null, advice.rules_version)}</p>
        <p className="faint">{w.advice.fabricated}</p>
      </footer>

      {citing && <CitationSheet events={citing.caseId === null ? events : (shelfEvents[citing.caseId] ?? [])} citation={citing.citation} label={citing.label} onClose={() => setCiting(null)} />}
    </main>
  );
}

// While the adviser checks: the page reads itself again every few seconds, so the advice appears without
// the client having to do anything, and says that it is doing so.
export function Waiting({ text }: { text: string }) {
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
      {text}
    </p>
  );
}

// What the client told us, in their words back to them: the advice rests on these answers, so they can
// check them.
export function YourAnswers({ profile, lang, open = false }: { profile: ClientProfile; lang: Lang; open?: boolean }) {
  const w = WORDS[lang].answers;
  const fields = ["goal", "horizon_years", "risk_level", "knowledge", "relies_on_income", "may_need_cash_at_short_notice", "aged_65_or_over", "exclusions"] as const;
  return (
    <details className="card" open={open} style={{ marginTop: "1.5rem" }}>
      <summary>{w.title}</summary>
      <dl className="facts" style={{ marginTop: "0.75rem" }}>
        {fields.map((field) => (
          <div key={field}>
            <dt>{w.field[field]}</dt>
            <dd>{answerIn(lang, profile, field)}</dd>
          </div>
        ))}
      </dl>
      <p className="t-caption faint" style={{ marginTop: "0.75rem" }}>
        {w.note}
      </p>
    </details>
  );
}

// The explanation for a product opened from the list (#71), written when it is opened: one explain run on
// that advice, in the client's language, then the page reads the log again. Opening never spends twice: a
// run that completed is on the log and the page shows it. A failure says so and offers to try again.
function useWriteOnOpen(needed: boolean, caseId: string, adviceId: string | null) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "writing" | "failed">(needed ? "writing" : "idle");
  const [attempt, setAttempt] = useState(0);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!needed || adviceId === null || started.current === attempt) return;
    started.current = attempt;
    setState("writing");
    runStep(caseId, { step_run_id: crypto.randomUUID(), step: "explain", input_run_id: adviceId })
      .then(() => router.refresh())
      .catch(() => setState("failed"));
  }, [needed, caseId, adviceId, attempt, router]);
  return { state: needed ? state : "idle", retry: () => setAttempt((n) => n + 1) };
}

// The offer to read the explanation in the page's language when it was written in the other (#75): one
// explain run in that language, on request, kept on the log; the page then reads it from there.
function OtherLanguage({ caseId, adviceId, lang, writtenIn }: { caseId: string; adviceId: string; lang: Lang; writtenIn: Lang }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "writing" | "failed">("idle");
  const w = WORDS[lang];
  async function write() {
    setState("writing");
    try {
      await runStep(caseId, { step_run_id: crypto.randomUUID(), step: "explain", input_run_id: adviceId, language: lang });
      router.refresh();
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="card stack" aria-live="polite" style={{ "--stack-gap": "0.5rem", marginTop: "1rem" } as React.CSSProperties}>
      <p className="t-callout">{w.advice.otherLanguage.note(WORDS[writtenIn].languageName)}</p>
      {state === "writing" ? (
        <p className="row t-footnote muted" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
          <span className="step__index step__index--doing" aria-hidden>
            …
          </span>
          {w.advice.otherLanguage.writing}
        </p>
      ) : (
        <div className="row" style={{ "--row-gap": "0.75rem" } as React.CSSProperties}>
          <button type="button" className="btn btn--small" onClick={() => void write()}>
            {w.advice.otherLanguage.button(w.languageName)}
          </button>
          {state === "failed" && <span className="t-footnote text-negative">{w.advice.otherLanguage.failed}</span>}
        </div>
      )}
    </div>
  );
}
