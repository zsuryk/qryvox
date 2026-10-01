# TypeScript monorepo on Vercel, shaped around serverless

## Status

accepted — 2026-10-01 — deciders: <names>

## Context

We build the product end-to-end in TypeScript — Next.js UI in `/frontend`, Hono API in `/backend`, zod contracts in `/shared`, pnpm workspaces — and deploy to Vercel (Hobby) as two projects in one monorepo, with the Hobby account owner deploying from their machine via the Vercel CLI. Vercel has no persistent filesystem, so the database is a SQLite dialect accessed through Drizzle + libSQL: a local `file:` database in dev, Turso over HTTP in production. That constraint also shapes the code: the analysis pipeline is a set of stateless steps the browser orchestrates, not a long-running server job, and PDF parsing happens client-side.

`/shared` is owned jointly: either side may edit it, commit those changes alone, and push immediately (shared contract, per AGENTS.md).

## Considered options

- **Python + FastAPI backend** — rejected. Python's document-handling advantage (OCR, table parsers) doesn't apply: the product pack (factsheet, PPM, marketing deck, fee table) is fabricated text-based PDFs and extraction runs in the browser. Going Python would cost us the zod↔TypeScript shared contract, the main potential source of FE/BE drift. The team had no language preference, so this was decided on fit, not fluency.
- **Cloudflare Workers + D1 + OpenNext** — rejected. D1 is real SQLite and Hono is native there, but Next.js would run behind the OpenNext adapter: a second runtime (`workerd`) to debug against dev's Node, a 3 MB worker bundle ceiling, and a still-moving deployment story. Vercel makes Next.js the home team; the only thing lost is local SQLite, which one libSQL driver swap recovers.
- **Postgres** — rejected. SQLite gives dev/prod parity with a local `file:` database and no server process; hosted Postgres (Neon included, also zero-ops) would mean either a network database in dev or a second dialect. The Drizzle schema ports to Postgres later if scale ever demands it.
- **Hono mounted inside Next.js (one project, `app/api/[[...route]]/route.ts` via `hono/vercel`)** — rejected. One project, same origin, no CORS, one command and therefore no version skew — all real advantages under manual deploys. We keep two projects anyway because the API must be redeployable without a full Next.js build: an LLM endpoint fix ships in minutes instead of waiting behind a Next build. The skew risk is handled by deploy order (backend first, then frontend, from the same commit) plus additive-only API contract changes — see Deployment below. The remaining cost of two projects is one env var plus a CORS allow-list, recorded under Consequences.
- **Single container (Docker / Railway / local `docker compose`)** — rejected in favour of a shareable judge URL. Local dev runs against the file database; analysis steps still need the Anthropic API, but the board and replay work offline from recorded events (ADR-0002), so an outage degrades to `next dev` + API dev server for everything except new LLM steps.

## Decision

- **No in-process background job or SSE — a simplicity choice, not a platform limit.** Streaming is available on Hobby's Fluid compute; we decline it. Each pipeline step (extract → claims → contradictions → findings) is one stateless function call driven by the frontend in sequence. Each step is a single LLM call, well inside Vercel's 300s function limit.
- **PDF parsing in the browser.** pdf.js already renders and highlights pages; server-side `unpdf`/pdfjs would have been the most edge-hostile code in the stack and was dropped.
- **Document storage.** The fabricated product pack ships as static assets keyed by SHA-256; anything beyond the pack would use Vercel Blob client uploads, never a function body (Vercel Function request bodies are capped at 4.5 MB). `document.ingested` records the PDF hash, the extracted text, and the pdf.js version. Citations are stored as page + quoted text, not character offsets, and pdf.js is pinned — so the highlight stays correct across pdf.js versions and text-layer changes. The PDF itself is re-fetched from its static asset by hash on every render, reload or replay; nothing is cached in the event log.
- **Env-only database swap.** `file:./dev.db` locally, `libsql://` + auth token on Vercel — same Drizzle schema and queries in both places.

### Deployment: owner-only CLI deploys

The repo stays private and we pay nothing, which rules out the obvious path: Hobby allows no collaboration, and a Git-triggered deploy only proceeds when the commit author is the Hobby account owner. So the two Vercel projects are **not** connected to the Git integration; each has its Root Directory set (`frontend` / `backend`), and only the owner deploys, from the repo root of a clean checkout of `main` so `/shared` is uploaded too:

