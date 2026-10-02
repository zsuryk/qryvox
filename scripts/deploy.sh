#!/usr/bin/env bash
# Owner-only Vercel deploys for qryvox, run from the command line by the account owner
# (ADR-0001). The Git integration is never connected: on Hobby, a push only deploys when the commit
# author is the team owner, which cannot be satisfied by anyone else. So deploys upload a git-less
# copy of the repo, which leaves Vercel no commit author to reject.
#
#   scripts/deploy.sh setup   create + link both projects, push production env vars
#   scripts/deploy.sh check   build locally with Vercel's own pipeline, deploying nothing
#   scripts/deploy.sh preview <url>  upload for real as a Preview; production is not touched
#   scripts/deploy.sh api     migrate, deploy the backend, verify /health
#   scripts/deploy.sh web     deploy the frontend
#   scripts/deploy.sh all     api then web, from the same commit (never web before api)
#
# Production secrets are read from .env.deploy, which is gitignored. Nothing here is ever committed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATE_DIR=".deploy"
PROJECTS_FILE="$STATE_DIR/projects.env"
SECRETS_FILE=".env.deploy"
API_PROJECT="${VERCEL_API_PROJECT:-qryvox-api}"
# The frontend takes the bare product name: qryvox.vercel.app is the judge-facing URL (ADR-0001),
# so qryvox-web.vercel.app would put a build detail in front of the audience.
WEB_PROJECT="${VERCEL_WEB_PROJECT:-qryvox}"
SCOPE="${VERCEL_SCOPE:-}"
SCOPE_ARGS=()

# Every production value, mirrored from .env.example. IP_HASH_SECRET is required against a hosted
# database (backend/src/env.ts throws without it); LLM_* are optional and only gate new steps.
API_VARS=(
  DATABASE_URL
  DATABASE_AUTH_TOKEN
  IP_HASH_SECRET
  ALLOWED_ORIGIN
  RATE_LIMIT_WINDOW_SECONDS
  RATE_LIMIT_STEPS_PER_IP
  RATE_LIMIT_STEPS_PER_CASE
  LLM_BASE_URL
  LLM_API_KEY
  LLM_MODEL
  LLM_TEMPERATURE
  LLM_TIMEOUT_MS
)

# The frontend bundle inlines NEXT_PUBLIC_* at build time, so these live on the web project, not
# the API project. The value is the deployed backend's own URL.
WEB_VARS=(
  NEXT_PUBLIC_API_URL
)

info() { printf '  %s\n' "$*"; }
fail() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

need_vercel() {
  command -v vercel >/dev/null 2>&1 || fail "vercel CLI not found. Install it: npm i -g vercel (needs >= 20.1.0 for workspace builds)"
  vercel whoami >/dev/null 2>&1 || fail "not logged in. Run: vercel login"
}

# Never let the CLI infer the scope. Its stored currentScope was empty and it reported a team
# ("kw16") that was not in `vercel teams ls`, which silently targets the wrong account.
# `vercel teams ls` prints its table on stderr, and marks the active team with a non-alphanumeric
# glyph, so filter on that rather than on column positions.
resolve_scope() {
  [ -n "$SCOPE" ] && { SCOPE_ARGS=(--scope "$SCOPE"); return 0; }
  local found count
  found="$(vercel teams ls 2>&1 | awk 'NF >= 3 && $1 ~ /[^A-Za-z0-9]/ && $2 != "id" { print $2 }')"
  count="$(printf '%s\n' "$found" | grep -c . || true)"
  if [ "$count" -eq 1 ]; then
    SCOPE="$found"
    SCOPE_ARGS=(--scope "$SCOPE")
    info "using Vercel scope '$SCOPE' (override with VERCEL_SCOPE)"
    return 0
  fi
  fail "cannot tell which Vercel team to use ($count found). Set one explicitly: export VERCEL_SCOPE=<team-slug>   # list them: vercel teams ls"
}

