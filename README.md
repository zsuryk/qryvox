# Qryvox — Investment Product Diligence Copilot

> *Democratise the diligence behind private banking: an AI copilot that verifies an investment product's own claims — across its factsheet, PPM, marketing deck, and fee table — before it reaches the shelf, and you never write a prompt to use it. Every analysis is a button, every claim a clickable citation, every decision a keystroke — and every one of them logged and replayable. It advises only on products it has verified, and only once a licensed adviser signs the advice off.*

## Target user

**The institution-facing intermediary — small-to-mid wealth platforms, robo-advisors, and licensed advisers — with the retail investor as the beneficiary.**

- **Who it's for:** the investment / operations analyst at a mid-sized robo-advisor or wealth platform who vets a product before shelf placement, and the licensed adviser who signs off advice on it
- **Who benefits:** the retail client, who gets advice fitted to their goals, risk profile and knowledge — on products whose claims were verified first, the product-vetting layer they could never access or afford directly
- **Explicitly not:** giant banks (in-house due-diligence teams and budgets already cover this) and not individuals picking products themselves (retail investors don't run document diligence — their platform's analyst does, before the product ever reaches them)

## The pitch: two layers

| Layer | Audience | Claim |
|---|---|---|
| **The hook** | Live demo | "Not another ChatGPT wrapper — the prompting is compiled into the interface" |
| **The moat** | The actual buyer (regulated intermediary) | Citation-linked findings + replayable audit log + human-in-the-loop state machine + live precision/recall — *defensible diligence* |

One thesis underneath both: **expertise lives in the product, not in the user's head.** The UI makes it usable; the audit layer makes it buyable.

## The hook: not another ChatGPT wrapper

> *"Most similar products are just ChatGPT wrappers with custom prompts. We revolutionised the UI interaction: you don't need to be an expert in prompt engineering to use it — we've done the prompting for you. Simply interact with buttons and navigate."*

The model is the commodity; the **interaction layer** is the product. Competitors ship a text box and hope the user phrases the question right. We compiled every capability into purpose-built controls, so an investment analyst who has never heard of "prompts" can run a full document review by clicking through a guided workflow.

For this target user it lands as more than convenience: prompt variance is audit risk. "Every analyst runs the same compiled procedure, identically, regardless of who clicks" is process control — the compliance argument for a promptless UI.

### Interaction principles

- **Zero free-text in the main flow.** There is no chat box in the demo path. Every task is reachable by drag, click, toggle, or keyboard shortcut.
- **Prompts are compiled, not typed.** Each control carries a pre-engineered, domain-tuned prompt underneath; the user chooses *what to examine*, the UI decides *how to ask*.
- **Domain vocabulary, not prompt vocabulary.** The user speaks "flag unsupported fee claims" — the interface translates, scopes, and executes.
- **Progressive disclosure.** Simple by default: drop a document, get flags. Power lives one layer down (filters, re-run scopes, thresholds), never in a text field.
- **The model is swappable.** Because no prompt knowledge leaks to the user, the LLM behind the UI can change without changing the workflow.

**Anticipated question — "how is this not a prompt wrapper?"** → "A wrapper gives you a text box and ships the prompt engineering as a string. We shipped it as an interface: the prompt engineering is invisible, versioned, and testable, and the user only ever touches controls that already know what to do."

## The moat: defensible diligence

The interaction wins the room; the audit layer wins the buyer. A regulated intermediary doesn't switch tools because a UI is pretty — they switch because the output survives scrutiny. The workflow runs in three layers, each feeding the next:

1. **Verify the documents** — claim decomposition → contradiction detection → citation → human disposition
2. **Check institutional policy** — each document against the institution's product rules (e.g. every risk type in the PPM named in the factsheet)
3. **Match the client** — the verified product against a client profile, judged by fixed suitability rules, explained at the client's depth, signed off by an adviser

…and every step is replayable. Nothing is ever computed: claims and attributes are read and cross-checked, and suitability compares levels and terms — no returns, no forecasts.

