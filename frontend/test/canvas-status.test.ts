import { SlimEvent } from "@qryvox/shared";
import { describe, expect, it } from "vitest";
import { fixtureEvents } from "../lib/canvas-source";
import { type RunLine, statusLines } from "../lib/canvas-status";

// The status panel (#58) reads the case's own log: a line per step run, a line per card operation.

const base = fixtureEvents();
const caseId = base[0]!.case_id;

// Step events at the next seqs, as the backend would have appended them.
function withSteps(...steps: { type: "step.started" | "step.completed" | "step.failed"; run: string; payload: Record<string, unknown> }[]) {
  return [
    ...base,
    ...steps.map((s, i) => {
      const seq = base.length + 1 + i;
      return SlimEvent.parse({
        seq,
        event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "3")}`,
        case_id: caseId,
        actor: "demo-analyst",
        at: "2026-10-03T12:00:00.000Z",
        step_run_id: s.run,
        v: 1,
        type: s.type,
        payload: { model: "fake", input_run_id: null, ...s.payload },
      });
    }),
  ];
}

const runs = (lines: ReturnType<typeof statusLines>) => lines.filter((l): l is RunLine => l.kind === "run");

describe("the status panel", () => {
  it("lists the recorded run step by step, in order, with the failed attempt a retry recovered from", () => {
    const lines = runs(statusLines(base));
    expect(lines.map((l) => [l.label, l.status])).toEqual([
      ["Extract statements", "completed"],
      ["Decompose into claims", "completed"],
      ["Cross-check claims", "completed"],
      ["Raise findings", "completed"],
      ["Cross-check claims", "completed"],
      ["Raise findings", "completed"],
    ]);
    expect(lines[0]).toMatchObject({ failedAttempts: 1, lastFailure: "model endpoint unreachable: recorded outage", error: null });
  });

  it("puts every card operation on a line of its own, naming the card", () => {
    const cards = statusLines(base).filter((l) => l.kind === "card");
    expect(cards.map((l) => [l.seq, l.text])).toEqual([
      [28, "Docked to the plan under Fees · Factsheet"],
      [29, "Pinned"],
      [30, "Discarded to the bin"],
    ]);
    expect(cards[0]!.card).toMatch(/^The factsheet states a 0.85% management fee/);
  });

  it("puts a decision made from a finding card on a line too, naming the finding (#59)", () => {
    const finding = base.find((e) => e.type === "finding.created")!;
    if (finding.type !== "finding.created") throw new Error("no finding");
    const seq = base.length + 1;
    const decided = SlimEvent.parse({
      seq,
      event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "5")}`,
      case_id: caseId,
      actor: "demo-analyst",
      at: "2026-10-03T12:00:00.000Z",
      step_run_id: null,
      v: 1,
      type: "disposition.changed",
      payload: { finding_id: finding.payload.finding_id, disposition: "dismissed" },
    });
    expect(statusLines([...base, decided]).at(-1)).toMatchObject({ kind: "card", seq, text: "Dismissed the finding", card: finding.payload.claim });
  });

  it("shows a parse run as a visible step, with the analyst's words and what they came to", () => {
    const lines = runs(
      statusLines(
        withSteps(
          { type: "step.started", run: "p1", payload: { step: "parse", prompt_version: "parse@1", intent: "fee risks in the deck" } },
          { type: "step.completed", run: "p1", payload: { step: "parse", prompt_version: "parse@1", intent: "fee risks in the deck", output: { chips: [{ category: "fees", authority: "deck", step_kind: null }] } } },
          { type: "step.started", run: "p2", payload: { step: "parse", prompt_version: "parse@1", intent: "something" } },
          { type: "step.failed", run: "p2", payload: { step: "parse", prompt_version: "parse@1", intent: "something", error: "the model's chips did not parse" } },
        ),
      ),
    );
    expect(lines.at(-2)).toMatchObject({ label: "Read intent", status: "completed", detail: "“fee risks in the deck”", result: "1 intent chip" });
    // A failed step says why, from its own step.failed.
    expect(lines.at(-1)).toMatchObject({ label: "Read intent", status: "failed", error: "the model's chips did not parse", failedAttempts: 0 });
  });

  it("lists a find-similar run with its seed", () => {
    const seed = { document_id: "deck", page: 2, quote: "No entry or exit charges." };
    const lines = runs(
      statusLines(withSteps({ type: "step.started", run: "s1", payload: { step: "extract", prompt_version: "extract@1", seed } })),
    );
    expect(lines.at(-1)).toMatchObject({ label: "Find similar · Extract statements", status: "running", detail: "More like “No entry or exit charges.”, page 2" });
  });
});
