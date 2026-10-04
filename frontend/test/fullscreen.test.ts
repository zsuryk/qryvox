import { describe, expect, it } from "vitest";
import { canvasView, fixtureEvents } from "../lib/canvas-source";
import { canvasLog, shownLog } from "../lib/canvas-store";
import { FULLSCREEN_ATTR, type FullscreenHost, fullscreenTarget, isFullscreen, leaveFallback, toggleFullscreen } from "../lib/fullscreen";

// Full screen (#83): a viewing preference, not a card operation. What it must get right is where its
// state comes from — the browser, read every time — and what it must never do is decide anything about
// the cards: a round trip through it appends nothing to the log.

type Fake = {
  element: unknown;
  supported: boolean;
  requests: unknown[];
  exits: number;
  refusals: number;
  mark: (el: unknown) => void;
  unmark: () => void;
};

// A browser, faked: `element` is what it has full screen (something else changes that, not us), and the
// mark is the CSS fallback an iPhone Safari gets, which the browser has no answer for at all.
function fake(supported = true): { host: FullscreenHost; browser: Fake } {
  const state: Fake = { element: null, supported, requests: [], exits: 0, refusals: 0, mark: () => undefined, unmark: () => undefined };
  let marked: unknown = null;
  state.mark = (el) => {
    marked = el;
  };
  state.unmark = () => {
    marked = null;
  };
  const host: FullscreenHost = {
    get element() {
      return state.element as Element | null;
    },
    get marked() {
      return marked as Element | null;
    },
    supported,
    request: (el) => {
      if (state.refusals > 0) {
        state.refusals -= 1;
        return Promise.reject(new Error("refused"));
      }
      state.requests.push(el);
      state.element = el;
      return Promise.resolve();
    },
    exit: () => {
      state.exits += 1;
      state.element = null;
      return Promise.resolve();
    },
    mark: (el) => state.mark(el),
    unmark: () => state.unmark(),
  };
  return { host, browser: state };
}

describe("the full screen control", () => {
  it("reads its state from the browser, not from a flag of its own", async () => {
    const { host, browser } = fake();
    const surface = { name: "surface" } as unknown as Element;
    expect(isFullscreen(host)).toBe(false);

    expect(await toggleFullscreen(host, surface)).toBe("on");
    expect(browser.requests).toEqual([surface]);
    expect(isFullscreen(host)).toBe(true);

    // The browser leaves full screen on its own — Escape, or the platform's own gesture. Nothing here
    // was told, and the control reads the right answer all the same.
    browser.element = null;
    expect(isFullscreen(host)).toBe(false);

    // And a control left mid-flight comes back to where it was, not one step out of date.
    expect(await toggleFullscreen(host, surface)).toBe("on");
    expect(await toggleFullscreen(host, surface)).toBe("off");
    expect(browser.exits).toBe(1);
    expect(isFullscreen(host)).toBe(false);
  });

  it("takes the whole canvas on a phone and the surface on a wide screen", () => {
    expect(fullscreenTarget(true)).toBe("section");
    expect(fullscreenTarget(false)).toBe("surface");
  });

  it("goes edge to edge by itself where the browser has no element full screen", async () => {
    const { host, browser } = fake(false);
    const section = { name: "section" } as unknown as Element;
    expect(await toggleFullscreen(host, section)).toBe("on");
    expect(browser.requests).toEqual([]);
    expect(isFullscreen(host)).toBe(true);
    expect(await toggleFullscreen(host, section)).toBe("off");
    expect(isFullscreen(host)).toBe(false);
  });

  it("leaves the fallback on Escape, where the browser has none of its own to leave", async () => {
    const { host, browser } = fake(false);
    const section = { name: "section" } as unknown as Element;
    expect(await toggleFullscreen(host, section)).toBe("on");
    expect(leaveFallback(host)).toBe(true);
    expect(isFullscreen(host)).toBe(false);
    expect(browser.exits).toBe(0);
  });

  it("leaves the canvas as it was, and says so, where the request is refused", async () => {
    const { host, browser } = fake();
    const surface = { name: "surface" } as unknown as Element;
    browser.refusals = 1;
    expect(await toggleFullscreen(host, surface)).toBe("refused");
    expect(isFullscreen(host)).toBe(false);
    expect(browser.exits).toBe(0);
  });

  it("leaves the log exactly as it found it, in and out", async () => {
    const events = fixtureEvents();
    const before = JSON.stringify(events);
    const { host } = fake();
    const canvas = { name: "canvas" } as unknown as Element;
    const view = canvasView(events);
    const log = canvasLog(events);

    expect(await toggleFullscreen(host, canvas)).toBe("on");
    expect(await toggleFullscreen(host, canvas)).toBe("off");

    // Nothing was appended, nothing was folded differently, and every card is still where it was.
    expect(JSON.stringify(events)).toBe(before);
    expect(shownLog(log)).toEqual(events);
    expect(canvasView(events).state).toEqual(view.state);
  });

  it("marks the canvas the same way everywhere, so the CSS can find it", () => {
    expect(FULLSCREEN_ATTR).toBe("data-fullscreen");
  });
});
