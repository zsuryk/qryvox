# Deploying to Vercel

One command per action. Deploys go through `scripts/deploy.sh`; `smoke` is a plain tsx script. Read
`docs/adr/0001-typescript-monorepo-on-vercel.md` for why the deploys work the way they do.

| Command | What it does |
|---|---|
| `pnpm deploy:check` | Runs Vercel's own build pipeline locally. Deploys nothing. Use after touching `vercel.json`. |
| `pnpm deploy:preview` | Uploads for real as a **Preview**. Production is untouched. Proves the upload path end to end. |
| `pnpm deploy:api` | Migrates the database, deploys the backend, verifies `/health`. |
| `pnpm deploy:web` | Deploys the frontend. |
| `pnpm deploy:all` | `api` then `web`, from the same commit — the same two can never be deployed out of order, so production never runs a new frontend against an old backend. |
| `pnpm smoke` | End-to-end check of the deployed backend: health, open a case, ingest the pack, run the full pipeline, verify the chain. |
| `pnpm seed:demo -- --base <url>` | Builds the demo state on a deployment through its API: two verified products, three approved personas each. See "Seeding the demo" below. |
| `pnpm deploy:setup` | One-time: creates and links both Vercel projects, pushes production env vars. |

## First run on a new machine

```sh
npm i -g vercel          # >= 20.1.0 for workspace builds
vercel login
cp .env.example .env.deploy   # fill in DATABASE_URL, DATABASE_AUTH_TOKEN, IP_HASH_SECRET, LLM_*
pnpm deploy:setup
```

`.env.deploy` and `.deploy/` are gitignored — never commit either, see "Demo mode / auth model" below.

Then, once per project, in the Vercel dashboard (**Settings → Build and Deployment**):

- **Root Directory** = `backend` / `frontend` — only needed for `backend` today
- **Include source files outside of the Root Directory** = ON (this is how `/shared` is uploaded)
- Leave the Git integration disconnected

## Demo mode / auth model

There is no account system. No login, no user table, no sessions, no per-user authorisation. A deployment
is single-tenant — SQLite (`file:./dev.db`) locally, Turso in production — so everyone who finds the URL is
looking at the same cases, the same log and the same clients. One link is the capability, and that is the
whole model. Know what it does and does not cover before sharing that URL:

- **The demo link carries the token.** `?k=<token>` is taken out of the address bar into `sessionStorage`
  when the page loads (`frontend/lib/api.ts`) and sent as the **`x-api-token`** header on every request.
  The env var is **`API_TOKEN`** (`.env.example`), and it is set on the backend Vercel project before the
  URL is shared. Unset, analysis steps are open — right locally, wrong on a public URL.
  It was called `JUDGE_TOKEN` until #86: rename the variable on the backend Vercel project (the backend
  still reads the old name and warns, but `.env.deploy` must carry `API_TOKEN` for `deploy.sh` to sync it).
- **What it protects: the calls that spend model tokens, and only those.** The guard covers
  `POST /cases/:caseId/steps` — `extract`, `decompose`, `contradictions`, `compliance`, `findings`,
  `attributes`, `explain`, `parse`, `rationale` (`backend/src/guards.ts`). A missing or wrong token is a
  401 before the model is called, and unlike the origin allow-list it also stops requests that send no
  `Origin` at all, such as `curl`. Everything else is open: opening a case, ingesting documents,
  dispositions, card operations, the client queue and its decisions, the board, the replay, the event log.
  Those take the token when the browser sends it and never check it.
- **What it does not protect: identity, tenancy, authorisation.** The `actor` on every event is always
  `demo-analyst` (ADR-0004), so a disposition or a client decision typed by anyone at all is recorded as
  the analyst's own. There is no second analyst to keep apart, nothing per-user to authorise, and no
  per-user revocation: rotating the token invalidates the link for everyone holding it. The log records
  *what* the system did and cannot record *who* did it.
- **Client pages are open by link** the same way (`/start/<case>`, `/list/<clientId>`), which is why the
  token is a spend guard and not access control. `docs/ops/model-spend.md` has the other three layers
  doing the same job: the origin allow-list, the rate limit, and a hard spend limit at the provider.

**Never commit `.env`, `.env.deploy` or `.deploy/`.** They hold the Turso token, `IP_HASH_SECRET`,
`LLM_API_KEY` and `API_TOKEN`; production values live only in the two Vercel projects, and `.env.example`
is the committed contract — the only env file that belongs in git. `.gitignore` already covers all three,
but a secret that lands in a commit is published: rotate it in Vercel rather than deleting the file.

**The post-deploy check is `pnpm smoke`**, after every `pnpm deploy:all`. Pass `API_TOKEN` when the backend
has one set — without it the pipeline's steps answer 401 and the run fails — and "Verifying by hand" below
says what it asserts and how to point it at another deployment.

## Why the deploy is not `vercel deploy`

A Hobby **team** cannot have members — Vercel returns `invites_not_allowed` — and Vercel
authorises a deploy by matching the git commit author against the team owner. So with this
account, any commit authored by anyone other than the owner email is blocked *before the build
runs*, and `--archive=tgz` does not help: it compresses the upload, it does not strip git
metadata.

