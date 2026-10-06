# Scalability, measured

The product is built so that expensive work happens once per product and cheap work happens once per
client. Everything below was measured on real runs against Kimi K3 (`LLM_REASONING_EFFORT=low`) on
2026-10-03. Token counts come from the `usage` in each `step.completed` event's stored `raw_response`;
times run from `step.started` to `step.completed`. Anyone can re-read them from the event log.

## Once per product: verifying it for the shelf

The pack is fabricated demo fixture data. Five analysis steps read it and find what is wrong with it. A sixth reads the facts the suitability
rules need.

| Step | Larkspur v1 (in / out tokens, seconds) | Larkspur v2 | Wrenfield |
| --- | --- | --- | --- |
| extract | 1,496 / 1,095 · 28.7 s | 1,518 / 1,144 · 24.3 s | 1,297 / 929 · 20.7 s |
| decompose | 1,538 / 2,027 · 41.7 s | 1,577 / 2,113 · 41.8 s | 1,410 / 1,830 · 42.7 s |
| contradictions | 1,984 / 633 · 16.1 s | 2,010 / 804 · 23.6 s | 1,730 / 1,109 · 29.8 s |
| compliance | 1,956 / 1,700 · 46.0 s | 1,982 / 1,899 · 54.3 s | 1,702 / 364 · 11.2 s |
| findings | 1,147 / 471 · 12.9 s | 1,056 / 515 · 11.9 s | 607 / 265 · 6.7 s |
| attributes | 1,838 / 469 · 11.5 s | 1,860 / 511 · 12.7 s | 1,639 / 424 · 10.7 s |
| **Total** | **9,959 / 6,395 · 2 min 37 s** | **10,003 / 6,986 · 2 min 49 s** | **8,385 / 4,921 · 2 min 2 s** |
| rationale (optional, #62; not in the total) | — | 1,385 / 333 · 12.5 s (9 findings) | — |

The optional rationale step (#62) writes a line on why each finding matters, for all of a findings run's
findings in one call. It was measured on 2026-10-03 on the Larkspur v2 run, with nine findings: about 1.7
thousand tokens and 13 s. It runs once per findings run, not per card or per client, and no card waits for it.

**Verifying a product costs about 15–17 thousand tokens and under three minutes.** Then a person
reviews the findings. A new document version (the Larkspur v2 update) costs the same again, and only that
product is checked again.

Quality at that cost was measured with the eval against the answer keys:

- Larkspur: 9/10 recall and 10/10 precision.
- Wrenfield: 2/2 recall and 2/4 precision.
- The product facts were all correct.
- All three personas got the expected verdict.

## Once per client: advice

| Part | Model tokens | Time |
| --- | --- | --- |
| Profile and suitability verdict: the rules, a pure function | **0** | milliseconds |
| Alternatives: the same rules over every verified product on the shelf | **0** | milliseconds |
| Explanation at three depths, English (six runs) | about 1,140 in / 1,630 out | 31–48 s, about 41 s on average |
| Explanation at three depths, Traditional Chinese (one run) | 1,288 in / 2,427 out | 56 s |

**Serving a client costs about 2.8 thousand tokens, one model call.** The verdict itself costs nothing
and is the same every time. From the moment a self-serving client presses send to the moment their page is
waiting for the adviser, we measured 46 s (English) and 57 s (Chinese) end to end.

## What that means at scale

| | Naive: a model reads every document for every client | Qryvox |
| --- | --- | --- |
| 1 product, 1,000 clients | ≈ 1,000 × 16k = 16M tokens, with no guarantee that two clients get the same verdict on the same facts | 16k + 1,000 × 2.8k ≈ **2.8M tokens**, with verdicts fixed by rules |
| 20 products, 1,000 clients each | ≈ 320M tokens | 20 × 16k + 20,000 × 2.8k ≈ **56M tokens** |
| A rule change | Everything must be re-read | **0 model tokens.** Drafts are run again under the new `rules@` version. |
| A document update | Every client must be re-read | One product is verified again (16k), and only the advice resting on it is superseded |

The cost is roughly linear in clients, with a small constant. To turn tokens into money, multiply by the
provider's current price list. The endpoint is OpenAI-compatible (ADR-0003), so a cheaper or local model
is a configuration change, and the eval measures what it costs in quality.

## The adviser

The adviser does not read documents per client. That was done once, when the product was verified.

- **The review queue** puts every draft no adviser has decided at the top, so nothing waits behind decided work. Each card shows
  the verdict, the client's answers, the reasons with their sources, and anything flagged.
- **Approving is one click**, or one deliberate checkbox and a click for a vulnerable client. Rejecting
  takes one of five reasons.
- **Superseding is automatic.** A changed profile or a new document version sets old advice aside and
  puts it back in the queue, so the adviser never hunts for stale advice.

The adviser's time goes where regulators want it to go: checking, and talking to vulnerable clients. It
does not go on reading PPMs.

## Where it would strain, and the fix

- **Each step is one model call of 10–55 s**, inside Vercel's 300 s limit. Without
  `LLM_REASONING_EFFORT=low`, Kimi K3 exceeded that limit. For production, run steps on a queue instead of
  inside the request.
- **Explanations are independent per client** and parallelise freely. The provider's rate limit is the
  ceiling, not our design.
- **The event log is one append-only table with a per-case hash chain.** Writes serialise per case, not
  globally. libSQL/Turso scales reads; a busy institution would partition by case or move to Postgres. The
  contract is the same (ADR-0002).
- **Idempotent steps.** A retried step with the same `step_run_id` never runs or bills twice.
