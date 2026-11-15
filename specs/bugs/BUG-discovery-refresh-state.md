---
bug_id: BUG-discovery-refresh-state
status: investigating
severity: high
scope: issue workspace
---

User reports minute polling resets the whole workspace and issue loading prevents
switching repositories. Existing discovery error handling clears previously valid
lists/selections; page filtering clears snapshots on any discovery error. A shared
loading flag disables the repository selector during issue requests.

Fix: retain valid workspace state during background refresh/transient errors; allow
repository changes while issues load; cancel/discard old requests. Keep explicit
owner/sign-out and authoritative access-removal invalidation. Add regressions before
code and publish this bounded fix independently after checks and review.

Verify: `cd frontend && node --experimental-strip-types tests/issue-discovery.test.ts && npm run check && npm run build` plus Chrome pending-request/selection-preservation check.
