#!/usr/bin/env bash
# Owner-only Vercel deploys for qryvox (ADR-0001: the Hobby Git integration only accepts commits
# authored by the account owner, so nothing here is automated and nothing uses GitHub Actions).
#
#   scripts/deploy.sh setup   create + link both projects, push production env vars
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

# Requires load_project API to have run first: without a project in scope these vars would land
# on whichever project the CLI infers.
sync_env() {
  step "Syncing production environment variables"
  load_secrets
  local name value
  for name in "${API_VARS[@]}"; do
    value="${!name:-}"
    if [ -z "$value" ]; then
      case "$name" in
        DATABASE_URL | IP_HASH_SECRET)
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

# Runs Vercel's real build pipeline locally without deploying, so a bad vercel.json or an
# unresolvable workspace is caught before it costs a deployment.
check_build() {
  preflight
  load_project API
  step "Pulling project settings"
  vercel pull --yes --environment production --scope "$SCOPE" >/dev/null
  step "Building locally (nothing is deployed)"
  vercel build --yes --target production --scope "$SCOPE"
  step "Build config is valid"
  info "output in .vercel/output (gitignored). Delete it before 'vercel deploy' to force a fresh remote build."
}

deploy_api() {
  preflight
  load_project API
  migrate
  sync_env
  step "Building the backend"
  pnpm --filter @qryvox/backend build
  step "Deploying $API_PROJECT to production"
  vercel deploy --prod
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
  step "Deploying $WEB_PROJECT to production"
  vercel deploy --prod
  info "deployed the frontend. It calls the backend via NEXT_PUBLIC_API_URL (set on the web project)."
}

case "${1:-all}" in
  setup) setup ;;
  check) check_build ;;
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *) fail "usage: scripts/deploy.sh [setup|check|api|web|all]" ;;
esac
