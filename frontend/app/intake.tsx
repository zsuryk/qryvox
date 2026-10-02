"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Sha256 } from "@qryvox/shared";
import { ingestDocument, openCase } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { type DocumentTile, intake, type IntakeFile } from "../lib/intake";
import { browserPdfAssets } from "../lib/pdf";
import { packSources } from "../lib/pack";
import { PIPELINE_STEPS, STEP_LABELS } from "../lib/pipeline";

// The one place a document enters the system. Nothing here asks for a file dialog and nothing waits to
// be told to go: a drop, or the fabricated pack behind the button, are the whole of intake. Both land
// on the same call in lib/intake.ts, so a demo and a hand-dropped pack take the same road.

const MUTED = "#5b6270";
const LINE = "#d5d9e0";
const ACCENT = "#1f4f8f";
// One colour per outcome, and the word beside it: a tile that failed must not rely on colour alone.
const STATUS: Record<DocumentTile["status"], { label: string; colour: string }> = {
  extracting: { label: "Reading", colour: MUTED },
  sending: { label: "Recording", colour: "#8a6d3b" },
  ingested: { label: "Ingested", colour: "#1c6b4a" },
  skipped: { label: "Skipped", colour: "#7a6a20" },
  failed: { label: "Failed", colour: "#a02c2c" },
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

  // The fabricated pack, through the same road: same read, same parse, same append.
  const fromPack = async () => {
    await run(await packSources());
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
        style={{
          alignItems: "center",
          background: depth > 0 ? "#eef3fa" : "#ffffff",
          border: `2px dashed ${depth > 0 ? ACCENT : LINE}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Drop the product pack here</p>
        <p style={{ color: MUTED, fontSize: "0.85rem", margin: 0, maxWidth: "46ch" }}>
          Every PDF is read in this browser with the pinned pdf.js. No file is uploaded to be parsed.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void fromPack().catch(report)}
          style={{
            background: busy ? LINE : ACCENT,
            border: 0,
            borderRadius: 6,
            color: "#ffffff",
            cursor: busy ? "progress" : "pointer",
            font: "inherit",
            padding: "8px 16px",
          }}
        >
          {busy ? "Reading…" : "Load the fabricated pack"}
        </button>
        {notice && <p style={{ color: "#a02c2c", fontSize: "0.85rem", margin: 0 }}>{notice}</p>}
      </div>

      {tiles.length > 0 && (
        <ul style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", listStyle: "none", margin: "24px 0 0", padding: 0 }}>
          {tiles.map((tile) => (
            <li
              key={tile.key}
              style={{
                background: "#ffffff",
                border: `1px solid ${LINE}`,
                borderLeft: `4px solid ${STATUS[tile.status].colour}`,
                borderRadius: 6,
                padding: "12px 14px",
              }}
            >
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{tile.filename}</span>
              <span style={{ background: "#f6f7f9", borderRadius: 999, color: MUTED, fontSize: "0.75rem", marginLeft: 8, padding: "2px 8px" }}>
                {tile.kind ?? "kind unknown"}
              </span>
              <p style={{ color: MUTED, fontSize: "0.8rem", margin: "6px 0 0", overflowWrap: "anywhere" }}>
                <span style={{ color: STATUS[tile.status].colour }}>{STATUS[tile.status].label}</span>
                {tile.detail ? ` — ${tile.detail}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {caseId && (
        <>
          <p style={{ color: MUTED, fontSize: "0.75rem", letterSpacing: "0.04em", margin: "20px 0 0", textTransform: "uppercase" }}>
            Case opened
            <br />
            <Link href={`/cases/${caseId}`} style={{ color: ACCENT, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
              Run the pipeline on it →
            </Link>
          </p>
          {/* The case page is where the run lives, so it says which way is onward rather than leaving the
              analyst to find it: the four steps in order, and the board they fill. */}
          <p style={{ color: MUTED, fontSize: "0.8rem", margin: "6px 0 0" }}>
            On the case page you run the four steps in order — {PIPELINE_STEPS.map((step) => STEP_LABELS[step]).join(" → ")} — and the claim board fills as
            they go.
          </p>
        </>
      )}
    </>
  );
}

const toBytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
