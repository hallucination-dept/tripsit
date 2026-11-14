---
bug_id: BUG-issue-discovery-state
status: investigating
severity: medium
scope: issue discovery
---

User reports `hallucination-dept/express-testbed` has issues but the app says none.
Read-only probes return 34 open issues through the production discovery client for
one current linked account; another current linked account returns403. No issue
payload/schema/filter failure reproduced. The selector's unconditional "No open
issues" placeholder mislabels failed discovery; the controller separately retains
an error. Do not infer which account/session the user is using.

Plan: verify real rendered select option/value after successful asynchronous loading;
reproduce unavailable/denied/loading/empty states, fix misleading state once in the
shared issue UI/controller, retain auth/access checks, add regressions and preflight.
No GitHub or database mutation is required. User clarification pending about error text.

Verify: `cd frontend && node --experimental-strip-types tests/issue-discovery.test.ts && node --experimental-strip-types tests/github-discovery.test.ts && npm run check && npm run build`.
