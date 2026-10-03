"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type AdviceDecision,
  type Citation,
  type ClientProfile,
  type DecisionConfirmation,
  fold,
  knowledgeSuggestion,
  READING_THRESHOLD,
  type RejectionReason,
  RejectionReason as Reasons,
  ruleById,
  type SlimEvent,
  vulnerability,
} from "@qryvox/shared";
import {
  type AdviceView,
  adviceView,
  answerText,
  blankProfile,
  CAUSE,
  type ClientRow,
  EFFECT,
  factLines,
  KNOWLEDGE,
  newClientId,
  profileSummary,
  REJECTION,
  VERDICT,
} from "../lib/advice";
import { decideAdvice, draftAdvice, fetchEvents, recordProfile, runStep } from "../lib/api";
import { errorMessage } from "../lib/errors";
import CitationSheet from "./citation-sheet";
import { AdviceEval } from "./eval-tiles";
import Questionnaire from "./questionnaire";

// The Advice section: the product as read, and each client with the advice the rules drafted for them,
// waiting for the adviser (#32, #33). The adviser decides; nothing here approves anything by itself, and
// every action is an event appended to the case's log and read back from it before it is shown.

type Busy = { key: string; label: string } | null;

// How the client page names each depth, so the suggestion speaks of what the client actually pressed.
const KNOWLEDGE_DEPTH = { novice: "simple", informed: "detailed", expert: "in-full" } as const;

