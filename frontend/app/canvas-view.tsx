"use client";

import { type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeFindings,
  type CardId,
  CardOperationRequest,
  type Disposition,
  dispositionOf,
  type FindingCategory,
  findingIdOfCard,
  type PlanGroup,
  type SlimEvent,
  type WorldPos,
} from "@qryvox/shared";
import Link from "next/link";
import { categoryLabel } from "../lib/board";
import { type CardCitation, type CardModel, cardModel, dockableCategories, DOCUMENT_KIND_LABELS, naturalSlot } from "../lib/canvas-cards";
import { type DropTarget, resolveDrop } from "../lib/canvas-drop";
import { canvasLayout } from "../lib/canvas-layout";
import { CARD_W } from "../lib/tiling";
import { type PlanLayout, planHit } from "../lib/plan-region";
import { type CanvasMode, type CanvasView as View, canvasView } from "../lib/canvas-source";
import { candidatesOf, hasRecording, planSimilar, playback, similarFailure, similarRequest } from "../lib/canvas-similar";
import { appendOp, type CanvasLog, canvasLog, type CardOp, reread, rolledBack, sent, settled, shownLog } from "../lib/canvas-store";
import { changeDisposition, fetchEvents, recordCardOperation, runStep } from "../lib/api";
import { DISPOSITION_LABEL, keyIntent } from "../lib/disposition";
import { errorMessage } from "../lib/errors";
import {
  centreOn,
  fitTo,
  glide,
  gridStyle,
  IDENTITY,
  panBy,
  pinch as pinchViewport,
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
import { Sheet } from "./ui";

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
// How long a finger is held still on a card before the card is picked up, as a long press is elsewhere.
const LONG_PRESS = 450;

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

// The analyst's decision on a finding, made from its card (#59). The same decision as the Review console's:
// on a live case it is posted to the dispositions endpoint and the log is read again, so what the card then
// shows is what the log records; on the fixture it is appended in this tab, like a card operation. The event
// id is kept for a decision that did not arrive, so pressing again is a retry that appends nothing twice.
function useDecide(mode: CanvasMode, store: Store, say: (words: string) => void, claimOf: (findingId: string) => string) {
  const [deciding, setDeciding] = useState<ReadonlySet<CardId>>(new Set());
  const unsent = useRef(new Map<string, string>());
  const { update, refresh } = store;
  const decide = useCallback(
    async (cardId: CardId, disposition: Disposition) => {
      const findingId = findingIdOfCard(cardId);
      if (findingId === null) return;
      const key = `${findingId}:${disposition}`;
      const eventId = unsent.current.get(key) ?? crypto.randomUUID();
      unsent.current.set(key, eventId);
      setDeciding((s) => new Set(s).add(cardId));
      try {
        if (mode.kind === "fixture") {
          const op = { type: "disposition.changed", payload: { finding_id: findingId, disposition } } as const;
          update((log) => ({ ...log, confirmed: appendOp(log.confirmed, op, { eventId, at: new Date().toISOString() }) }));
        } else {
          await changeDisposition(mode.caseId, { event_id: eventId, finding_id: findingId, disposition });
          await refresh();
        }
        unsent.current.delete(key);
        say(`${DISPOSITION_LABEL[disposition]} — ${claimOf(findingId)}`);
      } catch (cause) {
        // A refusal usually means the log moved on (a later run superseded the finding): read it again.
        say(`Not recorded: ${errorMessage(cause)}`);
        await refresh().catch(() => undefined);
      } finally {
        setDeciding((s) => new Set([...s].filter((id) => id !== cardId)));
      }
    },
    [mode, update, refresh, say, claimOf],
  );
  return { decide, deciding };
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
  // Both layouts, wide and narrow (#61): the frame's width picks one, and the first fit has to know the
  // bounds of whichever it picks before anything is drawn.
  const layouts = useMemo(() => ({ wide: canvasLayout(view), narrow: canvasLayout(view, { narrow: true }) }), [view]);
  const bounds = useMemo(() => ({ wide: layouts.wide.bounds, narrow: layouts.narrow.bounds }), [layouts]);
  const frame = useRef<HTMLDivElement | null>(null);
  const bin = useRef<HTMLButtonElement | null>(null);
  const planButton = useRef<HTMLButtonElement | null>(null);
  const { viewport, ready, narrow, fit, zoom, reset, reveal, release, gestures } = useViewport(frame, bounds);
  const layout = narrow ? layouts.narrow : layouts.wide;
  // The viewport as it now is, for a long press that picks a card up a while after it went down.
  const seen = useRef(viewport);
  useEffect(() => {
    seen.current = viewport;
  }, [viewport]);
  const [sheet, setSheet] = useState<{ citation: CardCitation; label: string } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const hint = "canvas-hint";
  const board = view.state.board;
  const pinnedCount = layout.flow.filter((p) => p.pinned).length;
  const dockedCount = layouts.wide.docked.length;
  const models = useMemo(() => new Map(view.cards.map((card) => [card.cardId, cardModel(card, view.state)])), [view]);
  const discarded = board.discarded.flatMap((d) => models.get(d.cardId) ?? []);

  // The cards' actions read the latest layout through a ref, so they keep one identity across renders and
  // a pan, which re-renders the canvas every frame, never re-renders a card.
  const latest = useRef({ view, layout });
  useEffect(() => {
    latest.current = { view, layout };
  }, [view, layout]);
  const claimOf = useCallback((findingId: string) => latest.current.view.state.findings.find((f) => f.finding_id === findingId)?.claim ?? "the finding", []);
  const { decide, deciding } = useDecide(mode, store, say, claimOf);
  // The board's decisions, counted as the Review console counts them: every finding in play, decided or not.
  const decisions = useMemo(() => {
    const decided = activeFindings(view.state).map((f) => dispositionOf(view.state, f.finding_id)?.disposition ?? null);
    return {
      approved: decided.filter((d) => d === "approved").length,
      dismissed: decided.filter((d) => d === "dismissed").length,
      undecided: decided.filter((d) => d === null).length,
    };
  }, [view]);
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
        say("Discarded from the canvas. The finding is not dismissed; restore the card from the bin.");
      },
      restore(id) {
        dispatch({ type: "card.restored", payload: { card_id: id } });
        say("Restored to the canvas.");
      },
      similar: (id) => void similar(id),
      decide: (id, disposition) => void decide(id, disposition),
      openCitation: (citation, label) => setSheet({ citation, label }),
      reveal(id) {
        const rect = rectOf(id);
        if (rect) reveal(rect);
      },
    };
  }, [decide, dispatch, reveal, say, similar]);

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
  // it there, a slot of the plan region in the card's category docks it there (on a phone, the Plan button
  // docks it in its own slot), and anything else sends it back to where it came from, on the same curve it
  // would have settled on. With a mouse or a pen a press becomes a drag after a few pixels, so a click on a
  // card is still a click. A finger on a card pans the canvas like a finger anywhere else (#61), until it is
  // held still for a moment: then the card is picked up under it, and from there it drags the same way.
  const [drag, setDrag] = useState<{ id: CardId; at: WorldPos; target: DropTarget; categories: readonly FindingCategory[] } | null>(null);
  const press = useRef<{
    id: CardId;
    pointer: number;
    touch: boolean;
    // Where the pointer came down and where it is now, in the frame's coordinates.
    start: Point;
    last: Point;
    grab: Point;
    // Where the card became the pointer's to drag: the press, or for a finger the moment it was picked up.
    armedAt: Point | null;
    moving: boolean;
    timer: number | null;
  } | null>(null);
  const frameAt = (event: { clientX: number; clientY: number }): Point => {
    const box = frame.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const local = (event: PointerEvent) => toWorld(viewport, frameAt(event));
  // What the pointer is over: the bin, the Plan button on a phone, a slot of the plan or the plan between
  // slots, open canvas (where the card's own corner is what would be pinned), or none of the canvas at all.
  const targetOf = (event: PointerEvent, corner: WorldPos, id: CardId): DropTarget => {
    const inside = (el: Element | null) => {
      const box = el?.getBoundingClientRect();
      return !!box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    };
    if (inside(bin.current)) return { kind: "bin" };
    if (narrow && inside(planButton.current)) {
      const card = view.cards.find((c) => c.cardId === id);
      return { kind: "dock", slot: card ? naturalSlot(card, view) : null };
    }
    if (!inside(frame.current)) return { kind: "outside" };
    return (narrow ? null : planHit(layout.plan, local(event))) ?? { kind: "canvas", at: corner };
  };
  const categoriesOf = (id: CardId) => {
    const card = view.cards.find((c) => c.cardId === id);
    return card ? dockableCategories(card, view) : [];
  };
  // The Review console's keys, on the finding card in focus (#59, lib/disposition.ts): A approves, D
  // dismisses, J and K (or ↓ and ↑) move to the next or previous finding card, in the order they are laid
  // out. A key typed into a field is the field's, and an excerpt card has no finding to decide.
  const cardKey = (event: KeyboardEvent<HTMLDivElement>, id: CardId) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
    if (findingIdOfCard(id) === null) return;
    const intent = keyIntent({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey });
    if (!intent) return;
    event.preventDefault();
    if (intent === "approve" || intent === "dismiss") return actions.decide(id, intent === "approve" ? "approved" : "dismissed");
    const order = [...(narrow ? [] : layout.docked), ...layout.flow].filter((p) => p.card.kind === "finding");
    const at = order.findIndex((p) => p.card.cardId === id);
    if (at < 0 || order.length === 0) return;
    const next = order[(at + (intent === "next" ? 1 : -1) + order.length) % order.length]!;
    event.currentTarget.closest(".canvas")?.querySelector<HTMLElement>(`[data-finding-card="${CSS.escape(next.card.cardId)}"]`)?.focus({ preventScroll: true });
    reveal(next.rect);
  };

  const cardGesture = (id: CardId, rect: Rect) => ({
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      const touch = event.pointerType === "touch";
      // With a mouse or a pen a card is a thing of its own: pressing it never pans the background behind it.
      // A finger is left to the canvas, which pans under it until the card is picked up.
      if (!touch) event.stopPropagation();
      if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
      // Grabbed while still settling: it is picked up from where it is on screen, not from its slot.
      const el = event.currentTarget;
      const shown = presented(el) ?? rect;
      const at = local(event);
      const p = {
        id,
        pointer: event.pointerId,
        touch,
        start: frameAt(event),
        last: frameAt(event),
        grab: { x: at.x - shown.x, y: at.y - shown.y },
        armedAt: touch ? null : frameAt(event),
        moving: false,
        timer: null as number | null,
      };
      press.current = p;
      if (!touch) {
        el.setPointerCapture(event.pointerId);
        return;
      }
      p.timer = window.setTimeout(() => {
        p.timer = null;
        // Only a finger still alone and still where it came down picks a card up: one that has been panning,
        // or is half of a pinch, keeps doing that.
        if (press.current !== p || !release(p.pointer)) {
          if (press.current === p) press.current = null;
          return;
        }
        const corner = presented(el) ?? rect;
        const under = toWorld(seen.current, p.last);
        p.grab = { x: under.x - corner.x, y: under.y - corner.y };
        p.armedAt = p.last;
        try {
          el.setPointerCapture(p.pointer);
        } catch {
          // A finger already lifted cannot be captured; its pointerup has the card back in place.
        }
        // A tick under the finger where the hardware has one: the card is in the hand now.
        navigator.vibrate?.(8);
        setDrag({ id, at: corner, target: { kind: "canvas", at: corner }, categories: categoriesOf(id) });
      }, LONG_PRESS);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const p = press.current;
      if (!p || p.pointer !== event.pointerId) return;
      p.last = frameAt(event);
      // A finger not yet holding the card is the canvas's pan, which the frame is following; once it has
      // gone further than a press wanders, it is not going to pick the card up.
      if (!p.armedAt) {
        if (p.timer !== null && Math.hypot(p.last.x - p.start.x, p.last.y - p.start.y) > SLOP) {
          window.clearTimeout(p.timer);
          press.current = null;
        }
        return;
      }
      if (!p.moving && Math.hypot(p.last.x - p.armedAt.x, p.last.y - p.armedAt.y) < 6) return;
      p.moving = true;
      const at = local(event);
      const corner = { x: at.x - p.grab.x, y: at.y - p.grab.y };
      setDrag({ id, at: corner, target: targetOf(event, corner, id), categories: categoriesOf(id) });
    },
    onPointerUp() {
      const p = press.current;
      press.current = null;
      if (p?.timer) window.clearTimeout(p.timer);
      // Picked up and put straight back down, or never picked up at all: nothing happened to it.
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
      const p = press.current;
      if (p?.timer) window.clearTimeout(p.timer);
      press.current = null;
      setDrag(null);
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      cardKey(event, id);
    },
    // A finger held on a card is picking it up, not asking for the page's menu.
    onContextMenu(event: MouseEvent<HTMLDivElement>) {
      if (press.current?.touch) event.preventDefault();
    },
  });

  return (
    <section className="section canvas-section" aria-label="Canvas">
      <div className="row spread canvas-summary">
        <p className="t-footnote muted">
          {[
            counted(layout.flow.length, "card on the canvas", "cards on the canvas"),
            pinnedCount > 0 ? `${pinnedCount} pinned` : null,
            dockedCount > 0 ? `${dockedCount} docked to the plan` : null,
            board.discarded.length > 0 ? `${board.discarded.length} discarded` : null,
            `${decisions.approved} approved · ${decisions.dismissed} dismissed · ${decisions.undecided} undecided`,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        <p className={`t-footnote ${said ? "" : "faint"}`} role="status">
          {said ?? (mode.kind === "fixture" ? "Card operations and decisions stay in this tab: a reload starts the recorded case over." : null)}
        </p>
      </div>
      {/* A case opens here (#59), before anything has run on it: the steps are run from Review. */}
      {view.cards.length === 0 && mode.kind === "live" && (
        <div className="notice notice--tint canvas-empty">
          <p className="t-callout">
            No findings on this case yet. Run the steps on Review, and each finding arrives here as a card, with the passages it
            cites. <Link href={`/cases/${mode.caseId}`}>Run the steps on Review →</Link>
          </p>
        </div>
      )}
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
        data-narrow={narrow ? "true" : undefined}
        {...gestures}
      >
        <div className="canvas__world" style={{ transform: worldTransform(viewport) }}>
          {/* Nothing is dealt until the frame has a size and the world is fitted to it, so the cards
              arrive where they will stay instead of arriving and then jumping to fit. */}
          {ready && !narrow && <PlanRegion plan={layout.plan} drag={drag} />}
          {ready &&
            [...(narrow ? [] : layout.docked.map((p) => ({ ...p, docked: true }))), ...layout.flow.map((p) => ({ ...p, docked: false }))].map(
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
                        deciding={deciding.has(card.cardId)}
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
          aria-label={`Discarded, ${board.discarded.length}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setTrayOpen((open) => !open)}
        >
          <span aria-hidden className="canvas-bin__icon">
            <BinIcon />
          </span>
          <span className="canvas-bin__label">Discarded</span>
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
            <p className="t-caption faint">
              Discarding only tidies the canvas: the finding is not dismissed, and its decision stays as it was. To dismiss a
              finding, press Dismiss on its card.
            </p>
          </div>
        )}

        {/* On a phone the plan and the status panel are not laid over the cards: each is a button along
            the top that opens a sheet, and the Plan button takes a dropped card as the plan region does. */}
        {narrow ? (
          <div className="canvas__top" onPointerDown={(event) => event.stopPropagation()}>
            <button
              ref={planButton}
              type="button"
              className={`canvas-bin canvas-plan${drag ? " canvas-plan--armed" : ""}${drag?.target.kind === "dock" ? " canvas-plan--over" : ""}`}
              aria-haspopup="dialog"
              onClick={() => setPlanOpen(true)}
            >
              Plan
              <span className="canvas-bin__count">{dockedCount}</span>
            </button>
            <CanvasStatus events={log} sheet />
          </div>
        ) : (
          <CanvasStatus events={log} />
        )}

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
        Drag the background to move around, or one finger anywhere. Scroll to pan; hold ⌘ or Ctrl and scroll, or pinch with
        two fingers, to zoom. With the canvas focused, the arrow keys pan, + and − zoom, 0 fits everything and 1 is actual
        size. Drag a card (on a touch screen, hold it a moment first) to pin it somewhere, onto the bin to discard it, or
        onto the plan to dock it; each card&apos;s buttons do the same. Approve and Dismiss on a finding card are your
        decision on the finding, recorded on the case as on Review; with a finding card focused, A approves, D dismisses,
        and J or K (↓ or ↑) move to the next or previous finding. Discard is different: it only takes a card off the
        canvas, and decides nothing.
      </p>
      {planOpen && <PlanSheet groups={layouts.wide.groups} models={models} onUndock={actions.undock} onClose={() => setPlanOpen(false)} />}
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

// The plan on a phone (#61): the reportable set as a list in a sheet, grouped the way the plan region
// groups it, by category and then by the authority of the document each card is reported under. A card
// leaves it by Undock, back into the flow; it arrives by its Dock button or by being dropped on Plan.
function PlanSheet({
  groups,
  models,
  onUndock,
  onClose,
}: {
  groups: readonly PlanGroup[];
  models: ReadonlyMap<CardId, CardModel>;
  onUndock: (id: CardId) => void;
  onClose: () => void;
}) {
  const count = groups.reduce((n, g) => n + g.cards.length, 0);
  return (
    <Sheet title="Plan" onClose={onClose}>
      <p className="t-footnote muted">{count === 0 ? "The reportable set is empty." : `The reportable set · ${count} card${count === 1 ? "" : "s"}`}</p>
      {count === 0 ? (
        <p className="t-callout muted plan-sheet__empty">Drag a card onto Plan, or press its Dock button, to report it.</p>
      ) : (
        groups.map((group) => (
          <section key={`${group.category}:${group.authority}`} className="plan-sheet__group" aria-label={`${categoryLabel(group.category)}, ${DOCUMENT_KIND_LABELS[group.authority]}`}>
            <p className="t-eyebrow">
              {categoryLabel(group.category)} · {DOCUMENT_KIND_LABELS[group.authority]}
            </p>
            <ul className="list-plain canvas-tray__list">
              {group.cards.flatMap((docked) => {
                const model = models.get(docked.cardId);
                if (!model) return [];
                return (
                  <li key={docked.cardId} className="canvas-tray__row">
                    <div className="canvas-tray__what">
                      <p className="t-caption faint">{model.kind === "finding" ? `Finding · ${model.severityLabel}` : `Excerpt · ${model.documentKind ?? model.documentName}, page ${model.page}`}</p>
                      <p className="t-footnote canvas-tray__text">{model.kind === "finding" ? model.title : model.quote}</p>
                    </div>
                    <button type="button" className="btn btn--small" onClick={() => onUndock(docked.cardId)}>
                      Undock
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Sheet>
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
//
// Pointer Events throughout, so a mouse, a pen and a finger are one code path (#61). One pointer down on
// the background pans; a second one turns the gesture into a pinch about the two fingers' midpoint
// (lib/viewport.ts pinch), and lifting either finger goes back to panning under the one left, without a
// jump. A finger is tracked on whatever it landed on (touch pointers are captured there by the browser), so
// a pan may start on a card; a pan that started on a card's button does not then press it.
//
// The frame's own width decides the layout: narrower than NARROW_BELOW, it is a phone's (one column of
// cards, the plan and the status panel in sheets), and crossing that width fits the canvas afresh.
const NARROW_BELOW = 640;
// How far a press may wander and still be a press, in screen pixels: a long press that moved further than
// this was a pan, and a pan that moved further than this does not press what it started on.
const SLOP = 10;
// The phone's top bar, in screen pixels at life size: the first view starts the cards below it.
const TOP_BAR = 60;

type Bounds = { wide: Rect | null; narrow: Rect | null };

function useViewport(frame: RefObject<HTMLDivElement | null>, bounds: Bounds) {
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [ready, setReady] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const size = useRef<Size>({ width: 0, height: 0 });
  // What a fit fits, for the observer and the keyboard, which outlive any one render.
  const content = useRef(bounds);
  useEffect(() => {
    content.current = bounds;
  }, [bounds]);
  const isNarrow = useRef(false);
  // The viewport as it now is, for a pinch, which starts from it.
  const live = useRef(viewport);
  useEffect(() => {
    live.current = viewport;
  }, [viewport]);
  const fitted = useRef(false);
  // Every pointer down on the canvas, where it is now in frame coordinates; the pan, if one pointer is
  // moving the world; the pinch, if two are.
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<{ id: number; start: Point; last: Point; history: { t: number; x: number; y: number }[] } | null>(null);
  const pinching = useRef<{ ids: [number, number]; start: Viewport; from: [Point, Point] } | null>(null);
  // Whether the gesture just ended moved far enough that the click it ends with is not a press.
  const travelled = useRef(false);
  const frameId = useRef<number | null>(null);

  const stopGlide = () => {
    if (frameId.current !== null) cancelAnimationFrame(frameId.current);
    frameId.current = null;
  };

  // The whole of the content in view. The first view is no smaller than a card can be read at, and on a
  // touch screen it is life size wherever a card fits across at life size, so the cards' buttons are a
  // finger's 44 points (#61). On a phone the margin is the screen's own, with room left at the top for
  // the bar the Plan and Activity buttons float in. Fit, asked for, shows everything.
  const fitWith = useCallback((first: boolean) => {
    const narrowNow = isNarrow.current;
    const content_ = narrowNow ? content.current.narrow : content.current.wide;
    const { width } = size.current;
    if (!content_ || width === 0) return;
    const padding = narrowNow ? 16 : 48;
    const rect = narrowNow ? { ...content_, y: content_.y - TOP_BAR, h: content_.h + TOP_BAR } : content_;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const readable = touch || narrowNow ? Math.min(1, (width - 2 * padding) / CARD_W) : 0.7;
    setViewport(fitTo(rect, size.current, { padding, maxZoom: 1, minZoom: first ? Math.max(0.7, readable) : undefined }));
  }, []);
  const fit = useCallback(() => {
    stopGlide();
    fitWith(false);
  }, [fitWith]);

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

  // The frame's size, the layout its width calls for, and a fit whenever there is a first size to fit to
  // or the layout changed under it (a phone turned on its side).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // On a phone the canvas is as tall as the screen has room for below the case's heading
    // (globals.css), so its zoom controls and bin are on screen without scrolling: the stylesheet is told
    // where in the page the canvas starts.
    const placeFrame = () => el.style.setProperty("--canvas-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    placeFrame();
    window.addEventListener("resize", placeFrame);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      size.current = { width: entry.contentRect.width, height: entry.contentRect.height };
      const nowNarrow = entry.contentRect.width < NARROW_BELOW;
      const changed = nowNarrow !== isNarrow.current;
      isNarrow.current = nowNarrow;
      if (changed) setNarrow(nowNarrow);
      if (!fitted.current || changed) {
        fitWith(true);
        fitted.current = true;
        setReady(true);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", placeFrame);
    };
  }, [frame, fitWith]);

  // The wheel, natively: React's wheel listener is passive, and a canvas that zooms must stop the page
  // from scrolling (and the browser from zooming the whole page on a pinch) underneath it. Safari's own
  // pinch events are refused for the same reason: the canvas's pinch is the Pointer Events one below.
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
    const onGesture = (event: Event) => event.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture);
    };
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

  const local = (event: PointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const panFrom = (id: number, at: Point, t: number) => {
    pan.current = { id, start: at, last: at, history: [{ t, ...at }] };
  };
  const endPan = (el: HTMLElement) => {
    pan.current = null;
    delete el.dataset.panning;
  };

  // A long press on a card asks for its finger (#61): granted only while that finger is still the one
  // panning, alone and within the slop of where it came down, so a drag of a card never starts out of a pan
  // or a pinch already under way. Granted, the canvas lets go of that finger and the card has it.
  const release = useCallback((id: number): boolean => {
    const p = pan.current;
    if (!p || p.id !== id || pinching.current || Math.hypot(p.last.x - p.start.x, p.last.y - p.start.y) > SLOP) return false;
    pointers.current.delete(id);
    pan.current = null;
    delete frame.current?.dataset.panning;
    return true;
  }, [frame]);

  const lift = (event: PointerEvent<HTMLDivElement>) => {
    const id = event.pointerId;
    if (!pointers.current.delete(id)) return;
    const pinch = pinching.current;
    if (pinch?.ids.includes(id)) {
      // One finger of a pinch lifted: the other carries on as a pan from where it is, with no speed to
      // carry (a pinch is let go of, not thrown).
      pinching.current = null;
      const [other] = [...pointers.current.entries()];
      if (other) panFrom(other[0], other[1], event.timeStamp);
      else endPan(event.currentTarget);
      return;
    }
    const p = pan.current;
    if (!p || p.id !== id) return;
    endPan(event.currentTarget);
    if (event.type === "pointercancel") return;
    const first = p.history[0]!;
    const last = p.history.at(-1)!;
    const dt = (last.t - first.t) / 1000;
    // A hand that stopped before letting go has no speed left to carry.
    if (dt > 0 && event.timeStamp - last.t < 60) coast({ x: (last.x - first.x) / dt, y: (last.y - first.y) / dt });
  };

  const gestures = {
    // Before anything inside sees the press: a new gesture has not travelled yet.
    onPointerDownCapture() {
      travelled.current = false;
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      stopGlide(); // Caught mid-glide: it stops under the hand.
      // A mouse is captured here so a pan carries on off the frame; a finger is already captured by what it
      // landed on, and capturing it here would take a tap away from a card's button.
      if (event.pointerType === "mouse") event.currentTarget.setPointerCapture(event.pointerId);
      // The first finger of a new touch, or any mouse press, starts afresh: a pointer whose lift was never
      // heard (its element left the page under it) must not turn the next touch into a pinch.
      if (event.isPrimary) {
        pointers.current.clear();
        pinching.current = null;
      }
      const at = local(event);
      pointers.current.set(event.pointerId, at);
      event.currentTarget.dataset.panning = "true";
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.entries()];
        pinching.current = { ids: [a![0], b![0]], start: live.current, from: [a![1], b![1]] };
        pan.current = null;
        travelled.current = true;
      } else if (pointers.current.size === 1) panFrom(event.pointerId, at, event.timeStamp);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!pointers.current.has(event.pointerId)) return;
      const at = local(event);
      pointers.current.set(event.pointerId, at);
      const pinch = pinching.current;
      if (pinch) {
        const [a, b] = pinch.ids.map((id) => pointers.current.get(id));
        if (a && b) setViewport(pinchViewport(pinch.start, pinch.from, [a, b]));
        return;
      }
      const p = pan.current;
      if (!p || p.id !== event.pointerId) return;
      const dx = at.x - p.last.x;
      const dy = at.y - p.last.y;
      p.last = at;
      if (Math.hypot(at.x - p.start.x, at.y - p.start.y) > SLOP) travelled.current = true;
      p.history = [...p.history.filter((h) => event.timeStamp - h.t < 100), { t: event.timeStamp, ...at }];
      setViewport((v) => panBy(v, dx, dy));
    },
    onPointerUp: lift,
    onPointerCancel: lift,
    // A pan that began on a card's button ends with a click on it, which is not the analyst pressing it.
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!travelled.current) return;
      travelled.current = false;
      event.preventDefault();
      event.stopPropagation();
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

  return { viewport, ready, narrow, fit, zoom, reset, reveal, release, gestures };
}
