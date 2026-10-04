import { notFound } from "next/navigation";
import { fetchEvents, NotFound } from "../../../../lib/api";
import ClientAdvice from "../../../client-advice";

// One product opened from the client's list (#71): the same page as the single-product link, with the way
// back to the list, and its explanation written now if it has not been (the client-side effect does it).
export default async function OpenedProductPage({ params }: { params: Promise<{ clientId: string; caseId: string }> }) {
  const { clientId, caseId } = await params;
  const events = await fetchEvents(caseId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  return <ClientAdvice caseId={caseId} events={events} clientId={clientId} fromList />;
}