So the script stages a copy of the committed tree with **no `.git` directory** and uploads from
there. No commit author, nothing to reject. `main` remains the source of truth: the script
refuses to run on a dirty or out-of-date tree, prints the commit it staged, and asserts the
staging copy has no `.git` before uploading.

## Reading deploy output

| In the log | Meaning |
|---|---|
| `● Blocked — the commit author doesn't have permission` | The upload still contained git metadata. Should be impossible now; check `stage_gitless` in `scripts/deploy.sh`. |
| TypeScript errors, then a successful deploy | Vercel transpiles without type-checking. Run `pnpm typecheck` locally — that is the real gate. |
| HTTP 302 to `vercel.com/sso-api` on a preview URL | Deployment Protection. Not an error. Use `vercel curl <url>` to reach a preview. |

## Verifying by hand

`curl` is the quick look. `pnpm smoke` is the post-deploy check.

```sh
curl -fsS https://qryvox-api.vercel.app/health
```

`eventTypes` in that response comes from `@qryvox/shared`, so a correct answer proves the
workspace resolved inside the deployed function — which is the failure mode ADR-0001 warns about.

For the full check, run the smoke script:

```sh
API_TOKEN=... pnpm smoke             # production: every analysis step needs the token
pnpm smoke                           # https://qryvox-api.vercel.app, when API_TOKEN is unset
SMOKE_BASE_URL=https://... pnpm smoke   # any other deployment
```

It opens a case, ingests the fabricated pack, runs the pipeline in the browser's order
(extract, decompose, contradictions, compliance, findings), and asserts the chain verifies
intact. A fresh case and fresh ids every run, so it is safe to re-run after any contract change.

## Seeding the demo

A fresh database holds nothing anyone can look at. `pnpm seed:demo` builds the demo state over the HTTP
API, the way the browser would, so it runs against any deployment, local or production:

```sh
pnpm seed:demo -- --base https://qryvox-api.vercel.app --token $API_TOKEN --web https://qryvox.vercel.app
pnpm seed:demo -- --base http://localhost:8787      # a local backend, no token
```

`--token` (or `API_TOKEN`) is the API token, needed when the backend has `API_TOKEN` set.
`--web` only makes the printed case and client links absolute. It spends model tokens: about 6-10 minutes
on Kimi K3. Run it once, after the model switch (#17), and watch the spend limit.

What it builds, per product (Larkspur revised, then Wrenfield): a case with the pack ingested; the five
steps (extract, decompose, contradictions, compliance, findings); the product facts (attributes); card
rationales; and a disposition on every finding on the board. Once both are verified, each persona (Mrs
Chan, Mr Lee, Ms Wong) gets a profile, a drafted advice with the shelf compared, an explanation, and the
adviser's approval with `explained_directly`. A refused step (422 grounding, 502) is retried up to 3 times
under a new `step_run_id`. It ends by verifying each chain and printing the case and client URLs and each
step's time and tokens.

- **Dispositions.** The answer key (`frontend/public/eval/<pack>/ground-truth.json`) decides: a finding
  that matches a planted entry (same category, and a quote containing the planted one, as the eval tiles
  match) is approved; every other finding is dismissed.
- **Documents.** The PDFs in `frontend/public/pack/` are read with the frontend's own `parseDocument` and
  pdf.js, so text and hashes equal a browser drop; each hash is checked against the manifest.
- **Idempotent by product.** A product's case id is derived from its pack id, so a rerun lands on the same
  case, reads its log, and runs only what is missing. A finished product costs no model call, and a
  rerun that finds everything built prints "none: everything was already built".
- Another run of a seed against a database with other cases for the same product name is fine: the shelf
  takes the latest verified case per product.

## Constraints worth knowing before demo night

- **The Git integration stays disconnected.** Deploys are owner-only CLI by design; do not
  connect it and do not add a `VERCEL_TOKEN` workflow.
- **Hobby has no collaboration.** Only one person can deploy. Plan a deploy cadence, and freeze
  before a demo.
- **Set a hard spend limit in the model provider's console.** A public demo URL can otherwise
  burn credits. This is the real backstop behind the three app-level guards.
- **`LLM_MODEL` may be a steerable or stealth model.** Those get deprecated with little notice;
  keep a fallback model in mind or the analysis steps will 503 mid-demo.
- **One step must finish inside one function call.** `backend/vercel.json` sets the function's
  `maxDuration` to 300 s (Hobby's ceiling on Fluid compute), and `LLM_TIMEOUT_MS` (240 s by default)
  stays under it, so a slow model fails as a clean `step.failed` rather than a killed function. Every
  number in `docs/scalability.md` was measured on **Kimi K3 with `LLM_REASONING_EFFORT=low`** (about
  10–55 s a step). A slower model, or K3 without `low`, can run past the limit on the large grounded
  steps (`compliance`, `decompose`): in production the stealth model took about 12 minutes and timed
  out at `compliance` every time (#17). Use the measured configuration for the demo.
