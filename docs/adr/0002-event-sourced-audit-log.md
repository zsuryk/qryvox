# Event-sourced audit log as the source of truth

Every meaningful state change — document ingested, analysis step run, finding created, disposition changed, along with the prompt version and model used — is appended to a single `events` table with a monotonic `seq`. Current state is derived by folding events; the replay scrubber is "rebuild state at seq N". Tables like `findings` are projections, never written to directly.

## Status

accepted

## Considered options

- **CRUD tables + a separate audit trail** — rejected. Replay would have to reverse-engineer history from snapshots and audit rows, and the log and the state could disagree. We'd be building two systems where one suffices.
- **A full event-sourcing/CQRS framework** — rejected. One append-only table plus pure fold functions gives the same power with no framework to learn during a hackathon.

## Why

"Replayable audit log — any past decision reconstructable exactly" is a pitch-critical claim of the moat, and event sourcing makes replay a fold over the log rather than a feature we build. It's also economical: the analysis steps, dispositions, and eval tiles already need the same stream of events, so the board, the replay scrubber, and the precision/recall dashboard all read from one source.

## Consequences

- Discipline required: every write goes through an event append; mutating projection rows directly breaks replay.
- Event payloads must be self-describing and versioned (prompt version, model, document ids, full context) — schema evolution means migrating events, not rows.
- Bad events can't be deleted in place; correctness comes from appending compensating events. (In hackathon reality, wiping the dev database is the escape hatch.)
