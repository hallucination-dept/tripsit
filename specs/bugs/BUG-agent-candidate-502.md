---
bug_id: BUG-agent-candidate-502
status: investigating
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
