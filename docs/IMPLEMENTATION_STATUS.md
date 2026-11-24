# Reel Gen — Independent status ledger

As-of foundation build: 2026-11-24. Do not interpret unit tests as live end-to-end deployment proof.

| Requirement | Status | Evidence | Production impact |
|---|---|---|---|
| Neon-only SQL schema | IMPLEMENTED, NOT DEPLOYED | `db/001_initial.sql`; local file inspection | Must connect actual Neon project, apply migration, verify permissions |
| No Supabase dependencies | VERIFIED IN DELIVERED CORE | `package.json` has no dependencies; no imported Supabase modules | Previous unrelated apps unaffected |
| URL provider recognition + safety | LOCAL TEST PASS | `src/folder-links.mjs`, 12 original tests | Not integrated into live webapp |
| Universal input file classification | LOCAL TEST PASS | `src/media-intake.mjs`, 7 original tests | Hosted uploads/resumability still missing |
| Secure per-workspace SQL repository | LOCAL UNIT TEST PASS | `src/neon-repository.mjs`, 3 tests with mock query | No live Neon connection, session management, or RLS checks |
| Google Drive pagination & recursion | LOCAL MOCK TEST PASS | `src/google-drive.mjs`, mocked API | No OAuth credentials; live real-account import untested |
| OneDrive Graph shared folder enumeration | LOCAL MOCK TEST PASS | `src/onedrive.mjs`, mocked API | No OAuth credentials; real-account import untested |
| Real FFmpeg MP4 render and basic validation | LOCAL ACTUAL-MEDIA TEST PASS | `src/render-engine.mjs`, ffprobe sample | Only local deterministic rough cut; no hosted render worker or semantic AI |
| Professional timeline/editor on hosted site | PARTIAL, PREVIOUS PROTOTYPE | Previous Vercel deployment | No new changes deployed |
| Auth / persistent cross-device projects | NOT IMPLEMENTED | No connected Neon | Required for usable SaaS |
| Real semantic highlight selection / story direction | NOT IMPLEMENTED | None | Core capability missing |
| License-aware music, captions, QA suite | NOT IMPLEMENTED | None | Required |
| Resumable cloud uploads and object storage | NOT IMPLEMENTED | None | Required |
| Multi-provider OAuth with encryption | NOT IMPLEMENTED | None | Required |
| CI/CD GitHub repository | NOT VERIFIED | GitHub repo not confirmed | Required |
| Production redeployment of Neon core | NOT DONE | Local-only code | Existing site remains live |

## Immediate external authorization blockers

1. Neon must be connected and its Free project created in an approved account; supply its encrypted pooled TLS `DATABASE_URL` to Vercel. No Neon credential has been made available to this implementation.
2. Official OAuth apps must be registered/authorized by respective owners, and production client IDs/secrets configured securely for Google and Microsoft.
3. An authorized media storage backend and a truly free always-available rendering worker must be selected/provisioned. An offline Mac is not an online worker.
4. The verified GitHub repo needs creation or discovery/authorization so code can be committed and Vercel Git-connected.

## Local verification commands

```bash
npm test
node src/render-cli.mjs --input /path/to/source-clips --output /path/to/reel.mp4 --duration 30 --ratio 9:16
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height -of json /path/to/reel.mp4
```

## Non-negotiable release requirement

Do not declare complete until a user can securely sign in, import a real authorized cloud folder recursively, generate ranked story-aware highlights, edit, render/validate/download a real MP4, reopen project on a second device, and review genuine dashboard history—with tests, live URLs and recorded proof.
