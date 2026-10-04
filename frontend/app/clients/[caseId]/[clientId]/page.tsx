import { notFound } from "next/navigation";
import { type SlimEvent, shelfFor } from "@qryvox/shared";
import { fetchEvents, NotFound } from "../../../../lib/api";
import { clientView } from "../../../../lib/client-view";
import ClientAdvice from "../../../client-advice";

// The client's own page: their advice, and nothing of the analyst's machinery around it.
export default async function ClientPage({ params }: { params: Promise<{ caseId: string; clientId: string }> }) {
  const { caseId, clientId } = await params;
  const events = await fetchEvents(caseId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  // The shelf comparison cites other products' documents, which only their own cases' events hold: fetched
  // here, as this case's are, for the products the approved advice compares. A case that cannot be read
  // leaves its citations unopenable; the passage is still quoted on the page.
  const view = clientView(events, clientId);
  const shelfEvents: Record<string, SlimEvent[]> = {};
  if (view.status === "approved") {
    const ids = [...new Set(shelfFor(view.advice).map((e) => e.case_id))];
    await Promise.all(ids.map(async (id) => void (shelfEvents[id] = await fetchEvents(id).catch(() => []))));
  }
  return <ClientAdvice caseId={caseId} events={events} clientId={clientId} shelfEvents={shelfEvents} />;
}
