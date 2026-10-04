# Live demo script

Four and a half minutes, two people: **the driver** clicks, **the speaker** talks. The deck (13 slides)
carries the argument; this is the part judges remember. Every number said aloud is in
`docs/scalability.md` or the eval tiles.

## Before you start (10 minutes before)

- **Which stack.** Use production (`https://qryvox.vercel.app/?k=<token>`) only once #17 is green: Kimi K3
  with `LLM_REASONING_EFFORT=low`, `pnpm smoke` passing, and `pnpm demo:seed` run against it. Otherwise
  use the local stack (`http://localhost:3000`), seeded the same way. Decide before the room fills, not
  during the demo.
- **Open these tabs, in order:**
  1. The Larkspur case's canvas: `/cases/<larkspur-case>/canvas`.
  2. A fresh `/start`, the client's questionnaire, in a private window, so the client has no history.
  3. The adviser console: `/cases/<larkspur-case>/advice`.
  4. Mr Lee's page: `/clients/<larkspur-case>/persona-lee`.

  The seed prints the case ids.
- **Fallback that needs no model and no network:** the recorded canvas at `/canvas`. It replays a real
  case, including find-similar and typed intent from recordings.
- Zoom the browser to 110% so the back row can read the cards. Close notifications.

## The run

| Time | Driver does | Speaker says |
| --- | --- | --- |
| 0:00 | Tab 1: the canvas, full | "Other entries are a chat box. This is an analyst's desk: every result is a card our program parsed and checked against the source. There's no prompt anywhere." |
| 0:20 | Click a fee finding's citation chip | "Every card is one click from the exact passage. The factsheet says 0.85%; the fee table says 1.25%." |
| 0:40 | Drag that card into the plan region (Fees · Fee table), then drag a noise card to the bin | "Docking builds the reportable set, ordered by source authority. Discarding is housekeeping, not a judgement. Every move is in the audit log." |
| 1:00 | Press **Similar** on the exit-charge card | "Find similar is instant and free: the nearest passages already extracted and grounded. 'Look further' asks the model only when you want it." |
| 1:20 | Type `fee contradictions in the PPM` and press Enter | "Words are a shortcut to chips, never a prompt. The canvas narrows to what was asked." |
| 1:40 | Tab 2: answer the questionnaire in 繁體中文, as a 65-year-old who relies on the income; submit | "Now the client. One questionnaire, every product we've verified. In their language." |
| 2:10 | Show the waiting page | "Nothing reaches the client until a licensed adviser approves. This client is vulnerable, so the adviser must confirm they explained it directly." |
| 2:20 | Tab 3 → **Decide the whole list**: tick the confirmation, pick the suitable product, Approve | "One decision covers the list. 'Recommended' appears only on the adviser's pick: that's the adviser's act, not the machine's." |
| 2:45 | Back to tab 2: the list updates by itself; open the picked product | "Every product, suits or doesn't, with the rule that decided it and the passage behind it. The explanation is written now, in Chinese, with the English evidence quoted word for word." |
| 3:20 | Tab 4: Mr Lee; scroll to the comparison | "Same rules, different client. He wants growth; the PPM says this fund is built for income, so he's told. Wrenfield doesn't suit him, and he sees why." |
| 3:50 | Tab 1 → Record → drag the replay scrubber back before the approval | "A regulator can replay any moment: the advice disappears exactly as it was before the adviser signed. The chain check proves nothing was altered." |
| 4:15 | Tab 1 → Review: stop on the eval tiles at the top | "Recall 9 of 10, precision 10 of 10 on Kimi K3. Measured, not claimed." |

## If something goes wrong

- **A model step is slow or refused.** Say: "That's the grounding check refusing something the model
  couldn't quote verbatim. It retries." Then move to the next beat. The explanation can be opened again
  with **Try again**.
- **Production is down.** Switch to the local stack's tabs. Don't debug in front of the judges.
- **No network at all.** Use `/canvas` (recorded) and Mr Lee's page on the local stack.

## Questions we expect, with 20-second answers

- **"Isn't this a ChatGPT wrapper?"** "There's no chat box. The model reads documents and writes
  explanations. Fixed rules decide suitability, a named adviser signs off, and everything is in a
  hash-chained log. If the model invents a quote or a number, the step is refused."
- **"What if the model misses something?"** "That's what the eval measures: recall against planted answer
  keys, live on screen. Grounding stops invention, an analyst disposes of every finding, and nothing is
  shelved without that."
- **"What does it cost at scale?"** "About 16 thousand tokens to verify a product, once. About 2.8 thousand
  per client, and the verdicts themselves cost nothing. Roughly six times cheaper than a model reading
  every document for every client, and verdicts that can't drift."
- **"Is this allowed under Hong Kong rules?"** "It's advice by a licensed adviser, with the controls mapped
  to the SFC's suitability and online-platform requirements, HKMA vulnerable-customer care and the PDPO.
  The map is in docs/compliance.md, written for compliance to confirm."

## Rehearsals

Run the whole script twice, timed, with the real stack. Note the times and anything that stuck here and
in #74.

| Rehearsal | Date | Stack | Time | What to fix |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
