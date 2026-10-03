import { SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import Board from "../board";

// The board on the recorded case: the whole loop, with no model key and no API running. The log is the
// fixture the fold tests fold, handed to the same component that will fold a live case's events.
const events = SlimEvent.array().parse(recorded);

export default function BoardPage() {
  return (
    <main className="page">
      <div className="stack" style={{ "--stack-gap": "0.5rem", marginBottom: "2rem" } as React.CSSProperties}>
        <p className="t-eyebrow">Recorded case</p>
        <h1 className="t-large">Larkspur Global Income Fund</h1>
        <p className="t-footnote muted">{events.length} events · folded in your browser · no model called</p>
      </div>
      <Board events={events} />
    </main>
  );
}
