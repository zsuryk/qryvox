import Link from "next/link";
import { fetchClientQueue, fetchEvents } from "../../lib/api";
import { productName } from "../../lib/case";
import { VERDICT } from "../../lib/advice";

// The adviser's way in (#71): the clients whose advice awaits a decision, oldest first, each opening the
// whole list to decide; those already decided sit below.
export default async function AdviseQueuePage() {
  const clients = await fetchClientQueue();
  const rows = await Promise.all(
    clients.map(async (client) => ({
      ...client,
      cases: await Promise.all(
        client.cases.map(async (c) => ({ ...c, product: productName(await fetchEvents(c.case_id).catch(() => [])) ?? c.case_id })),
      ),
    })),
  );
  const waiting = rows.filter((r) => r.cases.some((c) => c.decision === null));
  const decided = rows.filter((r) => r.cases.every((c) => c.decision !== null));

  const row = (r: (typeof rows)[number]) => (
    <li key={r.client_id} className="card stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
      <div className="row spread">
        <h2 className="t-headline">{r.client_id}</h2>
        {r.vulnerable && <span className="badge">Vulnerable client</span>}
      </div>
      <ul className="list-plain stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
        {r.cases.map((c) => (
          <li key={c.case_id} className="t-body">
            {c.product}: {VERDICT[c.verdict].label}
            {c.decision === null ? " · awaiting decision" : ` · ${c.decision}`}
          </li>
        ))}
      </ul>
      <div>
        <Link className="btn btn--small" href={`/advise/${encodeURIComponent(r.client_id)}`}>
          Decide the whole list
        </Link>
      </div>
    </li>
  );

  return (
    <main className="page page--narrow">
      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "1.5rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Adviser</p>
        <h1 className="t-large">Advice awaiting a decision</h1>
      </div>
      {waiting.length === 0 ? (
        <div className="card">
          <p className="t-body">Nothing is waiting for you. A client's advice appears here once they answer.</p>
        </div>
      ) : (
        <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
          {waiting.map(row)}
        </ol>
      )}
      {decided.length > 0 && (
        <section className="stack" style={{ "--stack-gap": "0.75rem", marginTop: "2rem" } as React.CSSProperties}>
          <h2 className="t-title">Decided</h2>
          <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
            {decided.map(row)}
          </ol>
        </section>
      )}
    </main>
  );
}
