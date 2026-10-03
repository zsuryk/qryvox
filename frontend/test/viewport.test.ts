import { describe, expect, it } from "vitest";
import {
  boundsOf,
  centreOn,
  clampZoom,
  fitTo,
  glide,
  gridStyle,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  toScreen,
  toWorld,
  type Viewport,
  visibleWorld,
  wheelFactor,
  worldTransform,
  zoomAt,
  zoomBy,
} from "../lib/viewport";

// The canvas's one world transform (#52): screen = world × zoom + pan, and back.
const views: Viewport[] = [
  { panX: 0, panY: 0, zoom: 1 },
  { panX: 120, panY: -40, zoom: 0.5 },
  { panX: -333.3, panY: 87.25, zoom: 1.75 },
  { panX: 10, panY: 10, zoom: MIN_ZOOM },
];
const points = [
  { x: 0, y: 0 },
  { x: 300, y: 220 },
  { x: -1234.5, y: 98.75 },
];

describe("the world transform", () => {
  it("round-trips world → screen → world, and screen → world → screen", () => {
    for (const v of views) {
      for (const p of points) {
        const back = toWorld(v, toScreen(v, p));
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
        const again = toScreen(v, toWorld(v, p));
        expect(again.x).toBeCloseTo(p.x, 9);
        expect(again.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("is the CSS the world layer renders with: translate, then scale about world (0, 0)", () => {
    expect(worldTransform({ panX: 12, panY: -3, zoom: 0.5 })).toBe("translate3d(12px, -3px, 0) scale(0.5)");
  });

  it("pans 1:1 with the hand whatever the zoom", () => {
    const v = { panX: 5, panY: 5, zoom: 0.4 };
    const before = toScreen(v, { x: 100, y: 100 });
    const after = toScreen(panBy(v, 30, -12), { x: 100, y: 100 });
    expect([after.x - before.x, after.y - before.y]).toEqual([30, -12]);
  });
});

describe("zoom", () => {
  it("is clamped at both ends", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(MAX_ZOOM);
    expect(clampZoom(1.1)).toBe(1.1);
    expect(zoomBy(views[0]!, 1000, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomBy(views[0]!, 0.0001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it("keeps the world point under the pointer where it is", () => {
    const anchor = { x: 400, y: 250 };
    for (const v of views) {
      const under = toWorld(v, anchor);
      const zoomed = zoomAt(v, v.zoom * 1.6, anchor);
      const still = toScreen(zoomed, under);
      expect(still.x).toBeCloseTo(anchor.x, 9);
      expect(still.y).toBeCloseTo(anchor.y, 9);
    }
  });

  it("turns wheel deltas into factors that undo each other", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1, 12);
  });
});

describe("fit to content", () => {
  const size = { width: 1000, height: 600 };

  it("shows all of the content, centred, inside the padding", () => {
    const bounds = { x: -400, y: 0, w: 1600, h: 900 };
    const v = fitTo(bounds, size, { padding: 40 });
    const topLeft = toScreen(v, { x: bounds.x, y: bounds.y });
    const bottomRight = toScreen(v, { x: bounds.x + bounds.w, y: bounds.y + bounds.h });
    expect(topLeft.x).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(topLeft.y).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(bottomRight.x).toBeLessThanOrEqual(960 + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(560 + 1e-9);
    // Centred on the axis with room to spare.
    expect(topLeft.x + bottomRight.x).toBeCloseTo(size.width, 9);
  });

  it("never blows a small board up past life size", () => {
    expect(fitTo({ x: 0, y: 0, w: 300, h: 200 }, size).zoom).toBe(1);
    expect(fitTo({ x: 0, y: 0, w: 300, h: 200 }, size, { maxZoom: 1.5 }).zoom).toBe(1.5);
  });

  it("shows content too big for the smallest zoom from its top-left corner", () => {
    const bounds = { x: 100, y: 100, w: 20000, h: 20000 };
    const v = fitTo(bounds, size, { padding: 40 });
    expect(v.zoom).toBe(MIN_ZOOM);
    expect(toScreen(v, { x: 100, y: 100 })).toEqual({ x: 40, y: 40 });
  });

  it("bounds a set of rectangles, and nothing for none", () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -5, y: 20, w: 10, h: 10 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 15, h: 30 });
  });
});

describe("what the screen shows", () => {
  it("names the visible world rectangle and centres on one", () => {
    const v = { panX: -100, panY: 50, zoom: 0.5 };
    expect(visibleWorld(v, { width: 800, height: 400 })).toEqual({ x: 200, y: -100, w: 1600, h: 800 });
    const centred = centreOn(v, { x: 1000, y: 1000, w: 200, h: 100 }, { width: 800, height: 400 });
    expect(toScreen(centred, { x: 1100, y: 1050 })).toEqual({ x: 400, y: 200 });
    expect(centred.zoom).toBe(0.5);
  });

  it("thins the grid as it zooms out and moves it with the pan", () => {
    expect(gridStyle({ panX: 3, panY: 4, zoom: 1 })).toEqual({ backgroundSize: "24px 24px", backgroundPosition: "3px 4px" });
    // 24 × 0.25 = 6px would be a wash: doubled to 12px.
    expect(gridStyle({ panX: 0, panY: 0, zoom: 0.25 }).backgroundSize).toBe("12px 12px");
    expect(gridStyle({ panX: 0, panY: 0, zoom: 2 }).backgroundSize).toBe("48px 48px");
  });

  it("lets go of a pan the way a scroll view does: slower every frame, never reversing", () => {
    let v = { x: 1200, y: -600 };
    for (let i = 0; i < 60; i += 1) {
      const next = glide(v, 1 / 60);
      expect(Math.abs(next.x)).toBeLessThan(Math.abs(v.x));
      expect(Math.sign(next.x)).toBe(Math.sign(v.x));
      v = next;
    }
    expect(glide({ x: 100, y: 0 }, 0)).toEqual({ x: 100, y: 0 });
  });
});
