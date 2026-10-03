"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CardId, CardOperationRequest, type FindingCategory, type SlimEvent, type WorldPos } from "@qryvox/shared";
import { categoryLabel } from "../lib/board";
import { type CardCitation, cardModel, dockableCategories, DOCUMENT_KIND_LABELS, naturalSlot } from "../lib/canvas-cards";
import { type DropTarget, resolveDrop } from "../lib/canvas-drop";
import { canvasLayout } from "../lib/canvas-layout";
import { type PlanLayout, planHit } from "../lib/plan-region";
import { type CanvasMode, type CanvasView as View, canvasView } from "../lib/canvas-source";
import { candidatesOf, hasRecording, planSimilar, playback, similarFailure, similarRequest } from "../lib/canvas-similar";
import { appendOp, type CanvasLog, canvasLog, type CardOp, reread, rolledBack, sent, settled, shownLog } from "../lib/canvas-store";
import { fetchEvents, recordCardOperation, runStep } from "../lib/api";
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
  toWorld,
  type Viewport,
  visibleWorld,
  wheelFactor,
  worldTransform,
  zoomAt,
  zoomBy,
} from "../lib/viewport";
import { Card, type CardActions } from "./canvas-card";
import CanvasStatus from "./canvas-status";
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
  // What the last operation came to, in words, for everyone: a drop that did nothing says why, and so does
  // an operation the server refused.
  const [said, setSaid] = useState<string | null>(null);
  const quiet = useRef<number | null>(null);
  const say = useCallback((words: string) => {
    if (quiet.current !== null) window.clearTimeout(quiet.current);
    setSaid(words);
    quiet.current = window.setTimeout(() => setSaid(null), 5000);
  }, []);
  useEffect(() => () => {
    if (quiet.current !== null) window.clearTimeout(quiet.current);
  }, []);

  const store = useCanvasStore(events, mode, say);
  const { log } = store;

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
  return <Canvas view={folded.view} log={log} mode={mode} store={store} said={said} say={say} />;
}

// The store (lib/canvas-store.ts) as React state: the log, and card operations appended to it. On the
// fixture an operation is appended here and that is all. On a live case it is shown at once and sent to the
// backend, one at a time and in the order made, so the latest of two operations on a card is the latest in
// the log too; the answer confirms it, a refusal takes it back off the canvas with the server's reason.
function useCanvasStore(events: readonly SlimEvent[], mode: CanvasMode, say: (words: string) => void) {
  // The log shown is kept beside the store rather than derived on each render, so a pan, which renders the
  // canvas every frame, never folds it again.
  const [log, setLog] = useState<readonly SlimEvent[]>(events);
  // Every change goes through update, so this ref is always the store as it now is: an answer arriving
  // decides against the log as it stands, not as it stood when the operation was sent.
  const current = useRef<CanvasLog>(canvasLog(events));
  const update = useCallback((change: (log: CanvasLog) => CanvasLog) => {
    current.current = change(current.current);
    setLog(shownLog(current.current));
  }, []);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const caseId = mode.kind === "live" ? mode.caseId : null;

  // The case's log read again, replacing what this tab had confirmed.
  const refresh = useCallback(async () => {
    if (caseId === null) return;
    const events = await fetchEvents(caseId);
    update((log) => reread(log, events));
  }, [caseId, update]);

  // Resolves true once the operation is recorded (at once, on the fixture), false if it was refused.
  const dispatch = useCallback(
    (op: CardOp): Promise<boolean> => {
      const envelope = { eventId: crypto.randomUUID(), at: new Date().toISOString() };
      if (caseId === null) {
        update((log) => ({ ...log, confirmed: appendOp(log.confirmed, op, envelope) }));
        return Promise.resolve(true);
      }
      update((log) => sent(log, { op, envelope }));
      const recorded = queue.current.then(async () => {
        try {
          const event = await recordCardOperation(caseId, CardOperationRequest.parse({ event_id: envelope.eventId, ...op }));
          const next = settled(current.current, event);
          if (next === "stale") await refresh();
          else update(() => next);
          return true;
        } catch (cause) {
          update((log) => rolledBack(log, envelope.eventId));
          say(`Not recorded: ${errorMessage(cause)}`);
          return false;
        }
      });
      queue.current = recorded.then(() => undefined);
      return recorded;
    },
    [caseId, refresh, say, update],
  );

  // update and current go out too, for the fixture's recorded find-similar runs (lib/canvas-similar.ts),
  // which this tab appends itself, and for reading the log as it now stands once a run has settled.
  return { log, dispatch, refresh, update, current };
}

