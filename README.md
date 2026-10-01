# Qryvox — Investment Product Diligence Copilot

> *Democratise the diligence behind private banking: an AI copilot that verifies an investment product's own claims — across its factsheet, PPM, marketing deck, and fee table — before it reaches the shelf, and you never write a prompt to use it. Every analysis is a button, every claim a clickable citation, every decision a keystroke — and every one of them logged and replayable. No investment advice.*

## Target user

**The institution-facing intermediary — small-to-mid wealth platforms, robo-advisors, and licensed advisers — with the retail investor as the beneficiary.**

- **Who it's for:** the investment / operations analyst at a mid-sized robo-advisor or wealth platform who vets a product before shelf placement
- **Who benefits:** the retail investor, who sees verified claims before buying — the product-vetting layer they could never access or afford directly
- **Explicitly not:** giant banks (in-house due-diligence teams and budgets already cover this) and not individuals picking products themselves (retail investors don't run document diligence — their platform's analyst does, before the product ever reaches them)

## The pitch: two layers

| Layer | Audience | Claim |
|---|---|---|
| **The hook** | Hackathon judges, live demo | "Not another ChatGPT wrapper — the prompting is compiled into the interface" |
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

**Anticipated judge question — "how is this not a prompt wrapper?"** → "A wrapper gives you a text box and ships the prompt engineering as a string. We shipped it as an interface: the prompt engineering is invisible, versioned, and testable, and the user only ever touches controls that already know what to do."

## The moat: defensible diligence

The interaction wins the room; the audit layer wins the buyer. A regulated intermediary doesn't switch tools because a UI is pretty — they switch because the output survives scrutiny. The workflow is **claim decomposition → contradiction detection → citation → human disposition → replay**, and it stays document-claim extraction throughout: claims are read and cross-checked, never computed.

- **Citation-linked findings** — every flag points to the exact passage in the exact source document; no black-box claims to defend
- **Replayable audit log** — any past decision reconstructable exactly, on demand, for a regulator or an internal reviewer
- **Human-in-the-loop disposition** — a state machine of approve/dismiss with no auto-rejection; accountability stays with the licensed human
- **Live precision/recall** — an eval harness with planted ground truth proves accuracy as a measurement, not a vibe — the standard this buyer already applies to vendors

The comparison class isn't ChatGPT — it's Excel, manual review, and expensive GRC tools. This is what they're buying: product diligence they can stand behind at shelf-placement review.

**Anticipated judge question — "where's the innovation beyond UX?"** → "The UI is how a non-expert drives it; the citation-replay-eval layer is why a regulated firm can trust what comes out. Competitors ship one or the other — a chat box, or a black box."

**Anticipated judge question — "where's the advice?"** → "Advice built on unvetted product claims is exactly what gives democratized wealth products a bad name. We build the trust layer first."

## Why this fits *Finance & Wealth — Democratising Private Bank-Level Advice*

The track is about advice — but what makes private-bank advice trustworthy isn't the recommendation, it's the **products on the shelf**. Private banks run exhaustive product due diligence before an investor ever sees an offer; retail/robo platforms list thinly-vetted products because it costs too much. This project **democratises that product-vetting layer** — and the "no investment advice" fence becomes a feature: it shows judges you understand regulated scope.

Democratising isn't only about cost. Product vetting is also gated by *expertise* — knowing which claim in the marketing deck conflicts with page 12 of the PPM. We democratise that too: the expertise lives in the interface, so a non-expert drives the entire review.

## What It Does (demo flow — an interaction tour)

Every step below is a distinct UI surface. Watch the cursor: it never types a sentence.

1. **Drop-zone intake** — drag the product pack (factsheet, PPM, marketing deck, fee table) onto the drop zone; documents fan out as tiles and claim extraction runs automatically
2. **Claim board** — each document is decomposed into discrete claims; contradictions, fake claims, and disclosure gaps appear as pinned cards with filter toggles (fees, strategy, risk, terms) — a fee stated two different ways, a marketing claim with no support in the PPM, a risk disclosure missing where the deck makes promises — all selected by clicking, not asking
3. **Citation split-pane** — click any flag's citation chip to open the source document beside it, with the exact passage highlighted
4. **Verified claims card** — a one-paragraph verified product profile for shelf-placement review, publishable to the retail investor; regenerate with a button, tune with toggles, never by rewriting a prompt
5. **Disposition console** — approve/dismiss each finding with buttons or keyboard shortcuts; state machine, no auto-rejection, human-in-the-loop
6. **Replay scrubber** — drag the timeline scrubber to reconstruct any past decision exactly (audit log + replay)
7. **Live eval dashboard** — the fabricated product pack ships with N planted contradictions; precision/recall tiles update live during the demo

## Track-Brief Mapping (accurate / auditable / fast)

| Brief word | Proof |
|---|---|
| **Accurate** | Planted-contradiction eval set + live precision/recall — not a vibe, a measurement |
| **Auditable** | Citation-linked findings + replayable audit log |
| **Fast** | Document pack → scored findings in seconds vs. days of manual review |

## Scope (weekend-feasible)

- **MVP:** fabricated product pack (factsheet, PPM excerpt, marketing deck, fee table), 6 planted contradictions → drop-zone intake, claim board, citation split-pane, disposition console, eval dashboard, audit replay
- **Stretch:** regulatory filing/news cross-check, tamper signals, retail-facing verified claims card, keyboard-first navigation, continuous re-verification (pack re-checks when the product publishes an update)
- **Explicitly out of scope (say it in the pitch):** investment recommendations, product suitability, portfolio anything, and any performance computation — no returns, no volatility, no backtesting; claims are extracted and cross-checked, never computed. Zero math, zero advice, zero text boxes.
