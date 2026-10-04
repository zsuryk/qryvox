"use client";

import { type FormEvent, type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { DocumentKind, FindingCategory, type IntentChip, resolveIntent, type SlimEvent } from "@qryvox/shared";
import { categoryLabel } from "../lib/board";
import { DOCUMENT_KIND_LABELS } from "../lib/canvas-cards";
import { similarFailure } from "../lib/canvas-similar";
import type { CanvasMode } from "../lib/canvas-source";
import type { CanvasLog } from "../lib/canvas-store";
import { runStep } from "../lib/api";
import { CARD_STEPS, CHIP_STEP_LABELS, chipKey, chipLabel } from "../lib/intent-chips";
import { chipsOf, intentRefusal, parseRequest, parseRunFor, parsedAlready, playIntent, RECORDED_INTENTS, standingParseRun } from "../lib/intent-parse";
import styles from "./canvas-intent.module.css";

// The intent field (#69): one quiet line to say what to look at, and the chips it comes to. Enter
// sends the words to the parse step, which reads them into chips like the ones the picker offers; the chips
// from the words and the ones picked by hand are merged by the shared resolveIntent, and any of them can be
// switched off or on again. Only sending words calls a model, and then once: the same words again are a retry.

type IntentStore = {
  current: RefObject<CanvasLog>;
  update: (change: (log: CanvasLog) => CanvasLog) => void;
  refresh: () => Promise<void>;
};

export type Intent = ReturnType<typeof useIntent>;

export function useIntent(log: readonly SlimEvent[], mode: CanvasMode, store: IntentStore, say: (words: string) => void) {
  const [text, setText] = useState("");
  const [manual, setManual] = useState<readonly IntentChip[]>([]);
  // Chips switched off by hand, by key: a chip stays in the row, dimmed, so it can be switched back on.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  // The run whose chips stand where the analyst has just sent words: by default the log's latest completed.
  const [chosen, setChosen] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const busy = useRef(false);
  const { current, update, refresh } = store;

  const standing = useMemo(() => {
    const done = (id: string | null) => id !== null && chipsOf(log, id) !== null;
    return done(chosen) ? chosen : standingParseRun(log);
  }, [log, chosen]);
  const resolved = useMemo(() => resolveIntent(log, standing, manual), [log, standing, manual]);
  const chips = useMemo(() => resolved.chips.filter((c) => !off.has(chipKey(c))), [resolved, off]);

  const submit = useCallback(async () => {
    if (busy.current) return;
    const words = text.trim();
    const refusal = intentRefusal(words);
    if (refusal) return setNote(refusal);
    const held = current.current!.confirmed;
    const settle = (id: string, how: string) => {
      const chipsRead = chipsOf(current.current!.confirmed, id);
      if (chipsRead === null) return;
      setChosen(id);
      setOff(new Set());
      setNote(
        chipsRead.length === 0
          ? `${how}“${words}” maps onto nothing, so the chips picked by hand stand.`
          : `${how}“${words}” read as ${chipsRead.length} chip${chipsRead.length === 1 ? "" : "s"}.`,
      );
    };
    if (parsedAlready(held, words)) {
      // A retry under the id the words went out under: the server would hand back the run it holds, so
      // nothing is sent and the model is not asked again.
      settle(parseRunFor(held, words)!, "Already read: ");
      return;
    }
    if (mode.kind === "fixture") {
      const played = playIntent(held, words, crypto.randomUUID(), new Date().toISOString());
      if (!played) {
        return setNote("The recorded case has no model behind it, so it only reads the sentences below. On a live case the words go to the model.");
      }
      update((l) => ({ ...l, confirmed: [...l.confirmed, ...played] }));
      settle(played[0]!.step_run_id!, "");
      return;
    }
    busy.current = true;
    setParsing(true);
    setNote("Reading what you typed, with the model…");
    const id = parseRunFor(held, words) ?? crypto.randomUUID();
    const poll = window.setInterval(() => void refresh().catch(() => undefined), 2000);
    try {
      await runStep(mode.caseId, parseRequest(words, id));
      await refresh();
      settle(id, "");
    } catch (cause) {
      await refresh().catch(() => undefined);
      setNote(`Could not read those words: ${similarFailure(cause)} The chips are as they were.`);
      say("The words were not read: the chips are as they were.");
    } finally {
      window.clearInterval(poll);
      busy.current = false;
      setParsing(false);
    }
  }, [current, mode, refresh, say, text, update]);

  // Switching a chip: a chip that is on goes off, one that is off comes back on, and a chip the row does not
  // have yet (from the picker) is picked by hand.
  const toggle = useCallback(
    (chip: IntentChip) => {
      const key = chipKey(chip);
      if (!resolved.chips.some((c) => chipKey(c) === key)) return setManual((m) => [...m, chip]);
      setOff((o) => {
        const next = new Set(o);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    },
    [resolved],
  );

  // Every chip off, the hand-picked ones dropped: the whole canvas again. What the words said stays on the log.
  const clear = useCallback(() => {
    setManual([]);
    setOff(new Set(resolved.chips.map(chipKey)));
    setNote(null);
  }, [resolved]);

  return { text, setText, resolved: resolved.chips, source: resolved.source, manual, off, chips, parsing, note, submit, toggle, clear };
}

const single = (field: keyof IntentChip, value: string): IntentChip => ({ category: null, authority: null, step_kind: null, [field]: value }) as IntentChip;

export function IntentBar({ intent, mode }: { intent: Intent; mode: CanvasMode }) {
  const [picking, setPicking] = useState(false);
  const { chips, resolved, off } = intent;
  const active = (chip: IntentChip) => chips.some((c) => chipKey(c) === chipKey(chip));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void intent.submit();
  };
  const groups: { label: string; chips: { chip: IntentChip; label: string }[] }[] = [
    { label: "Area", chips: FindingCategory.options.map((c) => ({ chip: single("category", c), label: categoryLabel(c) })) },
    { label: "Document", chips: DocumentKind.options.map((k) => ({ chip: single("authority", k), label: DOCUMENT_KIND_LABELS[k] })) },
    { label: "Stage", chips: CARD_STEPS.map((s) => ({ chip: single("step_kind", s), label: CHIP_STEP_LABELS[s] })) },
  ];
  return (
    <div className={styles.intent}>
      <form role="search" aria-label="Intent" className={styles.form} onSubmit={onSubmit}>
        <input
          type="text"
          className={styles.field}
          value={intent.text}
          maxLength={500}
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          aria-label="What do you want to look at?"
          aria-busy={intent.parsing}
          placeholder={mode.kind === "fixture" ? "fee contradictions in the PPM" : "What do you want to look at? For example, fee contradictions in the PPM"}
          readOnly={intent.parsing}
          onChange={(event) => intent.setText(event.target.value)}
        />
        <button type="submit" className="btn btn--small btn--plain" disabled={intent.parsing} aria-busy={intent.parsing}>
          {intent.parsing ? "Reading…" : "Read"}
        </button>
        <button type="button" className="btn btn--small btn--plain" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          Pick chips
        </button>
      </form>
      <p className="t-caption muted" role="status">
        {intent.note}
      </p>
      {mode.kind === "fixture" && (
        <p className="t-caption faint">
          The recorded case reads only these sentences:{" "}
          {RECORDED_INTENTS.map((r) => (
            <button key={r.words} type="button" className={styles.sample} onClick={() => intent.setText(r.words)}>
              {r.words}
            </button>
          ))}
        </p>
      )}
      {resolved.length > 0 && (
        <ul className={`list-plain ${styles.chips}`} aria-label="Intent chips">
          {resolved.map((chip) => {
            const key = chipKey(chip);
            const hand = intent.manual.some((c) => chipKey(c) === key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={!off.has(key)}
                  title={`${hand ? "Picked by hand" : "Read from your words"}. Press to switch it ${off.has(key) ? "on" : "off"}.`}
                  onClick={() => intent.toggle(chip)}
                >
                  {chipLabel(chip)}
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className="btn btn--small btn--plain" onClick={intent.clear}>
              Clear
            </button>
          </li>
        </ul>
      )}
      {picking && (
        <div className={styles.picker}>
          {groups.map((group) => (
            <div key={group.label} className={styles.group} role="group" aria-label={group.label}>
              <span className="t-eyebrow">{group.label}</span>
              {group.chips.map(({ chip, label }) => (
                <button key={chipKey(chip)} type="button" className="chip" aria-pressed={active(chip)} onClick={() => intent.toggle(chip)}>
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="t-caption faint">
        {chips.length === 0
          ? "No chips yet. Say what you want to look at, or pick chips."
          : "These chips are the intent. Switch one off or on by pressing it; each chip is picked by hand or read from your words."}
      </p>
    </div>
  );
}
