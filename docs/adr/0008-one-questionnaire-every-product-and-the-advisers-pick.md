# One questionnaire for every product, and the adviser's pick

## Status

accepted — 2026-10-04 — deciders: Tyson Chen. Ticket #71. Extends ADR-0005's adviser sign-off and ADR-0006's
language; supersedes nothing. The single-product link flow stays.

## Context

A client started from one product's link and saw that product's verdict; the whole shelf (#68) sat at the
bottom of the page. This product runs the journey the other way: answer the questionnaire once, then see every
verified product, each saying whether it suits you.

The log is per case, and a case is one product (ADR-0002). A hash chain, the fold, replay and the audit all
read one case at a time. Nothing but the shelf comparison reads across cases, and it reads only what the
rules computed. So "the client's answers, once" has to reach many cases without turning the log into
something else.

## Decision

- **The answers are recorded in every verified product's case, as a `client.profiled` each, all from the same
  answers.** `POST /clients` takes the profile once and, for every verified product (a completed findings
  run and an attributes run that names the product, the latest case per product, as the shelf finds it),
  appends the profile to that case and drafts that case's advice. It is the existing `recordProfile` and
  `draftAdvice` with no model call, so the rules, the supersede-on-change behaviour and the audit are the
  ones every case already has. Each case's log, read alone, still shows what the client answered and what
  was advised for that product.
- **One request, many appends, safe to retry.** The browser names one `event_id`. Every event the call
  appends takes an id derived from it and the case, so a lost response or a failure part-way is answered by
  sending the same request again: what was written is returned, what was not is written. There is no
  cross-case transaction and none is needed, because a case with its profile and no advice yet is a state the
  log already has.
- **The list is found by the client's pseudonymous id.** `GET /clients/:clientId` names the cases that hold
  that client's answers. The page reads each case's events, as the shelf comparison already reads other
  cases' events for their citations, and folds them. There is no new store and no index to keep in step.
- **The adviser decides the whole list in one decision.** `POST /clients/:clientId/decision` approves, or
  rejects with its one reason, the client's advice in play in every case, after checking that all of it can
  be decided (a vulnerable client's confirmation, ADR-0005, applies once to the list). The decision is still
  an `advice.decided` per advice, so every case's log carries the adviser's act on its own product.
- **The adviser may mark one suitable product as their pick.** It is recorded on that advice's decision as
  `adviser_pick: true`, an additive optional field. Only an approved, suitable advice can be a pick, and only
  one per client list.
- **The page says "suits you" or "doesn't suit you" on every product, and "recommended" only on the pick.**
  Under the SFC regime a recommendation is the adviser's act: it is a person's judgement of what to buy, made
  with the client's circumstances in mind and answerable for. The list is the rules' result and nothing more,
  a comparison of stated facts against the client's answers. Calling a product "suitable" recommended, or
  letting the order of the list read as a ranking, would put the adviser's word in the rules' mouth. The
  pick is the one place where a person said "this one", and it is recorded as theirs.
- **The explanation is written on open.** The list costs no tokens. Opening a product runs one explain on
  that product's advice, in the client's language, and the page shows it; unopened products never spend any.

## Considered options

- **A client-level profile that cases read.** Rejected. It would be a log of its own with its own chain,
  fold and replay, and the rules would read from outside the case they are drafted in. A case could no
  longer be audited alone: its advice would rest on answers that live elsewhere.
- **A profile in one "home" case, referenced from the rest.** Rejected for the same reason, with an arbitrary
  home added.
- **Drafting a product's advice when the client first opens it.** Rejected. The list has to be ordered by
  verdict, so every product is drafted up front; it costs only the rules.
- **An approval per product.** Rejected. The adviser reads the client's whole picture once, and one decision
  matches that. The decision still lands on each product's own log.
- **Marking the best suitable product automatically.** Rejected. That is a recommendation by the rules. The
  pick is an adviser's act and never defaulted.
- **Letting the pick be any product.** Rejected. A product the rules find not suitable, or that needs
  confirming, is not one the adviser can recommend from this page.

## Consequences

- The client's answers are stored once per verified product, so a client's profile appears N times across the
  log. They are pseudonymous and coarse by design (ADR-0005), and each copy is what that case's rules read.
- A product verified after a client answered is not on their list until they answer again, or an adviser
  records their profile in its case. The list is the shelf as it stood.
- Changing an answer is a new `client.profiled` in each case, as it is for one case today, which supersedes
  that case's advice.
- Decisions recorded before the pick have none, and fold as no pick.
- The single-product page and its shelf comparison are unchanged. A client who came from a product's link
  still has no list.
