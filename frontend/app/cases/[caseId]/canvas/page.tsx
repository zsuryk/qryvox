import { loadCanvasEvents } from "../../../../lib/canvas-source";
import CanvasView from "../../../canvas-view";

// Canvas: the case's findings and the passages they cite as cards on an open board, beside the Review
// list rather than instead of it (#48, v1 augments). Read through the canvas's one data seam, live.
export default async function CanvasSection({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const mode = { kind: "live", caseId } as const;
  const events = await loadCanvasEvents(mode);
  return <CanvasView events={events} mode={mode} />;
}
