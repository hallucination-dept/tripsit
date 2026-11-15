# PR 9 reviewer privacy repair

ADR 0003 requires destination-specific owner authorization before private
source is sent to an external reviewer. This branch has no such authorization
flow. The reviewer currently accepts private source and the assessment path
relies on the snapshot's historical visibility. A public repository can
subsequently become private while access remains valid.

1. Add a focused regression for private snapshots, changed current visibility,
   malformed visibility and denied access; assert the reviewer receives no call.
   Verify: `cd frontend && node --experimental-strip-types --test tests/assessment.test.ts tests/reviewer.test.ts`.
2. Reauthorize immediately before review dispatch and require GitHub's current
   repository visibility and the stored snapshot visibility both to be public;
   independently refuse private input in the reviewer adapter. Preserve public
   assessment behavior and do not add a consent workflow.
   Verify: `cd frontend && node --experimental-strip-types --test tests/assessment.test.ts tests/reviewer.test.ts tests/github-context.test.ts`.
3. Run frontend preflight and check the patch.
   Verify: `cd frontend && npm run check && npm run build`; `git diff --check`.

No check can eliminate a visibility change after GitHub responds and before the
outbound request; reauthorization is performed immediately before dispatch.
