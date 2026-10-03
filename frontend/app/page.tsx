import Link from "next/link";
import Intake from "./intake";

// Intake is the front of the flow: drop the pack, watch each document fan out, then open the case the run
// happens on. Nothing is analysed until the analyst starts it, and nothing is typed at any point.
export default function Home() {
  return (
    <main className="page page--narrow">
      <div className="stack" style={{ "--stack-gap": "0.75rem", marginBottom: "2rem" } as React.CSSProperties}>
        <p className="t-eyebrow">New review</p>
        <h1 className="t-large">Check a product before it reaches the shelf.</h1>
        <p className="t-body muted measure">
          Drop the product&apos;s documents. Qryvox reads them in your browser, checks every claim against the others and
          against the institution&apos;s rules, and cites the page for everything it finds. Nothing is typed, and every
          step is on the record.
        </p>
        <p className="t-footnote muted">
          Just looking? <Link href="/canvas">Open a case already reviewed →</Link>
        </p>
      </div>
      <Intake />
    </main>
  );
}
