# Preserve autonomous model response identity

The autonomous coordinator currently decodes reserialized JSON but stores the
original model response. Decode the original bytes in the candidate decoder,
accepting the existing optional single Markdown frame only for autonomous
responses. Resolve each autonomous file's original blob solely from the
server-provided frozen repository map; retain direct-mode strict blob checks.
Keep all existing path, collision, UTF-8, size and source admission checks.
Token-to-file mapping remains unavailable until a later change proves offsets.

1. Add regression cases for unmodified raw bytes, framed/escaped Unicode
   responses, omitted or forged model blob identifiers, and malformed frames.
   Verify: `cd frontend && node --experimental-strip-types tests/candidate-output.test.ts && node --experimental-strip-types tests/generation.test.ts`.
2. Decode original autonomous output directly and derive blob IDs from the
   authorized server-side map; do not change direct-mode behavior. Verify the
   focused commands above and `cd frontend && npm run check && npm run build`.
3. Check patch scope with `git diff --check`. No live provider or database is
   involved; these checks do not prove token mapping or end-to-end acceptance.
