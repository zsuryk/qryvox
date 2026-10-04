"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type CaseAdvice,
  type ClientProfile,
  decidingReasons,
  groupReasons,
  type RejectionReason,
  RejectionReason as Reasons,
  ruleById,
  VERDICT_ORDER,
  vulnerability,
} from "@qryvox/shared";
import { EFFECT, profileSummary, REJECTION, VERDICT } from "../lib/advice";
import { decideClientList } from "../lib/api";
import { errorMessage } from "../lib/errors";

// The adviser decides a client's whole list in one decision (#71, ADR-0008): approve every product's advice
// together, or reject them with one reason, and mark at most one suitable product as the adviser's pick —
// the only thing the client's page will call recommended. The decision still lands on each product's own
// log. A vulnerable client's list needs the direct-explanation confirmation once (ADR-0005).

type Entry = { caseId: string; product: string; advice: CaseAdvice };

export default function ListReview({ clientId, profile, entries }: { clientId: string; profile: ClientProfile | null; entries: Entry[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<string | null>(null);
  const [explained, setExplained] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const vulnerable = profile ? vulnerability(profile) : [];
  const ordered = [...entries].sort((a, b) => VERDICT_ORDER[a.advice.verdict] - VERDICT_ORDER[b.advice.verdict] || a.product.localeCompare(b.product));
  const decided = entries.length > 0 && entries.every((e) => e.advice.decision !== null);
  const picked = entries.find((e) => e.advice.decision?.adviserPick);

  async function decide(decision: "approved" | "rejected", reason?: RejectionReason) {
    setBusy(true);
    setSaid(null);
    try {
      await decideClientList(clientId, crypto.randomUUID(), decision, {
        ...(reason ? { reason } : {}),
        ...(decision === "approved" && vulnerable.length > 0 ? { confirmations: ["explained_directly" as const] } : {}),
        ...(decision === "approved" && pick ? { pick_case_id: pick } : {}),
      });
      setSaid({ ok: true, text: decision === "approved" ? "The list is approved. The client can now see it." : "The list is rejected. The client will not see it." });
      router.refresh();
    } catch (cause) {
      setSaid({ ok: false, text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--narrow">
      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "1.5rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Client&apos;s list</p>
        <h1 className="t-large">
          <code>{clientId}</code>
        </h1>
        {profile && (
          <div className="row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
            {profileSummary(profile).map((fact) => (
              <span key={fact} className="badge">
                {fact}
              </span>
            ))}
          </div>
        )}
        <p className="t-body muted measure">
          One decision covers every product below. The client sees &ldquo;suits you&rdquo; or &ldquo;does not suit you&rdquo; for each, from the rules, and
          &ldquo;recommended&rdquo; only on the product you mark as your pick.
        </p>
      </div>

      {vulnerable.length > 0 && (
        <div className="notice notice--caution stack" style={{ "--stack-gap": "0.375rem", marginBottom: "1rem" } as React.CSSProperties}>
          <p className="t-footnote strong" style={{ color: "var(--label)" }}>
            This client needs extra care: {vulnerable.join("; ")}.
          </p>
          {!decided && (
            <label className="switch">
              <input type="checkbox" checked={explained} onChange={(e) => setExplained(e.target.checked)} />
              <span className="t-footnote" style={{ color: "var(--label)" }}>
                I have explained this advice to the client directly. Approving records this confirmation.
              </span>
            </label>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="card">
          <p className="t-body">This client has no advice in play. Their answers may have changed since.</p>
        </div>
      ) : (
        <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
          {ordered.map(({ caseId, product, advice }) => {
            const groups = groupReasons(decidingReasons(advice.reasons));
            const can = advice.verdict === "suitable" && !decided;
            return (
              <li key={caseId} className="card stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
                <div className="row spread">
                  <p className="t-headline">{product}</p>
                  <span className={`verdict text-${VERDICT[advice.verdict].tone}`}>{VERDICT[advice.verdict].label}</span>
                </div>
                <p className="t-footnote muted">
                  {groups.length === 0
                    ? "Meets every rule."
                    : groups.map((g) => `${ruleById(g.rule).title} (${EFFECT[g.effect].label.toLowerCase()}${g.reasons.length > 1 ? ` ×${g.reasons.length}` : ""})`).join(" · ")}
                </p>
                <div className="row spread">
                  <Link className="t-callout" href={`/cases/${caseId}/advice`}>
                    Open that product →
                  </Link>
                  {can && (
                    <label className="switch">
                      <input type="radio" name="pick" checked={pick === caseId} onChange={() => setPick(caseId)} onClick={() => pick === caseId && setPick(null)} />
                      <span className="t-footnote">Adviser&apos;s pick</span>
                    </label>
                  )}
                  {advice.decision && (
                    <span className={`badge badge--strong ${advice.decision.decision === "approved" ? "badge--positive" : "badge--negative"}`}>
                      <span className="dot" />
                      {advice.decision.decision === "approved" ? "Approved" : `Rejected${advice.decision.reason ? ` · ${REJECTION[advice.decision.reason]}` : ""}`}
                      {advice.decision.adviserPick ? " · adviser's pick" : ""}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {entries.length > 0 && !decided && (
        <div className="stack" style={{ "--stack-gap": "0.75rem", marginTop: "1.5rem" } as React.CSSProperties}>
          <p className="t-footnote muted">
            {pick ? `Your pick: ${entries.find((e) => e.caseId === pick)?.product}.` : "No pick marked: the client sees no recommendation."}
          </p>
          <div className="row" role="group" aria-label="The adviser's decision on the list">
            <button
              type="button"
              className="btn btn--positive"
              disabled={busy || (vulnerable.length > 0 && !explained)}
              title={vulnerable.length > 0 && !explained ? "Confirm you have explained it to the client first" : undefined}
              onClick={() => void decide("approved")}
            >
              Approve the whole list
            </button>
            <button type="button" className="btn btn--negative" aria-expanded={rejecting} disabled={busy} onClick={() => setRejecting((r) => !r)}>
              Reject…
            </button>
          </div>
          {rejecting && (
            <div className="inset stack materialize" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
              <p className="t-footnote strong">Why is this list rejected? The reason goes on the record of every product.</p>
              <div className="choices" role="group" aria-label="Reason for rejecting">
                {Reasons.options.map((reason) => (
                  <button key={reason} type="button" className="chip" disabled={busy} onClick={() => void decide("rejected", reason)}>
                    {REJECTION[reason]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {decided && picked && <p className="t-callout" style={{ marginTop: "1rem" }}>Adviser&apos;s pick: {picked.product}.</p>}
      {decided && (
        <p className="t-footnote muted" style={{ marginTop: "0.75rem" }}>
          <Link href={`/list/${clientId}`}>The client&apos;s list →</Link>
        </p>
      )}

      <p aria-live="polite" role="status" className={`t-footnote ${said?.ok === false ? "text-negative" : "muted"}`} style={{ marginTop: "1rem" }}>
        {busy ? "Saving…" : said?.text}
      </p>
    </main>
  );
}
