import Link from "next/link";
import { canvasMode, loadCanvasEvents } from "../../lib/canvas-source";
import { productName } from "../../lib/case";
import CanvasView from "../canvas-view";

// The canvas with no case: the recorded Larkspur case and a few card operations on it, folded in the
// browser, with no model and no API (canvas-source.ts). It is how the canvas is demonstrated and tested
// outside any case. ?case=<id> is the same canvas on that case, live; a case's own Canvas section is the
// usual way there.
export default async function CanvasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const mode = canvasMode({ get: (name) => (typeof params[name] === "string" ? params[name] : null) });
  const events = await loadCanvasEvents(mode);

  return (
    <main className="page">
      <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
        <p className="t-eyebrow">{mode.kind === "fixture" ? "Canvas · recorded case" : "Canvas · live case"}</p>
        <h1 className="t-large">{mode.kind === "fixture" ? "Larkspur Global Income Fund" : (productName(events) ?? "Product review")}</h1>
        <p className="t-footnote muted">
          {mode.kind === "fixture" ? (
            <>
              {events.length} events · folded in your browser · no model called ·{" "}
              <Link href="/board">the same case as a list →</Link>
            </>
          ) : (
            <>
              {events.length} events · <Link href={`/cases/${mode.caseId}/canvas`}>open the case →</Link>
            </>
          )}
        </p>
      </div>
      <CanvasView events={events} mode={mode} />
    </main>
  );
}