```sh
git pull --rebase origin main
vercel deploy --prod --project <backend-project>
vercel deploy --prod --project <frontend-project>
```

Deploy order matters: **backend first, then frontend, both from the same commit** — otherwise production ends up with a new frontend talking to an old backend.

Backend-only deploys (the reason we keep two projects, above) are safe only because **API contract changes are additive**: new fields and endpoints are optional, and nothing is renamed or removed while the live frontend still uses it. A breaking change ships in steps — add the new shape, deploy both, remove the old shape in a later deploy — never as a backend-only deploy. Under that rule, skipping the frontend deploy is fine; deploying the frontend ahead of the backend is not.

- **Vercel Git integration (auto-deploy on push)** — rejected. Pushes from anyone but the owner are blocked, and the Vercel bot comments on every blocked commit.
- **GitHub Actions with the owner's `VERCEL_TOKEN`** — rejected. It works mechanically, but routing teammates' commits through the owner's token sidesteps the rule Hobby enforces; a flagged account could be paused right before the demo. It also puts an account token in reach of anyone who can edit a workflow.
- **Public repo** — rejected; we keep the code private.
- **Vercel Pro** — rejected on cost ($20 per developer seat per month).

## Consequences

- One toolchain, one contract source of truth, zero hosting cost within Hobby quota (200 projects, 1M invocations, 4 CPU-hrs/month, 100 deployments/day — shared by both projects under the owner's account; figures as of 2026-10, see https://vercel.com/docs/plans/hobby).
- **Verify the backend deploy on day one:** monorepo workspace resolution of `/shared` under a Root Directory build is a known failure mode; run `vercel deploy` of `/backend` with a trivial endpoint immediately, and bundle `/shared` in (tsup/esbuild) if resolution fails. Do not discover this at hour 40.
- **Two projects means CORS:** the backend allow-lists the frontend origin; the frontend reads the backend URL from `NEXT_PUBLIC_API_URL` (declared in `.env.example` when contracts land).
- **Protect token spend:** a public judge URL lets anyone spend the Anthropic credits. Three layers: (1) a judge-link token — the demo URL carries `?k=…`, the frontend stores it in `sessionStorage` and sends it as a request header, so no passcode prompt and no text box, keeping the zero-text-box promise; (2) rate limiting by counting recent `step.started` events per IP/case **in the `events` table** — in-memory counters are useless on serverless because function instances don't share them. Events are immutable (ADR-0002), so they store `ip_hash` — an HMAC-SHA-256 of the client IP keyed by a server-side secret (`IP_HASH_SECRET`) — never the raw address, which could never be deleted afterwards; (3) a hard spend limit in the Anthropic console, which remains the real backstop.
- **Turso free-plan risk:** exceeding any single metric (storage, rows read, rows written) blocks the database until resolved. Keep large quota headroom during demo week, and **before demo night export the demo case's events to a JSON snapshot** the frontend can load from a static asset — the fallback must not depend on the database it is protecting. Last resort is a second Turso database (a separate free account) or a libSQL server on the owner's laptop; **not Neon/Postgres**, which would reintroduce the second dialect this ADR rejected mid-week.
- The owner is the release bottleneck: `main` and production can drift, and nothing ships while they're away. Teammates verify on local dev; agree a deploy cadence (e.g. after each merged feature, and a freeze before demo night).
- Production env vars (Turso URL + token, Anthropic key, judge-link token, `IP_HASH_SECRET`) live only in the Vercel projects, managed by the owner; teammates use `.env.example` with the local `file:` database.
- Progress UI is driven by awaited step calls instead of a live stream — simpler, but a failed step must surface as resumable board state, not a dead job.
- Vercel Hobby is non-commercial, and exceeding a quota **pauses that feature for up to 30 days** rather than charging (no overage billing). Set usage alerts before demo night so a runaway loop can't burn the quota.
- The real bill is Anthropic API tokens, not hosting.
- Schedule risk: citation highlighting in the pdf.js text layer (budget 2–3h; fallback is a highlighted quote panel + page jump).
