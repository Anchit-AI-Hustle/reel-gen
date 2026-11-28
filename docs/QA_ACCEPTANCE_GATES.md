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

## Release traceability register (initial baseline, 2026-11-28)

Baseline source: 9f985e3e6b38ab812375178e1739c1a7ddda898e. Production deployment previously reported: dpl_48Xx98aEEV1DNzaYm4VDhEoVjVmR. This register does not certify that deployment. Each row requires an executed test, exact tested SHA, deployment ID (or N/A for local tests), evidence URL and result. Initial status NOT TESTED means no qualifying evidence recorded in this register; it does not imply a feature is absent.

| ID | Requirement / control inventory seed | Required test and evidence | Status |
|---|---|---|---|
| NAV-01 | Hamburger, drawer, active links, Escape, focus return, touch targets | Browser keyboard/touch tests at desktop/tablet/mobile widths | NOT TESTED |
| NAV-02 | All routes, redirects, back/forward, refresh, deep links | Enumerate actual routes and controls; browser navigation tests | NOT TESTED |
| AUTH-01 | Sign-in/out, session expiry, tenant isolation | Authenticated and unauthorized cross-tenant API/browser tests | NOT TESTED |
| LINK-01 | Google account chooser, multiple accounts, unlink, refresh, revocation | Real authorized OAuth and token lifecycle | NOT TESTED |
| LINK-02 | Microsoft OneDrive and SharePoint | Real authorized OAuth and folder/file operations | NOT TESTED |
| LINK-03 | Dropbox and Box | Real authorized OAuth and folder/file operations | NOT TESTED |
| LINK-04 | S3-compatible scoped credentials | Authorized list/read, denied out-of-scope access, revoke | NOT TESTED |
| ADD-01 | Add footage: connected accounts, folder browsing, search, pagination, multiselect, recursive import | Real provider fixtures, dedupe, permission and retry tests | NOT TESTED |
| ADD-02 | Multiple URLs, local files/folders, drag/drop, library, reference photos | Browser selection and import tests, malformed URL and SSRF denial | NOT TESTED |
| ADD-03 | Video/audio/image/RAW/project/archive/unknown assets | Classification vs actual decode, conversion/unsupported status, archive traversal and limits | NOT TESTED |
| BRIEF-01 | Optional brief, consent, reference inclusion/exclusion | Empty brief, consent denial, ambiguous/multiple references | NOT TESTED |
| MATCH-01 | Genuine subject identity and labeled intervals | Consented positive/negative fixtures, precision/recall and temporal overlap; no color-only identity | NOT TESTED |
| RULE-01 | Ordering, duration, format, inclusion/exclusion, contradictions | Constraint regression and actual selected source intervals | NOT TESTED |
| JOB-01 | Generate, progress, cancellation, timeout, retry, errors | Real job state transitions; no simulated success | NOT TESTED |
| EDIT-01 | Preview, timeline, trim, reorder, revisions, settings | Browser controls and persisted EDL assertions | NOT TESTED |
| OUT-01 | MP4 playback and download | FFprobe, visual/audio inspection, source compliance, authenticated download | NOT TESTED |
| DB-01 | D1 durable tenant-scoped persistence | Live migrations and cross-session round trip, isolation | NOT TESTED |
| R2-01 | Private R2 media | Activation read-only check, scoped upload/download and access denial | NOT TESTED |
| OPS-01 | Setup script and real preflight | bash -n plus non-mutating credential/binding/compute checks | NOT TESTED |
| OPS-02 | Local Mac and GitHub synchronization | Device availability, git status and exact SHA, no overwrite | NOT TESTED |
| REL-01 | Full CI, review, production SHA and custom-domain E2E | Exact commit workflow logs, deployment metadata and browser smoke | NOT TESTED |

### Evidence record template

For each execution append: gate ID; test name; UTC date; tested commit SHA; deployment ID or N/A; fixture/environment; PASS/FAIL/BLOCKED/NOT TESTED; evidence link; observed result; remaining action. Never carry a PASS to another SHA without justified retesting.

### Inventory expansion rule

The table is a seed, not an exhaustive inventory. Enumerate every actual route, API method, visible and keyboard-accessible control, modal, input, upload, setting, timeline operation and output from source and browser inspection. Assign stable IDs and map each to tests for empty/loading/success/error/disabled/permission/timeout/retry states where applicable. Record inapplicable states with rationale. Include accessibility, touch, keyboard focus and all viewport sizes. A missing inventory entry or unexecuted required test blocks release. Record real-world recognition limits separately from fixture results.
