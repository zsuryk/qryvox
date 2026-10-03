import { loadCanvasEvents } from "../../../../lib/canvas-source";
import CanvasView from "../../../canvas-view";

// Canvas: the case's findings and the passages they cite as cards on an open board, and where a case opens
// (#59): the analyst docks, pins and discards cards here, and approves or dismisses findings. Review, at the
// case's own address, stays the list view and the place the steps are run. Read through the canvas's one
// data seam, live.
export default async function CanvasSection({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const mode = { kind: "live", caseId } as const;
  const events = await loadCanvasEvents(mode);
  return <CanvasView events={events} mode={mode} />;
}
