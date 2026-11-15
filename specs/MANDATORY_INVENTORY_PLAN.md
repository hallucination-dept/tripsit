# Mandatory check inventory

The packet currently derives check definitions only from a completed runner
artifact. Separately expose the configured trusted mandatory checks for the
current repository and frozen base before execution, without constructing
runner evidence or claiming the manifest is complete. Keep the existing policy
requirement coverage and missing-check gaps authoritative.

1. Reuse the server-only configured-check parser on the assessment's frozen
   verification context. Report matching mandatory IDs and requirement links;
   distinguish missing or invalid configuration and runner availability.
   Include unresolved mandatory applicability and policy requirements lacking
   any configured matching check. Verify: `cd frontend && node --experimental-strip-types tests/verification.test.ts`.
2. Return the source-free inventory through the authenticated assessment view
   and display it with explicit incompleteness and no execution/pass claim.
   Preserve the packet's existing revision-bound execution rules. Verify:
   `cd frontend && node --experimental-strip-types tests/assessment-view.test.ts && node --experimental-strip-types tests/candidate-inspection.test.ts`.
3. Verify missing, malformed and unmatched configuration, mandatory policy
   preservation and unavailable runner paths, then run frontend preflight:
   `cd frontend && node --experimental-strip-types tests/assessment-route.test.ts && node --experimental-strip-types tests/packet.test.ts && npm run check && npm run build`; `git diff --check`.

No configured check or source result proves that the mandatory inventory is
complete; manual inspection and missing-check gaps remain required.
