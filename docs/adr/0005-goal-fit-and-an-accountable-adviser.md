# Advice that answers the client's goal, decided by an accountable adviser

## Status

accepted — 2026-10-03 — deciders: <names>. Tickets #41, #42 (under #40). Supersedes nothing; extends
ADR-0004's adviser sign-off.

## Context

Two criteria, *personalisation* and *investment outcome quality*, ask
whether the advice serves what the client is trying to achieve, and *fiduciary & regulatory compliance*
asks whether the human decision behind it would satisfy a regulator. Measured against them, three gaps:

1. **The client's goal decided nothing.** The questionnaire asked what the money was for (income, growth,
   keeping capital safe) and no suitability rule read the answer.
2. **A rejection recorded no reason.** The adviser could approve or reject, and a rejected draft said
   nothing about why — the first thing a regulator asks.
3. **Every client was treated alike.** Hong Kong regulators expect extra care for vulnerable clients, such
   as the elderly; a 68-year-old new to investing and living on the income went through the same single
   click as anyone.

## Decision

- **S7, "Built for what you want" (rules@2).** The attributes step reads the product's *primary objective*
  from the PPM's statement of it, cited and grounded like every attribute. S7 meets when the client's goal
  is that objective and **warns** otherwise. It never blocks: an income fund is not unsuitable for a growth
  investor on that alone, but the client is told, in their own explanation, what the product is built for.
  Adding a rule changes what the same inputs produce, so the rule set moves to **rules@2**; every advice
  records the version it was drafted under.
- **A rejection carries its reason**, chosen from five (answers miss the client's circumstances; a product
  fact is wrong; the explanation is not adequate; the client prefers another product; needs a conversation
  first) — never typed, so reasons can be counted. The API refuses a rejection without one.
- **Vulnerable clients get a second key.** A client is vulnerable when they are 65 or over (a new, optional,
  coarse answer — a band, not a birth date) or new to investing while relying on the income. Their advice
  can be approved only when the adviser confirms they have **explained it to the client directly**; the
  confirmation is recorded on the decision, and the API refuses an approval without it. The client, when
  they checked the product themselves, is told their adviser will speak with them first.
- All three are additive: new optional fields on the profile, the attributes and `advice.decided`;
  everything recorded before still parses and folds.

## Considered options

- **S7 as a block.** Rejected: suitability for a goal is a matter of degree the rules cannot measure, and a
  block would remove products a client might reasonably choose once told. A warning keeps the client and
  the adviser informed without pretending to precision.
- **Several objectives per product, or a scored fit.** Rejected: a score would be a number we cannot
  ground, and the PPM states one objective first. One cited primary objective is checkable.
- **Free-text rejection notes.** Rejected: the product promises no text boxes, and free text cannot be
  counted, audited or translated. A short list can be extended.
- **Vulnerability as a suitability rule.** Rejected: it would change verdicts (and hide a suitable
  product), when what regulators ask for is a *process* — more care before the advice is given. It is a
  control on the adviser's decision, not on the verdict.
- **Collecting an age or date of birth.** Rejected under data minimisation (PDPO DPP1): the only question
  the rules ask is whether the client is 65 or over.

## Consequences

- The client's goal now shapes what they read: Mr Lee (growth) is told Larkspur is built mainly for income;
  Mrs Chan (income) is told Wrenfield is built first to keep capital safe, and is still offered it.
- Every adviser decision in the log is explainable: which way, when, under which rules version, and — for
  a rejection — why, and — for a vulnerable client — that it was explained to them directly. The decision
  carries an actor, but in demo mode that actor is always `demo-analyst`, so the log explains what was
  decided and never which of several people decided it (ADR-0004).
- Advice drafted under rules@1 keeps saying rules@1; replay shows each advice under the rules it was given.
- Attributes runs recorded before rules@2 have no primary objective; S7 is silent on them until the facts
  are read again.
- Approving a vulnerable client's advice takes one more deliberate act. That friction is the point.