- **Citation-linked findings** — every flag points to the exact passage in the exact source document; no black-box claims to defend
- **Replayable audit log** — any past decision reconstructable exactly, on demand, for a regulator or an internal reviewer
- **Human-in-the-loop disposition** — a state machine of approve/dismiss with no auto-rejection; accountability stays with the licensed human
- **Rules judge, the model reads** — suitability verdicts come from fixed, versioned rules, so the same client and product always get the same verdict; the model only extracts cited attributes and explains the verdict's own reasons
- **Verified shelf only** — advice can only be drafted on a product that has been through layers 1 and 2
- **Live precision/recall** — an eval harness with planted ground truth proves accuracy as a measurement, not a vibe — the standard this buyer already applies to vendors

The comparison class isn't ChatGPT — it's Excel, manual review, and expensive GRC tools. This is what they're buying: product diligence they can stand behind at shelf-placement review.

**Anticipated question — "where's the innovation beyond UX?"** → "The UI is how a non-expert drives it; the citation-replay-eval layer is why a regulated firm can trust what comes out. Competitors ship one or the other — a chat box, or a black box."

**Anticipated question — "isn't AI advice a regulatory risk?"** → "The AI never decides. Fixed rules decide suitability, every reason cites the product's own documents and the client's own answers, and nothing reaches the client until a licensed adviser approves it. And it can only advise on products it has verified — advice built on unvetted product claims is exactly what gives democratised wealth products a bad name."

## Why this fits *Finance & Wealth — Democratising Private Bank-Level Advice*

The track is about advice — but what makes private-bank advice trustworthy isn't the recommendation, it's the **products on the shelf**. Private banks run exhaustive product due diligence before an investor ever sees an offer; retail/robo platforms list thinly-vetted products because it costs too much. This project **democratises that product-vetting layer, and builds the advice on top of it**: personalised advice, but only on a verified shelf and only with a human's sign-off — which is how a regulated firm can actually ship it.

Democratising isn't only about cost. Product vetting is also gated by *expertise* — knowing which claim in the marketing deck conflicts with page 12 of the PPM. We democratise that too: the expertise lives in the interface, so a non-expert drives the entire review.

## What It Does (demo flow — an interaction tour)

Every step below is a distinct UI surface. Watch the cursor: it never types a sentence.

1. **Drop-zone intake** — drag the product pack (factsheet, PPM, marketing deck, fee table) onto the drop zone; documents fan out as tiles and claim extraction runs automatically
2. **Claim board** — each document is decomposed into discrete claims; contradictions, fake claims, and disclosure gaps appear as pinned cards with filter toggles (fees, strategy, risk, terms) — a fee stated two different ways, a marketing claim with no support in the PPM, a risk disclosure missing where the deck makes promises — all selected by clicking, not asking
3. **Citation split-pane** — click any flag's citation chip to open the source document beside it, with the exact passage highlighted
4. **Verified claims card** — a one-paragraph verified product profile for shelf-placement review, publishable to the retail investor; regenerate with a button, tune with toggles, never by rewriting a prompt
5. **Disposition console** — approve/dismiss each finding with buttons or keyboard shortcuts; state machine, no auto-rejection, human-in-the-loop
6. **Replay scrubber** — drag the timeline scrubber to reconstruct any past decision exactly (audit log + replay)
7. **Policy checks** — institutional product rules run as a pipeline step; a breach appears on the board as a `policy_gap` card naming the rule
8. **Client questionnaire** — goals, horizon, risk and knowledge captured with buttons only; three fabricated personas load in one click
9. **Advice draft + adviser console** — a verdict per client (suitable / conditional / not suitable), every reason tied to a rule, a cited passage and a profile answer; the adviser approves or rejects
10. **Client advice page** — the approved advice at the client's depth (novice / informed / expert), with a citation chip on every reason
11. **Live eval dashboard** — the fabricated product pack ships with planted findings, policy gaps and personas with expected verdicts; precision/recall and advice-accuracy tiles update live during the demo

