# A fixed analyst identity in stage 1

## Status

accepted — 2026-10-03 — deciders: <names>. Records spec decision 9 (#1), which settled what ADR-0002 left
open. To be superseded in stage 2, when there is more than one analyst.

## Context

ADR-0002 says every event carries an `actor`: "the licensed human accountable for a disposition; a fixed
analyst identity or a simple picker, decided elsewhere". The spec chose the first in stage 1 and flagged
it as a decision taken by omission, to be written down before stage 2.

The product's accountability claim rests on this field. A disposition is only worth something in an audit
if it names who decided, and the README promises that "accountability stays with the licensed human". At
the same time, stage 1 is a demo with one person at the keyboard, and the interface promises no text
boxes: a login form would be the first one.

## Considered options

- **A login** — rejected for stage 1. It is a text box in the main flow, needs a user store, and buys
  nothing when one person drives the demo.
- **A picker (choose a name from a list)** — deferred. No text box, but a list of invented analysts adds
  nothing to a single-person demo, and anyone can pick any name, so it would look like accountability
  without providing it.
- **One fixed identity** — chosen.

## Decision

- **Every event's `actor` is `demo-analyst`** (`ANALYST_ACTOR` in `shared/src/actor.ts`). The server
  sets it; no request carries an actor, so a client cannot claim to be someone else.
- **The interface shows it as the signed-off human**, so the board and replay already have the shape that
  a real identity will fill.
- **No step ever acts as the analyst.** Steps never approve or dismiss; only a `disposition.changed`
  appended through the dispositions endpoint is a decision, and it is attributed to the analyst.

## Consequences

- Stage 1 can show *what* was decided and *when*, but not *who* among several people: every decision in
  every case names the same actor. That is honest for a one-person demo and wrong for a real team.
- Adding real identities later needs no migration. `actor` is already on every event and stored events are
  never rewritten (ADR-0002), so old events keep `demo-analyst` and new events carry the real name.
- Whoever replaces this must decide where the identity comes from (a login, an SSO header, a picker) and
  whether the server or the client vouches for it. Today the server alone sets it, and that property is
  worth keeping: an actor the client can choose is not evidence.
- The judge-link token (ADR-0001) is not an identity. It says the caller holds the demo link, not who they
  are, and it is not recorded on events.
