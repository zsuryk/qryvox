"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlimEvent } from "@qryvox/shared";
import { type CanvasMode, type CanvasView as View, canvasView } from "../lib/canvas-source";
import { canvasLayout } from "../lib/canvas-layout";
import { errorMessage } from "../lib/errors";
import {
  fitTo,
  glide,
  gridStyle,
  IDENTITY,
  panBy,
  placeAt,
  type Point,
  type Rect,
  type Size,
  type Viewport,
  wheelFactor,
  worldTransform,
  zoomAt,
  zoomBy,
} from "../lib/viewport";

// The canvas (#48): the case's findings and the passages they cite, laid out as cards on a board that pans
// and zooms without end. It is a view over the case's log and nothing else: the cards are folded from the
// events this component was handed (canvas-source.ts), and every position on it is a world coordinate that
// lib/viewport.ts alone maps to the screen, through one transform on one world layer.
//
// The background is the thing a hand moves here: it follows the pointer 1:1, carries a flick's speed when
// let go and loses it the way a scroll view does, and stops dead under a new press. A scroll of the wheel
// or trackpad pans; with ⌘ or Ctrl held (which is also what a trackpad pinch sends), it zooms about the
// pointer. The same moves are on the keyboard and on real buttons, for anyone not using a pointer.

const KEY_PAN = 64;

export type CanvasViewProps = { events: readonly SlimEvent[]; mode: CanvasMode };

export default function CanvasView({ events, mode }: CanvasViewProps) {
  // A gap in the log is a hard error, not a half-built canvas (ADR-0002), so it is said, not drawn.
  const folded = useMemo((): { view: View } | { error: string } => {
    try {
      return { view: canvasView(events) };
    } catch (cause) {
      return { error: errorMessage(cause) };
    }
  }, [events]);
  if ("error" in folded) {
    return <p className="notice notice--negative t-callout">This canvas cannot be built from the case&apos;s log: {folded.error}</p>;
  }
  return <Canvas view={folded.view} mode={mode} />;
}

