import { describe, expect, it } from "vitest";
import { ANALYST_ACTOR, dispositionOf, fold, type Disposition, SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { dispositionConsole, keyAction, KEY_BINDINGS, type ConsoleState } from "../lib/disposition";

// The console on the recorded case, folded in the browser exactly as it folds it: no model call, no store,
// nothing but the log (ADR-0002). The fixture is a whole pipeline run — extract failing once and retried,
// then the findings run twice — with nobody in the room, which makes it the honest starting point for every
// assertion here: a case that has flagged six findings and decided nothing.

const events = SlimEvent.array().parse(recorded);
const caseId = events[0]!.case_id;
const lastSeq = events.at(-1)!.seq;
const lastRunId = events.filter((event) => event.type === "finding.created").at(-1)!.step_run_id;

// The active board in the order the console lists it: severity, then category, then which run put it up.
const order = [
  "121e3360-f043-440c-bc52-d5d5af60b013",
  "f882ed39-8ec6-40e6-b9aa-f16dc65b456e",
  "518879f9-0d7d-46f4-a8f5-c4d03f503086",
  "89988d49-f182-4980-940e-4d4f08fc99a5",
  "bddc2112-420d-4150-a372-4322763179aa",
  "fee4f239-b1d9-4adf-a65b-01e33532aa2d",
] as const;
const [first, second, third, risk, strategy, terms] = order;

// The finding the re-run replaced: off the board, still in the log, and still the record of a decision.
const superseded = "73aaa3f9-7758-4a7b-b944-a0cb2420f512";

// One disposition.changed appended to the recorded stream, at the next free seq. The recorded fixture holds
// no disposition at all, so a fold test has to append them by hand; that is the whole of what this file
// does to the log, and each stands for an event the analyst asked for and nobody else.
function decided(...decisions: readonly { findingId: string; disposition: Disposition }[]): SlimEvent[] {
  return [
    ...events,
    ...decisions.map(({ findingId, disposition }, index) =>
      SlimEvent.parse({
        seq: lastSeq + index + 1,
        event_id: `00000000-0000-4000-8000-${String(lastSeq + index + 1).padStart(12, "0")}`,
        case_id: caseId,
        actor: ANALYST_ACTOR,
        at: `2026-10-02T12:0${index}:00.000Z`,
        step_run_id: null,
        type: "disposition.changed",
        v: 1,
        payload: { finding_id: findingId, disposition },
      }),
    ),
  ];
}

// The one event a run could append that would be easy to mistake for a verdict: a later findings run
// replacing this one. It carries no disposition, and nothing may infer one from it.
function supersede(log: readonly SlimEvent[], findingId: string): SlimEvent {
  const seq = log.at(-1)!.seq + 1;
  return SlimEvent.parse({
    seq,
    event_id: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`,
    case_id: caseId,
    actor: ANALYST_ACTOR,
    at: "2026-10-02T13:00:00.000Z",
    step_run_id: lastRunId,
    type: "finding.superseded",
    v: 1,
    payload: { finding_id: findingId },
  });
}

const nothing: ConsoleState = { focusedFindingId: null };
const at = (findingId: string): ConsoleState => ({ focusedFindingId: findingId });
const ids = (log: readonly SlimEvent[]) => dispositionConsole(log).rows.map((row) => row.card.findingId);
const decisionsOf = (log: readonly SlimEvent[]) =>
  dispositionConsole(log).rows.map((row) => [row.card.findingId, row.decision]);

describe("the disposition console", () => {
  it("gives every active finding a row and leaves it undecided until an analyst says otherwise", () => {
    const view = dispositionConsole(events);

    expect(ids(events)).toEqual(order);
    // This log flags six findings, fails a step, retries it and re-runs findings: and decides nothing.
    expect(decisionsOf(events)).toEqual(order.map((findingId) => [findingId, null]));
    expect(view.rows[0]).toMatchObject({ decision: null, decidedBy: null, decidedAt: null, decidedAtSeq: null });
    expect(view).toMatchObject({ approved: 0, dismissed: 0, undecided: 6 });
  });

  it("marks a decision with who made it and when, read off the event that recorded it", () => {
    const view = dispositionConsole(decided({ findingId: first, disposition: "approved" }));

    expect(view.rows[0]).toMatchObject({
      decision: "approved",
      // Stage 1 has one analyst identity and no picker (spec decision 9), and the log says so itself.
      decidedBy: ANALYST_ACTOR,
      decidedAt: "2026-10-02T12:00:00.000Z",
      decidedAtSeq: lastSeq + 1,
    });
    expect(view).toMatchObject({ approved: 1, dismissed: 0, undecided: 5 });
  });

  it("keeps a dismissed finding on the console, marked dismissed rather than taken away", () => {
    const log = decided({ findingId: second, disposition: "dismissed" });
    const view = dispositionConsole(log);

    // Still there, in the same place, with its claim: a dismissal is a decision to be shown, not a card to
    // be hidden once it has been dealt with.
    expect(ids(log)).toEqual(order);
    expect(view.rows[1]).toMatchObject({
      decision: "dismissed",
      decidedBy: ANALYST_ACTOR,
      card: { claim: expect.stringContaining("exit charges") },
    });
    expect(view).toMatchObject({ approved: 0, dismissed: 1, undecided: 5 });
  });

  it("takes the latest decision as the state and leaves the earlier one in the log", () => {
    const log = decided(
      { findingId: first, disposition: "approved" },
      { findingId: first, disposition: "dismissed" },
    );

    expect(decisionsOf(log)[0]).toEqual([first, "dismissed"]);
    // Changing a mind is a further decision, not an undo: both are in the log and neither is withdrawn.
    expect(log.filter((event) => event.type === "disposition.changed").map((event) => event.payload)).toEqual([
      { finding_id: first, disposition: "approved" },
      { finding_id: first, disposition: "dismissed" },
    ]);
  });

  it("keeps a superseded finding's decision in the log while the finding leaves the console", () => {
    const log = decided({ findingId: superseded, disposition: "dismissed" });

    expect(ids(log)).not.toContain(superseded);
    expect(dispositionOf(fold(log), superseded)).toMatchObject({ disposition: "dismissed", actor: ANALYST_ACTOR });
  });

  it("takes nothing but a decision as a verdict: a supersede is not a dismissal, either way", () => {
    const approved = decided({ findingId: first, disposition: "approved" });
    const replaced = [...approved, supersede(approved, first)];
    const undecided = [...events, supersede(events, second)];

    // A finding that was decided and is then replaced keeps what it was decided.
    expect(dispositionOf(fold(replaced), first)?.disposition).toBe("approved");
    expect(ids(replaced)).not.toContain(first);
    // A finding nobody decided leaves the board undecided, which is not dismissed.
    expect(dispositionOf(fold(undecided), second)).toBeNull();
    expect(dispositionOf(fold(undecided), second)?.disposition).not.toBe("dismissed");
  });

  it("decides nothing when the categories on change, and holds back what it hides", () => {
    const log = decided(
      { findingId: first, disposition: "approved" },
      { findingId: terms, disposition: "dismissed" },
    );
    const decision: Record<string, Disposition | null> = {
      [first]: "approved",
      [second]: null,
      [third]: null,
      [risk]: null,
      [strategy]: null,
      [terms]: "dismissed",
    };

    // Narrowing what is shown is not a decision, so every decision is the same under any filter.
    expect(decisionsOf(log)).toEqual(order.map((findingId) => [findingId, decision[findingId]]));
    expect(dispositionConsole(log, null, ["fees"]).rows.map((row) => [row.card.findingId, row.decision])).toEqual([
      [first, "approved"],
      [second, null],
    ]);
    expect(dispositionConsole(log, null, ["terms"]).rows.map((row) => [row.card.findingId, row.decision])).toEqual([
      [terms, "dismissed"],
    ]);
  });

  it("puts the analyst on the first row until they move, and back on it when what they held is gone", () => {
    expect(dispositionConsole(events).focused?.index).toBe(0);
    expect(dispositionConsole(events, null).focused?.row.card.findingId).toBe(first);
    expect(dispositionConsole(events, risk).focused).toMatchObject({ index: 3, row: { card: { findingId: risk } } });
    // A focus the log no longer holds falls back to the first row rather than going blank, so the keyboard
    // and the eye are never on different findings.
    expect(dispositionConsole(events, superseded).focused?.row.card.findingId).toBe(first);
    expect(dispositionConsole(events, "not-a-finding").focused?.row.card.findingId).toBe(first);
  });

  it("says which of the emptinesses this is rather than showing a console with nothing on it", () => {
    expect(dispositionConsole(events).notice).toBeNull();
    expect(dispositionConsole(events, null, []).notice).toEqual({
      headline: "No categories selected.",
      detail: "The board holds 6 findings in other categories. Turn a category on to see them.",
    });
    expect(dispositionConsole(events.filter((event) => event.seq < 16)).notice).toEqual({
      headline: "No findings on this case yet.",
      detail: "Nothing has been recorded to the board, so there is nothing to filter.",
    });
  });
});

describe("the keyboard", () => {
  it("approves, dismisses, and steps to the next and previous finding", () => {
    expect(keyAction(nothing, { key: "a" }, events)).toEqual({ kind: "decide", findingId: first, disposition: "approved" });
    expect(keyAction(nothing, { key: "d" }, events)).toEqual({ kind: "decide", findingId: first, disposition: "dismissed" });
    expect(keyAction(at(first), { key: "j" }, events)).toEqual({ kind: "focus", findingId: second });
    expect(keyAction(at(second), { key: "k" }, events)).toEqual({ kind: "focus", findingId: first });
    // The arrows do the same two things, for the analyst who already moves with them.
    expect(keyAction(at(first), { key: "ArrowDown" }, events)).toEqual({ kind: "focus", findingId: second });
    expect(keyAction(at(second), { key: "ArrowUp" }, events)).toEqual({ kind: "focus", findingId: first });
  });

  it("decides whichever finding is in focus, so every finding on the case is reachable by keyboard", () => {
    for (const findingId of order) {
      expect(keyAction(at(findingId), { key: "a" }, events)).toEqual({ kind: "decide", findingId, disposition: "approved" });
      expect(keyAction(at(findingId), { key: "d" }, events)).toEqual({ kind: "decide", findingId, disposition: "dismissed" });
    }
  });

  it("walks the whole console in order and wraps at both ends", () => {
    const walk = (from: string, key: string) => {
      let focused = from;
      const visited: string[] = [];
      for (let i = 0; i < order.length; i += 1) {
        const action = keyAction(at(focused), { key }, events);
        if (action.kind !== "focus") throw new Error(`expected a move, got ${action.kind}`);
        focused = action.findingId;
        visited.push(focused);
      }
      return visited;
    };

    // One full lap from the first row in each direction, coming back round to where it started.
    expect(walk(first, "j")).toEqual([second, third, risk, strategy, terms, first]);
    expect(walk(first, "k")).toEqual([terms, strategy, risk, third, second, first]);
    // A review is a loop: the console wraps rather than stopping dead at either end.
    expect(keyAction(at(terms), { key: "j" }, events)).toEqual({ kind: "focus", findingId: first });
    expect(keyAction(at(first), { key: "k" }, events)).toEqual({ kind: "focus", findingId: terms });
  });

  it("refuses every key it does not own", () => {
    for (const key of ["q", "z", "1", "Escape", "Tab", "Enter", " ", "Backspace", "A", "D", "J", "ArrowLeft", "ArrowRight"]) {
      expect(keyAction(nothing, { key }, events), key).toEqual({ kind: "ignore" });
    }
  });

  it("refuses a shortcut pressed with a modifier, which was somebody else's keystroke", () => {
    for (const modifier of ["ctrl", "meta", "alt"] as const) {
      for (const key of KEY_BINDINGS.flatMap((binding) => binding.keys)) {
        expect(keyAction(nothing, { key, [modifier]: true }, events), `${modifier}+${key}`).toEqual({ kind: "ignore" });
      }
    }
  });

  it("decides nothing on its own: only the two decision keys ask for a decision", () => {
    const asked = KEY_BINDINGS.flatMap((binding) => binding.keys).map((key) => [key, keyAction(at(first), { key }, events)]);

    expect(asked).toEqual([
      ["a", { kind: "decide", findingId: first, disposition: "approved" }],
      ["d", { kind: "decide", findingId: first, disposition: "dismissed" }],
      ["j", { kind: "focus", findingId: second }],
      ["ArrowDown", { kind: "focus", findingId: second }],
      ["k", { kind: "focus", findingId: terms }],
      ["ArrowUp", { kind: "focus", findingId: terms }],
    ]);
    // And the console's own view is unmoved by any of it: a keystroke asks for an event, and only the log
    // can move a finding from undecided to decided.
    expect(decisionsOf(events)).toEqual(order.map((findingId) => [findingId, null]));
  });

  it("decides nothing when there is nothing to decide", () => {
    const empty = events.filter((event) => event.seq < 16);

    for (const key of KEY_BINDINGS.flatMap((binding) => binding.keys)) {
      expect(keyAction(nothing, { key }, empty), key).toEqual({ kind: "ignore" });
    }
  });
});
