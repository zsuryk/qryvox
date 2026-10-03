import { SlimEvent } from "@qryvox/shared";
import recorded from "@qryvox/shared/case-recorded.json";
import { describe, expect, it } from "vitest";
import { describe as say, positionOf, project, rubberband, seqAt, springStep, tickKind, tracked } from "../lib/replay";

const events = SlimEvent.array().parse(recorded);

describe("the track", () => {
  it("spreads the events end to end, and reads a position back to the nearest one", () => {
    expect(positionOf(1, 27, 520)).toBe(0);
    expect(positionOf(27, 27, 520)).toBe(520);
    for (const seq of [1, 2, 13, 26, 27]) expect(seqAt(positionOf(seq, 27, 520), 27, 520)).toBe(seq);
    expect(seqAt(-50, 27, 520)).toBe(1);
    expect(seqAt(900, 27, 520)).toBe(27);
  });
});

describe("the gesture", () => {
  it("projects a flick forward by exponential decay, further the faster it goes, and not at all at rest", () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(2000)).toBeCloseTo(2 * project(1000));
    expect(project(-1000)).toBeCloseTo(-project(1000));
  });

  it("resists past the ends, more the further it is pulled, never as far as the finger", () => {
    expect(tracked(100, 520)).toBe(100);
    const near = tracked(560, 520) - 520;
    const far = tracked(720, 520) - 520;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(40);
    expect(far).toBeLessThan(200);
    expect(far / 200).toBeLessThan(near / 40);
    expect(tracked(-40, 520)).toBe(-rubberband(40, 520));
  });

  it("settles on its target with a critically damped spring, without overshooting", () => {
    let state = { x: 0, v: 0 };
    let peak = 0;
    for (let i = 0; i < 120; i += 1) {
      state = springStep(state, 100, 1 / 120);
      peak = Math.max(peak, state.x);
    }
    expect(state.x).toBeCloseTo(100, 0);
    expect(peak).toBeLessThanOrEqual(100.5);
  });

  it("carries a release velocity into the spring, and a bouncier one overshoots", () => {
    let state = { x: 0, v: 2000 };
    let peak = 0;
    for (let i = 0; i < 240; i += 1) {
      state = springStep(state, 100, 1 / 120, 0.8);
      peak = Math.max(peak, state.x);
    }
    expect(peak).toBeGreaterThan(100);
    expect(state.x).toBeCloseTo(100, 0);
  });
});

describe("the caption", () => {
  it("says what each event was, in words", () => {
    expect(say(events[0]!)).toBe("Case opened");
    expect(events.map(say).every((text) => text.length > 0)).toBe(true);
    expect(tickKind(events.find((e) => e.type === "finding.created")!)).toBe("finding");
  });
});
