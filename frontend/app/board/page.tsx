import { SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import Board from "../board";

// The board on the recorded case: the whole loop, with no model key and no API running. The log is the
// fixture the fold tests fold, handed to the same component that will fold a live case's events.
const events = SlimEvent.array().parse(recorded);

export default function BoardPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100 }}>
      <h1>Larkspur Global Income Fund</h1>
      <p style={{ color: "#5b6270", margin: "0 0 20px" }}>
        A recorded case · {events.length} events · folded in the browser, no model called
      </p>
      <Board events={events} />
    </main>
  );
}
