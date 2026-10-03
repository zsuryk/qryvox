"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Sha256 } from "@qryvox/shared";
import { ingestDocument, openCase } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { type DocumentTile, intake, type IntakeFile } from "../lib/intake";
import { browserPdfAssets } from "../lib/pdf";
import { PACKS, packSources } from "../lib/pack";
import { PIPELINE_STEPS, STEP_LABELS } from "../lib/pipeline";

// The one place a document enters the system. Nothing here asks for a file dialog and nothing waits to
// be told to go: a drop, or the fabricated pack behind the button, are the whole of intake. Both land
// on the same call in lib/intake.ts, so a demo and a hand-dropped pack take the same road.

// One tone per outcome, and the word beside it: a tile that failed must not rely on colour alone.
const STATUS: Record<DocumentTile["status"], { label: string; tone: string }> = {
  extracting: { label: "Reading", tone: "" },
  sending: { label: "Recording", tone: "badge--tint" },
  ingested: { label: "Ingested", tone: "badge--positive" },
  skipped: { label: "Skipped", tone: "badge--caution" },
  failed: { label: "Failed", tone: "badge--negative" },
};

export default function Intake() {
  const [tiles, setTiles] = useState<readonly DocumentTile[]>([]);
  const [ingested, setIngested] = useState<readonly Sha256[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Drag events fire again for every element the cursor crosses, so the zone counts its own depth
  // rather than trusting a single leave.
  const [depth, setDepth] = useState(0);
  // The browser names the event that opens the case (ADR-0002). Held across retries so a second
  // attempt lands on the case the first one opened rather than opening another. Never cleared: this
  // screen is one case, and a second drop joins it rather than quietly starting a fresh one.
  const opening = useRef<string | null>(null);

  async function run(files: readonly IntakeFile[]) {
    setBusy(true);
    setNotice(null);
    try {
      const accepted = await intake(files, {
        assets: browserPdfAssets,
        api: {
          openCase: async () => {
            const { case_id } = await openCase((opening.current ??= crypto.randomUUID()));
            setCaseId(case_id);
            return case_id;
          },
          ingest: (id, eventId, document) => ingestDocument(id, eventId, document),
        },
        ingested,
        // A tile is identified by its filename, so a second drop of the same pack updates the tiles
        // already on screen where they stand rather than stacking a second copy of the pack.
        onTile: (tile) =>
          setTiles((current) =>
            current.some((other) => other.key === tile.key)
              ? current.map((other) => (other.key === tile.key ? tile : other))
              : [...current, tile],
          ),
      });
      setIngested((current) => [...current, ...accepted.map((document) => document.sha256)]);
    } finally {
      setBusy(false);
    }
  }

  const report = (cause: unknown) => setNotice(errorMessage(cause));

  // A dropped File names only itself. Its bytes are read here, in the browser; the server is told what
  // was in them and is never handed the file.
  const fromDrop = (list: FileList) =>
    run([...list].map((file) => ({ filename: file.name, read: () => file.arrayBuffer().then(toBytes) })));

  // A fabricated pack, through the same road: same read, same parse, same append. Larkspur and the
  // second product, Wrenfield, each open a case of their own; the revised Larkspur is loaded onto the
  // Larkspur case it revises, from that case's page.
  const fromPack = async (dir: string) => {
    await run(await packSources(dir));
  };

  // Another review, from a clean screen: a new case for whatever is dropped or loaded next.
  const reset = () => {
    opening.current = null;
    setTiles([]);
    setIngested([]);
    setCaseId(null);
    setNotice(null);
  };

  return (
    <>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDepth((now) => now + 1);
        }}
        onDragLeave={() => setDepth((now) => Math.max(0, now - 1))}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDepth(0);
          void fromDrop(event.dataTransfer.files).catch(report);
        }}
        className={`dropzone${depth > 0 ? " dropzone--over" : ""}`}
      >
        <p className="t-headline">{depth > 0 ? "Let go to read the pack" : "Drop the product pack here"}</p>
        <p className="t-footnote muted" style={{ maxWidth: "46ch" }}>
          Every PDF is read in this browser with the pinned pdf.js. No file is uploaded to be parsed.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          {PACKS.filter((pack) => pack.id !== "larkspur-v2").map((pack, i) => (
            <button
              key={pack.id}
              type="button"
              className={`btn${i === 0 ? " btn--primary" : ""}`}
              disabled={busy || caseId !== null}
              aria-busy={busy}
              onClick={() => void fromPack(pack.dir).catch(report)}
            >
              {busy ? "Reading…" : `Load ${pack.label}`}
            </button>
          ))}
        </div>
        <p className="t-caption faint">Both products are fabricated for this demonstration.</p>
        {notice && (
          <p className="t-footnote text-negative" role="alert">
            {notice}
          </p>
        )}
      </div>

      {tiles.length > 0 && (
        <ul className="grid-cards" style={{ marginTop: "1.5rem" }}>
          {tiles.map((tile) => (
            <li key={tile.key} className="card materialize stack" style={{ "--stack-gap": "0.5rem" } as React.CSSProperties}>
              <div className="row spread">
                <span className="t-callout strong wrap-anywhere">{tile.filename}</span>
                <span className="badge">{tile.kind ?? "kind unknown"}</span>
              </div>
              <p className="t-footnote muted wrap-anywhere">
                <span className={`badge ${STATUS[tile.status].tone}`}>
                  <span className="dot" />
                  {STATUS[tile.status].label}
                </span>
                {tile.detail ? ` ${tile.detail}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {caseId && (
        <>
          {/* A case opens on its Canvas (#59); the run lives on Review, so this says which way is onward
              rather than leaving the analyst to find it: the steps in order, and the cards they bring. */}
          <div className="card notice--tint materialize stack" style={{ "--stack-gap": "0.5rem", marginTop: "1.5rem" } as React.CSSProperties}>
            <p className="t-eyebrow">Case opened</p>
            <p className="t-callout">
              The case opens on its canvas. Run the steps in order from Review —{" "}
              {PIPELINE_STEPS.map((step) => STEP_LABELS[step]).join(" → ")} — and each finding arrives on the canvas as a card.
            </p>
            <div className="row">
              <Link href={`/cases/${caseId}/canvas`} className="btn btn--primary">
                Open the case →
              </Link>
              <button type="button" className="btn btn--plain" onClick={reset}>
                Start another review
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const toBytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
