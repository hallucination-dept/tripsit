# e01s01 review round 1 dispositions

type: fix
context: domain
Status: local findings addressed; independent round 2 pending. Full live/UAT acceptance remains blocked.

Parent supplied both independent reports: A85/B85, fail. This response addresses the reported local code findings; it does not reinterpret the failed full acceptance gate as passing.

1. MUST-FIX (both): expiry could occur while GitHub authorization awaited. Reproduced before implementation with a controlled clock: direct get unexpectedly resolved after expiry (assertion “Missing expected rejection”). Regression checkpoint 7c7c7fc; f5fb0aa rechecks after authorization and filters the completed list immediately before release. Get returns404 and list omits expired snapshots. Invalid expiry also refuses source.
2. SHOULD-FIX A: successful list reload could retain an omitted/stale selected detail. Applied selectedAfterReload to clear missing selection or replace it with the new returned snapshot. Pure helper is used by the actual page and tested for both cases.
3. SHOULD-FIX A: list repeated the full authorization sequence for every issue. Applied request-local Set keyed by exact repository name+ID, only after successful authorization. Two issues in one repository share that request's authorization; another repository/ID is checked separately. No persistent permission cache.
4. SHOULD-FIX B: AbortSignal alone did not bound an action that ignored it. HTTP now races action completion against request/30s abort and returns504 without source on timeout. linkedGitHubToken uses the same bounded await and explicit checkpoints between accounts/token/next work. Services check cancellation after record reads, after authorization, before create mutation and before list release. Late underlying completion cannot release a response or start subsequent intake work. Shared pg pool now sets 5s connection, client-query and server-statement limits; already-started SQL is bounded by those limits rather than falsely claimed to have instantaneous signal cancellation. Existing OAuth identity/session behavior is preserved; token retrieval still selects the local account ID.
5. SHOULD-FIX B: missing transport/runtime assertions. Added exact local-account token wiring, cancellation during delayed account lookup with no next token work, wrong App identity, oversized full upstream response and issue body, and fetch cancellation cases. Existing read-body cancellation remains tested. These are local injected-transport tests, not live provider claims.
6. CONSIDER: initial database “concurrency” shared one queued client. Improved actual test to use two separately acquired connections with different pg_backend_pid values and concurrent immutable creates. Retention test additionally exercises real PostgreSQL statement cancellation (57014) with pg_sleep and a25ms server deadline. No production access.
7. FULL ACCEPTANCE: private admission, actual configured GitHub/revocation probes, recurring purge invocation and authenticated browser UAT remain unimplemented/unverified. live_gates.py remains a failclosed REPORTER STUB. Tasks7/8 stay failing; no story completion or release gate advancement.

## Post-fix evidence

- `node --experimental-strip-types frontend/tests/e01s01.test.ts`: 19 cases passed,0failed/cancelled/skipped.
- Real disposable-loopback `frontend/tests/e01s01-db.test.ts`: 2 tests passed, with separate connections, owner isolation, physical deletion, immutable IDs and actual server timeout assertions.
- `npm run check && npm run build`: exit0, Svelte0errors/0warnings, adapter-node built; runtime auth baseURL absent warning remains informational because no runtime configuration is claimed.
- `python3 specs/experiments/plan_selfcheck.py` and `git diff --check`: exit0.
- Commits: 7c7c7fc RED reviewer regressions;47039cf test harness refinements;f5fb0aa GREEN fixes. A transient minimal expiry reproduction was run to observe the actual old race independently of the new-helper import failure, then removed; committed tests preserve coverage.

Self-audit after fixes: no new dependency/secret/source logging; constant bound SQL and escaped page preserved. Source disclosure, stale UI, authorization request fan-out and ignored cancellation findings addressed. Operational limits: existing pg pool now has finite5s limits affecting auth as well as intake; actual configured auth/provider behavior remains a live gate. No lint command exists. Parent independent round2 is next; do not equate19local tests with full story acceptance.
