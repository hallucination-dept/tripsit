# Owner outcome feedback

Owners record an escaped defect or spot-check against an existing owner decision, exact staged packet and candidate file. Store only bounded metadata and a same-repository issue number as the owner-reported evidence reference; do not assert the issue proves the finding. Match subsequent candidate file paths in the same repository and require additional inspection after an escape; unknown areas remain explicitly unresolved. No automatic trust recovery or model-generated findings.

- Implement owner- and repository-scoped immutable records with exact packet/decision/file checks and idempotent requests. Verify: `cd frontend && node --experimental-strip-types --test tests/outcome-feedback.test.ts`.
- Provide authenticated bounded route and UI showing owner-reported findings and increased scrutiny. Verify: `cd frontend && node --experimental-strip-types --test tests/outcome-feedback-route.test.ts && npm run check && npm run build`.
- Exercise stale/cross-owner/mismatched-path denial, duplicate requests, later exact-area matches and unmatched coverage. Disposable PostgreSQL verification remains required before delivery.
- Invalidate accepted decisions when the owner/repository outcome epoch changes. Serialize the acceptance insert with the epoch, require recorded deep inspection and regression follow-up for matching escapes, and deny stale epoch decisions. Verify: `cd frontend && node --experimental-strip-types --test tests/human-decision.test.ts tests/human-decision-db.test.ts` using a disposable local `TRIPSIT_TEST_DATABASE_URL`.
