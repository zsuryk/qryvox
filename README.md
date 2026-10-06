# Qryvox

A diligence copilot for investment products. It ingests a product pack — factsheet, PPM excerpt, marketing deck, fee table — extracts and cross-checks the claims those documents make against each other and against institutional product rules, and matches the product against client profiles. Every step is appended to a hash-chained event log, every finding carries a citation to a page, suitability verdicts come from fixed rules rather than the model, and a licensed adviser approves advice before a client sees it.

Demo mode, fixtures and current limitations are in [Demo mode & limitations](#demo-mode--limitations).

## Features

- **Canvas of cards over the case log** — findings and cited passages arrive as cards on an open canvas that pans and zooms; pin, discard or dock them into a reportable plan grouped by category × document authority. Layout is derived from the log, so a replay rebuilds it.
- **Citation-grounded findings** — every finding cites a document, a 1-based page and a verbatim quote, and every quote a step produces is checked against that page before it is kept (the grounding check). Ungrounded output is dropped.
- **Find similar** — BM25 over the latest extract run returns a card's nearest passages instantly; *Look further* then seeds a re-run of `extract` from the passage the card shows.
- **Typed intent chips** — a typed sentence is parsed into intent chips (a category, a document kind, a step, any left open) that filter the canvas.
- **Hash-chained, replayable audit log** — one append-only `events` table is the only source of truth, enforced by database triggers. State is a fold over it, and folding to an earlier seq shows the case as it was. The chain is tamper-evident, not tamper-proof.
- **Eval tiles with planted answer keys** — precision, recall and advice-accuracy tiles run live against a pack's ground truth, which is stored apart from the documents and never an input to any step.
- **Client questionnaire in the client's language** — goal, horizon, risk level, knowledge and exclusions captured with buttons and no free text; the client journey runs in English and 繁體中文.
- **Rule-based suitability** — `shared/src/suitability.ts` is a pure, versioned function of the profile, cited product attributes and open findings. The model reads and explains; it never decides a verdict.
- **Adviser approval with vulnerable-client confirmation** — advice is drafted by the system and approved by the adviser, who must pick a rejection reason. Vulnerable clients (65+, or new to investing while relying on income) are approved only once the adviser confirms they explained the advice directly.
- **Fabricated demo packs** — Larkspur Global Income Fund (plus a revised v2) and Wrenfield Short Duration Fund, served as static PDFs pinned by SHA-256, with planted findings and personas that have expected verdicts.

## Quickstart

Requires Node 22+ and pnpm (the repo pins pnpm 12.8.1).

```bash
git clone <repo-url> qryvox
cd qryvox
pnpm install
cp .env.example .env
```

There is no root `dev` script — run the two packages in separate terminals:

```bash
pnpm --filter @qryvox/backend dev    # API on http://localhost:8787 (PORT)
pnpm --filter @qryvox/frontend dev   # app on http://localhost:3000 (builds shared first)
```

The `.env.example` defaults work as-is for local development: a file-backed SQLite database, which the backend migrates on boot, and no API token, which leaves analysis steps open. To run new analysis steps, set `LLM_BASE_URL` and `LLM_MODEL` to any OpenAI-compatible endpoint; without them the backend serves everything it has and answers 503 to new steps. Browsing a case needs no model.

Open <http://localhost:3000/canvas> for a case already reviewed.

To build the demo state (two verified products, every finding dispositioned, three personas profiled and approved per product) against a running backend, over the HTTP API only:

```bash
pnpm seed:demo -- --base http://localhost:8787
```

The Larkspur and Wrenfield packs, their ground truth and every persona are **fabricated fixtures** — no real issuer, no real performance data.

## Testing

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Deployment

Deploys are owner-only Vercel CLI runs from a staged copy of the repo, never the Git integration; read [docs/deploying.md](docs/deploying.md) before deploying. Run `pnpm deploy:check` first — it runs the build and deploys nothing — and `pnpm smoke` afterwards as the end-to-end check of the deployed API.

## Demo mode & limitations

- **Fixed identity.** Every event, including an adviser's sign-off, is attributed to `demo-analyst`. There is no login and no identity picker.
- **Shared token.** When `API_TOKEN` is set, an analysis step needs the header `x-api-token` with that value. It is one shared secret, not per-user auth.
- **Link-as-capability.** Client pages are reachable by link; possession of the link is the only check.
- **Single tenant.** One local SQLite file in development, one Turso database in production.
- **Fabricated fixtures.** All packs, personas and answer keys are invented. Nothing computes returns or forecasts, and advice is only ever drafted on a product that has been through the analysis steps.
- **No multi-user auth.** Real identities are future work.

## License

[MIT](LICENSE)