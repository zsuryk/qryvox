# Source-of-Wealth Diligence Copilot

> *Democratise the diligence behind private banking: an AI copilot that builds and continuously verifies a client's source-of-wealth dossier — and you never write a prompt to use it. Every analysis is a button, every claim a clickable citation, every decision a keystroke — and every one of them logged and replayable. No investment advice.*

## Target user

**The institution-facing intermediary — small-to-mid wealth platforms, robo-advisors, and licensed advisers — with the retail individual as the beneficiary.**

- **Who it's for:** the compliance / onboarding team at a mid-sized robo-advisor or a licensed wealth adviser who must run source-of-wealth diligence on clients before serving them
- **Who benefits:** the retail individual, who gets a private-bank-grade verification layer they could never access or afford directly
- **Explicitly not:** giant banks (in-house teams and budgets already cover this) and not individuals using it themselves (retail clients don't run their own SoW review — their adviser does, on their behalf)

## The pitch: two layers

| Layer | Audience | Claim |
|---|---|---|
| **The hook** | Hackathon judges, live demo | "Not another ChatGPT wrapper — the prompting is compiled into the interface" |
| **The moat** | The actual buyer (regulated intermediary) | Citation-linked findings + replayable audit log + human-in-the-loop state machine + live precision/recall — *defensible diligence* |

One thesis underneath both: **expertise lives in the product, not in the user's head.** The UI makes it usable; the audit layer makes it buyable.

## The hook: not another ChatGPT wrapper

> *"Most similar products are just ChatGPT wrappers with custom prompts. We revolutionised the UI interaction: you don't need to be an expert in prompt engineering to use it — we've done the prompting for you. Simply interact with buttons and navigate."*

The model is the commodity; the **interaction layer** is the product. Competitors ship a text box and hope the user phrases the question right. We compiled every capability into purpose-built controls, so a compliance officer who has never heard of "prompts" can run a full source-of-wealth review by clicking through a guided workflow.

For this target user it lands as more than convenience: prompt variance is audit risk. "Every analyst runs the same compiled procedure, identically, regardless of who clicks" is process control — the compliance argument for a promptless UI.

### Interaction principles

- **Zero free-text in the main flow.** There is no chat box in the demo path. Every task is reachable by drag, click, toggle, or keyboard shortcut.
- **Prompts are compiled, not typed.** Each control carries a pre-engineered, domain-tuned prompt underneath; the user chooses *what to examine*, the UI decides *how to ask*.
- **Domain vocabulary, not prompt vocabulary.** The user speaks "flag unexplained deposits" — the interface translates, scopes, and executes.
- **Progressive disclosure.** Simple by default: drop a document, get flags. Power lives one layer down (filters, re-run scopes, thresholds), never in a text field.
- **The model is swappable.** Because no prompt knowledge leaks to the user, the LLM behind the UI can change without changing the workflow.

**Anticipated judge question — "how is this not a prompt wrapper?"** → "A wrapper gives you a text box and ships the prompt engineering as a string. We shipped it as an interface: the prompt engineering is invisible, versioned, and testable, and the user only ever touches controls that already know what to do."

## The moat: defensible diligence

The interaction wins the room; the audit layer wins the buyer. A regulated intermediary doesn't switch tools because a UI is pretty — they switch because the output survives scrutiny.

- **Citation-linked findings** — every flag points to the exact passage in the exact source document; no black-box claims to defend
- **Replayable audit log** — any past decision reconstructable exactly, on demand, for a regulator or an internal reviewer
- **Human-in-the-loop disposition** — a state machine of approve/dismiss with no auto-rejection; accountability stays with the licensed human
- **Live precision/recall** — an eval harness with planted ground truth proves accuracy as a measurement, not a vibe — the standard this buyer already applies to vendors

The comparison class isn't ChatGPT — it's Excel, manual review, and expensive GRC tools. This is what they're buying: diligence they can hand to a regulator.

**Anticipated judge question — "where's the innovation beyond UX?"** → "The UI is how a non-expert drives it; the citation-replay-eval layer is why a regulated firm can trust what comes out. Competitors ship one or the other — a chat box, or a black box."

**Anticipated judge question — "where's the advice?"** → "Advice built on unverified client data is exactly what gives democratized wealth products a bad name. We build the trust layer first."

## Why this fits *Finance & Wealth — Democratising Private Bank-Level Advice*

The track is about advice — but what makes private-bank advice trustworthy isn't the recommendation, it's the **dossier underneath it**. Private banks run exhaustive source-of-wealth (SoW) checks before a client gets served; retail/robo platforms skip it because it costs too much. This project **democratises that verification layer** — and the "no investment advice" fence becomes a feature: it shows judges you understand regulated scope.

Democratising isn't only about cost. Private-bank diligence is also gated by *expertise* — knowing what to ask the evidence. We democratise that too: the expertise lives in the interface, so a non-expert drives the entire review.

## What It Does (demo flow — an interaction tour)

Every step below is a distinct UI surface. Watch the cursor: it never types a sentence.

1. **Drop-zone intake** — drag the evidence pack (pay slips, bank statements, company registry filings, tax returns, property records) onto the drop zone; documents fan out as tiles and extraction runs automatically
2. **Contradiction board** — findings appear as pinned cards on a board with filter toggles (income, identity, employment, filings); declared income vs. actual deposits, employment vs. company filings, name/date/address mismatches, unexplained wealth — all selected by clicking, not asking
3. **Citation split-pane** — click any flag's citation chip to open the source document beside it, with the exact passage highlighted (tampering signals, sanctions/news hits, gaps)
4. **Dossier summary card** — a one-paragraph verified client profile for a *human* advisor; regenerate with a button, tune with toggles, never by rewriting a prompt
5. **Disposition console** — approve/dismiss each finding with buttons or keyboard shortcuts; state machine, no auto-rejection, human-in-the-loop
6. **Replay scrubber** — drag the timeline scrubber to reconstruct any past decision exactly (audit log + replay)
7. **Live eval dashboard** — the fabricated dossier ships with N planted contradictions; precision/recall tiles update live during the demo

## Track-Brief Mapping (accurate / auditable / fast)

| Brief word | Proof |
|---|---|
| **Accurate** | Planted-contradiction eval set + live precision/recall — not a vibe, a measurement |
| **Auditable** | Citation-linked findings + replayable audit log |
| **Fast** | Document pack → scored findings in seconds vs. days of manual review |

## Scope (weekend-feasible)

- **MVP:** 6–8 page fabricated HK client dossier, 6 planted contradictions → drop-zone intake, contradiction board, citation split-pane, disposition console, eval dashboard, audit replay
- **Stretch:** sanctions/news retrieval, tamper signals, advisor summary card, keyboard-first navigation, continuous re-verification (dossier re-checks when new deposits hit)
- **Explicitly out of scope (say it in the pitch):** investment recommendations, product suitability, portfolio anything — zero math, zero advice, zero text boxes
