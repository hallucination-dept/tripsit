# Server-owned required-check manifest

Allow an operator to configure a versioned trusted assertion for one repository, frozen base and policy version. It lists every mandatory policy requirement, explicitly resolves applicability with a reason, and binds each applicable requirement to exact configured mandatory check definitions. Treat the assertion as operator-provided policy, not evidence that checks ran or that the assertion is independently correct. Missing, duplicate, malformed, unmatched or ambiguous configuration remains unavailable. Do not change acceptance readiness.

1. Validate a bounded server-only manifest against the exact repository/base/policy, complete mandatory policy IDs and mandatory configured check definition digests. Reject duplicate IDs, unresolved applicability, missing check bindings, unknown checks, empty applicable requirements or extras. Verify: `cd frontend && node --experimental-strip-types tests/trusted-required-manifest.test.ts`.
2. Bind the validated manifest digest and resolved requirement/check inventory to the immutable packet, preserving missing evidence and `acceptanceReady: false`; missing manifest is an explicit unavailable state. Verify: `cd frontend && node --experimental-strip-types tests/revision-packet.test.ts && node --experimental-strip-types tests/assessment-route.test.ts`.
3. Run `cd frontend && npm run check && npm run build`. Do not configure production or call external services.


The server-only `REQUIRED_CHECK_MANIFEST_JSON` is a JSON array. Each entry has
`schemaVersion: 1`, a nonempty `version`, integer `repositoryId`, exact `baseSha`,
exact `policyVersion`, `complete: true`, and `controls`. Each mandatory control
appears exactly once with `id`, `applicability` (`applicable` or
`not_applicable`), a nonempty `reason`, and `checks`. An applicable control
needs at least one `{id, digest}` and a not-applicable control needs none. Every
configured mandatory check must be linked to at least one applicable control.
The check digest is `verificationDigest` of its validated configured check,
including cases and derived mandatory flag but excluding graph-dependent
`nodeIds`; it is not a checksum of model output. See the executable fixture in
`frontend/tests/trusted-required-manifest.test.ts` for a complete example.

The operator assertion and its digest are frozen in the packet; this does not
resolve existing baseline policy or establish completeness independently. Any
future acceptance gate must compare the frozen assertion against the active
server configuration and verify required execution and human inspection.
