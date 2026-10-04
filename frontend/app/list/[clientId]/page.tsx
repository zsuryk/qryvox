import { notFound } from "next/navigation";
import { fetchClientCases, fetchEvents, NotFound } from "../../../lib/api";
import { clientList } from "../../../lib/client-list";
import ClientList from "../../client-list";

// The client's own page for their whole list (#71): the products' own logs, read here, folded into one list.
export default async function ListPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const caseIds = await fetchClientCases(clientId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  const cases = await Promise.all(caseIds.map(async (caseId) => ({ caseId, events: await fetchEvents(caseId) })));
  return <ClientList clientId={clientId} list={clientList(cases, clientId)} />;
}
