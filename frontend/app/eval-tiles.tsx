"use client";

import { useEffect, useState } from "react";
import { fold, GroundTruth, PackManifest, PersonaSet, type SlimEvent } from "@qryvox/shared";
import { VERDICT } from "../lib/advice";
import { adviceScore, findingsScore, packOf, ratio } from "../lib/eval";
import { PACKS } from "../lib/pack";

// The eval tiles (#15, #35): the pipeline measured against the pack's own answer key, live. The key is a
// static file read here, in the browser; it is never sent to the backend or a model. Each tile says what
// its number means, so it is a measurement anyone can check rather than a figure to take on trust.

type Keys = { dir: string; truth: GroundTruth; personas: PersonaSet } | "none" | null;

function useAnswerKeys(events: readonly SlimEvent[]): Keys {
  const [keys, setKeys] = useState<Keys>(null);
  const hashes = fold(events)
    .documents.map((d) => d.sha256)
    .join();
  useEffect(() => {
    let live = true;
    void (async () => {
      const manifests = await Promise.all(
        PACKS.map(async (pack) => {
          const res = await fetch(`/pack/${pack.dir}manifest.json`);
          return { dir: pack.dir, manifest: PackManifest.parse(await res.json()) };
        }),
      );
      const dir = packOf(events, manifests);
      if (dir === null) return live && setKeys("none");
      const [truth, personas] = await Promise.all([
        fetch(`/eval/${dir}ground-truth.json`).then(async (r) => GroundTruth.parse(await r.json())),
        fetch(`/eval/${dir}personas.json`).then(async (r) => PersonaSet.parse(await r.json())),
      ]);
      if (live) setKeys({ dir, truth, personas });
    })().catch(() => live && setKeys("none"));
    return () => {
      live = false;
    };
    // The answer key depends on which documents the case holds, and on nothing else in the log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashes]);
  return keys;
}

export function FindingsEval({ events }: { events: readonly SlimEvent[] }) {
  const keys = useAnswerKeys(events);
  if (keys === null) return null;
  return (
    <section className="section" aria-labelledby="eval-heading">
      <div className="section-head">
        <h2 id="eval-heading" className="t-title">
          Measured against the answer key
        </h2>
        <span className="t-footnote muted">Fabricated pack, planted findings · never shown to the model</span>
      </div>
      {keys === "none" ? (
        <p className="card card--quiet t-callout muted">This case&apos;s documents match no pack with an answer key, so there is nothing to measure against.</p>
      ) : (
        <FindingsTiles events={events} truth={keys.truth} />
      )}
    </section>
  );
}

function FindingsTiles({ events, truth }: { events: readonly SlimEvent[]; truth: GroundTruth }) {
  const score = findingsScore(fold(events), truth);
  const recall = ratio(score.found, score.planted);
  const precision = ratio(score.matched, score.onBoard);
  return (
    <div className="stack" style={{ "--stack-gap": "0.875rem" } as React.CSSProperties}>
      <div className="tiles">
        <Tile label="Recall" value={recall.percent} fraction={`${recall.fraction} planted findings found`} definition="Planted findings that a finding on the board matches, out of all planted findings." />
        <Tile label="Precision" value={precision.percent} fraction={`${precision.fraction} findings on the board are planted ones`} definition="Findings on the board that match a planted finding, out of all findings on the board." />
      </div>
      <p className="t-caption faint measure">
        A finding matches a planted one when both are in the same category and one&apos;s quote contains the other&apos;s — the
        finding&apos;s citation or its counterpart. Superseded findings are off the board and count for nothing.
      </p>
      {(score.missed.length > 0 || score.extra.length > 0) && (
        <details>
          <summary>
            {score.missed.length} missed · {score.extra.length} not planted
          </summary>
          <div className="stack" style={{ "--stack-gap": "0.375rem", marginTop: "0.625rem" } as React.CSSProperties}>
            {score.missed.map((m) => (
              <p key={m.id} className="t-footnote">
                <span className="badge badge--caution">Missed</span> {m.summary}
              </p>
            ))}
            {score.extra.map((x) => (
              <p key={x.findingId} className="t-footnote">
                <span className="badge">Not planted</span> {x.claim}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function AdviceEval({ events }: { events: readonly SlimEvent[] }) {
  const keys = useAnswerKeys(events);
  if (keys === null || keys === "none") return null;
  const score = adviceScore(fold(events), keys.personas.personas);
  if (score.assessed === 0) return null;
  const accuracy = ratio(score.matched, score.assessed);
  return (
    <section className="section" aria-labelledby="advice-eval-heading">
      <div className="section-head">
        <h2 id="advice-eval-heading" className="t-title">
          Measured against the personas
        </h2>
        <span className="t-footnote muted">Fabricated clients with expected verdicts · never shown to the model</span>
      </div>
      <div className="tiles">
        <Tile
          label="Advice accuracy"
          value={accuracy.percent}
          fraction={`${accuracy.fraction} personas got the expected verdict`}
          definition="Personas whose advice in play has the verdict the answer key expects, out of personas with advice in play."
        />
        <div className="card stack" style={{ "--stack-gap": "0.375rem" } as React.CSSProperties}>
          {score.rows.map((row) => (
            <p key={row.name} className="t-footnote row spread">
              <span className="strong">{row.name}</span>
              <span>
                {row.got === null ? (
                  <span className="faint">not assessed</span>
                ) : (
                  <span className={row.got === row.expected ? "text-positive" : "text-negative"}>
                    {VERDICT[row.got].label}
                    {row.got === row.expected ? " ✓" : ` · expected ${VERDICT[row.expected].label.toLowerCase()}`}
                  </span>
                )}
              </span>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, fraction, definition }: { label: string; value: string | null; fraction: string; definition: string }) {
  return (
    <div className="card tile">
      <p className="t-eyebrow">{label}</p>
      <p className="tile__value">{value ?? "—"}</p>
      <p className="t-footnote strong">{fraction}</p>
      <p className="t-caption muted">{definition}</p>
    </div>
  );
}
