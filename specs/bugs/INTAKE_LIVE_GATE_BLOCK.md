# e01s01 live gate block

type: feat
context: domain
Status: unresolved planned gate, not a reproduced application exploit.

Reproduction: `python3 specs/experiments/live_gates.py e01s01 --require-configured` exits1 with the exact missing local origin, two session headers and GitHub fixture identities. The script now implements real configured public API probes for distinct authenticated owners, immutable create/list/detail provenance, second-owner denial and an existing inaccessible snapshot. Seven local HTTP-fixture tests pass; actual GitHub-backed execution is unrun. No credential files were read.

Impact: private snapshot create/read remains always refused. Public local slice is implemented and unit/database/build checks pass, but live public integration, recurring retention compliance and browser UAT are uncertified. Dependent stories cannot treat e01s01 as done.

Local repeated purge verification now executes two timed subprocess cycles against isolated real PostgreSQL fixtures; physical deletion and active-item preservation pass. This is not a verified invocation on the intended application deployment. A native Chrome harness is implemented and smoke-tested, with negative harness fixtures distinct from actual authenticated app UAT.

Next action: configure authorized development GitHub user/App/issue and separate owner/revocation fixtures, execute the implemented API/browser probes, verify a recurring purge invocation against the intended development deployment, then implement matching private admission. Production data/infrastructure mutations require explicit authorization. Keep tasks7/8 failing and story blocked until real evidence passes; do not create a duplicate story to hide this gate. Full gate accepted remains false even if public API probes pass.
