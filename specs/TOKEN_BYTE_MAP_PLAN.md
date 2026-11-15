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
