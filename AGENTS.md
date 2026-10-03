## Git workflow & repository rules

- **Trunk-based development**: commit and push directly to `main`. Do not create feature branches or pull requests.
- **Branching exceptions only**: do not branch unless (a) doing a refactor or (b) FE and BE work would genuinely overlap in the same files. Any such branch must be short-lived and rebased onto `main` before merging.
- **Strictly linear history**: always rebase onto the latest remote before pushing (`git pull --rebase origin main`). Never generate merge commits.
- **Never force-push**: do not force-push to `main` (or any shared branch). Amend only your own commits that have not been pushed yet.
- **Respect branch protection**: never attempt to change, weaken, or remove branch protection rules — whether via UI, `gh api`, or any other means. If a rule blocks you, work within it.
- **Directory boundaries**: frontend work is strictly confined to `/frontend`; backend work to `/backend`. `/shared` is jointly owned: either side may edit it, commit those changes alone, and push immediately (shared contracts).
- **Verify before push**: make sure local code runs before pushing.
- **Conventional commits**: use lightweight messages scoped to the layer, e.g. `feat(fe): ...`, `fix(be): ...`.
- **Shared contracts**: immediately commit updates to `.env.example` or shared API contracts whenever shared interfaces change.
- **Never change the user's git identity**: do not run `git config user.name` or `git config user.email`, and do not re-author existing commits. If a tool seems to need a different author, stop and ask — rewriting identity is the user's decision alone, and it rewrites shared history once pushed.

## Deploying

Deploys are owner-only Vercel CLI, never the Git integration, and they run from a staged copy of the repo that has **no `.git` directory** — Vercel matches commit authors against the account owner on Hobby and blocks everyone else. **Read `docs/deploying.md` before deploying.** Commands: `pnpm deploy:check` (build only), `pnpm deploy:preview` (upload, production untouched), `pnpm deploy:api`, `pnpm deploy:web`, `pnpm deploy:all` (api then web, same commit), `pnpm deploy:setup` (one-time), `pnpm smoke` (post-deploy end-to-end check of the API). Rationale in ADR-0001.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles using default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
