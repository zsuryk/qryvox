import { notFound } from "next/navigation";
import { fetchClientCases, fetchEvents, NotFound } from "../../../lib/api";
import { listEntries } from "../../../lib/client-list";
import ListReview from "../../list-review";

// The adviser's side of a client's list (#71): the whole list in front of them, one decision, one pick.
export default async function AdvisePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const caseIds = await fetchClientCases(clientId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  const cases = await Promise.all(caseIds.map(async (caseId) => ({ caseId, events: await fetchEvents(caseId) })));
  const { found, profile } = listEntries(cases, clientId);
  const entries = found.map(({ caseId, product, advice }) => ({ caseId, product, advice }));
  return <ListReview clientId={clientId} profile={profile} entries={entries} />;
}
