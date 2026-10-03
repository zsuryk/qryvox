"use client";

import Link from "next/link";
import { useState } from "react";
import { type AdviceDecision, type Citation, type ClientProfile, ruleById, type SlimEvent } from "@qryvox/shared";
import {
  type AdviceView,
  adviceView,
  answerText,
  blankProfile,
  CAUSE,
  type ClientRow,
  EFFECT,
  factLines,
  newClientId,
  profileSummary,
  VERDICT,
} from "../lib/advice";
import { decideAdvice, draftAdvice, fetchEvents, recordProfile, runStep } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { evidenceDocument } from "../lib/evidence";
import { EvidencePane } from "./evidence";
import Questionnaire from "./questionnaire";
import { Sheet } from "./ui";

// The Advice section: the product as read, and each client with the advice the rules drafted for them,
// waiting for the adviser (#32, #33). The adviser decides; nothing here approves anything by itself, and
// every action is an event appended to the case's log and read back from it before it is shown.

type Busy = { key: string; label: string } | null;

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

        {view.clients.length === 0 ? (
          <div className="card card--quiet stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
            <p className="t-headline">No clients yet</p>
            <p className="t-callout muted">Add a client to record their answers. Advice is drafted from them by the institution&apos;s rules.</p>
          </div>
        ) : (
          <ul className="list-plain stack" style={{ "--stack-gap": "1rem" } as React.CSSProperties}>
            {view.clients.map((row) => (
              <ClientCard
                key={row.client.clientId}
                caseId={caseId}
                row={row}
                blocked={view.blocked}
                busy={busy}
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
                onDecide={(adviceId, decision) =>
                  void act(
                    `decide:${adviceId}`,
                    decision === "approved" ? "Approving" : "Rejecting",
                    decision === "approved" ? "Approved. The client can now see this advice." : "Rejected. The client will not see it.",
                    () => decideAdvice(caseId, adviceId, crypto.randomUUID(), decision),
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
  onEdit: () => void;
  onCite: (citation: Citation, label: string) => void;
  onDraft: () => void;
  onExplain: (adviceId: string) => void;
  onDecide: (adviceId: string, decision: AdviceDecision) => void;
}) {
  const { client, advice, redraft, explanation } = row;
  const profile = client.profile;

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
              {(["approved", "rejected"] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className={`btn btn--small ${decision === "approved" ? "btn--positive" : "btn--negative"}`}
                  aria-pressed={advice.decision?.decision === decision}
                  disabled={busy !== null}
                  onClick={() => onDecide(advice.adviceId, decision)}
                >
                  {decision === "approved" ? "Approve" : "Reject"}
                </button>
              ))}
              {advice.decision?.decision === "approved" && (
                <Link className="btn btn--small btn--plain" href={`/clients/${caseId}/${client.clientId}`}>
                  Client&apos;s view →
                </Link>
              )}
            </div>
          </div>
        </>
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

// The source document in a sheet over the dimmed page: the same pane the board opens beside a finding.
function CitationSheet({ events, citation, label, onClose }: { events: readonly SlimEvent[]; citation: Citation; label: string; onClose: () => void }) {
  const source = evidenceDocument(events, citation.document_id);
  return (
    <Sheet title={label} onClose={onClose}>
      {source === null ? (
        <p className="t-callout">This case&apos;s log names no document {citation.document_id}. The passage is quoted in full on the card.</p>
      ) : (
        <EvidencePane
          document={source}
          citation={{ documentId: citation.document_id, documentName: source.filename, page: citation.page, quote: citation.quote }}
        />
      )}
    </Sheet>
  );
}
