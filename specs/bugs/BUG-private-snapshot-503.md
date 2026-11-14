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

Plan: support only authorized private issue snapshot storage after real owner-scope,
expiry and recurring retention controls are verified. Keep private candidate/model,
reviewer and runner dispatch denied. Recheck current GitHub user/install access on
reads; explicit UI storage disclosure, seven-day raw expiry, no authentication bypass.
No new infrastructure or schema is needed. Existing configured database testing is
authorized; use synthetic fixture data and clean it up. Track actual control evidence
separately from mocked browser presentation and pending real authenticated UAT.

Verify: `cd frontend && node --experimental-strip-types tests/e01s01.test.ts && node --experimental-strip-types tests/github-discovery.test.ts && npm run check && npm run build`.
