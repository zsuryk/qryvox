"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// The few controls the product builds itself. Each is a real control underneath — buttons, a dialog — so
// it answers to keyboard and assistive technology like any other, and none of them asks anyone to type.

// A modal sheet: it rises from the bottom over a dimmed page, for a task that has the analyst's whole
// attention. Escape and the scrim close it; focus moves into it on open and back to whatever opened it on
// close, so a keyboard user is never stranded behind it. It leaves the way it came — back down — and the
// close is interruptible in the only way that matters here: nothing is lost if it is reopened mid-exit.
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setLeaving(true);
    window.setTimeout(onClose, reduced ? 150 : 240);
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    // The page behind stays where it was: a sheet never scrolls what it covers.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [close]);

  return (
    <>
      <div className={`scrim${leaving ? " scrim--leaving" : ""}`} onClick={close} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`sheet${leaving ? " sheet--leaving" : ""}`}
        style={wide ? { width: "min(60rem, 100%)" } : undefined}
      >
        {/* The title and the way out stay put while the sheet's content scrolls beneath them. */}
        <div className="sheet__head">
          <div className="sheet__grabber" aria-hidden />
          <div className="row spread">
            <h2 className="t-title">{title}</h2>
          <button type="button" className="btn btn--small" onClick={close}>
              Done
            </button>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}

// One choice of a few, with a thumb that slides to it. The thumb's position is a transform, so a second
// tap mid-slide redirects it from where it is rather than starting over.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="group" aria-label={label} className="segmented" style={{ "--segments": options.length } as React.CSSProperties}>
      <span aria-hidden className="segmented__thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A number chosen by stepping, never typed: minus, the value in words, plus, and a few common values.
export function Stepper({
  label,
  value,
  min,
  max,
  unit,
  presets,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: (n: number) => string;
  presets: readonly number[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="row" role="group" aria-label={label}>
      <button type="button" className="btn btn--small" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="t-headline stepper__value" aria-live="polite">
        {unit(value)}
      </output>
      <button type="button" className="btn btn--small" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
      <span className="row" style={{ marginLeft: "0.5rem" }}>
        {presets.map((preset) => (
          <button key={preset} type="button" className="chip" aria-pressed={preset === value} onClick={() => onChange(preset)}>
            {unit(preset)}
          </button>
        ))}
      </span>
    </div>
  );
}

// A field's caption above its control: what is being asked, in the analyst's words.
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <p className="t-footnote strong">{label}</p>
      {hint && <p className="t-caption muted">{hint}</p>}
      <div className="field__control">{children}</div>
    </div>
  );
}