export default function AdviceSection({ caseId, events, refetch }: { caseId: string; events: readonly SlimEvent[]; refetch: () => Promise<void> }) {
  // The log as most recently read: the server's copy until an action reads a newer one (as CaseView does).
  const [read, setRead] = useState<{ server: readonly SlimEvent[]; log: readonly SlimEvent[] } | null>(null);
  const log = read !== null && read.server === events ? read.log : events;
  const [busy, setBusy] = useState<Busy>(null);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [asking, setAsking] = useState<{ profile: ClientProfile; editing: boolean } | null>(null);
  const [citing, setCiting] = useState<{ citation: Citation; label: string } | null>(null);

  let view: AdviceView;
  try {
    view = adviceView(log);
  } catch (cause) {
    return <p className="notice notice--negative t-callout">This section cannot be built from the case&apos;s log: {errorMessage(cause)}</p>;
  }

  // One action at a time, said out loud when it lands or fails, then the log read back.
  async function act(key: string, label: string, done: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy({ key, label });
    setSaid(null);
    try {
      await fn();
      setSaid({ text: done, ok: true });
    } catch (cause) {
      setSaid({ text: `${label} did not go through: ${errorMessage(cause)}`, ok: false });
    } finally {
      try {
        setRead({ server: events, log: await fetchEvents(caseId) });
        await refetch();
      } catch {
        // The log on screen stays the last one read; nothing about the action is in doubt.
      }
      setBusy(null);
    }
  }

  const readFacts = () =>
    act("facts", "Reading the product's facts", "The product's facts are read.", () =>
      runStep(caseId, { step_run_id: crypto.randomUUID(), step: "attributes", input_run_id: null }),
    );

  const save = async (profile: ClientProfile) => {
    await recordProfile(caseId, crypto.randomUUID(), profile);
    setAsking(null);
    setRead({ server: events, log: await fetchEvents(caseId) });
    setSaid({ text: `Answers recorded for ${profile.client_id}.`, ok: true });
    await refetch();
  };

  // The review queue: drafts no adviser has decided, first, so nothing waits behind decided work.
  const waiting = view.clients.filter((row) => row.advice !== null && row.advice.decision === null);
  const ordered = [...waiting, ...view.clients.filter((row) => !waiting.includes(row))];

  return (
    <>
      <section className="section" aria-labelledby="product-heading">
        <div className="section-head">
          <h2 id="product-heading" className="t-title">
            The product, as read
          </h2>
          {view.facts && <span className="t-footnote muted">Risk level {view.facts.riskLevel} of 5, mapped from these facts</span>}
        </div>
        <div className="card stack" style={{ "--stack-gap": "1rem" } as React.CSSProperties}>
          {!view.verified && (
            <p className="t-callout">
              Advice is drafted only on a verified product. <Link href={`/cases/${caseId}`}>Run the steps on the Review tab →</Link>
            </p>
          )}
          {view.facts ? (
            <dl className="facts">
              {factLines(view.facts.attributes).map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                  <dd className="t-caption faint" style={{ fontWeight: 400 }}>
                    {fact.where}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="t-callout muted">
              The facts suitability needs — how long to hold it, what it holds, how money comes out — have not been read
              from the documents yet.
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className={`btn ${view.facts ? "btn--small" : "btn--primary"}`}
              disabled={busy !== null}
              aria-busy={busy?.key === "facts"}
              onClick={() => void readFacts()}
            >
              {busy?.key === "facts" ? "Reading…" : view.facts ? "Read the facts again" : "Read the product's facts"}
            </button>
            <span className="t-caption faint">Every value is quoted from the documents, the PPM first.</span>
          </div>
          {view.blocked === null && <ClientLink caseId={caseId} />}
        </div>
      </section>

      <section className="section" aria-labelledby="clients-heading">
        <div className="section-head spread">
          <div className="row row--baseline" style={{ "--row-gap": "0.875rem" } as React.CSSProperties}>
            <h2 id="clients-heading" className="t-title">
              Clients
            </h2>
            <span className="t-footnote muted">
              {view.clients.length === 0 ? "None yet" : `${view.clients.length} on this product`}
            </span>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setAsking({ profile: blankProfile(newClientId()), editing: false })}>
            Add a client
          </button>
        </div>

        {waiting.length > 0 && (
          <div className="notice notice--caution row spread" style={{ marginBottom: "1rem" }}>
            <p className="t-callout strong" style={{ color: "var(--label)" }}>
              {waiting.length === 1 ? "1 draft is" : `${waiting.length} drafts are`} waiting for your decision
            </p>
            <span className="t-footnote" style={{ color: "var(--label)" }}>
              Listed first. Clients see nothing until you approve.
            </span>
          </div>
        )}

        {view.clients.length === 0 ? (
          <div className="card card--quiet stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
            <p className="t-headline">No clients yet</p>
            <p className="t-callout muted">Add a client to record their answers. Advice is drafted from them by the institution&apos;s rules.</p>
          </div>
        ) : (
          <ul className="list-plain stack" style={{ "--stack-gap": "1rem" } as React.CSSProperties}>
            {ordered.map((row) => (
              <ClientCard
                key={row.client.clientId}
                caseId={caseId}
                row={row}
                blocked={view.blocked}
                busy={busy}
                suggestion={knowledgeSuggestion(fold(log), row.client.clientId)}
                onAcceptSuggestion={(knowledge) =>
                  void act(`suggest:${row.client.clientId}`, "Recording new answers", "New answers recorded. Advice on the old ones is set aside.", () =>
                    recordProfile(caseId, crypto.randomUUID(), { ...row.client.profile, knowledge }),
                  )
                }
                onEdit={() => setAsking({ profile: row.client.profile, editing: true })}
                onCite={(citation, label) => setCiting({ citation, label })}
                onDraft={() =>
                  void act(`draft:${row.client.clientId}`, "Drafting advice", "Advice drafted by the rules. It waits for your decision.", () =>
                    draftAdvice(caseId, crypto.randomUUID(), row.client.clientId),
                  )
                }
                onExplain={(adviceId) =>
                  void act(`explain:${adviceId}`, "Writing the explanation", "The explanation is written, at all three depths.", () =>
                    runStep(caseId, { step_run_id: crypto.randomUUID(), step: "explain", input_run_id: adviceId }),
                  )
                }
                onDecide={(adviceId, decision, extra) =>
                  void act(
                    `decide:${adviceId}`,
                    decision === "approved" ? "Approving" : "Rejecting",
                    decision === "approved" ? "Approved. The client can now see this advice." : "Rejected. The client will not see it.",
                    () => decideAdvice(caseId, adviceId, crypto.randomUUID(), decision, extra),
                  )
                }
              />
            ))}
          </ul>
        )}

        <p aria-live="polite" role="status" className={`t-footnote ${said?.ok === false ? "text-negative" : "muted"}`} style={{ marginTop: "1rem" }}>
          {busy ? `${busy.label}…` : said?.text}
        </p>
      </section>

      <AdviceEval events={log} />

      {asking && (
        <Questionnaire initial={asking.profile} editing={asking.editing} onSave={save} onClose={() => setAsking(null)} />
      )}
      {citing && <CitationSheet events={log} citation={citing.citation} label={citing.label} onClose={() => setCiting(null)} />}
    </>
  );
}

function ClientCard({
  caseId,
  row,
  blocked,
  busy,
  suggestion,
  onAcceptSuggestion,
  onEdit,
  onCite,
  onDraft,
  onExplain,
  onDecide,
}: {
  caseId: string;
  row: ClientRow;
  blocked: string | null;
  busy: Busy;
  suggestion: { depth: ClientProfile["knowledge"]; count: number } | null;
  onAcceptSuggestion: (knowledge: ClientProfile["knowledge"]) => void;
  onEdit: () => void;
  onCite: (citation: Citation, label: string) => void;
  onDraft: () => void;
  onExplain: (adviceId: string) => void;
  onDecide: (adviceId: string, decision: AdviceDecision, extra: { reason?: RejectionReason; confirmations?: DecisionConfirmation[] }) => void;
}) {
  const { client, advice, redraft, explanation } = row;
  const profile = client.profile;
  // A client who calls for extra care, and why (#42): approving needs the adviser's confirmation.
  const vulnerable = vulnerability(profile);
  const [explained, setExplained] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  return (
    <li className="card stack" style={{ "--stack-gap": "1rem" } as React.CSSProperties}>
      <div className="row spread">
        <div className="stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
          <p className="t-headline">
            <code>{client.clientId}</code>
            <span className="t-caption faint" style={{ marginLeft: "0.5rem" }}>
              answers v{client.version}
            </span>
          </p>
          <div className="row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
            {profileSummary(profile).map((fact) => (
              <span key={fact} className="badge">
                {fact}
              </span>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn--small" onClick={onEdit}>
          New answers
        </button>
      </div>

      {vulnerable.length > 0 && (
        <div className="notice notice--caution stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
          <p className="t-footnote strong" style={{ color: "var(--label)" }}>
            This client needs extra care: {vulnerable.join("; ")}.
          </p>
          {advice !== null && advice.decision === null && (
            <label className="switch">
              <input type="checkbox" checked={explained} onChange={(e) => setExplained(e.target.checked)} />
              <span className="t-footnote" style={{ color: "var(--label)" }}>
                I have explained this advice to the client directly. Approving records this confirmation.
              </span>
            </label>
          )}
        </div>
      )}

      {suggestion && (
        <div className="notice notice--tint row spread">
          <p className="t-footnote" style={{ color: "var(--label)" }}>
            The client read the {KNOWLEDGE_DEPTH[suggestion.depth]} explanation {suggestion.count} times in a row — they chose to share
            this — but their answers say {KNOWLEDGE[profile.knowledge].toLowerCase()}. Worth asking again
            {suggestion.count > READING_THRESHOLD ? "" : ` (suggested after ${READING_THRESHOLD})`}.
          </p>
          <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => onAcceptSuggestion(suggestion.depth)}>
            Change to {KNOWLEDGE[suggestion.depth].toLowerCase()}
          </button>
        </div>
      )}

      {advice === null ? (
        <div className="inset stack" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
          {redraft && <p className="t-callout text-caution">Earlier advice was set aside because {CAUSE[redraft]}. Draft it again.</p>}
          <div className="row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={blocked !== null || busy !== null}
              aria-busy={busy?.key === `draft:${client.clientId}`}
              onClick={onDraft}
            >
              {busy?.key === `draft:${client.clientId}` ? "Drafting…" : redraft ? "Draft it again" : "Draft advice"}
            </button>
            <span className="t-footnote muted">{blocked ?? "The institution's rules decide; no model is asked."}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="row spread">
            <div className="row" style={{ "--row-gap": "0.75rem" } as React.CSSProperties}>
              <span className={`verdict text-${VERDICT[advice.verdict].tone}`}>{VERDICT[advice.verdict].label}</span>
              <span className="t-caption faint">
                by the rules ({advice.rules_version}) · event {advice.draftedAtSeq}
              </span>
            </div>
            {advice.decision ? (
              <span className={`badge badge--strong ${advice.decision.decision === "approved" ? "badge--positive" : "badge--negative"}`}>
                <span className="dot" />
                {advice.decision.decision === "approved" ? "Approved" : "Rejected"} by {advice.decision.actor}
                {advice.decision.reason ? ` · ${REJECTION[advice.decision.reason]}` : ""}
                {advice.decision.confirmations.includes("explained_directly") ? " · explained directly" : ""}
              </span>
            ) : (
              <span className="badge badge--strong badge--caution">
                <span className="dot" />
                Waiting for the adviser
              </span>
            )}
          </div>

          <ol className="list-plain" aria-label="Why">
            {advice.reasons.map((reason, i) => {
              const rule = ruleById(reason.rule);
              return (
                <li key={i} className="reason stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
                  <div className="row" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
                    <span className={`badge badge--strong badge--${EFFECT[reason.effect].tone}`}>
                      <span className="dot" />
                      {EFFECT[reason.effect].label}
                    </span>
                    <span className="t-callout strong">{rule.title}</span>
                    <span className="t-caption faint">{reason.rule}</span>
                  </div>
                  <p className="t-footnote muted">Client: {answerText(profile, reason.profile_field)}</p>
                  {reason.citation ? (
                    <Quote citation={reason.citation} onOpen={() => onCite(reason.citation!, rule.title)} />
                  ) : (
                    <p className="t-footnote muted">Nothing in the pack speaks to this.</p>
                  )}
                </li>
              );
            })}
          </ol>

          {advice.disclosures.length > 0 && (
            <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
              <p className="t-eyebrow">The client must also be told</p>
              {advice.disclosures.map((d) => (
                <Quote key={d.finding_id} citation={d.citation} onOpen={() => onCite(d.citation, "Disclosure")} />
              ))}
            </div>
          )}

          {advice.alternatives !== undefined && (
            <div className="inset stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
              <p className="t-eyebrow">Elsewhere on the shelf</p>
              {advice.alternatives.length === 0 ? (
                <p className="t-callout">Nothing else on the shelf fits this client.</p>
              ) : (
                advice.alternatives.map((alt) => (
                  <p key={alt.case_id} className="t-callout">
                    <span className="text-positive strong">Suitable:</span> {alt.product_name} — meets{" "}
                    {alt.reasons.map((r) => ruleById(r.rule).title.toLowerCase()).join(", ")}.{" "}
                    <Link href={`/cases/${alt.case_id}/advice`}>Open that product →</Link>
                  </p>
                ))
              )}
            </div>
          )}

          <hr className="hairline" style={{ margin: 0 }} />

          <div className="row spread">
            <div className="row">
              {explanation ? (
                <span className="t-footnote muted">
                  <span className="text-positive strong">Explained</span> at three depths — the client sees &ldquo;
                  {explanation.depths[profile.knowledge].summary}&rdquo;
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy !== null}
                  aria-busy={busy?.key === `explain:${advice.adviceId}`}
                  onClick={() => onExplain(advice.adviceId)}
                >
                  {busy?.key === `explain:${advice.adviceId}` ? "Writing…" : "Write the explanation"}
                </button>
              )}
            </div>
            <div className="row" role="group" aria-label="The adviser's decision">
              <button
                type="button"
                className="btn btn--small btn--positive"
                aria-pressed={advice.decision?.decision === "approved"}
                disabled={busy !== null || (vulnerable.length > 0 && !explained)}
                title={vulnerable.length > 0 && !explained ? "Confirm you have explained it to the client first" : undefined}
                onClick={() => onDecide(advice.adviceId, "approved", vulnerable.length > 0 ? { confirmations: ["explained_directly"] } : {})}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn--small btn--negative"
                aria-pressed={advice.decision?.decision === "rejected" || rejecting}
                aria-expanded={rejecting}
                disabled={busy !== null}
                onClick={() => setRejecting((r) => !r)}
              >
                Reject…
              </button>
              {advice.decision?.decision === "approved" && (
                <Link className="btn btn--small btn--plain" href={`/clients/${caseId}/${client.clientId}`}>
                  Client&apos;s view →
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {advice !== null && rejecting && (
        <div className="inset stack materialize" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
          <p className="t-footnote strong">Why is this draft rejected? The reason goes on the record.</p>
          <div className="choices" role="group" aria-label="Reason for rejecting">
            {Reasons.options.map((reason) => (
              <button
                key={reason}
                type="button"
                className="chip"
                disabled={busy !== null}
                onClick={() => {
                  setRejecting(false);
                  onDecide(advice.adviceId, "rejected", { reason });
                }}
              >
                {REJECTION[reason]}
              </button>
            ))}
          </div>
        </div>
      )}

      {row.earlier > 0 && (
        <p className="t-caption faint">
          {row.earlier} earlier draft{row.earlier === 1 ? "" : "s"} set aside, still in the record.
        </p>
      )}
    </li>
  );
}

// A cited passage, verbatim, with a chip that opens the document on its page.
function Quote({ citation, onOpen }: { citation: Citation; onOpen: () => void }) {
  return (
    <figure className="quote quote--cited" style={{ marginTop: "0.25rem" }}>
      <blockquote className="t-callout">{citation.quote}</blockquote>
      <figcaption>
        <button type="button" className="chip chip--link" onClick={onOpen}>
          {citation.document_id} · page {citation.page}
        </button>
      </figcaption>
    </figure>
  );
}

// The link a client uses to check this product for themselves. Copied, not typed; the page it opens asks
// for no name and creates no account.
function ClientLink({ caseId }: { caseId: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/start/${caseId}`;
  return (
    <div className="inset row spread">
      <div className="stack" style={{ "--stack-gap": "0.125rem" } as React.CSSProperties}>
        <p className="t-footnote strong">Clients can check this product themselves</p>
        <p className="t-caption muted">
          They answer the questions; the rules draft their advice at once; it waits here for you. <Link href={path}>Open the client link →</Link>
        </p>
      </div>
      <button
        type="button"
        className="btn btn--small"
        onClick={() =>
          void navigator.clipboard.writeText(new URL(path, window.location.origin).toString()).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
        }
      >
        {copied ? "Copied ✓" : "Copy client link"}
      </button>
    </div>
  );
}
