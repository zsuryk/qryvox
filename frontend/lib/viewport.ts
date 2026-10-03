// The canvas's viewport (#52): the one place that knows how the world maps onto the screen. Everything
// laid out on the canvas — cards, the plan region, auto-tiling — is in world coordinates, and only this
// module turns them into pixels: one transform for the whole world layer, never a position per card.
//
// A point in the world appears on screen at world × zoom + pan, where pan is in screen pixels from the
// viewport's top-left corner. Zoom is clamped, and zooming keeps the world point under the pointer where
// it is, the way a map does. Nothing here touches the DOM, so the round trip is tested in Node.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
// A rectangle in world coordinates.
export type Rect = { x: number; y: number; w: number; h: number };

export type Viewport = { panX: number; panY: number; zoom: number };

// A quarter of life size is the whole Larkspur board on a laptop; twice is a card read from across a room.
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;

export const IDENTITY: Viewport = { panX: 0, panY: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

export function toWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
}

// A drag of the background by (dx, dy) screen pixels: the world follows the hand 1:1 at any zoom.
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, panX: v.panX + dx, panY: v.panY + dy };
}

// Zoom to `zoom` (clamped) around a screen point, which stays over the same world point.
export function zoomAt(v: Viewport, zoom: number, anchor: Point): Viewport {
  const next = clampZoom(zoom);
  const world = toWorld(v, anchor);
  return { zoom: next, panX: anchor.x - world.x * next, panY: anchor.y - world.y * next };
}

export function zoomBy(v: Viewport, factor: number, anchor: Point): Viewport {
  return zoomAt(v, v.zoom * factor, anchor);
}

// Two fingers on a touch screen (#61): from where they came down (`from`, over the viewport `start` they
// found) to where they are now (`to`). The zoom scales with how far apart they have spread, clamped like any
// other zoom, and the world point that was under their midpoint stays under their midpoint, wherever the
// midpoint has gone since. So fingers that spread zoom about the point between them, fingers that move
// together pan, and both at once do both, as a photo does under two fingers. Computed from the start every
// time, never by accumulating per-move factors, so the world under the fingers cannot drift.
export function pinch(start: Viewport, from: readonly [Point, Point], to: readonly [Point, Point]): Viewport {
  const spread = distance(from[0], from[1]);
  const zoom = clampZoom(spread > 0 ? (start.zoom * distance(to[0], to[1])) / spread : start.zoom);
  const anchor = toWorld(start, midpoint(from[0], from[1]));
  const mid = midpoint(to[0], to[1]);
  return { zoom, panX: mid.x - anchor.x * zoom, panY: mid.y - anchor.y * zoom };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// A wheel or pinch delta as a zoom factor. Exponential, so zooming in and back out by the same amount
// returns to the same zoom, and a trackpad's many small deltas add up to what one mouse notch does.
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0025);
}

// The smallest rectangle around all of them, or null for none.
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

// The viewport that shows all of `bounds` inside a screen of `size`, centred, with `padding` screen pixels
// clear on every side. It never zooms past maxZoom to fill the screen (a lone card is not blown up), and
// never below minZoom (MIN_ZOOM unless asked for more): content too big for that is shown from its
// top-left corner rather than shrunk into something nobody can read.
export function fitTo(
  bounds: Rect,
  size: Size,
  { padding = 48, maxZoom = 1, minZoom = MIN_ZOOM }: { padding?: number; maxZoom?: number; minZoom?: number } = {},
): Viewport {
  const room = { width: Math.max(1, size.width - 2 * padding), height: Math.max(1, size.height - 2 * padding) };
  const zoom = clampZoom(Math.max(minZoom, Math.min(maxZoom, room.width / Math.max(1, bounds.w), room.height / Math.max(1, bounds.h))));
  const centred = (screen: number, start: number, extent: number) => {
    const slack = screen - extent * zoom;
    return slack >= 2 * padding ? slack / 2 - start * zoom : padding - start * zoom;
  };
  return { zoom, panX: centred(size.width, bounds.x, bounds.w), panY: centred(size.height, bounds.y, bounds.h) };
}

// The world layer's CSS transform: the only pixel arithmetic the canvas renders with. Translate first,
// then scale about the layer's top-left corner, which is world (0, 0).
export function worldTransform(v: Viewport): string {
  return `translate3d(${v.panX}px, ${v.panY}px, 0) scale(${v.zoom})`;
}

// Where one thing sits inside the world layer. World units are the unscaled layer's CSS pixels, so this is
// a world position, not a screen one: the layer's own transform does all the mapping to the screen.
export function placeAt(p: Point): string {
  return `translate3d(${p.x}px, ${p.y}px, 0)`;
}

// The dotted grid behind the world, which moves and scales with it. Its pitch is GRID world units,
// doubled as many times as it takes to keep the dots at least 12 pixels apart, so zooming out thins the
// grid instead of turning it into a grey wash.
export const GRID = 24;

export function gridStyle(v: Viewport): { backgroundSize: string; backgroundPosition: string } {
  let pitch = GRID * v.zoom;
  while (pitch < 12) pitch *= 2;
  return { backgroundSize: `${pitch}px ${pitch}px`, backgroundPosition: `${v.panX}px ${v.panY}px` };
}

// Pan inertia: the background keeps the speed it was let go at and loses it the way a scroll view does,
// exponentially (the same deceleration rate as the replay scrubber's momentum projection). dt in seconds,
// velocity in screen pixels per second.
export function glide(velocity: Point, dt: number, decelerationRate = 0.998): Point {
  const decay = decelerationRate ** (dt * 1000);
  return { x: velocity.x * decay, y: velocity.y * decay };
}

// The world rectangle the screen shows: what is on screen, in the world's own terms.
export function visibleWorld(v: Viewport, size: Size): Rect {
  const topLeft = toWorld(v, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, w: size.width / v.zoom, h: size.height / v.zoom };
}

// Pan so a world rectangle sits in the middle of the screen, at the zoom the viewport already has.
export function centreOn(v: Viewport, rect: Rect, size: Size): Viewport {
  return {
    ...v,
    panX: size.width / 2 - (rect.x + rect.w / 2) * v.zoom,
    panY: size.height / 2 - (rect.y + rect.h / 2) * v.zoom,
  };
}
