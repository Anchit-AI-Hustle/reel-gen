# Cloudflare backend migration (24 Nov 2026)

Cloudflare account: The Tandon Group (b480ae61b407c6ba187c20329be391f9)
D1 database: reel-gen-db (e2a1fd81-2709-42ca-8142-9fd69b2477c6), region APAC
D1 binding: DB
Worker: reel-gen-api (https://reel-gen-api.anchit-tandon.workers.dev)
Production frontend: https://reel-gen.anchit-tandon.com
Vercel project: prj_efOs4Q6F6m2pczlNQpQDVeI6iwbM

## Confirmed actions
- D1 database created using the connected Cloudflare account.
- Core SQLite/D1 schema applied and read back (migration 0001_core).
- Read-only health Worker deployed and bound to DB.
- Vercel project framework changed to nextjs; incorrect output directory override cleared.
- Non-secret Cloudflare account/database/Worker URL variables configured in Vercel.

## Blockers and security gates
- R2 is NOT enabled: Cloudflare rejects bucket creation with HTTP 403 code 10042, "Please enable R2 through the Cloudflare Dashboard."
- Enabling R2 requires the account owner to review its dashboard checkout, which can include billing beyond the free allowance. This must not be automated without payment approval.
- Media upload and MP4 exports MUST NOT claim production readiness until an R2 bucket (or another explicitly approved durable storage provider) is operational.
- The current Worker only exposes /health. Authentication and authorized CRUD are not deployed.
- The existing Next.js app still uses local filesystem persistence and Neon-specific code. Environment variables alone do NOT migrate the app.
- Reference-image/person matching requires consent-aware processing, R2 media storage, QA, and actual visual E2E tests.
- The local Mac device was offline when checked. Save source at /Users/anchittandon/reel-gen only after reconnect and verification.

## Account owner action
Visit https://dash.cloudflare.com/?to=/:account/r2/overview and review R2 activation/checkout. Do not enable paid usage or billing without explicit approval. After activation, create private bucket reel-gen-media, bind as MEDIA_BUCKET, and implement protected upload/download endpoints with quotas.

## Required development sequence
1. Replace PostgreSQL/Neon repositories and migrations with Cloudflare D1-compatible code.
2. Implement authenticated Worker CRUD; enforce user/workspace authorization independently of CORS.
3. Update Vercel server routes to use a secure Worker service token; do not expose tokens client-side.
4. Add R2 private storage with consent-based retention for images/videos and signed access.
5. Move FFmpeg to a real, authorized background compute worker; Vercel ephemeral filesystem is not durable.
6. Test full create -> media ingest -> reference selection -> generate -> preview -> MP4 download flow.
7. Run CI and human-verified browser E2E; do not mark features verified without evidence.

## Cost restrictions
Use only free-tier/open-source components and stop at any billing or paid-service activation boundary. Cloudflare R2 free allowance is not the same as guaranteed zero cost.
