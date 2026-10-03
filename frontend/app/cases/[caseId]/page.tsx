import { fetchEvents } from "../../../lib/api";
import CaseView from "../../case-view";
import { refetchCase } from "./actions";

// Review: the run, the board it fills, and the analyst's decision on each finding. The events are fetched
// here once, and the run takes over from them in the browser (spec decision 19, ADR-0001).
export default async function ReviewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const events = await fetchEvents(caseId);
  return <CaseView events={events} caseId={caseId} refetch={refetchCase} />;
}
