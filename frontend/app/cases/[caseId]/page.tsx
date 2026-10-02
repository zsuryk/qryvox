import { fold } from "@qryvox/shared";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { fetchEvents, fetchVerify, NotFound } from "../../../lib/api";
import CaseView from "../../case-view";

// Re-reads one case on the server. A server action because the page is a server component and the case
// view is not: what the shell needs is for the server's own copy of the case — its event count, its chain
// verdict — to be current again once a run has appended to the log.
async function refetchCase(caseId: string) {
  "use server";
  revalidatePath(`/cases/${caseId}`);
}

// One case: the run and the board it fills, then what the pack was and the log it all came from. The
// events are fetched and folded here once, and the run below takes over from them in the browser
// (spec decision 19, ADR-0001).
export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const [events, verify] = await Promise.all([fetchEvents(caseId), fetchVerify(caseId)]).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  const state = fold(events);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100 }}>
      <h1>Case {state.caseId}</h1>
      <p>Opened {state.openedAt} · {state.lastSeq} events</p>

      <p>
        Chain: <strong>{verify.intact ? "intact" : `broken at seq ${verify.broken_at_seq}`}</strong>
        {" · latest hash "}
        <code>{verify.latest_hash}</code>
      </p>

      <CaseView events={events} caseId={caseId} refetch={refetchCase.bind(null, caseId)} />

      <h2>Documents</h2>
      {state.documents.length === 0 ? (
        <p>No documents ingested.</p>
      ) : (
        <table cellPadding={6}>
          <thead>
            <tr>
              <th align="left">Document</th>
              <th align="left">Kind</th>
              <th align="right">Pages</th>
              <th align="left">SHA-256</th>
              <th align="right">Seq</th>
            </tr>
          </thead>
          <tbody>
            {state.documents.map((d) => (
              <tr key={d.ingestedAtSeq}>
                <td>{d.filename}</td>
                <td>{d.kind}</td>
                <td align="right">{d.pageCount}</td>
                <td>
                  <code>{d.sha256.slice(0, 12)}…</code>
                </td>
                <td align="right">{d.ingestedAtSeq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Event log</h2>
      <table cellPadding={6}>
        <thead>
          <tr>
            <th align="right">Seq</th>
            <th align="left">Type</th>
            <th align="left">Actor</th>
            <th align="left">At</th>
            <th align="left">Payload (slim)</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq} style={{ verticalAlign: "top" }}>
              <td align="right">{e.seq}</td>
              <td>
                <code>{e.type}</code>
              </td>
              <td>{e.actor}</td>
              <td>{e.at}</td>
              <td>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(e.payload, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
