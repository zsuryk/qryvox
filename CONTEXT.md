# Qryvox domain glossary

The words this project uses for its own concepts, as stage 1 settled them, plus the stage-2 terms agreed
in #21 (marked *stage 2*: contracts for them land with #23 and #27). Issues, tests, code and docs
use these terms with these meanings. When a concept you need is missing here, that is a gap to settle,
not licence to coin a synonym (see `docs/agents/domain.md`).

Each entry says what the term is, then what it is easily confused with. Code names are in `backticks`;
the contracts live in `shared/src`.

## The review

**Case** — one review of one pack, from opening to the analyst's last decision. Every event belongs to
exactly one case. A case is never reset or wiped: a new demo run opens a new case (ADR-0002). Its id is
the `event_id` of its own `case.opened` event, so a retried open lands on the same case.
*Not* a pack (the material reviewed) and *not* a session or login.

**Pack** — the set of documents one investment product ships with: a factsheet, a PPM excerpt, a
marketing deck and a fee table. Stage 1 has exactly one, the fabricated Larkspur pack (`larkspur-v1`),
served as static files under `/pack` with a manifest that pins each file by SHA-256.
*Not* a case (one pack can be reviewed in many cases).

**Document** — one file of a pack, identified by `document_id` and one of four kinds: `factsheet`, `ppm`,
`deck`, `fee_table`. The backend never receives the PDF: the browser reads it with the pinned pdf.js and
sends its text, one string per page, in a `document.ingested` event.
*Not* the PDF bytes (those stay static assets) and *not* "the text" alone (a document also carries its
hash, kind, page count and pdf.js version).

**PPM** — private placement memorandum, the legal document. The most authoritative document in a pack:
authority runs PPM, fee table, factsheet, deck. When two documents disagree, the finding is cited on the
less authoritative one.

**Fabricated** — invented for the demo. The product (Larkspur Global Income Fund) and the issuer
(Calderhaven Asset Management Ltd) do not exist, and every page says so.

**Ground truth** — the answer key for a pack: every planted finding with its category, kind, cited
document, page and verbatim quote. Stored apart from the documents (`/eval/ground-truth.json`) and
**never an input to any step**; only the eval reads it.
*Not* grounding (see below), despite the name.

**Planted finding** — a problem deliberately written into a fabricated pack, recorded in its ground
truth. The Larkspur pack has six.
*Not* a finding: a planted finding is what the pipeline should find; a finding is what it did find.

## The analysis

**Step** — one of the four stateless analysis stages, run in this order: `extract`, `decompose`,
`contradictions`, `findings`. Each is one model call, driven by the browser, reading only the log.
*Not* a step run (one execution of a step).

**Step run** — one execution of one step in one case, identified by a `step_run_id` the browser
generates. It is recorded as `step.started` followed by `step.completed` or `step.failed`, and each run
names the completed run it consumed (`input_run_id`). A run completes at most once.
*Not* a job or task: there is no background work; a run is one awaited HTTP call.

**Retry / re-run / replay** — three different things, often mixed up:
- **Retry**: sending the *same* `step_run_id` or `event_id` again, e.g. after a network failure. A completed
  run returns its stored result with no model call; a duplicate event appends nothing.
- **Re-run**: running a step again under a *new* `step_run_id`. The model is called again. A findings re-run
  supersedes the findings already on the board.
- **Replay**: folding the log up to an earlier seq to see the case as it was. Never calls a model.

**Prompt version** — the name of the prompt a step ran with, e.g. `extract@1`, recorded on every step
event (`PROMPT_VERSIONS`). The prompt text itself lives only in the backend and never reaches the
interface: the analyst never sees or writes a prompt.

**Model** — whichever LLM answered, as configured by `LLM_MODEL` behind any OpenAI-compatible endpoint.
Recorded on every step event. Nothing in the workflow depends on which vendor it is.

**Statement** — a sentence copied verbatim from a document, with its page. The output of `extract`.

**Claim** — in the analysis, one atomic fact a document asserts: a statement split into single facts,
each with a category, a topic shared across documents (e.g. "management fee") and a short assertion.
The output of `decompose`, with ids like `c6`. See the open question on this word below.