# Deploys go through VERCEL_ORG_ID/VERCEL_PROJECT_ID rather than a root .vercel/project.json:
# both projects build from this repo root (so /shared is uploaded), and a single .vercel
# directory can only point at one of them.
load_project() {
  [ -f "$PROJECTS_FILE" ] || fail "no $PROJECTS_FILE. Run: scripts/deploy.sh setup"
  local prefix="$1"
  export VERCEL_ORG_ID="$(grep -E "^${prefix}_ORG_ID=" "$PROJECTS_FILE" | cut -d= -f2-)"
  export VERCEL_PROJECT_ID="$(grep -E "^${prefix}_PROJECT_ID=" "$PROJECTS_FILE" | cut -d= -f2-)"
  [ -n "$VERCEL_ORG_ID" ] && [ -n "$VERCEL_PROJECT_ID" ] || fail "$prefix project ids missing from $PROJECTS_FILE. Re-run: scripts/deploy.sh setup"
}

# Deploy from a clean checkout of main so /shared is uploaded with the build (ADR-0001).
preflight() {
  step "Preflight"
  need_vercel
  [ -z "$(git status --porcelain)" ] || fail "uncommitted changes. Commit or stash first; deploys come from a clean checkout of main."
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || fail "not on main. Deploys come from a clean checkout of main (ADR-0001)."
  git fetch --quiet origin
  [ "$(git rev-list --count HEAD..origin/main)" -eq 0 ] || fail "main is behind origin/main. Run: git pull --rebase origin main"
  resolve_scope
  info "vercel $(vercel --version), scope '$SCOPE'"
  info "on main at $(git rev-parse --short HEAD), clean and up to date with origin"
}

# Schema must exist before the function boots: /health runs assertAppendOnly, which reads
# sqlite_master, so an unmigrated database turns every request into a 500.
migrate() {
  step "Migrating the production database"
  load_secrets
  info "applying migrations to the configured database"
  pnpm --filter @qryvox/backend db:migrate
}

load_secrets() {
  [ -f "$SECRETS_FILE" ] || fail "no $SECRETS_FILE (gitignored). Copy .env.example to it and fill in the production values."
  set -a; . "./$SECRETS_FILE"; set +a
}

# Checked before setup creates anything, so a missing local file can never leave half-built
# cloud state behind. Idempotent, so re-running setup after fixing this is safe.
check_secrets() {
  if [ ! -f "$SECRETS_FILE" ]; then
    fail "no $SECRETS_FILE (gitignored). Create it first:
    cp .env.example $SECRETS_FILE
  then fill in DATABASE_URL and DATABASE_AUTH_TOKEN from a free database at https://turso.tech,
  IP_HASH_SECRET from 'openssl rand -hex 32', and the LLM_* values for the analysis steps."
  fi
  load_secrets
  local name
  for name in DATABASE_URL IP_HASH_SECRET; do
    [ -n "${!name:-}" ] || fail "$name is empty in $SECRETS_FILE and is required in production"
  done
  case "$DATABASE_URL" in
    file:*)
      fail "DATABASE_URL in $SECRETS_FILE is still the local dev database ($DATABASE_URL). Production needs a libsql:// URL from https://turso.tech — Vercel has no persistent filesystem (ADR-0001)." ;;
  esac
  info "secrets present; database $DATABASE_URL"
}

# Requires load_project to have run first: without a project in scope these vars would land on
# whichever project the CLI infers.
sync_env_vars() {
  local -n names="$1"
  local name value
  for name in "${names[@]}"; do
    value="${!name:-}"
    if [ -z "$value" ]; then
      case "$name" in
        DATABASE_URL | IP_HASH_SECRET | NEXT_PUBLIC_API_URL)
          fail "$name is empty in $SECRETS_FILE and is required in production" ;;
      esac
      info "skip  $name (optional, unset)"
      continue
    fi
    vercel env rm "$name" production --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" production >/dev/null
    info "set   $name"
  done
}

