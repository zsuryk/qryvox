"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardId, SlimEvent } from "@qryvox/shared";
import { type CardCitation, cardModel, naturalSlot } from "../lib/canvas-cards";
import { canvasLayout } from "../lib/canvas-layout";
import { type CanvasMode, type CanvasView as View, canvasView } from "../lib/canvas-source";
import { appendOp, type CardOp, operations } from "../lib/canvas-store";
import { errorMessage } from "../lib/errors";
import {
  centreOn,
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
  visibleWorld,
  wheelFactor,
  worldTransform,
  zoomAt,
  zoomBy,
} from "../lib/viewport";
import { Card, type CardActions } from "./canvas-card";
import CitationSheet from "./citation-sheet";

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
  // The store: the log, and card operations appended to it (lib/canvas-store.ts). Only the fixture
  // appends here; on a live case the operations are disabled until the backend can record them.
  const [log, setLog] = useState<readonly SlimEvent[]>(events);
  const allowed = operations(mode);
  const dispatch = useCallback(
    (op: CardOp) => {
      if (!allowed.enabled) return;
      setLog((current) => appendOp(current, op, { eventId: crypto.randomUUID(), at: new Date().toISOString() }));
    },
    [allowed.enabled],
  );

  // A gap in the log is a hard error, not a half-built canvas (ADR-0002), so it is said, not drawn.
  const folded = useMemo((): { view: View } | { error: string } => {
    try {
      return { view: canvasView(log) };
    } catch (cause) {
      return { error: errorMessage(cause) };
    }
  }, [log]);
  if ("error" in folded) {
    return <p className="notice notice--negative t-callout">This canvas cannot be built from the case&apos;s log: {folded.error}</p>;
  }
  return <Canvas view={folded.view} log={log} mode={mode} readOnly={allowed.enabled ? null : allowed.reason} dispatch={dispatch} />;
}

type CanvasProps = {
  view: View;
  log: readonly SlimEvent[];
  mode: CanvasMode;
  readOnly: string | null;
  dispatch: (op: CardOp) => void;
};

function Canvas({ view, log, mode, readOnly, dispatch }: CanvasProps) {
  const layout = useMemo(() => canvasLayout(view), [view]);
  const frame = useRef<HTMLDivElement | null>(null);
  const { viewport, ready, fit, zoom, reset, reveal, gestures } = useViewport(frame, layout.bounds);
  const [sheet, setSheet] = useState<{ citation: CardCitation; label: string } | null>(null);
  const hint = "canvas-hint";
  const board = view.state.board;
  const pinned = layout.flow.filter((p) => p.pinned).length;
  const models = useMemo(() => new Map(view.cards.map((card) => [card.cardId, cardModel(card, view.state)])), [view]);

  // The cards' actions read the latest layout through a ref, so they keep one identity across renders and
  // a pan, which re-renders the canvas every frame, never re-renders a card.
  const latest = useRef({ view, layout });
  useEffect(() => {
    latest.current = { view, layout };
  }, [view, layout]);
  const actions = useMemo((): CardActions => {
    const cardOf = (id: CardId) => latest.current.view.cards.find((c) => c.cardId === id);
    return {
      dock(id) {
        const card = cardOf(id);
        const slot = card ? naturalSlot(card, latest.current.view.state) : null;
        if (slot) dispatch({ type: "card.docked", payload: { card_id: id, plan_slot: slot } });
      },
      undock: (id) => dispatch({ type: "card.undocked", payload: { card_id: id } }),
      // Pinned where it stands: the button is the keyboard's way to do what dropping the card does.
      pin(id) {
        const rect = latest.current.layout.flow.find((p) => p.card.cardId === id)?.rect;
        if (rect) dispatch({ type: "card.pinned", payload: { card_id: id, world_pos: { x: rect.x, y: rect.y } } });
      },
      discard: (id) => dispatch({ type: "card.discarded", payload: { card_id: id } }),
      restore: (id) => dispatch({ type: "card.restored", payload: { card_id: id } }),
      openCitation: (citation, label) => setSheet({ citation, label }),
      reveal(id) {
        const rect = latest.current.layout.flow.find((p) => p.card.cardId === id)?.rect;
        if (rect) reveal(rect);
      },
    };
  }, [dispatch, reveal]);

  return (
    <section className="section canvas-section" aria-label="Canvas">
      <div className="row spread canvas-summary">
        <p className="t-footnote muted" aria-live="polite">
          {[
            counted(layout.flow.length, "card on the canvas", "cards on the canvas"),
            pinned > 0 ? `${pinned} pinned` : null,
            board.docked.length > 0 ? `${board.docked.length} docked to the plan` : null,
            board.discarded.length > 0 ? `${board.discarded.length} discarded` : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        <p className="t-footnote faint">
          {readOnly ?? (mode.kind === "fixture" ? "Card operations stay in this tab: a reload starts the recorded case over." : null)}
        </p>
      </div>
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
          {ready &&
            layout.flow.map(({ card, rect, pinned }, index) => (
              <div
                key={card.cardId}
                className="canvas-item"
                style={{ transform: placeAt(rect), width: rect.w, height: rect.h }}
                // A card is a thing of its own: pressing it never pans the background behind it.
                onPointerDown={(event) => event.stopPropagation()}
                // Tabbing onto a card off screen brings it into view; a click on one already in view does not.
                onFocus={(event) => event.target.matches(":focus-visible") && reveal(rect)}
              >
                {/* The spawn is on the card inside, so it never fights the slot's own transform: a card
                    arrives in its slot, and later moves between slots, as two separate motions. */}
                <div className="canvas-item__body" style={{ "--spawn-delay": `${Math.min(index, 10) * 35}ms` } as React.CSSProperties}>
                  <Card
                    model={models.get(card.cardId)!}
                    state={{ docked: false, pinned, discarded: false }}
                    readOnly={readOnly}
                    undockable={naturalSlot(card, view.state) ? null : "No finding cites this passage, so it has no place in the plan"}
                    actions={actions}
                  />
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
      {sheet && <CitationSheet events={log} citation={sheet.citation.citation} label={sheet.label} onClose={() => setSheet(null)} />}
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

  // Bring a world rectangle into view if any of it is off screen, centred, at the zoom already chosen.
  const reveal = useCallback((rect: Rect) => {
    setViewport((v) => {
      const seen = visibleWorld(v, size.current);
      const inside = rect.x >= seen.x && rect.y >= seen.y && rect.x + rect.w <= seen.x + seen.w && rect.y + rect.h <= seen.y + seen.h;
      return inside || size.current.width === 0 ? v : centreOn(v, rect, size.current);
    });
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
      // The first view fits the canvas, but no smaller than a card can be read at: a big case opens
      // readable from its top-left corner, and Fit is one press away for the whole of it.
      if (!fitted.current) {
        fitted.current = true;
        const rect = content.current;
        if (rect) setViewport(fitTo(rect, size.current, { padding: 48, maxZoom: 1, minZoom: 0.7 }));
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

  return { viewport, ready, fit, zoom, reset, reveal, gestures };
}
