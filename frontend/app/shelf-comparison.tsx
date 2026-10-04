import { type Advice, type Reason, type ShelfEntry, shelfFor, type Verdict, VERDICT_ORDER } from "@qryvox/shared";
import { type Lang, WORDS } from "../lib/i18n";
import ReasonRows, { type Cited } from "./reason-rows";

// The shelf comparison on the client's page (#68): this product first, then every other product the
// adviser has verified, suitable before conditional before not suitable. Each shows the verdict as a
// sentence and the reasons that decided it, with where each comes from. The rules' results, never a
// recommendation: the caption says so.

export type { Cited };

// What the page has to say about the shelf: the section's rows, and whether to say nothing else fits.
export function shelfRows(advice: Advice): ShelfEntry[] {
  return [...shelfFor(advice)].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]);
}

export default function ShelfComparison({
  advice,
  product,
  lang,
  onCite,
}: {
  advice: Advice;
  product: string;
  lang: Lang;
  onCite: (cited: Cited) => void;
}) {
  const w = WORDS[lang];
  const others = shelfRows(advice);
  const nothingFits = advice.verdict === "not_suitable" && !others.some((o) => o.verdict === "suitable");

  const row = (key: string, name: string, verdict: Verdict, reasons: readonly Reason[], caseId: string | null, own: boolean) => {
    return (
      <li key={key} className="reason stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
        <div className="stack" style={{ "--stack-gap": "0.125rem" } as React.CSSProperties}>
          <p className="t-callout strong">{name}</p>
          {own && <p className="t-caption faint">{w.shelf.thisProduct}</p>}
        </div>
        <p className="t-body">{w.shelf.verdict(name)[verdict]}</p>
        <ReasonRows reasons={reasons} caseId={caseId} lang={lang} onCite={onCite} />
        {!own && verdict === "suitable" && <p className="t-footnote muted">{w.shelf.askAdviser}</p>}
      </li>
    );
  };

  return (
    <section aria-labelledby="shelf" className="card stack" style={{ "--stack-gap": "0.75rem", marginTop: "1.5rem" } as React.CSSProperties}>
      <div className="stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
        <h2 id="shelf" className="t-title">
          {w.shelf.title}
        </h2>
        <p className="t-footnote muted">{w.shelf.caption}</p>
      </div>
      <ol className="list-plain">
        {row("own", product, advice.verdict, advice.reasons, null, true)}
        {others.map((entry) => row(entry.case_id, entry.product_name, entry.verdict, entry.reasons, entry.case_id, false))}
      </ol>
      {nothingFits && <p className="t-callout muted">{w.advice.noneFit}</p>}
    </section>
  );
}
