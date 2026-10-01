# Event-sourced audit log as the source of truth

## Status

accepted — 2026-10-01 — deciders: <names>

## Context

Every meaningful state change — document ingested, analysis step run, finding created, disposition changed, along with the prompt version and model used — is appended to a single `events` table with a monotonic `seq`. Current state is derived by folding events; the replay scrubber is "rebuild state at seq N".

Each analysis step's event stores the raw LLM response alongside the parsed result. Replay is a pure fold over stored events and never re-invokes a model, so reconstruction is exact even though model output is not deterministic.

Every event carries `case_id` (each demo run opens a new case — no database wiping), `actor` (the licensed human accountable for a disposition; a fixed analyst identity or a simple picker, decided elsewhere), and `at` (wall-clock time for the scrubber; `seq` stays the ordering key).

"Replayable audit log — any past decision reconstructable exactly" is a pitch-critical claim of the moat, and event sourcing makes replay a fold over the log rather than a feature we build. It's also economical: the analysis steps, dispositions, and eval tiles already need the same stream of events, so the board, the replay scrubber, and the precision/recall dashboard all read from one source.

## Considered options

- **CRUD tables + a separate audit trail** — rejected. Replay would have to reverse-engineer history from snapshots and audit rows, and the log and the state could disagree. We'd be building two systems where one suffices.
- **A full event-sourcing/CQRS framework** — rejected. One append-only table plus pure fold functions gives the same power with no framework to learn during a hackathon.

## Decision

- **Fold-on-read; no materialized projection tables at hackathon scale.** State is `fold(events where seq <= max)`; the replay scrubber is the same fold with `seq <= N`. Fold functions live in `/shared` so the browser scrubber folds locally. Because a case's events hold extracted document text and raw LLM responses, the event-list endpoint returns **slim payloads, paged by `seq` (`?after=N`)** — heavy fields (raw response, document text) are fetched on demand. This keeps every response under Vercel's 4.5 MB limit (which caps responses, not just requests) and cuts Turso rows read. If a projection is ever materialized, the projection update goes in the same write transaction as the event append (see below).
- **Append-only is enforced in the database:** `BEFORE UPDATE` / `BEFORE DELETE` triggers on `events` raise an abort, so mutating rows can't break replay. The API layer keeps the same rule: no endpoint writes state outside an event append. Triggers live in a **hand-written migration** — drizzle-kit cannot express them and its SQLite table recreation would silently drop them — with a startup/CI check asserting they still exist.
- **Events are immutable and versioned.** Each carries a `v` field, and the fold upcasts older versions on read; we never rewrite stored events. Schema evolution means upcasting, not migrating.
- **Tamper-evident hash chain — not tamper-proof.** The chain is per `case_id`. Each event stores its own `hash` (so the newest event is protected without waiting for a successor), computed as SHA-256 over **canonical JSON** (stable key order) of its payload plus the previous event's `hash`. SQLite has no built-in SHA-256, so hashes are computed **in the API process** — never in the browser. Anyone holding Turso credentials can drop the triggers and recompute the chain; the honest claim is *evidence of tampering*, anchored by showing the latest `hash` in the UI and including it in the exported snapshot.
- **Every append is one write transaction.** Whether it is a single disposition or a whole step's output, an append opens a libSQL `transaction("write")`, reads the case's latest `hash`, computes the new events' hashes, inserts them, and commits. The write lock serializes concurrent appends (e.g. parallel document extraction) so the chain cannot fork, and the commit makes a multi-event append atomic. `db.batch()` cannot stand in for it: a batch cannot read the previous `hash` mid-flight. **No slow work inside the transaction:** the LLM call completes before the transaction opens, so the write lock is held for milliseconds rather than the tens of seconds an LLM call takes, and Turso's timeout on long interactive transactions is never in play.
- **Chain verification is server-side.** The browser only receives slim payloads (above), while each `hash` covers the full payload, so the browser cannot verify the chain itself. A server endpoint re-hashes the case's events and returns the verdict plus the latest `hash`; the UI displays that result.
- **Event vocabulary** — one zod discriminated union in `/shared`, shared by FE and BE: `case.opened`, `document.ingested`, `step.started`, `step.completed`, `step.failed`, `finding.created`, `finding.superseded`, `disposition.changed`.
- **Re-run rule.** A re-run appends new `step.started` / `step.completed` events carrying a fresh `step_run_id`, and emits `finding.superseded` for prior findings in scope. The board shows the latest run; dispositions on superseded findings stay in the log but leave the active board.
- **Idempotent pipeline steps.** The browser drives the pipeline (ADR-0001) and will retry after network failures — sometimes while the original request is still running. Two unique indexes guard the log:
  - `event_id` (UUID) on every event — generated by the browser for events it originates (`case.opened`, `document.ingested`, `disposition.changed`) and by the server for step output — dedupes retried single events. There is deliberately **no** unique index on `(case_id, step_run_id, type)`, which would break steps that emit several `finding.created` events.
  - A partial unique index `UNIQUE (case_id, step_run_id) WHERE type = 'step.completed'` lets each step run complete at most once.

  Flow per step call: the server first looks up `step.completed` for `(case_id, step_run_id)` and returns the stored result if present — **before** calling the LLM, so a sequential retry spends no tokens. Otherwise it calls the LLM, then appends `step.completed` and all its `finding.created` events in one write transaction, so no reader ever observes a half-step. If a concurrent duplicate committed first, the partial index rejects the insert, the transaction rolls back, and the server returns the stored result of the run that won. The losing request's LLM call is wasted tokens — rare and accepted; the log stays correct.

## Consequences

- The demo can be replayed from recorded events if the Anthropic API is down — replay never calls a model. The exported JSON snapshot (ADR-0001) doubles as the fallback if Turso itself is blocked, and carries the chain's latest `hash` as its anchor.
- Bad events can't be deleted in place; correctness comes from appending compensating events. Resetting for a new demo = open a new case (`case.opened`), never wiping Turso in production.
- Event payloads must be self-describing and full-context (prompt version, model, raw LLM response, parsed result, document ids) — evolution happens by upcasting old versions on read.