type Store = ReturnType<typeof useCanvasStore>;

// Find similar (#57), as the canvas runs it: the request recorded as a card event first, then the seeded run
// (lib/canvas-similar.ts) once the request is on the log, so the log reads request then run. On a live case
// the run is one awaited call to the steps endpoint, judge-link token and all, and the log is read again
// every couple of seconds while it runs, so the status panel shows it running; on the fixture a recorded run
// is played back. Either way the candidates arrive through the fold like everything else. A failure leaves
// the canvas as the log has it, with the reason said; a failed run is on the log as a failed run.
function useFindSimilar(view: View, mode: CanvasMode, store: Store, say: (words: string) => void) {
  const [searching, setSearching] = useState<ReadonlySet<CardId>>(new Set());
  // The run whose candidates the canvas should bring into view once they are laid out.
  const [arrived, setArrived] = useState<string | null>(null);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  }, [view]);
  const { dispatch, refresh, update, current } = store;

  const similar = useCallback(
    async (cardId: CardId) => {
      const planned = planSimilar(latest.current, cardId);
      if ("refused" in planned) return say(planned.refused);
      const { plan } = planned;
      const done = () => setSearching((s) => new Set([...s].filter((id) => id !== cardId)));
      setSearching((s) => new Set(s).add(cardId));
      say("Looking for more like this…");
      if (!(await dispatch({ type: "card.similar_requested", payload: { card_id: cardId, step_kind: plan.step } }))) return done();

      const stepRunId = crypto.randomUUID();
      const found = () => {
        const count = candidatesOf(canvasView(current.current.confirmed), stepRunId).length;
        setArrived(stepRunId);
        say(count === 0 ? "Nothing new turned up: every passage it found already has a card." : `${count} similar passage${count === 1 ? "" : "s"} added to the canvas, marked Similar.`);
      };
      if (mode.kind === "fixture") {
        const played = playback(current.current.confirmed, plan, stepRunId, new Date().toISOString());
        if (played) update((log) => ({ ...log, confirmed: [...log.confirmed, ...played] }));
        else say("The recorded case has no find-similar run recorded for this card.");
        if (played) found();
        return done();
      }
      const poll = window.setInterval(() => void refresh().catch(() => undefined), 2000);
      try {
        await runStep(mode.caseId, similarRequest(plan, stepRunId));
        window.clearInterval(poll);
        await refresh();
        found();
      } catch (cause) {
        window.clearInterval(poll);
        await refresh().catch(() => undefined);
        say(`Find similar did not finish: ${similarFailure(cause)}`);
      } finally {
        window.clearInterval(poll);
        done();
      }
    },
    [current, dispatch, mode, refresh, say, update],
  );

  return { similar, searching, arrived };
}

type CanvasProps = {
  view: View;
  log: readonly SlimEvent[];
  mode: CanvasMode;
  store: Store;
  said: string | null;
  say: (words: string) => void;
};