**Issue** — a problem the `contradictions` step names between claims, pointing at claim ids. Internal to
the pipeline: the board never shows an issue, only the finding made from it.
*Not* a GitHub issue, and *not* a finding.

**Finding** — what the board shows: one problem in the pack, with its kind, category, severity, a
one-sentence description, a citation and, when there is one, a counterpart. Created by the `findings`
step as `finding.created` events. A finding states what the documents say and where they conflict; it
never computes a number and never advises.
*Not* a planted finding, an issue, or a claim.

**Kind** (of a finding) — what sort of problem it is:
- `contradiction` — two documents state the same thing differently.
- `unsupported_claim` — the deck or factsheet asserts something the PPM does not back.
- `disclosure_gap` — the deck promises a benefit without the risk warning that should accompany it.
- `policy_gap` *(stage 2)* — a document fails an institutional product rule, whatever the other documents say;
  the finding names the rule. Differs from `disclosure_gap`, which compares documents with each other: a
  `disclosure_gap` is "the deck lacks a warning the PPM has", a `policy_gap` is "the factsheet lacks what our
  rules require". One passage can be both.

**Category** — the area a finding concerns, and the board's filter: `fees`, `strategy`, `risk`, `terms`.
*Not* the kind: "fees / contradiction" is one finding's category and kind.

**Severity** — `high`, `medium` or `low`, as the `findings` step rates it. Orders the board; it is a
reading aid, not a decision.

**Citation** — where a finding comes from: document, 1-based page and a verbatim quote. Always page plus
quote, never character offsets, so highlighting survives pdf.js text-layer changes (ADR-0001).

**Counterpart** — the passage a finding conflicts with, or the disclosure it lacks; `null` when nothing in
the pack speaks to it (typical for an unsupported claim). Same shape as a citation.

**Quote** — the exact text of a citation or counterpart. On the board it is always document text: the
`findings` step lets the model choose severity and wording only, and the server attaches quotes from
grounded claims.

**Grounding** — the server's check that each quote a step produces really appears on the page it cites,
with whitespace normalised. Ungrounded statements and claims are dropped; a run with nothing grounded
fails.
*Not* ground truth.

