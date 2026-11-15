# Issue-linked publication

Implement publication behind a real owner acceptance and current revision gate.
Use repository-scoped GitHub App write authority after linked-user access and
write-permission checks. Reconstruct and verify the exact staged Git objects,
write them without changing their identities, and use a deterministic branch
and durable publication identity. Reconcile existing references and pull
requests after ambiguous responses; never force-update, merge or approve.
Report unverified protection and missing evidence, and do not dispatch any
GitHub write while acceptance is unavailable.

Verification: `cd frontend && node --experimental-strip-types tests/publication.test.ts && node --experimental-strip-types tests/publication-github.test.ts && npm run check && npm run build`; `git diff --check`. Tests use mocked GitHub and local database fixtures; no live writes.
