# Exact token byte mapping

Add an isolated mapping function to the candidate decoder. It must first
validate the candidate, then require the complete ordered provider token bytes
to reconstruct the original response exactly. Parse the original JSON bytes
and record each content scalar's source and decoded UTF-8 byte ranges, including
escaped Unicode and a single optional autonomous Markdown frame. Reject
ambiguous duplicate keys, invalid or missing token bytes and bounded-resource
exhaustion as unavailable. Associate each mapping with response digest, file
blob identity, model and settings digest. Existing decoder callers continue to
receive unavailable mapping; persistence and consumer integration are later work.

Verification: `cd frontend && node --experimental-strip-types tests/candidate-output.test.ts && node --experimental-strip-types tests/generation.test.ts`; `cd frontend && npm run check && npm run build`; `git diff --check`. No live provider is used.

## Persistence integration

1. Generate an optional exact token-byte artifact only when the mapper proves
   complete reconstruction for the original response and valid token data.
   Bind it to the model, settings digest, response digest, file blob identities
   and direct/agent mode. Preserve unavailable mappings and old records.
   Verify: `cd frontend && node --experimental-strip-types tests/generation.test.ts`.
2. Persist the exact artifact in the existing owner-scoped expiring payload.
   Recompute it from stored source, observations and file identities on write
   and read; reject altered bytes, offsets, blob identities or settings. Apply
   existing payload limits. Verify: `cd frontend && node --experimental-strip-types tests/candidate-records.test.ts`.
3. Run mapper and persistence regressions and preflight; verify:
   `cd frontend && node --experimental-strip-types tests/candidate-output.test.ts && node --experimental-strip-types tests/model-generation.test.ts && npm run check && npm run build`.
   The database integration test requires an explicitly disposable local
   `TRIPSIT_TEST_DATABASE_URL`; no production or live service is used.
