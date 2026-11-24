#!/usr/bin/env bash
set -euo pipefail

cd /Users/anchittandon/reel-gen

echo "=== Step 1: Verify Wrangler (Cloudflare) and Vercel login ==="
if ! wrangler whoami >/dev/null 2>&1; then
  wrangler login
fi
if ! vercel whoami >/dev/null 2>&1; then
  vercel login
fi

echo ""
echo "=== Step 2: Provision Cloudflare D1 database (reel-gen-db) & R2 bucket (reel-gen-media) ==="
D1_OUT=$(wrangler d1 create reel-gen-db 2>&1 || true)
echo "$D1_OUT"
DB_ID=$(printf '%s\n' "$D1_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n 1 || true)

if [ -z "$DB_ID" ]; then
  DB_ID=$(wrangler d1 list --json | node -e 'const d = JSON.parse(require("fs").readFileSync(0,"utf8")); const hit = d.find(x => x.name === "reel-gen-db"); console.log(hit ? hit.uuid : "");')
fi

if [ -z "$DB_ID" ]; then
  echo "ERROR: Could not determine reel-gen-db UUID. Check wrangler d1 list."
  exit 1
fi
echo "Using D1 database_id: $DB_ID"

# Update worker/wrangler.toml with actual database_id
node -e '
const fs = require("fs");
const p = "worker/wrangler.toml";
let txt = fs.readFileSync(p, "utf8");
txt = txt.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${process.argv[1]}"`);
fs.writeFileSync(p, txt);
' "$DB_ID"

wrangler r2 bucket create reel-gen-media 2>&1 || true

echo ""
echo "=== Step 3: Apply D1 migrations remotely ==="
wrangler d1 migrations apply reel-gen-db --remote --config worker/wrangler.toml

echo ""
echo "=== Step 4: Set Worker secrets and deploy reel-gen-api ==="
API_TOKEN=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -hex 32)
ENC_KEY=$(openssl rand -hex 32)

printf '%s' "$API_TOKEN" | wrangler secret put CLOUDFLARE_DB_API_TOKEN --config worker/wrangler.toml
printf '%s' "$AUTH_SECRET" | wrangler secret put AUTH_SECRET --config worker/wrangler.toml

DEPLOY_OUT=$(wrangler deploy --config worker/wrangler.toml 2>&1)
echo "$DEPLOY_OUT"
WORKER_URL=$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'https://reel-gen-api\.[a-zA-Z0-9.-]+\.workers\.dev' | head -n 1 || true)

if [ -z "$WORKER_URL" ]; then
  read -r -p "Enter deployed Cloudflare Worker URL (https://reel-gen-api.<subdomain>.workers.dev): " WORKER_URL
fi

CF_ACCOUNT_ID=$(wrangler whoami 2>&1 | grep -oE '[0-9a-f]{32}' | head -n 1 || true)

echo ""
echo "=== Step 5: Remove obsolete Neon vars & configure Cloudflare env vars in Vercel ==="
for oldvar in DATABASE_URL DATABASE_URL_DIRECT NEON_DATABASE_URL NEON_PROJECT_ID; do
  for target in production preview; do
    vercel env rm "$oldvar" "$target" --yes >/dev/null 2>&1 || true
  done
done

set_vercel_env() {
  local name="$1"
  local value="$2"
  [ -z "$value" ] && return 0
  for target in production preview; do
    vercel env rm "$name" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$target"
  done
}

set_vercel_env "APP_URL" "https://reel-gen.anchit-tandon.com"
set_vercel_env "CLOUDFLARE_ACCOUNT_ID" "$CF_ACCOUNT_ID"
set_vercel_env "CLOUDFLARE_D1_DATABASE_ID" "$DB_ID"
set_vercel_env "CLOUDFLARE_DB_API_URL" "$WORKER_URL"
set_vercel_env "CLOUDFLARE_DB_API_TOKEN" "$API_TOKEN"
set_vercel_env "CLOUDFLARE_R2_BUCKET" "reel-gen-media"
[ -n "$CF_ACCOUNT_ID" ] && set_vercel_env "CLOUDFLARE_R2_ENDPOINT" "https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
set_vercel_env "AUTH_SECRET" "$AUTH_SECRET"
set_vercel_env "ENCRYPTION_KEY" "$ENC_KEY"

echo ""
echo "=== Step 6: Deploy Vercel production (https://reel-gen.anchit-tandon.com) ==="
vercel deploy --prod --yes

echo ""
echo "=== Step 7: Verify Worker health & live Vercel routes ==="
curl -s "${WORKER_URL}/health"
echo ""
for r in "" "/library" "/editor" "/drives" "/dashboard" "/settings" "/api/state"; do
  printf "%-12s -> HTTP %s\n" "${r:-/}" "$(curl -s -o /dev/null -w "%{http_code}" "https://reel-gen.anchit-tandon.com${r}")"
done
