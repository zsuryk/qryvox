# A fixed analyst identity

## Status

accepted — 2026-10-03 — deciders: <names>. Records spec decision 9 (#1), which settled what ADR-0002 left
open. Amended 2026-10-07 (#90): the fixed identity is a deliberate demo-mode choice, not a gap.

## Context

ADR-0002 says every event carries an `actor`: "the licensed human accountable for a disposition; a fixed
analyst identity or a simple picker, decided elsewhere". Demo mode settles it: the first.

The product's accountability claim rests on this field. A disposition is only worth something in an audit
if it names who decided, and the README promises that "accountability stays with the licensed human". At
the same time, the product is a demo with one person at the keyboard, and the interface promises no text
boxes: a login form would be the first one.

Demo mode is the shape as it ships, and that is a choice, not an omission. One fixed identity keeps the
demo openable without an account system, and the interface promises no tenancy: nothing in the product
asks a visitor who they are, there is no second analyst to keep apart, and no data belongs to one user
rather than to the demo. Real accounts with a per-user actor on every event are future work — a different
product, not a smaller version of this one.

## Considered options

- **A login** — rejected. It is a text box in the main flow, needs a user store, and buys nothing when
  one person drives the demo.
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
- **Real accounts are future work.** Whoever adds them decides where the identity comes from (a login, an
  SSO header, a picker), adds the user store behind it, and adds the tenancy that keeps one analyst's
  cases out of another's. Until then the log's actor is `demo-analyst` and nothing else.

## Consequences

- The product can show *what* was decided and *when*, but not *who* among several people: every decision in
  every case names the same actor. That is honest for a one-person demo and wrong for a real team.
- Anyone who can reach the deployment can append dispositions and client decisions, and each is recorded
  as the analyst's own. The log proves what the system did and never who typed it — there is no identity
  in it to prove.
- Adding real identities later needs no migration. `actor` is already on every event and stored events are
  never rewritten (ADR-0002), so old events keep `demo-analyst` and new events carry the real name.
- Whoever replaces this must decide whether the server or the client vouches for the identity. Today the
  server alone sets it, and that property is worth keeping: an actor the client can choose is not evidence.
- The API token (ADR-0001) is not an identity. It says the caller holds the demo link, not who they
  are, and it is not recorded on events. It guards the calls that spend model tokens and nothing else;
  `docs/deploying.md` draws that boundary.
