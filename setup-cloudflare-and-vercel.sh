#!/usr/bin/env bash
# Verify the existing Reel Gen project, Cloudflare and Vercel configuration.
# Default: read-only remote checks, then local CI. --apply: idempotent D1 migration.
# --deploy-preview: after passing tests, deploy the existing app as a preview only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export CLOUDFLARE_ACCOUNT_ID="b480ae61b407c6ba187c20329be391f9"
DB_NAME="reel-gen-db"
DB_ID="e2a1fd81-2709-42ca-8142-9fd69b2477c6"
PROJECT_ID="prj_efOs4Q6F6m2pczlNQpQDVeI6iwbM"
TEAM_ID="team_yC0I2xlKsitxFcfizef9EDQl"
WORKER_URL="https://reel-gen-api.anchit-tandon.workers.dev"
apply=0; preview=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    --deploy-preview) preview=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
for bin in node npm ffmpeg ffprobe curl; do
  command -v "$bin" >/dev/null || { echo "Missing prerequisite: $bin" >&2; exit 1; }
done
# Require installed/authenticated CLIs; never auto-login, activate billing, or print secrets.
command -v wrangler >/dev/null || { echo "Install Wrangler CLI and authenticate it to the intended account." >&2; exit 1; }
command -v vercel >/dev/null || { echo "Install Vercel CLI and authenticate it." >&2; exit 1; }
test -f .vercel/project.json || { echo "Link this checkout to the existing reel-gen Vercel project first (vercel link)." >&2; exit 1; }
node -e 'const f=require("./.vercel/project.json"); if(f.projectId!==process.argv[1] || f.orgId!==process.argv[2]){console.error("Wrong Vercel project/team; refusing to continue");process.exit(1)}' "$PROJECT_ID" "$TEAM_ID"
echo "Verifying Cloudflare account and existing D1 database..."
wrangler whoami
wrangler d1 info "$DB_NAME" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const v=JSON.parse(s);if((v.uuid||v.database_id||v.id)!==process.argv[1]){console.error("D1 identity mismatch");process.exit(1)}console.log("D1 identity verified")})' "$DB_ID"
if [ "$apply" -eq 1 ]; then
  wrangler d1 execute "$DB_NAME" --remote --file=db/cloudflare/0001_core.sql
fi
wrangler d1 execute "$DB_NAME" --remote --command="SELECT version FROM schema_migrations;"
echo "Checking R2 access (no checkout or subscription activation)..."
r2_ok=1
if ! wrangler r2 bucket list; then
  r2_ok=0
  echo "R2 unavailable. Review subscription activation in https://dash.cloudflare.com/?to=/:account/r2/overview" >&2
fi
echo "Checking deployed health Worker..."
curl --fail --silent --show-error --max-time 20 "$WORKER_URL/health"
printf '\n'
echo "Running local verification gates..."
npm ci
npm run typecheck
npm test
npm run build
if [ "$preview" -eq 1 ]; then
  # Do not promote to production from this script: auth, R2 and real-media E2E must pass first.
  vercel --yes
fi
if [ "$r2_ok" -eq 0 ]; then
  echo "BLOCKED: R2 is not available. Application upload/export integration cannot be certified." >&2
  exit 3
fi
echo "Preflight and local build passed. Full authenticated media E2E and production checks are still required."