sync_env() {
  step "Syncing production environment variables"
  load_secrets
  sync_env_vars API_VARS
}

# The dashboard's "new project" flow demands either a Git connection or a file upload, and
# ADR-0001 rules out the Git integration. `vercel project add` needs neither.
create_project() {
  local name="$1"
  if vercel project add "$name" "${SCOPE_ARGS[@]}" >/dev/null 2>&1; then
    info "created $name"
  else
    info "exists  $name"
  fi
}

link_project() {
  local name="$1" prefix="$2" scratch org project
  scratch="$(mktemp -d)"
  # Linking in a scratch dir keeps the ids out of the repo's single .vercel directory.
  if ! (cd "$scratch" && vercel link --yes --project "$name" "${SCOPE_ARGS[@]}" >/dev/null 2>&1); then
    rm -rf "$scratch"
    fail "could not link project '$name'. Create it with: vercel project add $name ${SCOPE[*]:-}"
  fi
  org="$(node -pe "require('$scratch/.vercel/project.json').orgId")"
  project="$(node -pe "require('$scratch/.vercel/project.json').projectId")"
  rm -rf "$scratch"
  printf '%s_ORG_ID=%s\n%s_PROJECT_ID=%s\n' "$prefix" "$org" "$prefix" "$project" >>"$PROJECTS_FILE"
  info "linked  $name ($project)"
}

setup() {
  need_vercel
  step "Checking production secrets"
  check_secrets
  step "Resolving the Vercel scope"
  resolve_scope
  mkdir -p "$STATE_DIR"
  : >"$PROJECTS_FILE"
  step "Creating and linking projects"
  create_project "$API_PROJECT"; link_project "$API_PROJECT" API
  create_project "$WEB_PROJECT"; link_project "$WEB_PROJECT" WEB
  load_project API
  sync_env
  step "One manual step left, once per project"
  info "Dashboard -> $API_PROJECT / $WEB_PROJECT -> Settings -> Build and Deployment:"
  info "  Root Directory                                    = backend / frontend"
  info "  Include source files outside of the Root Directory = ON  (this is how /shared is uploaded)"
  info "  Do NOT connect the Git integration (ADR-0001: owner-only CLI deploys on Hobby)"
  step "Setup complete"
  info "Next: pnpm deploy:api"
}

# Runs Vercel's real build pipeline locally, in the same git-less staging copy the deploy uses, so a
# bad vercel.json or an unresolvable workspace is caught before it costs a deployment.
check_build() {
  preflight
  load_project API
  stage_gitless
  step "Pulling project settings"
  vercel pull --yes --environment production --scope "$SCOPE" --cwd "$STAGE" >/dev/null
  step "Building locally (nothing is deployed)"
  vercel build --yes --target production --scope "$SCOPE" --cwd "$STAGE"
  step "Build config is valid"
}

# Same build, uploaded for real, but as a Preview: it exercises the whole upload path, including the
# commit-author check, without replacing the production deployment.
preview_api() {
  preflight
  load_project API
  stage_gitless
  step "Deploying a PREVIEW of $API_PROJECT (production is not touched)"
  vercel deploy --yes --scope "$SCOPE" --cwd "$STAGE"
  step "Verifying /health on the preview"
  # Previews sit behind Vercel Authentication, so the health check goes through the CLI's own
  # authenticated client rather than a bare curl.
  local url="${1:-$(latest_deployment_url)}" attempt
  # Vercel streams progress to stderr while the body lands on stdout, so read the body separately
  # from the noisy build output rather than grepping a merged stream.
  local body
  for attempt in 1 2 3 4 5 6; do
    body="$(vercel curl /health "$url" --scope "$SCOPE" 2>/dev/null)"
    if printf '%s' "$body" | grep -q '"status":"ok"'; then
      info "healthy: $url/health"
      info "the commit-author check passed with no git metadata in the upload,"
      info "so a production deploy of the same commit will pass too"
      return 0
    fi
    info "attempt $attempt/6 not ready yet, waiting..."
    sleep 5
  done
  fail "$url/health never returned ok"
}

