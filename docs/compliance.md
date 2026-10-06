# Compliance map

What the product does, set against what Hong Kong's regime and the CFA Institute's standards ask of an
adviser. Each row names the obligation, the control we built, and where it lives in the code.

> **This is a mapping for compliance to confirm, not a certification.** The rules in the product are
> fabricated institutional policy (CONTEXT.md, "Rules"), not quoted regulation. References are to the
> obligations as we understand them. An institution's compliance function owns the real rule set and the
> final reading of each obligation.

## In one paragraph

A model reads the documents and writes the words, and that is all it does. Product facts are grounded in
verbatim quotes. Suitability is decided by fixed, versioned rules in a pure function. No piece of advice
reaches a client without a human approval, and a rejection must give a reason. Vulnerable clients need a
second, recorded confirmation. Every one of these acts is an append-only, hash-chained event that can be
replayed to any point. That covers what a regulator asks for: why the advice was given, on what evidence,
and under which rules.

One obligation of that list is *not* met, and no row below should be read as saying it is. The log records
what was decided and when, but not who typed it: every event's `actor` is the fixed identity
`demo-analyst` (ADR-0004). A deployment is single-tenant and client pages are open to anyone holding the
link, so there is no per-client access control and no decision can be attributed to a named, licensed
person. Real identities, roles, tenancy and a licensed operator are future work (README, "Demo mode &
limitations"; `docs/deploying.md`).

## Hong Kong: SFC Code of Conduct and the suitability obligation

| Obligation | Control | Where |
| --- | --- | --- |
| **Know your client** (Code of Conduct ¶5.1): establish the client's financial situation, investment experience and objectives | A structured profile covering goal, horizon, risk level from three questions, knowledge, reliance on income, need for cash at short notice, 65 or over, and exclusions. It has no free text, every answer is recorded as an event, and each new answer supersedes the advice drafted on the old one. | `shared/src/client.ts`, `frontend/app/profile-form.tsx`, `backend/src/advice.ts` (`recordProfile`) |
| **Suitability** (¶5.2): a recommendation must be reasonably suitable given what the adviser knows of the client | Seven rules (S1–S7) compare the client's answers with facts read from the product's documents. A pure function applies them, so the same inputs always give the same verdict, and replay in the browser recomputes it. | `shared/src/rules.ts`, `shared/src/suitability.ts` |
| **Reasonable basis / product due diligence**: understand the product before recommending it | A product goes on the shelf only after the five analysis steps run and a person disposes of the findings. No advice can be drafted on an unverified pack (409). Product rules P1–P4 check the documents themselves. | `backend/src/steps/*`, `backend/src/advice.ts` (`draftAdvice`, `shelf`) |
| **Objectives, not just risk** | S7 compares the client's goal with the product's primary objective, as cited from the PPM. A mismatch produces a warning and is said in the client's explanation. ADR-0005. | `shared/src/suitability.ts` (`goal`) |
| **Disclosure of material information** | S6 discloses every open fees or terms finding to the client, whatever the verdict. Each disclosure cites the more authoritative document. | `shared/src/suitability.ts` (`disclose`), `frontend/app/client-advice.tsx` |
| **Explaining the recommendation in a way the client understands** | The explanation comes at three depths, starting at the client's own knowledge level, in English or Traditional Chinese (ADR-0006). Each statement is one tap from its source page. The explain step refuses quotes and numbers that are not in the advice or the documents. | `backend/src/steps/explain.ts`, `frontend/lib/i18n.ts` |
| **Alternatives** | When a product does not suit, the same rules check every other verified product on the shelf. The suitable ones are offered, each with its own reasons and citations. | `backend/src/advice.ts` (`alternativesFor`) |
| **Supervision and accountability** | An adviser approves or rejects every draft, and nothing approves itself. A rejection must carry one of five reasons, which can be counted. The approval is attributable to a decision and its reason, not to a person: every decision's actor is `demo-analyst`. | `backend/src/advice.ts` (`decideAdvice`), `backend/src/app.ts`, ADR-0004, ADR-0005 |
| **Record keeping** (Securities and Futures (Keeping of Records) Rules) | All of the above is held in an append-only, hash-chained event log. `GET /cases/:id/verify` proves that nothing was altered. Each step records its prompt version, model and raw response, and each advice records its `rules@` version. | `backend/src/log.ts`, `backend/src/hash.ts`, ADR-0002 |

## Hong Kong: online advisory platforms

The SFC's *Guidelines on Online Distribution and Advisory Platforms* (chapter 3, robo-advice) ask for the
following, among other things.

| Expectation | Control | Where |
| --- | --- | --- |
| Tell clients how the advice is produced and what its limits are | The client is told the rules apply first and an adviser confirms. Every reason names its rule, the rule set's version, and the source passage. | `frontend/app/client-start.tsx`, `frontend/app/client-advice.tsx` |
| Govern and test the algorithm | The rules are versioned (`rules@2`) and pure, with tests. Answer keys and an eval score the model's recall and precision, and the persona verdicts are checked. Changing the model or the prompt is judged against the eval. | `shared/test/`, `backend/test/`, `/eval` |
| Keep the questionnaire consistent and act on inconsistent answers | Risk level comes from three questions, never one self-rating. A suggestion to adjust knowledge level is offered to the adviser, never applied automatically. | `frontend/app/profile-form.tsx`, `frontend/app/advice-view.tsx` |
| Human oversight | No advice reaches a client without an adviser's approval. A self-serving client waits on a page that says so. | `frontend/app/client-advice.tsx` (`Waiting`) |

## Vulnerable clients

Hong Kong supervisors (the HKMA's investor-protection measures in particular) expect extra care for
vulnerable customers, such as those aged 65 or over.

| Expectation | Control | Where |
| --- | --- | --- |
| Identify vulnerable clients | A client is vulnerable when they are 65 or over, or new to investing and relying on the income. Age is asked only as a band, never as a birth date. | `shared/src/client.ts` (`vulnerability`) |
| Enhanced care before the advice is given | Approval needs the adviser to confirm they **explained it to the client directly**. The confirmation is recorded on the decision, and the API refuses an approval without it (409). The client is told their adviser will speak with them first. | `backend/src/advice.ts`, `frontend/app/advice-view.tsx`, ADR-0005 |

## Personal Data (Privacy) Ordinance: data protection principles

| Principle | Control | Where |
| --- | --- | --- |
| DPP1, collection limited to purpose | The profile asks only what a rule reads. It does not collect name, income, net worth or date of birth. | `shared/src/client.ts`, ADR-0005 |
| DPP2, accuracy and retention | The client sees their answers back with a "something wrong?" route, and new answers supersede the advice. Retention and erasure-by-key-deletion are designed but not built. | `frontend/app/client-advice.tsx`, `docs/data-ecosystem.md` |
| DPP3, use | How a client reads their advice is shared with the adviser only if the client turns it on. It only ever produces a suggestion. | `frontend/app/client-advice.tsx`, #38 |
| DPP4, security | Clients get pseudonymous ids. IPs are stored only as a keyed HMAC. One shared API token guards the calls that spend model tokens, and an origin allow-list refuses other sites' browser requests. Neither is access control: both are held by everyone who has the demo link. | `backend/src/guards.ts`, `shared/src/client.ts` |
| DPP5, openness | The client start page says what is collected and that no name or account is needed. | `frontend/app/client-start.tsx` |
| DPP6, access and correction | The client's own page shows everything they told us. | `frontend/app/client-advice.tsx` (`YourAnswers`) |

## CFA Institute Code and Standards

| Standard | Control |
| --- | --- |
| III(A) Loyalty, Prudence and Care | The verdict comes from rules about the client, never from the product's margin. The shelf offers whatever fits. |
| III(C) Suitability | S1–S7, applied the same way to every client, with every reason cited. |
| V(A) Diligence and Reasonable Basis | Every product fact is a verbatim quote from the documents. Contradictions between documents are found and shown to an analyst before the product is shelved. |
| V(B) Communication with Clients | Reasons, risks (S3 and S6 disclosures) and limits are explained at the client's depth and in their language. Facts are kept apart from the explanation. |
| V(C) Record Retention | The hash-chained event log, replayable to any point. |

## Gaps, stated plainly

- The rules are fabricated and far fewer than a real policy. Concentration, leverage and derivative-knowledge
  assessment (Code ¶5.1A, ¶5.3) are not modelled.
- Knowledge and risk tolerance are self-reported.
- The advice covers one product, not a portfolio, and assets held elsewhere are not seen.
- Encryption of profile data and the erasure design in `docs/data-ecosystem.md` are not built.
- There is one fixed adviser identity (ADR-0004). Real deployments need authentication, roles and
  four-eyes review on rule changes.
- No identity behind any of it: no login, no sessions, no per-user authorisation, and a deployment is
  single-tenant, so one person's dispositions are recorded as the analyst's own.
- Client pages are reachable by link and possession of the link is the only check, so nothing keeps one
  client's page from another's.
- Nothing here is licensed, registered or supervised. There is no licensed operator behind the fixed
  adviser identity, so a real client could not be advised through this as it stands.