function Canvas({ view, mode }: { view: View; mode: CanvasMode }) {
  const layout = useMemo(() => canvasLayout(view), [view]);
  const bounds = layout.bounds;
  const frame = useRef<HTMLDivElement | null>(null);
  const { viewport, ready, fit, zoom, reset, gestures } = useViewport(frame, bounds);
  const hint = "canvas-hint";
  const board = view.state.board;
  const pinned = layout.flow.filter((p) => p.pinned).length;

  return (
    <section className="section canvas-section" aria-label="Canvas">
      <p className="t-footnote muted canvas-summary" aria-live="polite">
        {[
          counted(layout.flow.length, "card on the canvas", "cards on the canvas"),
          pinned > 0 ? `${pinned} pinned` : null,
          board.docked.length > 0 ? `${board.docked.length} docked to the plan` : null,
          board.discarded.length > 0 ? `${board.discarded.length} discarded` : null,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </p>
      <div
        ref={frame}
        className="canvas"
        style={gridStyle(viewport)}
        tabIndex={0}
        role="region"
        aria-roledescription="canvas"
        aria-label={mode.kind === "fixture" ? "Canvas of the recorded case" : "Canvas of this case"}
        aria-describedby={hint}
        {...gestures}
      >
        <div className="canvas__world" style={{ transform: worldTransform(viewport) }}>
          {/* Nothing is dealt until the frame has a size and the world is fitted to it, so the cards
              arrive where they will stay instead of arriving and then jumping to fit. */}
          {ready && layout.flow.map(({ card, rect }, index) => (
            <div key={card.cardId} className="canvas-item" style={{ transform: placeAt(rect), width: rect.w, height: rect.h }}>
              {/* The spawn is on the card inside, so it never fights the slot's own transform: a card
                  arrives in its slot, and later moves between slots, as two separate motions. */}
              <div className="card canvas-stub canvas-item__body" style={{ "--spawn-delay": `${Math.min(index, 10) * 35}ms` } as React.CSSProperties}>
                <p className="t-caption faint">{card.kind === "finding" ? "Finding" : "Excerpt"}</p>
                <p className="t-callout">{card.kind === "finding" ? card.finding.claim : card.citation.quote}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="canvas__toolbar" role="toolbar" aria-label="Zoom" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="btn btn--small" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>
            −
          </button>
          <button type="button" className="btn btn--small canvas__zoom" aria-label="Zoom to actual size" title="Actual size" onClick={reset}>
            {Math.round(viewport.zoom * 100)}%
          </button>
          <button type="button" className="btn btn--small" aria-label="Zoom in" onClick={() => zoom(1.25)}>
            +
          </button>
          <button type="button" className="btn btn--small" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      <p id={hint} className="t-caption faint canvas-hint">
        Drag the background to move around. Scroll to pan; hold ⌘ or Ctrl and scroll, or pinch, to zoom. With the canvas
        focused, the arrow keys pan, + and − zoom, 0 fits everything and 1 is actual size.
      </p>
    </section>
  );
}

// "1 card", "3 cards": a count read as words.
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// The viewport as React state, and the gestures that move it. Everything that changes the viewport goes
// through lib/viewport.ts; this hook only decides when.
function useViewport(frame: RefObject<HTMLDivElement | null>, bounds: Rect | null) {
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [ready, setReady] = useState(false);
  const size = useRef<Size>({ width: 0, height: 0 });
  // What a fit fits, for the observer and the keyboard, which outlive any one render.
  const content = useRef(bounds);
  useEffect(() => {
    content.current = bounds;
  }, [bounds]);
  const fitted = useRef(false);
  const pan = useRef<{ id: number; last: Point; history: { t: number; x: number; y: number }[] } | null>(null);
  const frameId = useRef<number | null>(null);

  const stopGlide = () => {
    if (frameId.current !== null) cancelAnimationFrame(frameId.current);
    frameId.current = null;
  };

  const fit = useCallback(() => {
    stopGlide();
    const rect = content.current;
    if (rect && size.current.width > 0) setViewport(fitTo(rect, size.current, { padding: 48, maxZoom: 1 }));
  }, []);

  const centre = () => ({ x: size.current.width / 2, y: size.current.height / 2 });
  const zoom = (factor: number) => {
    stopGlide();
    setViewport((v) => zoomBy(v, factor, centre()));
  };
  const reset = () => {
    stopGlide();
    setViewport((v) => zoomAt(v, 1, centre()));
  };

  // The frame's size, and the first fit once there is a size to fit to.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      size.current = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (!fitted.current) {
        fitted.current = true;
        fit();
        setReady(true);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame, fit]);

  // The wheel, natively: React's wheel listener is passive, and a canvas that zooms must stop the page
  // from scrolling (and the browser from zooming the whole page on a pinch) underneath it.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopGlide();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.current.height : 1;
      const box = el.getBoundingClientRect();
      const at = { x: event.clientX - box.left, y: event.clientY - box.top };
      if (event.ctrlKey || event.metaKey) setViewport((v) => zoomBy(v, wheelFactor(event.deltaY * scale), at));
      else setViewport((v) => panBy(v, -event.deltaX * scale, -event.deltaY * scale));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frame]);
  useEffect(() => stopGlide, []);

  // Let go with speed: the background keeps it and slows the way a scroll view does. Not for reduced
  // motion, where it stops where it was let go.
  const coast = (velocity: Point) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let v = velocity;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      v = glide(v, dt);
      if (Math.hypot(v.x, v.y) < 8) {
        frameId.current = null;
        return;
      }
      setViewport((current) => panBy(current, v.x * dt, v.y * dt));
      frameId.current = requestAnimationFrame(tick);
    };
    frameId.current = requestAnimationFrame(tick);
  };

  const gestures = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      stopGlide(); // Caught mid-glide: it stops under the hand.
      event.currentTarget.setPointerCapture(event.pointerId);
      const at = { x: event.clientX, y: event.clientY };
      pan.current = { id: event.pointerId, last: at, history: [{ t: event.timeStamp, ...at }] };
      event.currentTarget.dataset.panning = "true";
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const p = pan.current;
      if (!p || p.id !== event.pointerId) return;
      const dx = event.clientX - p.last.x;
      const dy = event.clientY - p.last.y;
      p.last = { x: event.clientX, y: event.clientY };
      p.history = [...p.history.filter((h) => event.timeStamp - h.t < 100), { t: event.timeStamp, x: event.clientX, y: event.clientY }];
      setViewport((v) => panBy(v, dx, dy));
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const p = pan.current;
      if (!p || p.id !== event.pointerId) return;
      pan.current = null;
      delete event.currentTarget.dataset.panning;
      const first = p.history[0]!;
      const last = p.history.at(-1)!;
      const dt = (last.t - first.t) / 1000;
      // A hand that stopped before letting go has no speed left to carry.
      if (dt > 0 && event.timeStamp - last.t < 60) coast({ x: (last.x - first.x) / dt, y: (last.y - first.y) / dt });
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      pan.current = null;
      delete event.currentTarget.dataset.panning;
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      // Only the canvas's own keys, and only when the canvas itself has focus: a card's buttons keep theirs.
      if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
      const moves: Record<string, () => void> = {
        ArrowLeft: () => setViewport((v) => panBy(v, KEY_PAN, 0)),
        ArrowRight: () => setViewport((v) => panBy(v, -KEY_PAN, 0)),
        ArrowUp: () => setViewport((v) => panBy(v, 0, KEY_PAN)),
        ArrowDown: () => setViewport((v) => panBy(v, 0, -KEY_PAN)),
        "+": () => zoom(1.25),
        "=": () => zoom(1.25),
        "-": () => zoom(1 / 1.25),
        "0": fit,
        "1": reset,
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      stopGlide();
      move();
    },
  };

  return { viewport, ready, fit, zoom, reset, gestures };
}
