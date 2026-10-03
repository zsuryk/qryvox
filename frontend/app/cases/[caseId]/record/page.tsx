import { fold } from "@qryvox/shared";
import { fetchEvents, fetchVerify } from "../../../../lib/api";

// Record: what the case was given and everything that happened to it, in order. The chain's latest hash
// anchors the lot: any edit to any event above it would change it (ADR-0002).
export default async function RecordPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const [events, verify] = await Promise.all([fetchEvents(caseId), fetchVerify(caseId)]);
  const state = fold(events);

  return (
    <>
      <section className="section" aria-labelledby="chain-heading">
        <div className="section-head">
          <h2 id="chain-heading" className="t-title">
            Chain
          </h2>
        </div>
        <div className="card stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
          <p className="t-callout">
            {verify.intact
              ? `All ${verify.event_count} events re-hash to the chain the server stored.`
              : `The chain breaks at event ${verify.broken_at_seq}: an event was changed or removed.`}
          </p>
          <p className="t-footnote muted wrap-anywhere">
            Latest hash <code>{verify.latest_hash ?? "—"}</code>
          </p>
          <p className="t-caption faint">Tamper-evident, not tamper-proof: the hash shows a change, it cannot prevent one.</p>
        </div>
      </section>

      <section className="section" aria-labelledby="documents-heading">
        <div className="section-head">
          <h2 id="documents-heading" className="t-title">
            Documents
          </h2>
          <span className="t-footnote muted">{state.documents.length} in the pack, latest version of each</span>
        </div>
        {state.documents.length === 0 ? (
          <p className="t-callout muted">No documents ingested.</p>
        ) : (
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Kind</th>
                  <th className="num">Pages</th>
                  <th>SHA-256</th>
                  <th className="num">Event</th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((d) => (
                  <tr key={d.ingestedAtSeq}>
                    <td className="wrap-anywhere">{d.filename}</td>
                    <td>{d.kind}</td>
                    <td className="num">{d.pageCount}</td>
                    <td>
                      <code>{d.sha256.slice(0, 12)}…</code>
                    </td>
                    <td className="num">{d.ingestedAtSeq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="log-heading">
        <div className="section-head">
          <h2 id="log-heading" className="t-title">
            Event log
          </h2>
          <span className="t-footnote muted">{events.length} events, in the order they happened</span>
        </div>
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="num">Seq</th>
                <th>Type</th>
                <th>Actor</th>
                <th>At</th>
                <th>Payload (slim)</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td>
                    <code>{e.type}</code>
                  </td>
                  <td>{e.actor}</td>
                  <td className="faint">{e.at}</td>
                  <td>
                    <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
