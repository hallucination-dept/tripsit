# Exact selected-token mapping plan

Source inspection at `bf31018`: the Modal wrapper requests raw logprobs and
preserves `choice.logprobs` while adding legacy percentage fields. The frontend
adapter discards these observations. The autonomous generation path parses the
model's final action, serializes a different JSON object with server-supplied
blob IDs, and then replaces the decoder's raw bytes with the model response.
The two byte streams cannot share offsets. Provider token bytes and deployed
behavior remain unverified; model context capacity does not establish them.

1. **Provider contract.** Update `model-generation.ts` to extract bounded
   `choice.logprobs.content` token text, explicit byte arrays and finite
   non-positive logprobs, preserving output bytes and response completion state.
   Missing/malformed bytes or reconstruction mismatch produce unavailable
   observations without inventing data; truncated generation must not yield a
   complete candidate. Keep existing `/api/review` fields and Python wrapper
   conversion compatible. Do not infer token bytes from token display text.
   Verify: `cd frontend && node --experimental-strip-types tests/model-generation.test.ts`; `python3 -m unittest discover -s tests`.
2. **Canonical source identity.** Decode the original final response bytes,
   including a precisely delimited optional Markdown frame, instead of deriving
   spans from reserialized JSON. Validate the final action's paths and content
   against frozen GitHub identities, then attach server-supplied original blob
   IDs without rewriting the response. Preserve the separately supported direct
   generation shape and all current path, stale-blob, encoding and size checks.
   Verify: `cd frontend && node --experimental-strip-types tests/generation.test.ts`.
3. **Exact byte spans.** Extend `candidate-output.ts` with a bounded parser that
   records original UTF-8 response byte ranges for decoded file content, mapping
   JSON escapes and surrogate pairs to resulting file byte ranges. Require
   contiguous token-byte concatenation to equal the complete original response;
   map only output/file bytes whose reconstruction and identities are exact.
   Ambiguous or absent token data, invalid Unicode, cut-off output or changed
   bytes stay unavailable; malformed candidate JSON still fails. Associate each
   mapping with file blob SHA, raw-output digest, model and settings digest.
   Verify: `cd frontend && node --experimental-strip-types tests/candidate-output.test.ts && node --experimental-strip-types tests/generation.test.ts`.
4. **Persist and consume.** Extend the mapping union in `candidate-output.ts`,
   `generation.ts` and `candidate-records.ts`; validate range bounds, ordering,
   output digest, file blob identity and token reconstruction on both write and
   read. Preserve legacy unavailable records and existing owner/expiry/payload
   limits. Wire `assessment.ts`, `assessment-view.ts`, `verification.ts` and
   `packet.ts` only after exact file/node/check association is proven; unmatched
   or stale spans remain explicit gaps and mandatory checks remain mandatory.
   Update affected candidate views/types and fixtures as needed. Verify:
   `cd frontend && node --experimental-strip-types tests/candidate-records.test.ts && node --experimental-strip-types tests/assessment.test.ts && node --experimental-strip-types tests/assessment-view.test.ts && node --experimental-strip-types tests/priorities.test.ts && node --experimental-strip-types tests/packet.test.ts && node --experimental-strip-types tests/verification.test.ts`.
5. **Integration.** Add targeted direct and agentic cases for multibyte token
   boundaries, escaped quotes/CRLF, Unicode escapes and surrogate pairs,
   Markdown framing, missing bytes, mismatches, stale edits, zero observations,
   partial output, stored-record tampering and size limits. Run disposable local
   PostgreSQL persistence/expiry tests and frontend preflight. Verify:
   `cd frontend && node --experimental-strip-types tests/candidate-records-db.test.ts` with an explicitly disposable local `TRIPSIT_TEST_DATABASE_URL`, and `cd frontend && npm run check && npm run build`.

Actual raw provider observations and exact committed blob mapping require a
separate authorized configured endpoint contract test before live uncertainty
is used. No production deployment or data mutation is authorized by this plan.
