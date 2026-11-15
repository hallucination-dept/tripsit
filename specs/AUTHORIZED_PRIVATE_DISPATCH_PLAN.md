# Authorized private repository access

The user explicitly directs that an authenticated owner with repository access
may use the available workflow for private repositories. Apply this direction
to generation, independent review, admitted verification and packet freezing;
retain authenticated owner checks, repository ID/installation reauthorization,
provider retention disclosure, runner admission and revision freshness checks.
Invalid visibility or revoked access remains a denial. Existing ADR text is not
modified by this implementation.

1. Exercise private and changed-visibility success and revoked/invalid access
   denial immediately before dispatch, including repeated model turns and the
   runner's final dispatch callback. Verify: `cd frontend && node --experimental-strip-types tests/generation.test.ts && node --experimental-strip-types tests/assessment.test.ts && node --experimental-strip-types tests/verification.test.ts`.
2. Permit authorized private reviewer input while retaining server-only
   destination and retention requirements; allow authorized private packet
   freezing and staging, with repository identity and tree checks retained.
   Verify: `cd frontend && node --experimental-strip-types tests/reviewer.test.ts && node --experimental-strip-types tests/revision-packet.test.ts && node --experimental-strip-types tests/candidate-staging-service.test.ts && node --experimental-strip-types tests/github-context.test.ts`.
3. Run frontend preflight and inspect scope: `cd frontend && npm run check && npm run build`; `git diff --check`. Tests use mocks only; no private source or live service is contacted.
