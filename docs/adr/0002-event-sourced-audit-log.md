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

- **Fold-on-read; no materialized projection tables at hackathon scale.** State is `fold(events where seq <= max)`; the replay scrubber is the same fold with `seq <= N`. Fold functions live in `/shared` so the browser scrubber folds locally without hitting the API. If a projection is ever materialized, the event append and the projection update go in the same `db.batch()`.
- **Append-only is enforced in the database:** `BEFORE UPDATE` / `BEFORE DELETE` triggers on `events` raise an abort, so mutating rows can't break replay. The API layer keeps the same rule: no endpoint writes state outside an event append.
- **Events are immutable and versioned.** Each carries a `v` field, and the fold upcasts older versions on read; we never rewrite stored events. Schema evolution means upcasting, not migrating.
- **Tamper detection:** each event carries `prev_hash` (SHA-256 over the previous event), forming a hash chain — cheap, and a strong "auditable" demo moment.
- **Event vocabulary** — one zod discriminated union in `/shared`, shared by FE and BE: `case.opened`, `document.ingested`, `step.started`, `step.completed`, `step.failed`, `finding.created`, `finding.superseded`, `disposition.changed`.
- **Re-run rule.** A re-run appends a new `step_run` and emits `finding.superseded` for prior findings in scope. The board shows the latest run; dispositions on superseded findings stay in the log but leave the active board.
- **Idempotent pipeline steps.** The browser drives the pipeline (ADR-0001) and will retry after network failures: the client generates a `step_run_id` per step call, `events` has a unique index on `(case_id, step_run_id, type)`, and on conflict the server returns the existing result instead of appending.

## Consequences

- The demo can be replayed from recorded events if the Anthropic API is down — replay never calls a model.
- Bad events can't be deleted in place; correctness comes from appending compensating events. Resetting for a new demo = open a new case (`case.opened`), never wiping Turso in production.
- Event payloads must be self-describing and full-context (prompt version, model, raw LLM response, parsed result, document ids) — evolution happens by upcasting old versions on read.
