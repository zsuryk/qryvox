# A canvas of cards over the case log, not a chat box

## Status

accepted — 2026-10-04 — deciders: <names>. Spec #48; tickets #49–#67. Extends ADR-0002 (the event log)
and the "no free text" interaction principle (see the README's Features list).

## Context

Most model-backed tools are a chat box in front of a model: the user has to know what to ask and
how to phrase it, and the answer is prose that can't be checked, sorted or filed. Our users are analysts
vetting a product. What they need is to *collect* evidence: the passages that disagree, the claims
the PPM doesn't back, the fees stated two ways. They then need to put it in order as the reportable set,
and leave a record a reviewer can trust.

The product had cards, but in a fixed list. The question was what an interface built around collecting
evidence looks like, without bringing a text box back in.

## Decision

- **An infinite canvas of cards is the case's first surface** (#59). Pan and zoom go through one
  viewport module, with screen = world × zoom + pan, clamped to 25–200% (#52). Cards auto-tile in world
  coordinates without overlapping, and pinned cards keep their place when the rest reflow (#53). It works
  with touch, pinch and a phone layout (#61). The list view (Review) stays, for keyboard-first review and
  screen readers. Both are views of the same data.
- **A card is something the program parsed, never prose** (#54). There are two kinds: a *finding*
  (category, severity, authority, the claim, why it matters, a citation chip) and an *excerpt* (a verbatim
  passage with its document and page). Every card opens its source page with the passage highlighted.
- **What the analyst does to a card is an event** (#50, #56, #65): dock, undock, pin, unpin, discard,
  restore, find similar. The canvas state is folded from the log like everything else. The server only
  accepts operations on cards the case really has (`caseCards`) and is idempotent on `event_id`. The whole
  canvas can be replayed to any moment, like the rest of the case.
  - *Discard* is housekeeping: the card leaves the canvas and can be restored.
  - *Dismiss* is the analyst's judgement on a finding, recorded as a disposition. The two are never
    merged.
- **The plan region is the reportable set** (#55). Docked cards group by category, then by the
  authority of their source, ordered PPM > fee table > factsheet > deck. A drop on a slot of another
  category is refused, and the card goes back to where it came from.
- **Find similar never asks the model to invent** (#57, #60, #64, #66).
  - Pressing it first shows the card's nearest passages at once: BM25 over the statements already
    extracted from the pack. This costs nothing, gives the same result every time, and every passage was
    checked against its page when it was extracted.
  - "Look further" re-runs extraction seeded with the card's passage, for what the first pass missed.
    That runs under the same verbatim grounding as every step, and its results arrive as candidate cards
    that never change the reviewed findings.
- **Words, if the analyst wants them, become chips** (#51, #63). A sentence is parsed into intent
  chips (category, authority, step) from a closed vocabulary; text that names nothing gives no chips.
  Chips stay first-class: the sentence is a shortcut to them, not a prompt.
- **Each card says why it matters, written once per product** (#62). After a findings run, one batched
  model call writes a line for every finding. Its quotes and numbers are checked against that finding's
  own sources, and a line that fails is dropped. Cards fall back to the line derived from the step's
  output, so this is never on the critical path.
- **The activity panel is the case's own step log** (#58). Every run, retry, failure and card operation
  is a visible line. There is no separate progress mechanism.

## Considered options

- **A chat box with good prompts.** Rejected: it hands prompt engineering to the user, gives different
  answers depending on who types, and returns prose that can't be docked, filed or audited. For a
  regulated buyer, the variation between prompts is itself an audit risk.
- **Find similar by provider embeddings.** Deferred, not rejected. It needs an `/embeddings` endpoint our
  OpenAI-compatible provider may not offer, plus a vector store. Lexical neighbours over grounded
  statements cover the case with no new infrastructure.
- **Seed find-similar from contradictions for finding cards.** Tried, then dropped (#66). On a real case
  it returned the same known issue every time.
- **Canvas positions in the browser only.** Rejected. A pin or a dock is part of the analyst's work,
  and a reviewer should see it on replay.
- **Generate a rationale per card on demand.** Rejected: one call per card multiplies cost and latency.
  One batched call per product costs about 1.7k tokens and 12 s, measured on Kimi K3.

## Consequences

- The interface has no free-text box in its main path. An analyst who has never written a prompt runs
  the whole review with cards, buttons and drags. The prompt engineering is compiled, versioned and
  tested behind them.
- The canvas inherits everything the log gives: replay, the hash chain, and what was decided and when —
  all under one fixed actor, `demo-analyst`, never a named person (ADR-0004).
- The card vocabulary is closed. A new kind of card or operation is a contract change, made additively
  like any other event.
- On a big case, the first view fits the content but never below 70% zoom, so it opens readable.
