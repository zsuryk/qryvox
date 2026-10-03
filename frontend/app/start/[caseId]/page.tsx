import { notFound } from "next/navigation";
import { adviceView } from "../../../lib/advice";
import { fetchEvents, NotFound } from "../../../lib/api";
import { productName } from "../../../lib/case";
import ClientStart from "../../client-start";

// Where a client starts on their own: the link an adviser shares for one verified product. They answer
// the questions themselves; the rules draft their advice at once; an adviser confirms it before they see it.
export default async function StartPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const events = await fetchEvents(caseId).catch((err: unknown) => {
    if (err instanceof NotFound) notFound();
    throw err;
  });
  const view = adviceView(events);
  return <ClientStart caseId={caseId} product={productName(events) ?? "this product"} ready={view.blocked === null} />;
}
