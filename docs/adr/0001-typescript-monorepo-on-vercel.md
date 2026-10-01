# TypeScript monorepo on Vercel, shaped around serverless

We build the product end-to-end in TypeScript — Next.js UI in `/frontend`, Hono API in `/backend`, zod contracts in `/shared` — and deploy to Vercel (Hobby) as two projects in one monorepo. Vercel has no persistent filesystem, so the database is a SQLite dialect accessed through Drizzle + libSQL: a local `file:` database in dev, Turso over HTTP in production. That constraint also shapes the code: the analysis pipeline is a set of stateless steps the browser orchestrates, not a long-running server job, and PDF parsing happens client-side.

## Status

accepted

## Considered options

- **Python + FastAPI backend** — rejected. Python's document-handling advantage (OCR, table parsers) doesn't apply: the product pack (factsheet, PPM, marketing deck, fee table) is fabricated text-based PDFs and extraction runs in the browser. Going Python would cost us the zod↔TypeScript shared contract, the main potential source of FE/BE drift. The team had no language preference, so this was decided on fit, not fluency.
- **Cloudflare Workers + D1 + OpenNext** — rejected. D1 is real SQLite and Hono is native there, but Next.js would run behind the OpenNext adapter: a second runtime (`workerd`) to debug against dev's Node, a 3 MB worker bundle ceiling, and a still-moving deployment story. Vercel makes Next.js the home team; the only thing lost is local SQLite, which one libSQL driver swap recovers.
- **Postgres** — rejected. Zero-ops and free-tier fit favour SQLite for a 48-hour build; the Drizzle schema ports to Postgres later if scale ever demands it.
- **Single container (Docker / Railway / local `docker compose`)** — rejected in favour of a shareable judge URL. Local dev still runs fully offline against the file database, so a cloud outage degrades to `next dev` + API dev server.

## Shape this forces

- **No in-process background job or SSE.** Each pipeline step (extract → claims → contradictions → findings) is one stateless function call driven by the frontend in sequence. Each step is a single LLM call, well inside Vercel's 300s function limit.
- **PDF parsing in the browser.** pdf.js already renders and highlights pages; server-side `unpdf`/pdfjs would have been the most edge-hostile code in the stack and was dropped.
- **Env-only database swap.** `file:./dev.db` locally, `libsql://` + auth token on Vercel — same Drizzle schema and queries in both places.

## Consequences

- One toolchain, one contract source of truth, zero hosting cost within Hobby quota (200 projects, 1M invocations, 4 CPU-hrs/month, shared team-wide).
- Progress UI is driven by awaited step calls instead of a live stream — simpler, but a failed step must surface as resumable board state, not a dead job.
- Vercel Hobby is non-commercial, and exceeding a quota **pauses that feature for up to 30 days** rather than charging (no overage billing). Set usage alerts before demo night so a runaway loop can't burn the quota.
- The real bill is Anthropic API tokens, not hosting.
- Schedule risk: citation highlighting in the pdf.js text layer (budget 2–3h; fallback is a highlighted quote panel + page jump).