function Canvas({ view, log, mode, store, said, say }: CanvasProps) {
  const dispatch = store.dispatch;
  const { similar, searching, arrived } = useFindSimilar(view, mode, store, say);
  const layout = useMemo(() => canvasLayout(view), [view]);
  const frame = useRef<HTMLDivElement | null>(null);
  const bin = useRef<HTMLButtonElement | null>(null);
  const { viewport, ready, fit, zoom, reset, reveal, gestures } = useViewport(frame, layout.bounds);
  const [sheet, setSheet] = useState<{ citation: CardCitation; label: string } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const hint = "canvas-hint";
  const board = view.state.board;
  const pinnedCount = layout.flow.filter((p) => p.pinned).length;
  const models = useMemo(() => new Map(view.cards.map((card) => [card.cardId, cardModel(card, view.state)])), [view]);
  const discarded = board.discarded.flatMap((d) => models.get(d.cardId) ?? []);

  // The cards' actions read the latest layout through a ref, so they keep one identity across renders and
  // a pan, which re-renders the canvas every frame, never re-renders a card.
  const latest = useRef({ view, layout });
  useEffect(() => {
    latest.current = { view, layout };
  }, [view, layout]);
  const actions = useMemo((): CardActions => {
    const cardOf = (id: CardId) => latest.current.view.cards.find((c) => c.cardId === id);
    const rectOf = (id: CardId) => [...latest.current.layout.docked, ...latest.current.layout.flow].find((p) => p.card.cardId === id)?.rect;
    return {
      dock(id) {
        const card = cardOf(id);
        const slot = card ? naturalSlot(card, latest.current.view) : null;
        if (slot) dispatch({ type: "card.docked", payload: { card_id: id, plan_slot: slot } });
      },
      undock: (id) => dispatch({ type: "card.undocked", payload: { card_id: id } }),
      // Pinned where it stands: the button is the keyboard's way to do what dropping the card does.
      pin(id) {
        const rect = rectOf(id);
        if (!rect) return;
        dispatch({ type: "card.pinned", payload: { card_id: id, world_pos: { x: rect.x, y: rect.y } } });
        say("Pinned where it is. The other cards flow around it.");
      },
      unpin(id) {
        dispatch({ type: "card.unpinned", payload: { card_id: id } });
        say("Unpinned. It is back in the flow.");
      },
      discard(id) {
        dispatch({ type: "card.discarded", payload: { card_id: id } });
        say("Discarded. It is in the bin, and can be restored.");
      },
      restore(id) {
        dispatch({ type: "card.restored", payload: { card_id: id } });
        say("Restored to the canvas.");
      },
      similar: (id) => void similar(id),
      openCitation: (citation, label) => setSheet({ citation, label }),
      reveal(id) {
        const rect = rectOf(id);
        if (rect) reveal(rect);
      },
    };
  }, [dispatch, reveal, say, similar]);

  // A find-similar run's candidates, once laid out, are brought into view: the first of them, centred if
  // it landed off screen, so the analyst sees what the press came to.
  useEffect(() => {
    if (arrived === null) return;
    const placed = layout.flow.find((p) => p.card.kind === "excerpt" && p.card.candidateOf === arrived);
    if (placed) reveal(placed.rect);
  }, [arrived, layout, reveal]);

  // Why Similar cannot run from a card, per card, or null where it can (lib/canvas-similar.ts).
  const similarOff = useMemo(() => {
    const off = new Map<CardId, string>();
    for (const card of view.cards) {
      const planned = planSimilar(view, card.cardId);
      if ("refused" in planned) off.set(card.cardId, planned.refused);
      else if (mode.kind === "fixture" && !hasRecording(view, card.cardId)) off.set(card.cardId, NO_RECORDING);
    }
    return off;
  }, [view, mode.kind]);

  // Dragging a card. It follows the pointer 1:1 from where it was grabbed, in world units, lifted above
  // the rest; let go, and the drop is decided by lib/canvas-drop.ts: the bin discards it, open canvas pins
  // it there, a slot of the plan region in the card's category docks it there, and anything else sends it back to where it came from, on the same curve it would have
  // settled on. A press only becomes a drag after a few pixels, so a click on a card is still a click.
  const [drag, setDrag] = useState<{ id: CardId; at: WorldPos; target: DropTarget; categories: readonly FindingCategory[] } | null>(null);
  const press = useRef<{ id: CardId; pointer: number; start: Point; grab: Point; moving: boolean } | null>(null);
  const local = (event: PointerEvent) => {
    const box = frame.current!.getBoundingClientRect();
    return toWorld(viewport, { x: event.clientX - box.left, y: event.clientY - box.top });
  };
  // What the pointer is over: the bin, a slot of the plan or the plan between slots, open canvas (where
  // the card's own corner is what would be pinned), or none of the canvas at all.
  const targetOf = (event: PointerEvent, corner: WorldPos): DropTarget => {
    const inside = (el: Element | null) => {
      const box = el?.getBoundingClientRect();
      return !!box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    };
    if (inside(bin.current)) return { kind: "bin" };
    if (!inside(frame.current)) return { kind: "outside" };
    return planHit(layout.plan, local(event)) ?? { kind: "canvas", at: corner };
  };
  const cardGesture = (id: CardId, rect: Rect) => ({
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      // A card is a thing of its own: pressing it never pans the background behind it.
      event.stopPropagation();
      if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
      // Grabbed while still settling: it is picked up from where it is on screen, not from its slot.
      const shown = presented(event.currentTarget) ?? rect;
      const at = local(event);
      press.current = { id, pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, grab: { x: at.x - shown.x, y: at.y - shown.y }, moving: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const p = press.current;
      if (!p || p.pointer !== event.pointerId) return;
      if (!p.moving && Math.hypot(event.clientX - p.start.x, event.clientY - p.start.y) < 6) return;
      p.moving = true;
      const at = local(event);
      const corner = { x: at.x - p.grab.x, y: at.y - p.grab.y };
      const card = view.cards.find((c) => c.cardId === id);
      setDrag({ id, at: corner, target: targetOf(event, corner), categories: card ? dockableCategories(card, view) : [] });
    },
    onPointerUp() {
      const p = press.current;
      press.current = null;
      if (!p || !p.moving || !drag) return setDrag(null);
      const outcome = resolveDrop(id, drag.target, {
        pinned: layout.flow.filter((placed) => placed.pinned).map((placed) => ({ cardId: placed.card.cardId, rect: placed.rect })),
        obstacles: [layout.plan.bounds],
        discarded: false,
        docked: view.state.board.docked.find((d) => d.cardId === id)?.slot ?? null,
        categories: drag.categories,
      });
      setDrag(null);
      if ("ops" in outcome) {
        for (const op of outcome.ops) dispatch(op);
        say(outcome.said);
      } else say(outcome.returned);
    },
    onPointerCancel() {
      press.current = null;
      setDrag(null);
    },
  });

  return (
    <section className="section canvas-section" aria-label="Canvas">
      <div className="row spread canvas-summary">
        <p className="t-footnote muted">
          {[
            counted(layout.flow.length, "card on the canvas", "cards on the canvas"),
            pinnedCount > 0 ? `${pinnedCount} pinned` : null,
            board.docked.length > 0 ? `${board.docked.length} docked to the plan` : null,
            board.discarded.length > 0 ? `${board.discarded.length} discarded` : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        <p className={`t-footnote ${said ? "" : "faint"}`} role="status">
          {said ?? (mode.kind === "fixture" ? "Card operations stay in this tab: a reload starts the recorded case over." : null)}
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
        data-dragging={drag ? "true" : undefined}
        {...gestures}
      >
        <div className="canvas__world" style={{ transform: worldTransform(viewport) }}>
          {/* Nothing is dealt until the frame has a size and the world is fitted to it, so the cards
              arrive where they will stay instead of arriving and then jumping to fit. */}
          {ready && <PlanRegion plan={layout.plan} drag={drag} />}
          {ready &&
            [...layout.docked.map((p) => ({ ...p, docked: true })), ...layout.flow.map((p) => ({ ...p, docked: false }))].map(
              ({ card, rect, pinned, docked }, index) => {
                const lifted = drag?.id === card.cardId;
                return (
                  <div
                    key={card.cardId}
                    className={`canvas-item canvas-item--movable${lifted ? " canvas-item--lifted" : ""}`}
                    style={{ transform: placeAt(lifted ? drag.at : rect), width: rect.w, height: rect.h }}
                    // Tabbing onto a card off screen brings it into view; a click on one already in view does not.
                    onFocus={(event) => event.target.matches(":focus-visible") && reveal(rect)}
                    {...cardGesture(card.cardId, rect)}
                  >
                    {/* The spawn is on the card inside, so it never fights the slot's own transform: a card
                        arrives in its slot, and later moves between slots, as two separate motions. */}
                    <div className="canvas-item__body" style={{ "--spawn-delay": `${Math.min(index, 10) * 35}ms` } as React.CSSProperties}>
                      <Card
                        model={models.get(card.cardId)!}
                        docked={docked}
                        pinned={pinned}
                        discarded={false}
                        undockable={naturalSlot(card, view) ? null : NO_SLOT}
                        searching={searching.has(card.cardId)}
                        similarOff={similarOff.get(card.cardId) ?? null}
                        actions={actions}
                      />
                    </div>
                  </div>
                );
              },
            )}
        </div>

        {/* The discard bin: always in the same corner whatever the pan, so a card can always be thrown
            to it. Pressing it opens what is in it, to restore from. */}
        <button
          ref={bin}
          type="button"
          className={`canvas-bin${drag ? " canvas-bin--armed" : ""}${drag?.target.kind === "bin" ? " canvas-bin--over" : ""}`}
          aria-expanded={trayOpen}
          aria-controls="canvas-tray"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setTrayOpen((open) => !open)}
        >
          <span aria-hidden className="canvas-bin__icon">
            <BinIcon />
          </span>
          Discarded
          <span className="canvas-bin__count">{board.discarded.length}</span>
        </button>
        {trayOpen && (
          <div
            id="canvas-tray"
            role="region"
            aria-label="Discard bin"
            className="canvas-tray materialize"
            data-scrolls
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setTrayOpen(false);
              bin.current?.focus();
            }}
          >
            <div className="row spread">
              <p className="t-footnote strong">Discard bin</p>
              <button type="button" className="btn btn--small btn--plain" onClick={() => setTrayOpen(false)}>
                Done
              </button>
            </div>
            {discarded.length === 0 ? (
              <p className="t-caption muted">Nothing discarded. A card dropped here, or discarded by its button, waits here to be restored.</p>
            ) : (
              <ul className="list-plain canvas-tray__list">
                {discarded.map((model) => (
                  <li key={model.cardId} className="canvas-tray__row">
                    <div className="canvas-tray__what">
                      <p className="t-caption faint">{model.kind === "finding" ? `Finding · ${model.category}` : `Excerpt · ${model.documentKind ?? model.documentName}, page ${model.page}`}</p>
                      <p className="t-footnote canvas-tray__text">{model.kind === "finding" ? model.title : model.quote}</p>
                    </div>
                    <button type="button" className="btn btn--small" onClick={() => actions.restore(model.cardId)}>
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="t-caption faint">Discarding rejects a card from the canvas. The finding it shows is untouched.</p>
          </div>
        )}

        <CanvasStatus events={log} />

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
        focused, the arrow keys pan, + and − zoom, 0 fits everything and 1 is actual size. Drag a card to pin it
        somewhere, or onto the bin to discard it; each card&apos;s buttons do the same.
      </p>
      {sheet && <CitationSheet events={log} citation={sheet.citation.citation} label={sheet.label} onClose={() => setSheet(null)} />}
    </section>
  );
}

// The plan region's frame: its heading, a heading per category, a target per authority, and a label over
// each group of docked cards. All placed in world coordinates from lib/plan-region.ts; the cards in it are
// the canvas's own cards, so docking one moves the very card into its slot rather than drawing a copy.
// While a card is held, the slots it may go in light up, and the one under the pointer is marked.
function PlanRegion({ plan, drag }: { plan: PlanLayout; drag: { target: DropTarget; categories: readonly FindingCategory[] } | null }) {
  const docked = plan.cards.size;
  const at = (r: Rect) => ({ transform: placeAt(r), width: r.w, height: r.h });
  return (
    <>
      <section className="plan" style={at(plan.bounds)} aria-label="Plan: the reportable set">
        <div className="plan__head">
          <h2 className="t-headline">Plan</h2>
          <p className="t-caption muted">{docked === 0 ? "Drop or dock cards here to report them." : `The reportable set · ${docked} card${docked === 1 ? "" : "s"}`}</p>
        </div>
      </section>
      {plan.categories.map(({ category, heading }) => (
        <p key={category} className="t-eyebrow plan__category" style={at(heading)}>
          {categoryLabel(category)}
        </p>
      ))}
      {plan.slots.map(({ slot, target, group, count }) => {
        const key = `${slot.category}:${slot.authority}`;
        const valid = drag !== null && drag.categories.includes(slot.category);
        const over = drag?.target.kind === "slot" && drag.target.slot.category === slot.category && drag.target.slot.authority === slot.authority;
        const state = over ? (valid ? " plan__target--over" : " plan__target--refused") : valid ? " plan__target--open" : "";
        return (
          <div key={key} aria-hidden>
            <div className={`plan__target${count > 0 ? " plan__target--filled" : ""}${state}`} style={at(target)}>
              {DOCUMENT_KIND_LABELS[slot.authority]}
              {count > 0 && <span className="plan__count">{count}</span>}
            </div>
            {group && (
              <p className="t-caption strong plan__group" style={at({ ...group, h: 20 })}>
                {DOCUMENT_KIND_LABELS[slot.authority]}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

const NO_SLOT = "No finding cites this passage, so it has no place in the plan";
const NO_RECORDING =
  "The recorded case has no model behind it, and no find-similar run was recorded from this card. On a live case it runs the model.";

// Where a card is on screen right now, in world units: its slot's transform as the browser is drawing it,
// which differs from the slot while it is still settling into it.
function presented(el: HTMLElement): Point | null {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return null;
  const m = new DOMMatrixReadOnly(transform);
  return { x: m.m41, y: m.m42 };
}

function BinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11M6.5 4V2.75h3V4M4 4l.75 9.25h6.5L12 4" />
    </svg>
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
      // A list floating over the canvas scrolls itself; it is not the canvas being panned.
      if (event.target instanceof Element && event.target.closest("[data-scrolls]")) return;
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
