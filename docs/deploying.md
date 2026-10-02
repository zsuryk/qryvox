# Deploying to Vercel

One command per action. All of them go through `scripts/deploy.sh`; read
`docs/adr/0001-typescript-monorepo-on-vercel.md` for why it works this way.

| Command | What it does |
|---|---|
| `pnpm deploy:check` | Runs Vercel's own build pipeline locally. Deploys nothing. Use after touching `vercel.json`. |
| `pnpm deploy:preview` | Uploads for real as a **Preview**. Production is untouched. Proves the upload path end to end. |
| `pnpm deploy:api` | Migrates the database, deploys the backend, verifies `/health`. |
| `pnpm deploy:web` | Deploys the frontend. |
| `pnpm deploy:setup` | One-time: creates and links both Vercel projects, pushes production env vars. |

## First run on a new machine

```sh
npm i -g vercel          # >= 20.1.0 for workspace builds
vercel login
cp .env.example .env.deploy   # fill in DATABASE_URL, DATABASE_AUTH_TOKEN, IP_HASH_SECRET, LLM_*
pnpm deploy:setup
```

`.env.deploy` and `.deploy/` are gitignored. Production secrets exist only in the Vercel
projects and in your `.env.deploy` — never in the repo.

Then, once per project, in the Vercel dashboard (**Settings → Build and Deployment**):

- **Root Directory** = `backend` / `frontend` — only needed for `backend` today
- **Include source files outside of the Root Directory** = ON (this is how `/shared` is uploaded)
- Leave the Git integration disconnected

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

```sh
curl -fsS https://qryvox-api.vercel.app/health
```

`eventTypes` in that response comes from `@qryvox/shared`, so a correct answer proves the
workspace resolved inside the deployed function — which is the failure mode ADR-0001 warns about.

## Constraints worth knowing before demo night

- **The Git integration stays disconnected.** Deploys are owner-only CLI by design; do not
  connect it and do not add a `VERCEL_TOKEN` workflow.
- **Hobby has no collaboration.** Only one person can deploy. Plan a deploy cadence, and freeze
  before a demo.
- **Set a hard spend limit in the model provider's console.** A public judge URL can otherwise
  burn credits. This is the real backstop behind the three app-level guards.
- **`LLM_MODEL` may be a steerable or stealth model.** Those get deprecated with little notice;
  keep a fallback model in mind or the analysis steps will 503 mid-demo.
