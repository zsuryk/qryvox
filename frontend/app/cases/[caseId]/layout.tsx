import { fold } from "@qryvox/shared";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { fetchEvents, fetchVerify, NotFound } from "../../../lib/api";
import { productName, when } from "../../../lib/case";
import CaseNav from "./case-nav";

// What every section of a case shares: which product this is, the state of its chain, and the four places
// to go — Review (the run, the board, the decisions), Canvas (the same findings as cards on an open board),
// Advice (clients and the adviser's sign-off) and Record (the documents and the log it all folds from).
export default async function CaseLayout({ children, params }: { children: ReactNode; params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const [events, verify] = await Promise.all([fetchEvents(caseId), fetchVerify(caseId)]).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  const state = fold(events);

  return (
    <main className="page">
      <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Case</p>
        <h1 className="t-large">{productName(events) ?? "Product review"}</h1>
        <div className="row row--baseline" style={{ "--row-gap": "0.375rem 0.75rem" } as React.CSSProperties}>
          <span className="t-footnote muted">
            {state.openedAt ? `Opened ${when(state.openedAt)}` : "Not opened"} ·{" "}
            {state.lastSeq} events
          </span>
          {verify.intact ? (
            <span className="badge badge--positive">
              <span className="dot" />
              Chain intact
            </span>
          ) : (
            <span className="badge badge--negative">
              <span className="dot" />
              Chain broken at event {verify.broken_at_seq}
            </span>
          )}
        </div>
        <div style={{ marginTop: "1rem" }}>
          <CaseNav caseId={caseId} />
        </div>
      </div>
      {children}
    </main>
  );
}
