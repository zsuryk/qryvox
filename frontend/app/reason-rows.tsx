import { type Citation, decidingReasons, groupReasons, type Reason } from "@qryvox/shared";
import { EFFECT } from "../lib/advice";
import { type Lang, WORDS } from "../lib/i18n";

// The reasons that decided a verdict, as a client reads them (#68, #71): one row per rule and outcome, so
// Mrs Chan's three S4 blocks are one thing to read with three passages behind it, each opening the document.
// "Meets every rule" when nothing decided it. `limit` shows the first rows only, for the list.

export type Cited = { citation: Citation; label: string; caseId: string | null };

export default function ReasonRows({
  reasons,
  caseId,
  lang,
  onCite,
  limit,
}: {
  reasons: readonly Reason[];
  caseId: string | null;
  lang: Lang;
  onCite: (cited: Cited) => void;
  limit?: number;
}) {
  const w = WORDS[lang];
  const groups = groupReasons(decidingReasons(reasons));
  if (groups.length === 0) return <p className="t-footnote muted">{w.shelf.meetsAll}</p>;
  const shown = limit === undefined ? groups : groups.slice(0, limit);
  return (
    <>
      <ul className="list-plain stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
        {shown.map((group) => (
          <li key={`${group.rule}:${group.effect}`} className="stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
            <div className="row" style={{ "--row-gap": "0.5rem" } as React.CSSProperties}>
              <span className={`badge badge--strong badge--${EFFECT[group.effect].tone}`}>
                <span className="dot" />
                {w.effect[group.effect]}
              </span>
              <span className="t-callout">{w.rule[group.rule]}</span>
            </div>
            {group.citations.length > 0 ? (
              <div className="row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
                {group.citations.map((citation, i) => (
                  <button key={i} type="button" className="chip chip--link" onClick={() => onCite({ citation, label: w.rule[group.rule], caseId })}>
                    {w.advice.source(citation.document_id, citation.page)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="t-footnote muted">{w.advice.noSource}</p>
            )}
          </li>
        ))}
      </ul>
      {shown.length < groups.length && <p className="t-footnote muted">{w.list.moreReasons(groups.length - shown.length)}</p>}
    </>
  );
}
