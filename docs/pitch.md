# Pitch: strengths by judging criterion

Our strengths against the Capco track's five judging criteria. Every claim points to its evidence: code,
a test, a measurement or a decision record. The strategic presentation (12 slides, shared by the team from the Artifact link in #46) is built from this page.

**One line:** private-bank advice, made affordable by doing the expensive diligence once per product. A
model reads the documents. Fixed rules decide suitability. A named adviser signs off. Every step can be
replayed for a regulator.

## The hook: a canvas of cards, not a chat box

Other entries put a chat box in front of a model. We turned the analyst's work into **cards on an
infinite canvas**. The analyst never writes a prompt; it is compiled, versioned and tested behind the
buttons. Every card is something our program parsed and checked against its source, never free prose.
[ADR-0007](adr/0007-a-canvas-of-cards-over-the-case-log.md).

| What the analyst does | What makes it more than UX |
| --- | --- |
| **Pans and zooms** a canvas where results arrive as cards and tile themselves, on desktop or with touch and pinch | One viewport module and one tiling module, both unit-tested: no overlaps, and pins survive reflow (#52, #53, #61) |
| **Docks** a card into the plan region, the reportable set grouped by category and source authority (PPM > fee table > factsheet > deck) | Each drop is an event in the hash-chained log, so the reportable set can be replayed. A wrong-category drop is refused (#55, #65) |
| **Discards, pins, restores** | Discarding is housekeeping, separate from the analyst's Dismiss, which is a recorded judgement. The underlying finding is never deleted (#56, #59) |
| **Finds similar** passages from any card | First the nearest already-grounded passages, instantly and at no token cost (BM25). Then "look further" runs a grounded model step. Results arrive as candidate cards and never alter reviewed findings (#57, #60, #64) |
| **Types a sentence, if they want** | It becomes intent chips from a closed vocabulary, and the chips choose which cards show. Kimi K3: "fee contradictions in the PPM" → one chip, 51 cards → 2 in about 3 s. A sentence about nothing gives no chips, and changing a chip asks no model (#63, #69, #70) |
| **Reads why each card matters** | One batched, grounded model call per product writes all the lines (about 1.7k tokens, 12 s) (#62) |
| **Watches the activity panel** | It is the case's own step log, so every run, retry and failure is visible, with its reason (#58) |

---

## 1. Fiduciary & regulatory compliance

| Strength | Evidence |
| --- | --- |
| **The AI never decides.** Suitability is seven fixed, versioned rules in a pure function, so the same inputs always give the same verdict. | `shared/src/suitability.ts`, `shared/src/rules.ts`, `shared/test/` |
| **Advice only on a verified shelf.** No advice can be drafted on a product whose documents have not been checked. | `backend/src/advice.ts` (`draftAdvice`, 409) |
| **Every statement is grounded.** Product facts and explanation quotes must appear verbatim in the source page. Numbers are matched by value. Anything invented is refused. | `backend/src/steps/explain.ts`, `backend/test/explain.test.ts` |
| **An accountable adviser.** Nothing reaches a client without a named approval. A rejection must give one of five countable reasons. | ADR-0004, ADR-0005 |
| **Vulnerable clients get a second key.** For a client aged 65+, or new to investing and relying on the income, approval requires a recorded "explained directly" confirmation. The API refuses an approval without it. | ADR-0005, `backend/src/advice.ts` |
| **A tamper-evident record.** The event log is append-only and hash-chained, can be replayed to any event, and `GET /verify` proves the chain. | ADR-0002, `backend/src/log.ts`, `frontend/app/replay.tsx` |
| **Mapped to the regime.** Each control is mapped to SFC Code ¶5.1/¶5.2, the SFC online-platform guidelines, HKMA vulnerable-customer care, PDPO DPP1–6 and CFA III(C), V(A), V(B) and V(C), with the gaps stated. | [compliance.md](compliance.md) |

## 2. Personalisation & client experience

| Strength | Evidence |
| --- | --- |
| **Advice on the client's goal, not just their risk.** S7 tells a growth investor that an income fund is built for income, citing the PPM. | ADR-0005, `goal()` in `suitability.ts` |
| **Explained at the client's depth.** Each client gets three depths, starting at their own knowledge level, and switches with one tap without another model call. | `frontend/app/client-advice.tsx` |
| **In the client's language.** The whole journey is available in English or Traditional Chinese. Evidence stays quoted in the original, so it is still checkable. | ADR-0006, `frontend/lib/i18n.ts` |
| **Self-service with no account.** A product link leads to a short questionnaire with no text boxes. The client's page updates by itself once the adviser confirms. Measured at 46–57 s to the waiting page. | `frontend/app/client-start.tsx`, [scalability.md](scalability.md) |
| **Answer once, see every product.** One questionnaire is checked against every verified product, at no model cost. Each product says whether it suits the client, with the rule and passage that decided it. "Recommended" appears only on the adviser's pick. | ADR-0008, `/start` → `/list/<client>`, #68, #71 |
| **Learns how the client reads, with consent.** The client can let the adviser see which depth they choose. It only ever produces a suggestion to the adviser. | #38 |
| **Apple-style interface design.** It supports dark mode, reduced motion and transparency, increased contrast, and phone widths. | `frontend/app/globals.css` |

## 3. Data architecture & ecosystem

| Strength | Evidence |
| --- | --- |
| **Event-sourced.** State is `fold(events)`. The server and the browser fold the same log, which is how replay works. | ADR-0002, `shared/src/fold.ts` |
| **Shared typed contracts.** One zod schema per event is used by both front end and back end. Changes are additive only, so old records always parse. | `shared/src/events.ts` |
| **Every model call is audited.** Each call stores its prompt version, model, raw response and token usage, and is idempotent per run id. | `backend/src/steps/run.ts` |
| **Model-agnostic.** The model sits behind an OpenAI-compatible endpoint. Swapping it is a config change, judged by the eval. | ADR-0003 |
| **Privacy by design.** Ids are pseudonymous. IP addresses are stored only as an HMAC. Data collection is minimal, with age asked only as a band. Erasure by deleting a key is designed. | [data-ecosystem.md](data-ecosystem.md) |

## 4. Investment outcome quality

| Strength | Evidence |
| --- | --- |
| **Accuracy is measured, not claimed.** Planted answer keys and live precision, recall and advice-accuracy tiles. | `/eval`, `frontend/app/eval-tiles.tsx` |
| **Real-model results.** Kimi K3, Larkspur: recall 9/10, precision 10/10. Wrenfield: recall 2/2. Product facts all correct. All three personas got the expected verdict. | README "Status", [scalability.md](scalability.md) |
| **Catches what marketing hides.** Mismatched fees, an exit charge left out of key facts, and income paid from capital each become a disclosure the client must see. | Larkspur pack, S3/S6 |
| **Every product compared, not just one.** Each advice carries the whole shelf: Mr Lee sees why Wrenfield doesn't suit him, and Mrs Chan sees why Larkspur doesn't suit her and that Wrenfield does. | `shelfComparison` in `backend/src/advice.ts`, #68 |
| **Advice stays current.** A new document version or a changed profile supersedes the advice it touches and puts it back in the adviser's queue. | #37, `supersede` in `backend/src/advice.ts` |

## 5. Scalability

| Strength | Evidence |
| --- | --- |
| **Expensive once per product, cheap once per client.** Verifying a product costs about 16k tokens and under 3 minutes. Advising a client costs about 2.8k tokens and one call, and the verdict itself costs 0. | [scalability.md](scalability.md) |
| **About 6× fewer tokens than a model reading the documents for each client**, and verdicts that can't drift between clients. | [scalability.md](scalability.md) |
| **A rule change costs no model calls**, because the rules are code with a version. | `RULES_VERSION` |
| **The adviser checks; they don't read PPMs.** One review queue, one-click approval, automatic superseding. | `frontend/app/advice-view.tsx` |
| **Serverless and stateless.** Built for Vercel with libSQL/Turso. Explanations parallelise per client. | ADR-0001 |

---

## Answers to the questions judges will ask

- **"Isn't this a ChatGPT wrapper?"** No chat box at all. The analyst works with cards on a canvas, and every card
  is parsed and grounded by our program. The model reads and writes; rules decide, people approve, and
  the log proves it. The prompting is compiled into buttons, chips and drags.
- **"What if the model is wrong?"** Anything it invents is dropped by grounding. What it misses shows up
  in recall on the eval. A person disposes of every finding before the product is shelved.
- **"Is AI advice allowed?"** Here it is advice by a licensed adviser, who gets a verified product, a rule
  verdict and an explanation the client can understand. See [compliance.md](compliance.md).
- **"What does it cost?"** About 2.8k tokens per client. See [scalability.md](scalability.md).

## Honest limits

Rules are fabricated and few. Risk and knowledge answers are self-reported. Advice covers one product, not a
portfolio. Encryption of personal data is designed but not built. The adviser identity is fixed. Details are
in the "gaps" sections of [compliance.md](compliance.md) and [data-ecosystem.md](data-ecosystem.md).
