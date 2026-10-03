"use client";

import { useEffect, useState } from "react";
import { fold, PackManifest, type SlimEvent } from "@qryvox/shared";
import { ingestDocument } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { intake } from "../lib/intake";
import { packSources } from "../lib/pack";
import { browserPdfAssets } from "../lib/pdf";

// A product update (#37), on the case it updates. When the issuer has published a revised pack, the
// revised documents are read here exactly as the first ones were and recorded on this same case: each
// replaces the version it revises, for every step that runs after it. Then the case has to be verified
// again — the panel says so, and one press re-runs it from the start.

export default function ProductUpdate({
  caseId,
  log,
  busy,
  onIngested,
  onVerify,
}: {
  caseId: string;
  log: readonly SlimEvent[];
  busy: boolean;
  onIngested: () => Promise<void>;
  onVerify: () => void;
}) {
  const state = fold(log);
  const [revision, setRevision] = useState<PackManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Offered only on a case holding the original Larkspur pack, and only while some document still is.
  const hashes = state.documents.map((d) => d.sha256).join();
  useEffect(() => {
    let live = true;
    void (async () => {
      const [v1, v2] = await Promise.all(
        ["", "v2/"].map(async (dir) => PackManifest.parse(await (await fetch(`/pack/${dir}manifest.json`)).json())),
      );
      const held = hashes.split(",");
      const original = held.some((h) => v1!.documents.some((d) => d.sha256 === h));
      if (live) setRevision(original ? v2! : null);
    })().catch(() => live && setRevision(null));
    return () => {
      live = false;
    };
  }, [hashes]);

  // The documents changed after the last run started: its findings and facts are about the old ones.
  const lastIngest = Math.max(0, ...state.documents.map((d) => d.ingestedAtSeq));
  const lastRun = Math.max(0, ...state.stepRuns.filter((r) => r.step === "extract").map((r) => r.startedAtSeq));
  const stale = lastRun > 0 && lastIngest > lastRun;

  async function load() {
    setLoading(true);
    setProblem(null);
    try {
      await intake(await packSources("v2/"), {
        assets: browserPdfAssets,
        api: { openCase: async () => caseId, ingest: (id, eventId, document) => ingestDocument(id, eventId, document) },
        ingested: state.documents.map((d) => d.sha256),
        onTile: () => {},
      });
      await onIngested();
    } catch (cause) {
      setProblem(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  if (stale) {
    return (
      <div className="card notice--caution stack materialize" style={{ "--stack-gap": "0.5rem", marginTop: "1.25rem" } as React.CSSProperties}>
        <p className="t-headline" style={{ color: "var(--label)" }}>
          The documents changed after the last run
        </p>
        <p className="t-callout" style={{ color: "var(--label)" }}>
          The board and the product&apos;s facts were read from the earlier versions. Verify the revision: every step runs
          again on the new documents, and the findings it raises replace the old ones, which stay in the record.
        </p>
        <div>
          <button type="button" className="btn btn--primary" disabled={busy} aria-busy={busy} onClick={onVerify}>
            Verify the revision
          </button>
        </div>
      </div>
    );
  }

  if (revision === null || revision.documents.every((d) => state.documents.some((held) => held.sha256 === d.sha256))) return null;
  return (
    <div className="card card--quiet row spread" style={{ marginTop: "1.25rem" }}>
      <div className="stack" style={{ "--stack-gap": "0.25rem" } as React.CSSProperties}>
        <p className="t-callout strong">The issuer has published a revised pack</p>
        <p className="t-footnote muted">
          {revision.product} — {revision.documents.length} documents, fabricated like the first. It replaces the versions on this
          case.
        </p>
        {problem && <p className="t-footnote text-negative">{problem}</p>}
      </div>
      <button type="button" className="btn" disabled={loading || busy} aria-busy={loading} onClick={() => void load()}>
        {loading ? "Reading…" : "Load the revised pack"}
      </button>
    </div>
  );
}
