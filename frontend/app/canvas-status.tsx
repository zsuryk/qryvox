"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SlimEvent, StepRunStatus } from "@qryvox/shared";
import { type StatusLine, statusLines } from "../lib/canvas-status";
import { Sheet } from "./ui";

// The status panel (#58): the case's step log and the canvas's own operations, as lines read out of the
// events the canvas folds (lib/canvas-status.ts). It floats in the canvas's top corner as a parallel
// panel, a light material with no scrim, so the board stays in reach behind it. Closed, it is one line:
// how many runs, how many failed, and the latest thing that happened. Open, it is the whole record, the
// newest at the bottom, each failed step with the reason its step.failed gave.
//
// On a phone (`sheet`, #61) there is no room to lay the record over the cards: the closed line sits in the
// canvas's top bar, and opening it raises the record as a sheet from the bottom of the screen. The sheet is
// put on the page itself rather than inside the canvas, whose floating layers would otherwise hold it.

const WORD: Record<StepRunStatus, { label: string; tone: string; mark: string }> = {
  running: { label: "Running", tone: "badge--tint", mark: "…" },
  completed: { label: "Done", tone: "badge--positive", mark: "✓" },
  failed: { label: "Failed", tone: "badge--negative", mark: "!" },
};

export default function CanvasStatus({ events, sheet = false }: { events: readonly SlimEvent[]; sheet?: boolean }) {
  const lines = useMemo(() => statusLines(events), [events]);
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const runs = lines.filter((l) => l.kind === "run");
  const failed = runs.filter((l) => l.status === "failed").length;
  const running = runs.some((l) => l.status === "running");
  const latest = lines.at(-1);

  // Opened, or grown while open: the newest line is the one in view.
  useEffect(() => {
    const scroller = sheet ? list.current?.closest(".sheet") : list.current;
    if (open && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [open, lines.length, sheet]);

  const record = (
    <ol
      ref={list}
      id="canvas-status-list"
      className={`canvas-status__list${sheet ? " canvas-status__list--sheet" : " materialize"}`}
      data-scrolls={sheet ? undefined : true}
      aria-label="Steps and card operations, oldest first"
    >
      {lines.map((line) => (
        <Line key={`${line.kind}:${line.seq}`} line={line} />
      ))}
    </ol>
  );

  return (
    <div className={`canvas-status${sheet ? " canvas-status--bar" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="canvas-status__head"
        aria-expanded={open}
        aria-controls={sheet ? undefined : "canvas-status-list"}
        aria-haspopup={sheet ? "dialog" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dot ${failed > 0 ? "text-negative" : running ? "text-tint" : "text-positive"}`} aria-hidden />
        <span className="t-footnote strong">Activity</span>
        <span className="t-caption muted">
          {runs.length} run{runs.length === 1 ? "" : "s"}
          {failed > 0 && <span className="text-negative"> · {failed} failed</span>}
        </span>
        <span className="t-caption muted canvas-status__latest">{latest ? summary(latest) : "Nothing has run on this case yet."}</span>
        <span aria-hidden className="canvas-status__chevron">
          ›
        </span>
      </button>
      {open &&
        (sheet
          ? createPortal(
              <Sheet title="Activity" onClose={() => setOpen(false)}>
                {record}
              </Sheet>,
              document.body,
            )
          : record)}
    </div>
  );
}

function summary(line: StatusLine): string {
  return line.kind === "run" ? `${line.label} · ${WORD[line.status].label.toLowerCase()}` : line.text;
}

function Line({ line }: { line: StatusLine }) {
  if (line.kind === "card") {
    return (
      <li className="status-line">
        <span className="status-line__mark status-line__mark--card" aria-hidden />
        <div className="status-line__body">
          <p className="t-footnote">{line.text}</p>
          <p className="t-caption muted status-line__clip">{line.card}</p>
          <p className="t-caption faint">event {line.seq}</p>
        </div>
      </li>
    );
  }
  const word = WORD[line.status];
  return (
    <li className={`status-line status-line--${line.status}`}>
      <span className="status-line__mark" aria-hidden>
        {word.mark}
      </span>
      <div className="status-line__body">
        <p className="t-footnote strong row" style={{ "--row-gap": "0.375rem" } as React.CSSProperties}>
          {line.label}
          <span className={`badge ${word.tone}`}>{word.label}</span>
        </p>
        {line.detail && <p className="t-caption muted status-line__clip">{line.detail}</p>}
        {line.result && <p className="t-caption muted">{line.result}</p>}
        {line.error && <p className="t-caption text-negative wrap-anywhere">{line.error}</p>}
        {line.failedAttempts > 0 && (
          <p className="t-caption faint wrap-anywhere">
            Failed {line.failedAttempts === 1 ? "once" : `${line.failedAttempts} times`} first ({line.lastFailure}), then retried under the same run.
          </p>
        )}
        <p className="t-caption faint">
          event {line.seq} · {line.model}
        </p>
      </div>
    </li>
  );
}
