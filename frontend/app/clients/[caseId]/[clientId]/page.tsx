import { notFound } from "next/navigation";
import { fetchEvents, NotFound } from "../../../../lib/api";
import ClientAdvice from "../../../client-advice";

// The client's own page: their advice, and nothing of the analyst's machinery around it.
export default async function ClientPage({ params }: { params: Promise<{ caseId: string; clientId: string }> }) {
  const { caseId, clientId } = await params;
  const events = await fetchEvents(caseId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  return <ClientAdvice events={events} clientId={clientId} />;
}
