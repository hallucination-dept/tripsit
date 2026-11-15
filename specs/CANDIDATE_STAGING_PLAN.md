# Candidate commit staging

A staged candidate is an owner-scoped immutable Git commit object and its changed Git objects. It is not publication or acceptance. Stage only against a verified GitHub base commit and its complete, independently checked tree; preserve unchanged entries and modes. Do not checkout or execute repository content, invoke Git hooks, use live services during tests, or modify a configured database.

1. Expose a bounded authenticated GitHub base commit/tree read, verify returned commit identity and reconstruct the complete tree to check its reported root. Verify: `cd frontend && node --experimental-strip-types tests/github-context.test.ts`.
2. Build deterministic Git blob/tree/commit objects from the exact candidate bytes and base tree; reject stale originals, unsafe paths, modes, duplicate entries and hash mismatches. Verify: `cd frontend && node --experimental-strip-types tests/candidate-staging.test.ts`.
3. Atomically persist immutable owner-scoped staged objects using a migration and revalidate candidate/base/snapshot/expiry; expose authenticated route with access recheck. Verify: `cd frontend && node --experimental-strip-types tests/candidate-staging-service.test.ts && node --experimental-strip-types tests/candidate-staging-route.test.ts` and `cd frontend && node --experimental-strip-types tests/candidate-staging-db.test.ts` with `TRIPSIT_TEST_DATABASE_URL` pointing only to the disposable local test database.
4. Run `cd frontend && npm run check && npm run build`. Review exact bytes using a disposable local Git repository; no deployment or production migration.

A staged commit must have the exact base as sole parent, match every unchanged tree entry including mode, contain byte-identical candidate files and be stable across retries. A stage does not approve or make a packet acceptance-ready.