## Track-Brief Mapping (accurate / auditable / fast)

| Brief word | Proof |
|---|---|
| **Accurate** | Planted-contradiction eval set + live precision/recall — not a vibe, a measurement |
| **Auditable** | Citation-linked findings + replayable audit log |
| **Fast** | Document pack → scored findings in seconds vs. days of manual review |

## Brief mapping (must achieve all three objectives)

| Objective | Met by |
|---|---|
| **Fiduciary obligation** | Product diligence (CFA Standard V(A)), policy checks, suitability (III(C)), adviser sign-off, tamper-evident audit log |
| **Client experience** | Advice and explanation depth fitted to goals, risk profile and knowledge; zero text boxes |
| **Investment outcomes** | A verdict per client; a changed profile or product re-assesses and supersedes the old advice |
| **Data ecosystem** (key requirement) | [docs/data-ecosystem.md](docs/data-ecosystem.md): what is needed, what is hard to capture, assumptions, privacy limits (pseudonymous ids in the log, erasure by deleting a key) |
| **Bonus** | Product updates trigger re-verification; knowledge level learned from how the client reads |

The client layer is tracked in #20.

## Status (2026-10-04)

**Works end to end, locally, on a real model** (Kimi K3 via its OpenAI-compatible API): drop a pack → five analysis steps → findings with citations, checked against the institution's rules → the analyst's decisions → the product's facts read → clients' answers → advice drafted by the rules → explained at three depths → approved by the adviser → the client's own page. Every step is in a hash-chained log that can be replayed to any event. The case opens on a **canvas of cards** ([ADR-0007](docs/adr/0007-a-canvas-of-cards-over-the-case-log.md)): results tile in as cards; the analyst docks them into the reportable plan, pins, discards, finds similar passages, and types a sentence that becomes chips, all without a prompt. **Deployed** to qryvox.vercel.app (#17), but the production model is still being switched back to Kimi K3: on the slower stealth model, the pipeline times out at `compliance`.

| Area | State | Tickets |
|---|---|---|
| **Layer 1 — verify documents** | ✅ Drop zone, five-step pipeline, claim board, citation pane, disposition console | #7 #9–#13 |
| **Layer 2 — check policy** | ✅ `rules@1` P1–P4, the `compliance` step, policy-gap cards naming their rule | #23–#26 |
| **Layer 3 — match the client** | ✅ Questionnaire, rule-based suitability, adviser console, explanations, the client's page | #27–#34 |
| Client self-service | ✅ A client link per product: clients answer themselves, the rules draft at once, the adviser confirms from a review queue, the client's page updates by itself | — |
| Measurement | ✅ Recall / precision and advice-accuracy tiles, live from the log | #15 #35 |
| Replay | ✅ A scrubber that rebuilds the case at any event | #14 |
| Bonus | ✅ Product updates (Larkspur v2), a second product with alternatives (Wrenfield), learned reading depth | #37 #38 #39 |
| Data ecosystem | ✅ [docs/data-ecosystem.md](docs/data-ecosystem.md) | #36 |
| Client-layer pass | ✅ S7 goal fit (`rules@2`), rejection reasons, vulnerable-client confirmation (ADR-0005); the client journey in 繁體中文 (ADR-0006) | #41 #42 #43 |
| Compliance map | ✅ [docs/compliance.md](docs/compliance.md): SFC, HKMA, PDPO and CFA obligations against our controls | #44 |
| Cost and scale, measured | ✅ [docs/scalability.md](docs/scalability.md): ≈16k tokens per product, ≈2.8k per client | #45 |
| **Canvas** | ✅ Infinite canvas as the case's first section: pan/zoom/touch, auto-tiled cards, plan region, discard and pin, find similar (instant BM25 + grounded re-run), typed intent that becomes chips and filters the cards (`parse@1`), model-written rationales (`rationale@1`), activity panel | #48–#70 |
| **Client list** | ✅ Answer once at `/start` and see every verified product: suits or doesn't, with deciding reasons and sources; the adviser approves the list and may mark a pick; explanations written on open, in either language | #68 #71 #75 |
| Demo readiness | ✅ `pnpm seed:demo` builds the demo state on any deployment · 🚧 production run and rehearsals | #72–#74 |
| Spend protection | ✅ Origin allow-list, rate limit, API token end to end, `API_TOKEN` set in production | #16 #19 |
| Production deploy | ✅ Deployed (owner, CLI) · 🚧 switch the production model back to Kimi K3 with `LLM_REASONING_EFFORT=low` | #17 |

