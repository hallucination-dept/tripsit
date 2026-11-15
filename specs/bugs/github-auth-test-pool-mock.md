# github-auth test fails after the idle pool error handler

- Found: 2026-11-15, while verifying review flags (unrelated change).
- Evidence: `cd frontend && node --experimental-strip-types --test tests/github-auth.test.ts` fails with
  `TypeError` at `src/lib/auth.ts:26` on branch `fix/intake-error-logging` (commit 2294036), with or without the
  review-flag changes in the working tree. The previous `main` (d6b0c74) passes.
- Cause: 2294036 adds `database.on('error', …)` in `auth.ts`; the test replaces `pg` with
  `export class Pool {}`, which has no `on` method.
- Impact: the CI "offline frontend tests" step fails for that branch's pull request. Runtime behaviour is unaffected.
- Next action: give the test's `pg` stub an `on() {}` method (`export class Pool { on() {} }`) in that branch.
