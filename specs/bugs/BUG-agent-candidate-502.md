---
bug_id: BUG-agent-candidate-502
status: open
severity: high
scope: autonomous issue implementation
---

User reports502 creating a candidate for work item
`27eba683-198a-43ed-b27a-087a40addf1c`. Synthetic Gemma agent protocol passes, so
reproduce this actual frozen repository/issue with authenticated GitHub source tools
and in-memory candidate collection before choosing a fix. Configured source/model
use and database development diagnostics are authorized. No session-cookie fabrication,
GitHub writes or persisted candidate during reproduction; no source/credential logs.

Inspect bounded fixed stages: source acquisition, model HTTP/timeout/context capacity,
text action shape, selected original blob identities and final candidate decoding.
Fix the reproduced failure with a regression and rerun the real-item dry run. Do not
classify all502s as normal or claim success from the unrelated synthetic probe.

Verify: `cd frontend && node --experimental-strip-types tests/generation.test.ts && node --experimental-strip-types tests/model-generation.test.ts && npm run check && npm run build` plus actual-item source-free dry-run report.

## Closeout findings

- Fixed: model-facing file hashes overloaded the initial request; the same real issue
  changed from provider400 to200 after removing unnecessary metadata.
- Fixed: a legitimate generation took79s and exceeded the previous60s request timeout;
  inference now has180s within the existing300s agent deadline and timeouts report504.
- Fixed: conventional fenced JSON and model-omitted hashes; server derives trusted
  original blobs while preserving exact original output bytes/digest.
- **Still open:** on the final real-item dry run the model read two files totaling
  18,992 bytes; the next30,536-byte prompt exceeded the current8,192-token window.
  No database or repository writes occurred. Do not mark this bug or end-to-end
  generation acceptance complete.
- **User update:** the context window will be larger soon. This increase is planned,
  not verified live yet; do not assume a new size. Re-run this exact issue after it
  changes. Continue keeping bookkeeping out of prompts and improve context packing.

Resume from repository root with configured development environment:
`node --env-file=/home/u786288/projects/ohjunction/tripsit/frontend/.env --experimental-strip-types frontend/scripts/candidate-dry-run.ts 27eba683-198a-43ed-b27a-087a40addf1c`

Pi integration remains a separate unfinished improvement: SDK1.5.2 installed only in
`/tmp/tripsit-pi-prototype`; no app dependency or live Pi loop was integrated. The
buffered Gemma provider adapter/custom frozen source tools still need implementation.
