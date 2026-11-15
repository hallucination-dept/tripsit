# Revision-bound file-level token priorities

The configured trusted check identifies a repository file by `path`; impact
nodes also identify an exact candidate revision, path, blob and byte span. Use
the candidate file node, not a guessed symbol/export association, for a
file-level check signal. Keep unknown graph impact explicit; no semantic
coverage is inferred from this association.

1. Pass only the validated candidate token artifact and observations plus
   candidate file node identities into verification context. Check revision,
   model, settings, source path, Git blob, and full-file span; drop mismatches.
   Verify: `cd frontend && node --experimental-strip-types tests/assessment.test.ts`.
2. For each trusted check, associate only the unique matching candidate file
   node and its mapped output; include only complete tokens contained inside
   the file content's contiguous source range. Missing or ambiguous identity,
   empty coverage, or mismatched revisions remain missing signals, never zero.
   Preserve mandatory checks and existing impact ordering. Verify:
   `cd frontend && node --experimental-strip-types tests/verification.test.ts && node --experimental-strip-types tests/priorities.test.ts`.
3. Run relevant regressions and preflight: `cd frontend && node --experimental-strip-types tests/assessment-view.test.ts && node --experimental-strip-types tests/packet.test.ts && npm run check && npm run build`; `git diff --check`.

This does not imply token probabilities prove correctness, symbol-level check
coverage, runner admission, configured endpoint evidence or live acceptance.

## User-visible explanation

Expose an exact mapping status only for a persisted artifact whose response,
model, settings and observations match the current assessment identity. Show
the actual last-dispatched mandatory, selected and omitted checks with their
recorded reasons. Explain that file mapping does not guarantee a comparable
signal for each check, and that the packet summary is not a new dispatch plan.
Verify: `cd frontend && node --experimental-strip-types tests/assessment-view.test.ts && node --experimental-strip-types tests/candidate-inspection.test.ts && node --experimental-strip-types tests/packet.test.ts && npm run check && npm run build`; `git diff --check`.
