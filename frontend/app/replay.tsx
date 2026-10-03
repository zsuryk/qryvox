"use client";

import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { fold, type SlimEvent } from "@qryvox/shared";
import { describe, positionOf, project, seqAt, springStep, tickKind, tracked } from "../lib/replay";
import Board from "./board";
import { FindingsEval } from "./eval-tiles";

// The replay scrubber (#14): drag along the case's history and the case is rebuilt, live, exactly as it
// stood at that event — folded from the log up to there, in the browser, with no model called (ADR-0002).
//
// It is the one control in the product a person moves with their hand, so it moves like an object: it
// follows the finger 1:1 from where it was grabbed, resists past the ends, carries a flick's momentum to
// where it would come to rest, and settles there on a spring that starts at the finger's speed. Grab it
// mid-glide and it stops under the finger. Arrow keys, Page Up/Down, Home and End do the same by steps.

const FLICK = 800; // px/s: faster than this, the release was a throw and the settle may bounce a little.

export default function Replay({ events }: { events: readonly SlimEvent[] }) {
  const count = events.length;
  // Pinned to a past event, or null to follow the latest: at the end of the track the scrubber is "now",
  // and stays now as the log grows.
  const [pinned, setPinned] = useState<number | null>(null);
  const seq = pinned === null ? count : Math.min(pinned, count);
  const track = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLDivElement | null>(null);
  // The thumb's presentation value: where it is on screen now, which every new motion starts from.
  const shown = useRef(0);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ offset: number; history: { t: number; x: number }[] } | null>(null);
  // The event the thumb rests on, for the resize observer, which outlives any one render.
  const resting = useRef(seq);
  useEffect(() => {
    resting.current = seq;
  }, [seq]);

  const width = () => track.current?.getBoundingClientRect().width ?? 0;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Put the thumb at x and the case at the event under it.
  const place = useCallback(
    (x: number) => {
      shown.current = x;
      if (thumb.current) thumb.current.style.transform = `translateX(${x}px)`;
      const w = width();
      const at = seqAt(Math.min(w, Math.max(0, x)), count, w);
      setPinned(at === count ? null : at);
    },
    [count],
  );

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  // Settle on `target` by a spring from where the thumb is, at the speed it already has.
  const settle = useCallback(
    (target: number, velocity: number) => {
      stop();
      if (reduced()) return place(target);
      let state = { x: shown.current, v: velocity };
      let last = performance.now();
      const damping = Math.abs(velocity) > FLICK ? 0.8 : 1;
      const tick = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        state = springStep(state, target, dt, damping, 0.35);
        if (Math.abs(state.x - target) < 0.3 && Math.abs(state.v) < 4) {
          place(target);
          frame.current = null;
          return;
        }
        place(state.x);
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [place],
  );

  // The latest event when the log grows, and the thumb kept on its event when the track is resized.
  // Keep the thumb on its event when the log grows or the track is resized, unless a hand or a spring
  // is moving it. Only the DOM moves here: which event it is was decided already.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const rest = () => {
      if (drag.current || frame.current !== null) return;
      const x = positionOf(resting.current, count, width());
      shown.current = x;
      if (thumb.current) thumb.current.style.transform = `translateX(${x}px)`;
    };
    rest();
    const observer = new ResizeObserver(rest);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count, seq]);
  useEffect(() => stop, []);

  const local = (clientX: number) => clientX - (track.current?.getBoundingClientRect().left ?? 0);

  function down(event: PointerEvent<HTMLDivElement>) {
    stop(); // Caught mid-glide: it stops under the finger, from where it is.
    event.currentTarget.setPointerCapture(event.pointerId);
    const onThumb = thumb.current?.contains(event.target as Node) ?? false;
    // Grabbed on the thumb: keep the offset from where it was taken. On the track: the thumb comes to the
    // finger and follows from there.
    const offset = onThumb ? local(event.clientX) - shown.current : 0;
    drag.current = { offset, history: [{ t: event.timeStamp, x: local(event.clientX) - offset }] };
    if (!onThumb) place(local(event.clientX));
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const x = local(event.clientX) - d.offset;
    d.history = [...d.history.filter((p) => event.timeStamp - p.t < 100), { t: event.timeStamp, x }];
    place(tracked(x, width()));
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const first = d.history[0]!;
    const last = d.history.at(-1)!;
    const dt = (last.t - first.t) / 1000;
    const velocity = dt > 0 ? (last.x - first.x) / dt : 0;
    const w = width();
    // Snap to the event nearest where the gesture was going, not where it let go.
    const landing = Math.min(w, Math.max(0, shown.current + project(velocity)));
    settle(positionOf(seqAt(landing, count, w), count, w), velocity);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const to = { ArrowLeft: seq - 1, ArrowDown: seq - 1, ArrowRight: seq + 1, ArrowUp: seq + 1, PageDown: seq - 10, PageUp: seq + 10, Home: 1, End: count }[
      event.key
    ];
    if (to === undefined) return;
    event.preventDefault();
    const next = Math.min(count, Math.max(1, to));
    settle(positionOf(next, count, width()), 0);
  }

  const now = events.find((e) => e.seq === seq) ?? events.at(-1)!;
  const past = events.filter((e) => e.seq <= seq);
  const state = fold(past);
  const atEnd = seq === count;

  return (
    <section className="section" aria-labelledby="replay-heading">
      <div className="section-head spread">
        <div className="row row--baseline" style={{ "--row-gap": "0.875rem" } as React.CSSProperties}>
          <h2 id="replay-heading" className="t-title">
            Replay
          </h2>
          <span className="t-footnote muted">Drag through the case&apos;s history. Everything below is rebuilt from the log up to there.</span>
        </div>
        {!atEnd && (
          <button type="button" className="btn btn--small" onClick={() => settle(positionOf(count, count, width()), 0)}>
            Back to now
          </button>
        )}
      </div>

      <div className="card stack" style={{ "--stack-gap": "0.875rem" } as React.CSSProperties}>
        <div className="row spread">
          <p className="t-callout" aria-live="polite">
            <span className="strong">Event {seq}</span>
            <span className="muted"> of {count} · </span>
            {describe(now)}
          </p>
          <span className="t-caption faint">{new Date(now.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</span>
        </div>

        <div className="scrubber" ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="scrubber__rail" aria-hidden>
            {events.map((e) => (
              <span
                key={e.seq}
                className={`scrubber__tick scrubber__tick--${tickKind(e)}${e.seq <= seq ? " scrubber__tick--past" : ""}`}
                style={{ left: `${count <= 1 ? 0 : ((e.seq - 1) / (count - 1)) * 100}%` }}
              />
            ))}
          </div>
          <div
            ref={thumb}
            className="scrubber__thumb"
            role="slider"
            tabIndex={0}
            aria-label="Event in the case's history"
            aria-valuemin={1}
            aria-valuemax={count}
            aria-valuenow={seq}
            aria-valuetext={`Event ${seq} of ${count}: ${describe(now)}`}
            onKeyDown={key}
          />
        </div>

        <div className="row" style={{ "--row-gap": "0.375rem 1rem" } as React.CSSProperties}>
          {[
            count_(state.documents.length, "document"),
            count_(state.stepRuns.filter((r) => r.status === "completed").length, "step done", "steps done"),
            count_(state.findings.filter((f) => f.supersededAtSeq === null).length, "finding on the board", "findings on the board"),
            count_(state.dispositions.length, "decided", "decided"),
            count_(state.clients.length, "client"),
            count_(state.advice.filter((a) => a.decision?.decision === "approved" && a.supersededAtSeq === null).length, "advice approved", "advice approved"),
          ].map((text) => (
            <span key={text} className="t-footnote muted">
              {text}
            </span>
          ))}
        </div>
      </div>

      <Board events={past} />
      <FindingsEval events={past} />
    </section>
  );
}

// "1 document", "2 documents": a count read as words.
function count_(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
