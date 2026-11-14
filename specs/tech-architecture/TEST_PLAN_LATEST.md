# Plan verification architecture

type: feat
context: domain
Status: planned; no application or live gate is certified.

## Commands and fixture strategy

Each capsule §16 names happy/denial scenario IDs and §17 gives observable acceptance criteria. Tasks first create a focused `frontend/tests/<story-id>.test.ts` using native `node:test`/`assert`; Node 22 strip-types tests dependency-injected server helpers with relative imports and no Svelte virtual modules. Build tasks must verify the actual project's Node minor version supports this invocation, otherwise compile focused TypeScript tests with installed TypeScript before native node:test. Use mocks for HTTP and clocks; use a disposable development PostgreSQL database for real constraints, owner filtering, concurrency and expiry. No production credentials in fixtures. Shell command existence alone is never implementation evidence.

`python3 -m unittest discover -s specs/experiments/tests -p test_evaluation.py` verifies evaluation metrics and budget invariants. Python runner and inference conversion assertions must also be invoked from generation/execution test fixtures or their live-gate harness; a passing frontend mock cannot certify Python conversion.

The implementation must add `specs/experiments/live_gates.py`, with explicit per-story subcommands listed below, JSON/source-free evidence output, finite deadlines and a nonzero exit for missing required configuration or assertions. Gate records bind configuration/version/environment digests and expire on relevant changes; a previous mock or different environment is not admission evidence.

## Required live admission gates

| Command suffix (`python3 specs/experiments/live_gates.py … --require-configured`) | Must prove before dependent live behavior |
| --- | --- |
| e01s01 | Disposable DB owner isolation, concurrent record constraints, expiry/deletion of raw bytes and references; actual GitHub App repository read access and denial. No private artifact storage until persistence controls pass. |
| e01s02 | Real Gemma token/raw-output reconstruction and multi-file decoder/blob identity across Unicode, escaped contents, CRLF, truncation and later edits. Missing signal permits candidate but excludes numerical uncertainty in those spans. |
| e02s02 | Configured endpoint schema/limits/timeouts, destination disclosure and explicit private-source consent; no dispatch before consent, no live-completed review while unavailable. |
| e03s02 | Actual separate disposable runner credential absence, denied egress, finite CPU/memory/process/time/output limits, cancellation termination, symlink/artifact escape denial, trusted result interpretation and zero-test detection. Refuse all untrusted execution until this passes; no local fallback. |
| e01s03 | Real authorized development issue → exact candidate PR, installation denial, idempotent retries and signed webhook reconciliation. Separately validate required status check, stale-approval dismissal, current base/head and bypass rules before protected-ready; otherwise protection unverified. |

Any provisioning or production data change needs explicit authorization. Missing credentials/configuration is an explicit blocked live gate, not a test skip reported as pass. No secrets or private source appear in evidence logs.

## Risk and test mapping

| Stories | Priority fixtures |
| --- | --- |
| e01s01 | P0 missing session, cross-owner/revoked installation, snapshot provenance, seven-day expiry, atomic writes |
| e01s02 | P0 invalid/truncated replacements, traversal/duplicate/stale blobs, exact decoded bytes, no stale token mapping, old review compatibility, cancellation/rate limits |
| e01s04 | P0 trusted mandatory policy resists repository injection; versioned applicability; authorization/keyboard/performance and non-web gaps |
| e02s01 | P0 alias, rename/deletion/base graph, cyclic traversal, same-name ambiguity, shared resources, dynamic/config changes, graph budgets, unsupported language gaps |
| e02s02 | P0 independent prompt, provenance-linked claims, malformed/oversized response, private consent, SSRF denial, unavailable reviewer |
| e03s01 | P1 impact-first order, mandatory/high-confidence defect, missing signals, same-setting means, stable ID ties and budget omissions |
| e03s02 | P0 actual runner admission, forged stdout/oracle changes, no tests, timeout/cancel/error, base failure/candidate repair, no publish secrets |
| e04s01 | P1 escaped render, traceability, disagreement, stale evidence, within-PR reuse assessment, unknown-impact mandatory rerun, no cross-PR reuse |
| e04s02 | P0 authenticated owner only, required inspection, no mandatory-failure override, revision concurrency and stale acceptance |
| e01s03 | P0 permissions, exact blobs, duplicate retry reconciliation, changed head/base, status/branch-rule bypass cases, no merge/approve API |
| e05s01 | P0 independently labeled clean/defective held-out JS/TS, Python, C++, C#, Rust; equal mandatory checks/optional budget, counts/cost/misses/false alarms/unavailable |
| e05s02 | P1 owner-scoped spot-check/escape record, matching-area monotonic scrutiny, historical immutability and unresolved matching |

Coverage reports must separate parsing, relationship resolution and executable verification per language. Common-language fixtures do not restrict repository intake. Freeze evaluation manifest, independent labels, held-out split and digests before outcomes: optional budget 3 checks, 60 seconds each/180 seconds total per method; mandatory checks identical and outside optional count. Available tools failing or missing report unavailable with denominators; do not exclude unfavorable outcomes or infer calibration. Time each run and record detection, severe misses, false alarms and actual cost.

## Full evaluation completion command

`python3 specs/experiments/evaluate.py --manifest specs/experiments/fixtures/evaluation-manifest.json --split held-out --methods graph-only uncertainty-only combined --require-executions --report specs/verifications/EVALUATION_LATEST.json`

Implement this command in e05s01 to produce a complete report from actual revision-bound execution records for all three methods, validate the pre-outcome frozen manifest and held-out split digests, enforce identical mandatory checks and equal optional count/time caps, and reject absent executions or empty clean/defective denominators. Preserve unavailable results and their denominators; do not silently omit methods or languages. Unit tests validate report logic but cannot substitute for running the complete comparison. Fixtures/independent labels may be prepared earlier; completion stays after the issue-to-PR milestone and all relevant admission gates.

## Completion evidence

Every task begins `failing` (not yet verified), every story begins `todo`. Only an actual zero-exit verification command plus UAT evidence can change these states. Frontend changes require `npm run check && npm run build`; no configured npm test/lint command exists. An evidence markdown file alone is necessary but insufficient: it must list fixture IDs, revision/configuration, command exits, observations, failures and limits and be inspected at verify-work. Fix or log reproducible failures under specs/bugs with impact/next action; stop dependent work when a failed gate invalidates it.
