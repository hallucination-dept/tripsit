# Private source dispatch guard

Prevent generation and verification from sending private repository source to external services without destination-specific authorization. The existing product has no such authorization flow, so these operations must deny private snapshots and repositories that have become private; public repositories continue normally. Recheck the authenticated GitHub user, installation, repository identity, and current visibility immediately before each model or runner request.

- Guard both generation paths and every autonomous model turn using the existing GitHub visibility reauthorization. Verify: `cd frontend && node --experimental-strip-types --test tests/generation.test.ts`.
- Guard verification before its runner request using the same visibility reauthorization. Verify: `cd frontend && node --experimental-strip-types --test tests/assessment.test.ts tests/verification.test.ts`.
- Exercise visibility changes, denied and malformed authorization responses, and public success; run `cd frontend && npm run check && npm run build`.

No source, credentials, or provider calls are used in tests. This guard does not add a private-source authorization workflow.
