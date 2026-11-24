# Reel Gen — Neon / free-stack implementation foundation

**Status:** Locally tested foundation, **not a complete production platform or live Neon setup**.

**Production:** https://reel-gen.anchit-tandon.com  
**Existing Vercel project:** `prj_efOs4Q6F6m2pczlNQpQDVeI6iwbM`  
**Live deploy on preceding check:** `dpl_7SPsYQ7uVKUR7jJG34CvQEbvE5mM`  
**Database:** Neon PostgreSQL ONLY. No Supabase dependencies.

## Implemented
- Canonical cloud URL parsing and provider interface
- Media intake classification, accepting all extensions while differentiating decode capability
- Initial Neon PostgreSQL schema for users/workspaces/projects/assets, OAuth connections, timelines, jobs and activity
- Parameterized SQL repository with tenant-aware queries and Neon connection-string validator
- Google Drive folder pagination and nested listing adapter (requires an authorized Google OAuth token)
- OneDrive/Graph sharing URL resolution and recursive listing adapter (requires an authorized Graph OAuth token)
- Real local FFmpeg/FFprobe deterministic video rough-cut CLI and MP4 renderer, including real input audio when present
- Verification of output duration, aspect ratio, and audio track; deterministic local tests

## NOT implemented/NOT verified
- Neon account/project creation and `DATABASE_URL` (connect Neon first)
- Hosted credential vault, token refresh, and production OAuth endpoints
- Durable online media storage, resumable remote uploads and provider downloads
- Semantic AI video understanding, highlight ranking, story planning, subtitles, professional effects
- Hosted render workers, queuing, SaaS auth/security, live application integration, CI/CD

## Run tests (no npm install needed)
```sh
node --test tests/*.test.mjs
```

## Create a real MP4 from footage on a machine with FFmpeg
```sh
node src/render-cli.mjs --input /path/to/footage --output /path/to/reel.mp4 --duration 30 --ratio 9:16
```
This is a **deterministic rough cut**. It is not represented as AI-edited or professional editorial quality. For real AI selection, connect local open-source vision and speech engines, test against human-reviewed footage and compose a coherent timeline.

## Neon setup
1. Connect Neon via ChatGPT connector or `https://console.neon.tech` (Free plan).
2. Create the `reel-gen` Neon project only with correct ownership/consent and $0 charges.
3. Copy pooled `DATABASE_URL` into Vercel project settings as an encrypted variable, and keep direct migration connection server-only.
4. Run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_initial.sql`.
5. Before deploying, implement real sessions, tenant checks, encrypted OAuth tokens, storage and workers. **Do not expose DATABASE_URL to the browser.**

## Free-tier architecture caveat
Neon stores only relational metadata; raw videos should live in affordable bounded object storage or source drives. Free compute/storage quotas and provider limits apply. Vercel free functions cannot promise long-running HD rendering; use an authorized local/always-on machine or other confirmed free compute service for FFmpeg workers. Do not silently charge users or bypass OAuth.