**Rationale** — the one line on a board card saying why the finding counts as one (e.g. "Two documents
state the same fact differently: factsheet and ppm"). Derived by the board from the finding's kind and
documents; it is not stored in the log.

## The board and decisions

**Board** — the findings currently in play for a case: every finding not superseded
(`activeFindings`). Filtered by category; a dismissed finding stays on the board, marked dismissed.

**Supersede** — what a findings re-run does to the findings already on the board: one
`finding.superseded` each, in the same transaction as the new run's findings. A superseded finding
leaves the board but stays in the log, with any disposition it was given.
*Not* dismissed (the analyst's decision) and *not* deleted (nothing is ever deleted).

**Disposition** — the analyst's explicit decision on one finding: `approved` or `dismissed`, appended as
`disposition.changed`. Only a person decides; no step ever approves or dismisses, and a finding with no
disposition is *undecided*, not dismissed. Deciding again replaces the decision on the board; the log
keeps both. A superseded finding cannot be decided (409).

**Analyst / actor** — the analyst is the licensed human accountable for decisions. The actor is who an
event records as having acted. In stage 1 every event's actor is one fixed identity, `demo-analyst`
(`ANALYST_ACTOR`), with no login and no picker.

## Policy and advice (stage 2)

**Rules** — the institution's own rules, versioned as one set (`rules@1`) in two groups: **product rules**
(P1, P2, …), which a document must meet to go on the shelf, and **suitability rules** (S1, S2, …), which
decide whether a product fits a client. Fabricated institutional policy, never quoted regulation. Every
event that applies a rule records the rules version.

**Shelf / verified product** — a product whose pack has been through the analysis steps (and, when the
pipeline runs it, the `compliance` step) and whose attributes have been read, naming the product. Advice is
drafted on verified products only. The shelf is every such product, the latest verified case of each.

**Alternative** — another product on the shelf that the same suitability rules find suitable for a client
whose advice is not suitable, recorded on that advice with its own reasons and citations. An empty list says
nothing on the shelf fits. *Not* a recommendation the model makes: the rules decide it.

**Document version** — a document ingested again under the same `document_id` (a product update, e.g.
Larkspur v2) replaces the earlier version for every later step and in the fold; the earlier stays in the
log. A new attributes run then supersedes advice drafted on the old one.

**Client** — the person advice is for, known to the log only by a pseudonymous id. *Not* the analyst or the
adviser, and *not* a user of the analysis.

**Client profile** — a client's answers, captured with buttons only: goal, horizon, risk level (1–5),
knowledge (`novice`, `informed`, `expert`), whether they rely on the income or may need the money at short
notice, and exclusions. Recorded as `client.profiled`; a new version supersedes advice drafted on the old
one. Personal data never enters the log.

**Product attribute** — one fact about a product that suitability needs (minimum holding period,
sub-investment-grade allowance, capital protection, dealing terms, …), extracted by the `attributes` step
with a citation, the PPM preferred. Read from the documents, never computed.

**Persona** — a fabricated client with an expected verdict, stored apart like ground truth and never an input
to any step: Mrs Chan, Mr Lee, Ms Wong.

**Verdict** — `suitable`, `conditional` or `not_suitable`: the outcome of the suitability rules for one
client and one product. Decided by the rules, never by a model.

**Reason** — one ground for a verdict: a suitability rule, the product citation it rests on, and the profile
answer it compares against.

**Disclosure** — something the client must be told whatever the verdict, e.g. a fee finding the analyst has
not dismissed (S6).

**Explanation** — the `explain` step's wording of a verdict's reasons at each knowledge depth. It restates
the given reasons and quotes and nothing else.

**Advice** — a verdict for one client and one product, with its reasons, disclosures and explanation.
Drafted by the system (`advice.drafted`), decided by the adviser (`advice.decided`), superseded when the
profile or the product changes (`advice.superseded`). A client sees approved advice only.
*Not* a recommendation the model makes: the rules decide and the adviser signs off.

**Adviser** — the licensed human who approves or rejects advice. In stage 2, like the analyst, the fixed
`demo-analyst` actor (ADR-0004).

**Reading** — the depth a client chose to read their advice at, recorded as `client.read` only once they
switched on sharing it on their own page (#38). Its actor is the client's pseudonymous id — the one event a
client, not the analyst, is recorded as making. Three in a row of another depth suggest the adviser asks
again; a reading never changes a profile.

## The log

**Event** — one immutable record of something that happened in a case, appended to the single `events`
table. Events are the only source of truth: current state is derived from them, never stored. The
vocabulary is `case.opened`, `document.ingested`, `step.started`, `step.completed`, `step.failed`,
`finding.created`, `finding.superseded`, `disposition.changed`.

**Event log** — all of a case's events in seq order. The README's "audit log" and ADR-0002's
"event-sourced audit log" are the same thing. Append-only, enforced by database triggers.

**Envelope / payload** — every event is an envelope (`seq`, `event_id`, `case_id`, `type`, `v`, `actor`,
`at`, `step_run_id`) around a payload, whose shape depends on the type.

**Slim / full payload** — the event list returns slim payloads, without heavy fields (a document's page
text, a model's raw response), so every response stays under Vercel's 4.5 MB cap. The per-event payload
endpoint returns the full payload.

**Seq** — an event's position in its case: 1, 2, 3… with no gaps, per case, not across the table. The
ordering key for everything, including replay. A gap is a hard error, never a partial board.
*Not* a timestamp: `at` is wall-clock time for display; seq is the order.

**Fold** — deriving a case's state by reading its events in seq order (`fold` in `shared`). The server and
the browser run the same fold, so the browser's replay is the server's derivation.

**Chain / hash** — each event stores a SHA-256 hash over its full content plus the previous event's hash,
per case. Recomputing the chain reveals any edit or deletion: the chain is **tamper-evident, not
tamper-proof**. Someone with database credentials can drop the triggers and recompute it (ADR-0002).

**Latest hash** — the hash of a case's newest event, which commits to everything before it. Shown in the
product as the anchor of the chain.

## Measurement

**Eval** — measuring the pipeline against a pack's ground truth. A finding counts as a true positive when
its category and its quote match a planted finding.

**Recall** — planted findings found ÷ planted findings in the pack.

**Precision** — findings that match a planted finding ÷ findings on the board.

## Easily confused pairs

| These | Differ in |
|---|---|
| case / pack | the review / the material reviewed |
| planted finding / finding | what should be found / what was found |
| statement / claim / issue / finding | the four steps' outputs, in pipeline order |
| ground truth / grounding | the answer key / the quote check |
| retry / re-run / replay | same id, no new model call / new id, new model call / read the past, no model |
| dismissed / superseded | the analyst's decision / replaced by a later run |
| citation / counterpart | where the finding comes from / what it conflicts with or lacks |
| seq / `at` | the order / the wall-clock time |
| kind / category | what sort of problem / which area |
| disclosure_gap / policy_gap | a document lacks what another document has / a document lacks what our rules require |
| finding / advice | a problem in the pack / a verdict for one client on one product |
| verdict / disposition | the rules' outcome for a client / the analyst's decision on a finding |
| product rule / suitability rule | must hold for the product to go on the shelf / decides whether it fits a client |
| analyst / adviser / client | reviews the pack / signs off advice / receives advice |

## Words we avoid

| Avoid | Say instead | Why |
|---|---|---|
| flag, alert (as a noun) | finding | The README's pitch says "flag"; the product, code and tickets say finding. |
| issue (for what the board shows) | finding | Issue is the `contradictions` step's internal output. |
| review, session, project | case | One word for one review. |
| bundle, document set, dossier | pack | One word for the product's documents. |
| accepted, rejected, pending | approved, dismissed, undecided | The contract's values; nothing is ever auto-rejected. |
| status (of a finding) | disposition | Status is overloaded (step runs have one). |
| history, ledger, journal | event log | One log, one name. |
| job, task | step run | There is no background work. |
| tamper-proof, immutable chain | tamper-evident chain | The honest claim (ADR-0002). |
| snapshot (for the event list) | event list, event page | "Snapshot" is reserved for the stage-2 JSON export. |
| offset, position (in a document) | page and quote | Citations never use character offsets. |
| recommendation (for what the model does) | verdict, advice | The rules decide and the adviser signs off; no model recommends. |
| suitability score, rating | verdict | A verdict is one of three values; nothing is scored or computed. |
| advisor | adviser | One spelling, the README's (tickets written before #21 say advisor). |
| user (for the client) | client | The analyst and the adviser use the product; the client receives advice. |

## Open questions

These words are genuinely ambiguous today. They are flagged rather than given a confident definition;
settle each one before it spreads further.

1. **"Claim" means three things.** In the README, a claim is what a product's documents assert
   ("verifies an investment product's own claims"). In the pipeline, a claim is `decompose`'s atomic
   fact (`c6`). And `Finding.claim` is a finding's one-sentence description, which is not a claim in
   either sense. Renaming the field (e.g. to `statement` or `description`) is a breaking contract change,
   so it would need an additive new field first.
2. **"Verify" means two things.** The chain is *verified* (`GET /cases/:caseId/verify`, integrity of the log), while the
   README's product *verifies claims* (consistency of the documents). Saying "check the chain" for the
   first would remove the clash.
3. **"Extract" means two things.** The browser *extracts* text from a PDF with pdf.js; the `extract` step
   *extracts* statements from that text with a model.
4. **"Contradictions" names a step that finds more than contradictions.** The step returns all three kinds
   of issue; only one kind is a contradiction.
5. **The analyst is a constant, not a person.** Every decision, including an adviser's sign-off in stage 2,
   is attributed to `demo-analyst` (ADR-0004). Real identities remain future work.
6. ~~**How exactly a quote "matches" in eval.**~~ Settled by the eval tiles (#15): a finding matches a planted
   one when they share a category and either of the finding's quotes (citation or counterpart) contains the
   planted citation's quote or is contained by it (`frontend/lib/eval.ts`). It does not check the rule a
   policy gap names, so a P1 finding on a passage the answer key plants as P2 still counts.
7. **Severity has no written definition.** It is whatever the `findings` prompt asks the model for; nothing
   yet says what high, medium and low must mean to the analyst.
8. **Rationale is not in the log.** It is derived on screen, so a replayed board shows today's wording,
   not the wording the analyst saw. That is harmless while it is purely derived; it matters if the
   wording ever changes.