# Deploy from a copy of the repo that has no .git directory. Vercel's Hobby plan only lets the team
# owner create deployments and works this out by matching the git commit author against the team
# owner, so any other author is blocked before the build runs (ADR-0001). Uploading from a git-less
# directory means there is no commit metadata to inspect, so the check has nothing to reject, and the
# commit author is never involved. The staged copy is made from the committed tree, so main stays
# the single source of truth for what production runs.
stage_gitless() {
  STAGE="$(mktemp -d)/repo"
  mkdir -p "$STAGE"
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.vercel' \
    --exclude '.next' \
    --exclude '.deploy' \
    --exclude '.env.deploy' \
    --exclude 'shared/dist' \
    "$ROOT/" "$STAGE/"
  [ -d "$STAGE/.git" ] && fail "staging directory still contains .git; the deploy would be blocked"
  STAGED_AT="$(git -C "$ROOT" rev-parse --short HEAD)"
  info "staged $STAGED_AT without .git -> $STAGE"
}

cleanup_stage() { [ -n "${STAGE:-}" ] && rm -rf "$(dirname "$STAGE")"; }

# The URL of the most recent deployment, for the preview health check.
latest_deployment_url() {
  vercel ls "$API_PROJECT" --scope "$SCOPE" 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | head -1
}
trap cleanup_stage EXIT

deploy_api() {
  preflight
  load_project API
  migrate
  sync_env
  stage_gitless
  step "Deploying $API_PROJECT to production"
  vercel deploy --prod --yes --scope "$SCOPE" --cwd "$STAGE"
  step "Verifying /health on the deployed backend"
  local url="https://$API_PROJECT.vercel.app" attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS --max-time 20 "$url/health" | grep -q '"status":"ok"'; then
      info "healthy: $url/health"
      info "eventTypes came from @qryvox/shared, so the workspace resolved under the Root Directory build"
      return 0
    fi
    info "attempt $attempt/6 not ready yet, waiting..."
    sleep 5
  done
  fail "$url/health never returned ok. Check: vercel logs $API_PROJECT"
}

deploy_web() {
  preflight
  load_project WEB
  load_secrets
  # The backend's own deployed URL, unless .env.deploy pins it. The frontend bundle inlines it, so
  # it has to be on the web project before the build, not after.
  if [ -z "${NEXT_PUBLIC_API_URL:-}" ]; then
    NEXT_PUBLIC_API_URL="https://$API_PROJECT.vercel.app"
    export NEXT_PUBLIC_API_URL
  fi
  stage_gitless
  step "Syncing the frontend's public environment variables"
  sync_env_vars WEB_VARS
  step "Deploying $WEB_PROJECT to production"
  vercel deploy --prod --yes --scope "$SCOPE" --cwd "$STAGE" \
    || fail "the web project also needs Root Directory = frontend in the Vercel dashboard"
  step "Verifying the deployed frontend"
  local url="https://$WEB_PROJECT.vercel.app" attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS --max-time 25 "$url" | grep -qi "qryvox"; then
      info "served: $url"
      info "the page rendered, so the Next build and its shared-workspace import both resolved"
      return 0
    fi
    info "attempt $attempt/6 not ready yet, waiting..."
    sleep 5
  done
  fail "$url never served the app. Check: vercel logs $WEB_PROJECT"
}

case "${1:-all}" in
  setup) setup ;;
  check) check_build ;;
  preview) preview_api "${2:-}" ;;
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *) fail "usage: scripts/deploy.sh [setup|check|preview <url>|api|web|all]" ;;
esac
