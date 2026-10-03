import { type SlimEvent } from "@qryvox/shared";
import { STEP_LABELS } from "./pipeline";

// The replay scrubber's arithmetic (#14), apart from the DOM so it can be tested. Replay is folding the
// log to an earlier seq (ADR-0002); everything here is about turning a gesture on a track into that seq,
// the way a physical object would move: 1:1 under the finger, resisting past the ends, carrying momentum
// on release, settling by a spring.

// Where on a track of `width` pixels event `seq` of `count` sits, and back: ticks are spread end to end.
export function positionOf(seq: number, count: number, width: number): number {
  return count <= 1 ? 0 : ((seq - 1) / (count - 1)) * width;
}
export function seqAt(x: number, count: number, width: number): number {
  if (count <= 1 || width <= 0) return 1;
  return Math.min(count, Math.max(1, Math.round((x / width) * (count - 1)) + 1));
}

// Apple's momentum projection (Designing Fluid Interfaces): where a flick released at `velocity` px/s
// would come to rest under scroll-like deceleration. Exponential decay, not v²/2a.
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Past an end the thumb follows less and less, the further it is pulled: resistance, not a wall.
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// The thumb's on-screen position for a pointer at `x`, rubber-banded outside [0, width].
export function tracked(x: number, width: number): number {
  if (x < 0) return -rubberband(-x, width);
  if (x > width) return width + rubberband(x - width, width);
  return x;
}

// One step of a spring with Apple's two parameters: damping ratio (1 = no overshoot) and response (s). It
// animates from wherever the value is now with whatever velocity it has, which is what makes it
// interruptible and lets it inherit a gesture's velocity.
export function springStep(
  state: { x: number; v: number },
  target: number,
  dt: number,
  damping = 1,
  response = 0.35,
): { x: number; v: number } {
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  const a = -stiffness * (state.x - target) - friction * state.v;
  const v = state.v + a * dt;
  return { x: state.x + v * dt, v };
}

// What one event was, in a few words, for the scrubber's caption.
export function describe(event: SlimEvent): string {
  switch (event.type) {
    case "case.opened":
      return "Case opened";
    case "document.ingested":
      return `Document read: ${event.payload.filename}`;
    case "step.started":
      return `${STEP_LABELS[event.payload.step]} started`;
    case "step.completed":
      return `${STEP_LABELS[event.payload.step]} done`;
    case "step.failed":
      return `${STEP_LABELS[event.payload.step]} failed`;
    case "finding.created":
      return `Finding raised: ${event.payload.claim}`;
    case "finding.superseded":
      return "Finding replaced by a later run";
    case "disposition.changed":
      return `Analyst ${event.payload.disposition} a finding`;
    case "client.profiled":
      return `Client answers recorded: ${event.payload.client_id}`;
    case "advice.drafted":
      return `Advice drafted for ${event.payload.client_id}`;
    case "advice.superseded":
      return "Advice set aside";
    case "advice.decided":
      return `Adviser ${event.payload.decision} advice`;
  }
}

// Which kind of moment an event is, for the tick's mark on the track: the analysis, a decision, the rest.
export function tickKind(event: SlimEvent): "decision" | "finding" | "step" | "other" {
  if (event.type === "disposition.changed" || event.type === "advice.decided") return "decision";
  if (event.type === "finding.created" || event.type === "advice.drafted") return "finding";
  if (event.type.startsWith("step.")) return "step";
  return "other";
}
