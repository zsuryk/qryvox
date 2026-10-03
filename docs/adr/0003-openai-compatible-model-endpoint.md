# Any OpenAI-compatible model endpoint, configured by environment

## Status

accepted — 2026-10-03 — deciders: <names>. Records spec decisions 22–23 (#1). Amends ADR-0001 wherever it
names Anthropic: read "the model provider" there.

## Context

ADR-0001 was written around the Anthropic API: analysis steps "need the Anthropic API", the real bill is
"Anthropic API tokens", and the spend backstop is "a hard spend limit in the Anthropic console". Stage 1
built something more general. The backend calls any chat-completions endpoint that speaks the OpenAI
protocol, chosen entirely by environment (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`,
`LLM_TIMEOUT_MS`), and imports no provider SDK.

Two things pushed it there. The README promises that "the model is swappable" because no prompt knowledge
leaks to the user; a client welded to one vendor's SDK would make that claim untrue in the code. And
development needs a model that costs nothing per call: Ollama and LM Studio serve the same protocol
locally, so the full pipeline runs on a laptop against the real pack (qwen3.6:27b found all six planted
findings, twice).

## Considered options

- **The Anthropic SDK, as ADR-0001 assumed** — rejected. It ties every step to one vendor and gives local
  development no free model. Anthropic is still reachable: it serves an OpenAI-compatible endpoint.
- **A multi-provider library (e.g. the Vercel AI SDK)** — rejected. It solves a problem we do not have
  (streaming, tool calls, provider-specific features) and adds a dependency to the serverless bundle. One
  step is one request and one JSON reply; a plain `fetch` does that.
- **One OpenAI-compatible client over `fetch`** — chosen.

## Decision

- **The protocol is the contract, not the vendor.** `backend/src/llm.ts` posts to
  `<LLM_BASE_URL>/chat/completions` with `fetch`. The key is optional (local servers need none). Reasoning
  blocks (`<think>…</think>`) and code fences are stripped before the reply is parsed.
- **Unconfigured is a state, not a crash.** Without `LLM_BASE_URL` and `LLM_MODEL` the backend still serves
  the log, the board and replay; only a new analysis step answers 503.
- **Every step event records the model it ran with** (and its prompt version), so a finding can always be
  traced to the model that produced it, whichever provider that was.
- **The workflow never branches on the provider.** Prompts, schemas and grounding are the same for every
  model. A model that returns malformed output fails its step run, visibly, rather than being special-cased.

## Consequences

- The README's "swappable model" claim holds in the code: changing provider is an environment change and a
  redeploy, with no code change.
- Spend protection is the operator's job per provider. The hard limit ADR-0001 put "in the Anthropic
  console" now lives wherever `LLM_BASE_URL` points, and the settings differ by provider
  (`docs/ops/model-spend.md`).
- Quality is no longer fixed by the architecture: a weak model makes weak findings, and grounding drops its
  invented quotes but cannot make it find what it missed. The eval (precision/recall against ground truth)
  is what tells models apart, so it should be run whenever the production model changes.
- Models differ in how literally they follow the output format. Real models have already shown habits a
  scripted fake never does, such as copying a label back as a document id (40722e7, cffea6f). Each such
  habit is repaired narrowly in the backend, never by loosening grounding.
- A deployed backend cannot reach a model on someone's laptop; local models are for development only.
