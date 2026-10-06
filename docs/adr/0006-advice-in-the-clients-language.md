# Advice in the client's language, with the evidence in the document's

## Status

accepted — 2026-10-03 — deciders: <names>. Ticket #43 (under #40).

## Context

*Personalisation and client experience* matter. Hong Kong's retail investors mostly read
Traditional Chinese, and many of the clients regulators worry about most (the elderly, the new to investing)
read it best. The client journey (the questionnaire, the waiting page, the advice) was English only.

The obvious fix, translating everything, collides with the product's promise. Every statement the client
reads is tied to a passage of the product's documents, and the explain step checks that every quote in an
explanation appears verbatim in its source (ADR-0002 and the grounding checks). A translated quote can't be
checked, and it would no longer be the evidence.

## Decision

- **The client picks a language** (English or 繁體中文) on the first screen. It is recorded on the profile
  (`language`, optional and additive) and switchable on every page.
- **The interface is one two-language table** (`frontend/lib/i18n.ts`). It's typed so that a string can't
  exist in one language and not the other. The adviser's console stays in English.
- **The explanation is written once, in the chosen language,** by the same explain step and the same
  model call. A language note asks the model to write in Traditional Chinese as used in Hong Kong. It must
  keep document quotes **exactly as the document has them, in English, in straight double quotes**. The
  explanation records its `language`.
- **The grounding checks are unchanged.** Quotes are still matched verbatim against their source, and
  numbers are still matched by value. The Chinese text paraphrases around evidence that stays checkable.
  「」 brackets remain free for paraphrase, so they are never mistaken for a quote.
- The verdict, the reasons and the rules don't depend on language. Only the words change.

## Considered options

- **Translate the quotes too.** Rejected because a translated quote can't be checked against the source and
  is not what the document says. The client can open the original passage with one tap.
- **Translate the English explanation afterwards.** Rejected because it adds a second model call that nothing
  checks, between the checked text and the client.
- **An i18n library.** Rejected for now. One typed table covers two languages without a dependency, and the
  table's shape is what a library would need anyway.
- **Translate the console.** Deferred. Advisers work in English in the institution's records, and the
  record of their decisions stays in one language.

## Consequences

- A Hong Kong client can go from questionnaire to approved advice entirely in Traditional Chinese. This was
  verified live on Kimi K3: a self-serving client aged 65+ and new to investing answered in Chinese, was
  told their adviser would speak with them first, and read the approved advice in Chinese, with English
  evidence quoted verbatim.
- The quotes are in English inside Chinese sentences. That is deliberate: it is the evidence, and it reads
  like a Hong Kong bank's bilingual disclosure.
- Switching language on the advice page changes the interface. The explanation stays in the language it was
  written in. Getting the other language means drafting again, which is one more checked model call.
- Adding a language means adding a column to the table and a language note. The checks don't change.
