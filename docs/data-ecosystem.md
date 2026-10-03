# Data ecosystem

What Qryvox needs to know to give advice on a verified shelf, where each piece comes from, how hard it is
to get right, what the prototype assumes in its place, and how it is protected. The brief calls this the
key requirement; the short version is that **the hard data is about the client, not the product**, and
the design keeps the two apart.

Terms are as in [CONTEXT.md](../CONTEXT.md). Everything the prototype holds is fabricated: the Larkspur pack,
its ground truth and the three personas.

## The data map

| Data | Source | Capture difficulty | Prototype assumption | Privacy class | Where it lives |
|---|---|---|---|---|---|
| **Product documents** (factsheet, PPM, marketing deck, fee table) | Issuer or distributor | **Medium.** Formats vary; scanned PDFs need OCR; documents are versioned and the version reviewed must be pinned | Four text-based PDFs, pinned by SHA-256, parsed in the browser with a pinned pdf.js | Public | Static files; their extracted text in `document.ingested` |
| **Product attributes** (holding period, sub-investment-grade allowance, capital protection, dealing terms, derivatives, exclusion screens) | Read from the documents by the `attributes` step | **High.** The documents contradict each other — finding that is layer 1's whole job — and a fact can be stated in words, numbers or not at all | The PPM wins (authority runs PPM, fee table, factsheet, deck); every value must be quoted, ground on its page and, if a number, be stated in its own quote | Public | `step.completed` of an `attributes` run |
| **Institutional policy** (product rules P1–P4) and **suitability matrix** (S1–S6, the risk-level mapping) | The institution's compliance function | **Medium.** Every institution's differs, and turning prose policy into checkable rules takes a compliance officer's time | `rules@1`, fabricated institutional policy — never quoted regulation | Internal | `shared/src/rules.ts`, versioned; every event that applies a rule records the version |
| **Findings** on the product (contradictions, unsupported claims, disclosure gaps, policy gaps) | The analysis steps, decided by the analyst | Medium: depends on model quality, which the eval measures | A model behind any OpenAI-compatible endpoint; the analyst approves or dismisses each finding | Internal | `finding.created`, `disposition.changed` |
| **Client goals, horizon, constraints** (relies on income, may need cash at short notice, exclusions) | The client, in a questionnaire | **Low.** Clients know these, and buttons make the answers unambiguous | Answered honestly; no free text anywhere | **Personal** | `client.profiled`, under a pseudonymous id |
| **Risk tolerance** | Questionnaire | **High.** Self-assessment is unreliable and shifts with markets: tolerance stated in a rising market rarely survives a falling one | The questionnaire's level (1–5) is a starting point the adviser can revisit; every change is a new, logged profile version | **Personal, sensitive** | `client.profiled` |
| **Knowledge and experience** | Questionnaire, then behaviour | **High.** People overstate it, and it decides how advice must be explained | Self-reported level; bonus #38 suggests a change to the adviser from how the client reads (never changes it alone) | **Personal** | `client.profiled`; interaction events in #38 |
| **Full financial picture** (income, net worth, liabilities, assets held elsewhere) | The client, other institutions | **Very high.** Held-away assets are invisible without open-finance consent, and self-reports are partial | **Not used.** Suitability here judges one product against stated goals and limits, not a portfolio | **Personal, highly sensitive** | Nowhere |
| **Interaction signals** (which explanations a client opens, at what depth) | The client page | Low to capture; consent is the hard part | Bonus #38 only, shown to the client as a visible, consented feature | **Personal** | Events, pseudonymous |
| **Market and performance data** (prices, returns, volatility) | Market data vendors | — | **Deliberately unused.** Nothing in Qryvox computes a return, a forecast or a volatility: claims and attributes are read, suitability compares levels and terms | — | Nowhere |

## What is hard, and what we do about it

1. **Products describe themselves inconsistently.** The same fund states a 0.85% fee in its factsheet and
   1.25% in its fee table, an "investment-grade only" policy in one document and a 40% sub-investment-grade
   allowance in another. Layer 1 exists to surface exactly this, and layer 3 never reads a product fact that
   is not quoted from the documents, the PPM first.
2. **Clients describe themselves inaccurately.** Risk tolerance and knowledge are the two inputs that matter
   most and that people misjudge most. The design does not pretend otherwise: the profile is versioned, the
   adviser can revisit it, a changed profile supersedes the advice drafted on the old one, and replay shows
   which answers each piece of advice rested on.
3. **The full picture is out of reach.** Without assets held elsewhere, no one can judge a portfolio. Qryvox
   therefore makes a narrower claim — whether *this* product fits *these* stated goals and limits — and says
   so to the client.
4. **Policy is prose.** Turning an institution's suitability policy into rules a machine can apply is work a
   compliance officer has to own. `rules@1` shows the shape: short, versioned, each rule with the text an
   explanation may quote.

## Privacy design

- **Pseudonymous ids in the log.** A client is known to the event log only by an id such as
  `persona-chan`. The contract accepts only a lowercase slug, so a name typed with capitals or spaces is
  refused, but it cannot tell a slug from a name: issuing ids is the institution's job. What links the id
  to a person belongs outside the log, in the institution's client system.
- **The log cannot forget, so personal data must be erasable around it.** Events are immutable and
  hash-chained (ADR-0002); a raw name or address written to one could never be deleted. The precedent is
  already in the code: client IPs are stored only as a keyed HMAC (`ip_hash`), never raw.
- **Production design: erasure by deleting a key.** Profile answers are personal data even under a
  pseudonymous id. In production, each client's profile payload would be encrypted under a per-client key
  held outside the log; erasing the client means deleting the key, after which the events remain, the chain
  still verifies, and the answers are unreadable. **The prototype does not do this yet:** it stores the
  fabricated personas' answers in plain text, which is acceptable only because they are invented.
- **Data minimisation.** The profile asks only what the suitability rules use. Income, net worth and
  held-away assets are not collected because no rule reads them.
- **No advice from personal data the client did not give.** Interaction signals (bonus #38) only ever
  produce a suggestion to the adviser, recorded in the log, and are shown to the client as a feature they
  can see.
- **Jurisdiction.** The rules and retention would follow the institution's regime — for example the Hong
  Kong SFC's suitability obligations and the PDPO, or the GDPR in the EU. The prototype claims none of them;
  it shows the mechanisms they require: a reason for every judgement, a record of who decided, and personal
  data that can be erased.

## Limits, stated plainly

- Risk tolerance and knowledge are self-reported, and the prototype has no way to verify either.
- Assets held elsewhere are invisible, so the advice is about one product, not a portfolio.
- The rules are fabricated institutional policy, not regulation, and are far fewer than a real policy.
- The prototype's personal data is invented and stored unencrypted; the encryption design above is not
  built.
- Extraction quality depends on the model; the eval (precision, recall and advice accuracy against the
  answer keys) is how a change of model is judged, and grounding drops what a model invents but cannot
  make it find what it missed.
