// Full screen (#83): the canvas toolbar's full-screen control, as the browser sees it. The canvas takes
// either the whole screen or, on a phone, the whole canvas section with it — the case chrome, the intent
// line and the space the phone's own bar takes all stop eating the screen, and coming back restores
// exactly what was there.
//
// A viewing preference, not a card operation: it decides nothing, changes no card's state, and appends
// nothing to the log. That is why the fold knows nothing about it — the same canvas, pinned cards and
// all, with more of it on screen.
//
// The state is read from the browser every time (host.element), never remembered: leaving full screen
// any other way — Escape, the platform's own gesture, the browser refusing — leaves the control saying
// the right thing. Where a browser has no element full screen at all (iPhone Safari), the canvas marks
// itself (data-fullscreen) and CSS takes it edge to edge, which is the same answer read the same way.

// What the browser says about full screen, and what we ask of it, in one seam: the canvas hands over the
// document's own answers and its element's methods, and the logic below is testable without a browser.
export type FullscreenHost = {
  // The element the browser has full screen right now, or null.
  readonly element: Element | null;
  // The element the CSS fallback marked, where the browser has none to ask (iPhone Safari).
  readonly marked: Element | null;
  // Whether this browser has element full screen at all.
  readonly supported: boolean;
  request: (el: Element) => Promise<void>;
  exit: () => Promise<void>;
  mark: (el: Element) => void;
  unmark: () => void;
};

// Which element goes full screen: the canvas surface on a wide screen, the whole canvas section on a
// phone, where the intent line and the Plan and Activity buttons go with it.
export type FullscreenTarget = "surface" | "section";

export function fullscreenTarget(narrow: boolean): FullscreenTarget {
  return narrow ? "section" : "surface";
}

// The attribute the CSS fallback reads, and Escape's own way out of it.
export const FULLSCREEN_ATTR = "data-fullscreen";

// Whether the canvas is full screen: the browser's answer where it has one, the mark where it does not.
export function isFullscreen(host: FullscreenHost): boolean {
  return host.element !== null || host.marked !== null;
}

export type FullscreenOutcome = "on" | "off" | "refused";

// Full screen on, or off: what the button does. A refused request leaves everything as it was, and says
// so on the status line rather than pretending.
export async function toggleFullscreen(host: FullscreenHost, target: Element): Promise<FullscreenOutcome> {
  if (isFullscreen(host)) {
    if (host.element) await host.exit();
    else host.unmark();
    return "off";
  }
  if (!host.supported) {
    host.mark(target);
    return "on";
  }
  try {
    await host.request(target);
    return "on";
  } catch {
    return "refused";
  }
}

// Leave the fallback when Escape is pressed: a real full screen is the browser's to leave, and it says so.
export function leaveFallback(host: FullscreenHost): boolean {
  if (host.supported || !host.marked) return false;
  host.unmark();
  return true;
}

// The browser seam, built from a document and the element that would go full screen.
export function browserHost(doc: Document, el: Element): FullscreenHost {
  // Safari's older spellings, kept beside the standard ones: the same two questions, asked either way.
  const older = doc as Document & { webkitFullscreenElement?: Element | null };
  return {
    get element() {
      return doc.fullscreenElement ?? older.webkitFullscreenElement ?? null;
    },
    get marked() {
      return doc.querySelector(`[${FULLSCREEN_ATTR}]`);
    },
    supported: typeof el.requestFullscreen === "function" || "webkitRequestFullscreen" in el,
    request: async (target) => {
      const any_ = target as Element & { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => Promise<void> };
      const go = any_.requestFullscreen ?? any_.webkitRequestFullscreen;
      if (!go) throw new Error("this browser has no element full screen");
      await go.call(target);
    },
    exit: async () => {
      const any_ = doc as Document & { exitFullscreen?: () => Promise<void>; webkitExitFullscreen?: () => Promise<void> };
      const leave = any_.exitFullscreen ?? any_.webkitExitFullscreen;
      if (!leave) throw new Error("this browser cannot leave full screen");
      await leave.call(doc);
    },
    mark: (target) => target.setAttribute(FULLSCREEN_ATTR, "true"),
    unmark: () => {
      for (const marked of doc.querySelectorAll(`[${FULLSCREEN_ATTR}]`)) marked.removeAttribute(FULLSCREEN_ATTR);
    },
  };
}
