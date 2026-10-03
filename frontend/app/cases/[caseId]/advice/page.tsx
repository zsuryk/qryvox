import { fetchEvents } from "../../../../lib/api";
import AdviceSection from "../../../advice-view";
import { refetchCase } from "../actions";

// Advice: the product as read, the clients, and the adviser's decision on what the rules drafted for each.
export default async function AdvicePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const events = await fetchEvents(caseId);
  return <AdviceSection caseId={caseId} events={events} refetch={refetchCase} />;
}
