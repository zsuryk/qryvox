"use client";

import Link from "next/link";
import { useState } from "react";
import { type ClientProfile, vulnerability } from "@qryvox/shared";
import { type ClientList as List, suiting } from "../lib/client-list";
import { type Lang, WORDS } from "../lib/i18n";
import CitationSheet from "./citation-sheet";
import { Waiting, YourAnswers } from "./client-advice";
import LanguageSwitch from "./language-switch";
import ReasonRows, { type Cited } from "./reason-rows";

// "Your products" (#71): the client answered once, and sees every verified product with whether it suits
// them, suitable first, each with the one or two reasons that decided it and where they come from. The list
// is the institution's rules applied alike to every product; "recommended" appears only on the product the
// adviser picked, because a recommendation is the adviser's act (ADR-0008). Opening a product reads its full
// explanation, written then. Nothing is shown as advice until the adviser has approved the list.

export default function ClientList({ clientId, list }: { clientId: string; list: List }) {
  const [lang, setLang] = useState<Lang>(list.profile?.language ?? "en");
  const [onlySuiting, setOnlySuiting] = useState(false);
  const [citing, setCiting] = useState<(Cited & { productCase: string }) | null>(null);
  const w = WORDS[lang];
  const pageLang = lang === "en" ? "en" : "zh-Hant-HK";

  const header = (
    <div className="stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
      <div className="row spread">
        <p className="t-eyebrow">{w.list.eyebrow}</p>
        <LanguageSwitch lang={lang} onChange={setLang} />
      </div>
      <h1 className="t-large">{w.list.title}</h1>
    </div>
  );

  if (list.status !== "approved") {
    const profile: ClientProfile | null = list.profile;
    return (
      <main className="page page--narrow" lang={pageLang}>
        {header}
        <div className="card stack" style={{ "--stack-gap": "0.5rem", marginTop: "2rem" } as React.CSSProperties}>
          <p className="t-body">{list.status === "reviewing" ? w.list.waiting : w.advice[list.status]}</p>
          {list.status === "reviewing" && profile && vulnerability(profile).length > 0 && <p className="t-callout">{w.advice.vulnerable}</p>}
          {list.status === "reviewing" && <Waiting text={w.advice.waiting} />}
        </div>
        {profile && <YourAnswers profile={profile} lang={lang} open />}
      </main>
    );
  }

  const shown = onlySuiting ? suiting(list.products) : list.products;
  return (
    <main className="page page--narrow" lang={pageLang}>
      {header}
      <p className="t-body muted measure" style={{ marginTop: "0.75rem" }}>
        {w.list.lead(list.products.length)}
      </p>

      <div className="row spread" style={{ margin: "1.5rem 0 1rem" }}>
        <label className="switch">
          <input type="checkbox" checked={onlySuiting} onChange={(e) => setOnlySuiting(e.target.checked)} />
          <span className="t-callout">{w.list.filter}</span>
        </label>
        <p className="t-footnote muted" aria-live="polite">
          {w.list.count(shown.length, list.products.length)}
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <p className="t-body">{w.list.nothingSuits}</p>
        </div>
      ) : (
        <ol className="list-plain stack" style={{ "--stack-gap": "0.75rem" } as React.CSSProperties}>
          {shown.map((p) => (
            <li key={p.caseId} className="card stack" style={{ "--stack-gap": "0.625rem" } as React.CSSProperties}>
              <div className="row spread">
                <h2 className="t-headline">{p.product}</h2>
                {p.pick && (
                  <span className="badge badge--strong badge--positive">
                    <span className="dot" />
                    {w.list.recommended}
                  </span>
                )}
              </div>
              <p className="t-body">{w.shelf.verdict(p.product)[p.advice.verdict]}</p>
              {p.pick && <p className="t-footnote muted">{w.list.pickNote}</p>}
              <ReasonRows
                reasons={p.advice.reasons}
                caseId={p.caseId}
                lang={lang}
                limit={2}
                onCite={(cited) => setCiting({ ...cited, productCase: p.caseId })}
              />
              <div>
                <Link className="btn btn--small" href={`/list/${clientId}/${p.caseId}`}>
                  {w.list.open}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="t-footnote muted measure" style={{ marginTop: "1.5rem" }}>
        {w.list.note}
      </p>
      <YourAnswers profile={list.profile} lang={lang} />
      <footer className="t-footnote faint" style={{ marginTop: "2rem" }}>
        <p>{w.advice.fabricated}</p>
      </footer>

      {citing && (
        <CitationSheet
          events={list.products.find((p) => p.caseId === citing.productCase)?.events ?? []}
          citation={citing.citation}
          label={citing.label}
          onClose={() => setCiting(null)}
        />
      )}
    </main>
  );
}
