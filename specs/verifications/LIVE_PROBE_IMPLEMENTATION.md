# e01s01 executable development API probes

type: feat
context: domain
Status: harness implemented and locally tested; configured live execution unavailable; full admission remains blocked.

## Plan and scope

Replace the unconditional admission reporter with actual HTTP requests against an explicitly local development TripSit instance. Reuse the existing create/list/detail and Better Auth get-session endpoints. Do not copy App credentials into this process, mutate GitHub permissions or production services, enable private storage, or turn API-only results into browser/database/retention evidence. Owned files: live_gates.py, its focused tests and this evidence document. No package change or app route change.

## Probes and inputs

`python3 specs/experiments/live_gates.py e01s01 --require-configured --report /tmp/tripsit-live-api-report.json`

Set the following through a trusted development process environment, not a committed file:

| Name | Meaning |
| --- | --- |
| TRIPSIT_LIVE_ORIGIN | Explicit loopback HTTP origin, no path, userinfo, query or fragment |
| TRIPSIT_LIVE_OWNER_COOKIE | Existing signed-in owner's Cookie header; never logged |
| TRIPSIT_LIVE_OTHER_COOKIE | Distinct signed-in second owner's Cookie header; never logged |
| TRIPSIT_LIVE_REPOSITORY | Authorized public fixture owner/repository |
| TRIPSIT_LIVE_ISSUE_NUMBER | Positive real issue number |
| TRIPSIT_LIVE_REPOSITORY_ID | Independently recorded expected repository ID |
| TRIPSIT_LIVE_BASE_SHA | Independently recorded current default-branch SHA, exactly 40 or 64 hex characters |
| TRIPSIT_LIVE_REVOKED_ITEM_ID | Existing owner snapshot whose current repository authority is denied; valid UUID |

The harness performs eight HTTP requests: anonymous collection must return401; both sessions must identify distinct nonempty users; owner creates a real public snapshot; detail and list must preserve exactly the same immutable item; second owner must receive404; the preexisting inaccessible snapshot must return403. A404 for that last fixture fails because a nonexistent snapshot does not establish current repository denial. The harness does not revoke permissions itself and cannot prove how a fixture became inaccessible. The real configured server must use its actual GitHub installation adapter; local fixtures verify harness behavior only.

Creation verifies expected repository/name/issue/base identity, supplied provenance, empty inferred/confirmed collections, public visibility, opaque UUID and seven-day unexpired metadata. It does not infer formal criteria. Report contains check names, timestamp, source-free item/owner/config hashes, and digest of local probe/app/migration source files; raw source, repository references, cookies and upstream exception bodies are omitted. Local source digest is not proof that a running server loaded that exact build/configuration; deployment identity remains part of full live acceptance.

Each request has a35-second absolute connection/header/body deadline and1MiB body limit; eight sequential requests bound the full run to about280 seconds plus local work. Redirects are rejected without following Location, proxies are not used, and cookie header characters/length are validated. No retries or off-origin fetches. Only explicit local app-record creation mutates development data; GitHub itself is read-only. Keep the fixture until normal app retention removes it.

Full report always has accepted:false while private_admission, periodic_retention, database_isolation_and_purge and authenticated_browser remain unverified. A public_api passed result therefore still exits1. This is intentional: independent components must be implemented and verified before full gate completion; there is no success flag or skip mode.

## RED/GREEN and actual verification

- dff4fd7 test-only RED: explicit fixture configuration rejected by the old stub (one assertion failure).
- 6c70511 GREEN: configuration validation passed.
- 286d2ab test-only RED: actual HTTP behavior tests failed for missing run_probes, after approved loopback-server escalation resolved sandbox socket denial.
- 29a486e corrects the positive test fixture to exactly seven-day expiry before final implementation; tests still require missing HTTP implementation at that checkpoint.
- Final `python3 -m unittest discover -s specs/experiments/tests -p test_live_gates.py`: five test methods passed; subcases exercise missing/malformed config, header injection, same session, actual HTTP roundtrip, wrong SHA, source leak/denial failures, redirects, oversized content, timeout and report redaction. These are local fake-server checks, not real GitHub evidence.
- `python3 specs/experiments/live_gates.py --self-test`: exit0, configuration cannot grant admission.
- `python3 specs/experiments/live_gates.py e01s01 --require-configured`: exit1, all eight real fixture inputs unavailable; no live HTTP call was made.
- `git diff --check`: exit0.

Upstream verify-tdd-red-commit.sh is absent; actual RED command failures and separate commits recorded instead. No frontend code changed, so frontend check/build was not repeated here. No dependencies added. Parent integrates task/status state separately.

## Self-audit

Correctness: positive and adversarial local HTTP tests exercise real sockets, exact response/revision comparison and failure propagation. Missing or inconsistent fixtures fail. Security: loopback-only destinations, bounded cookies/body/deadlines, no redirects/proxies, no raw exceptions/source in evidence, read-only GitHub operations through app. Performance: finite eight requests, no retries; no background workers. Clarity: standard library only, one operational script and one test module, no admission receipt framework. No new HIGH finding detected in these local paths; this is not application/live security certification.

Skipped configured GitHub, production, actual revocation transition, browser, physical database/recurring retention and private admission checks. Those gaps continue to block full story acceptance.