**Measured on Kimi K3** (`LLM_REASONING_EFFORT=low`; real pdf.js text): Larkspur recall 9/10, precision 10/10, all five steps in about 2½ minutes; Wrenfield recall 2/2, precision 2/4; every product attribute read correctly on both; all three personas got their expected verdict, and Mrs Chan's advice points her to Wrenfield. Without `low`, a reasoning model can think for over 300 s on one step — past Vercel's limit.

## How it's built

- **TypeScript monorepo** (pnpm): `frontend/` (Next.js), `backend/` (Hono), `shared/` (zod contracts and the fold), deployed as two Vercel projects ([ADR-0001](docs/adr/0001-typescript-monorepo-on-vercel.md)).
- **Event-sourced:** one append-only, hash-chained `events` table is the only source of truth; state is a fold over it, and the browser runs the same fold to replay ([ADR-0002](docs/adr/0002-event-sourced-audit-log.md)).
- **Model-agnostic:** each step is one call to any OpenAI-compatible endpoint; every quote is checked against its page before it is kept ([ADR-0003](docs/adr/0003-openai-compatible-model-endpoint.md)).
- **Rules, not the model, decide suitability:** `shared/src/suitability.ts` is a pure function of the profile, the cited attributes and the open findings.
- **Fabricated data only:** two invented products — Larkspur (and its revision, Larkspur v2) and Wrenfield — with their ground truth and the personas' expected verdicts; the answer keys live in `frontend/public/eval/` and are never an input to any step.
- Words mean one thing each: see [CONTEXT.md](CONTEXT.md).

## Running it locally

Needs Node 22+ and pnpm 12.8.1 (`npm i -g pnpm@12.8.1`).

```bash
pnpm install
cp .env.example .env              # a local file database works as is
pnpm --filter @qryvox/backend dev     # API on http://localhost:8787
pnpm --filter @qryvox/frontend dev    # app on http://localhost:3000 (builds shared first)
```

- **No model needed to look around:** `/board` shows a recorded case with no model key and no API running. Running new analysis steps needs `LLM_BASE_URL` and `LLM_MODEL` in `.env` (a local Ollama works; see `.env.example`).
- **API explorer:** `pnpm --filter @qryvox/backend api:docs` → http://localhost:8788/docs (English / 中文).
- **Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- **Regenerate the pack and answer keys** after editing `shared/pack/`: `pnpm --filter @qryvox/shared pack:generate`.
- **Deploying** is owner-only; read [docs/deploying.md](docs/deploying.md) first.

## Scope (weekend-feasible)

- **MVP:** fabricated product pack (factsheet, PPM excerpt, marketing deck, fee table), 6 planted contradictions → drop-zone intake, claim board, citation split-pane, disposition console, eval dashboard, audit replay
- **Stretch:** regulatory filing/news cross-check, tamper signals, retail-facing verified claims card, keyboard-first navigation, continuous re-verification (pack re-checks when the product publishes an update)
- **Client layer (in progress, #20):** policy checks (`policy_gap`), client profiles, rule-based suitability, adviser sign-off, client advice page at three depths
- **Explicitly out of scope (say it in the pitch):** portfolio construction, any performance computation — no returns, no volatility, no backtesting — and advice on any product that has not been verified. Claims and attributes are extracted and cross-checked, never computed; suitability compares levels and terms. Zero math, no unverified advice, zero text boxes.
