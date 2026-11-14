---
bug_id: BUG-private-snapshot-503
status: investigating
severity: high
scope: private issue intake
---

POST `/api/work-items` for private `hallucination-dept/express-testbed` returns503.
The current work-items coordinator unconditionally rejects private snapshots, and
GitHub authorization rejects subsequent private reads. Listing private issues is
already supported, making the enabled snapshot button misleading.

Plan (updated by explicit user authorization): remove hardcoded public-only blocks
for snapshots and configured model/service workflows. Public/private repositories
use the same existing authentication, current user/install authorization, revision
checks, bounds and expiry. No additional consent, environment flags or admission
verification prerequisites for private intake. Recurring raw deletion is maintenance,
not a blocker. Test the actual private-repository regression and retained denials.

Verify: `cd frontend && node --experimental-strip-types tests/e01s01.test.ts && node --experimental-strip-types tests/github-discovery.test.ts && npm run check && npm run build`.
