# Reel Gen — acceptance and regression gates

This checklist is evidence-based. A successful deployment or synthetic fixture alone does not satisfy a real-media requirement.

| Gate | Required evidence |
|---|---|
| Build and CI | Typecheck, lint or static analysis, unit/integration tests, production build, actual CI conclusion |
| Cloudflare D1 | Versioned migrations, authenticated application reads/writes, tenant isolation, database round trip |
| Cloudflare R2 | Private bucket, signed uploads/downloads, quotas, explicit activation approval, lifecycle and deletion test |
| Authentication | Session verification, no default/shared workspace access, unauthorized and cross-tenant requests rejected |
| Ingest | Real files and recursive authorized cloud import, retries, deduplication, codec errors, persistence |
| Guided UX | Mobile and desktop browser recording, upload -> optional brief -> generate -> preview/edit -> download |
| Subject references | Consented and labeled footage, measured precision/recall and temporal overlap, lookalikes, occlusion, missing evidence, no filename or color-only identity claims |
| Hard requirements | Inclusion/exclusion, ordering, duration, format, ambiguity, contradictory brief, no filler or silent relaxation |
| Real rendering | FFmpeg MP4 output, audio/video sync, dimensions, timeline compliance, playable export, persistent artifact |
| Release | Commit SHA, deployment ID, browser evidence, live checks and rollback plan |

## Repair loop
1. Reproduce one failing gate and save the evidence.
2. Make the smallest complete correction on a versioned branch.
3. Add positive, negative, and regression tests.
4. Run all applicable tests; record failures and repeat the correction.
5. Deploy a preview only after applicable tests pass.
6. Re-test the browser flow and real rendered file. Promote only after acceptance gates pass.
7. Re-check production and report any blocked or unverified gate explicitly.

Do not mark reference subject matching complete using color similarity. Do not mark R2 or production generation complete while account activation, authentication, or rendering execution is blocked.
