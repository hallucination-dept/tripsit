# Hackathon integration and staged verification

Status: selected for planning; implementation and live gates remain mandatory.
Type: architecture decision
Context: complete Elaborate for roughly 24 hours of agent build work without requiring additional user resource decisions.

## Decisions

- Retain SvelteKit/Better Auth/PostgreSQL and Gemma on Modal. Use PostgreSQL for revision and execution records; no graph database or additional coordinating service is required.
- Accept any user-accessible GitHub repository and mixed-language source. Common-language targets include JavaScript/TypeScript, Python, C++, C#, and Rust. Use language-aware syntax extraction where validated, file-level diff/import information where available, and explicit unresolved boundaries elsewhere. Parsing alone never establishes semantic call resolution. Select grammar/tool versions and validate fixtures during Plan/Build; an unsupported analyzer must not prevent intake or become a passing result.
- Use a server-configured OpenAI-compatible reviewer endpoint and model, selected later. Keep keys server-side. Do not allow arbitrary browser-supplied URLs. Until configured, show reviewer unavailable and withhold claims of completed review. Private-source dispatch requires explicit owner authorization identifying the destination; GitHub login does not authorize disclosure to another provider.
- Define generation output as bounded file replacements with repository-relative paths and original blob identities. The decoder must preserve exact original output bytes and map decoded content back through escapes to output spans; reject traversal, duplicates, stale blobs, truncation, or invalid encoding. When exact token reconstruction is unavailable, retain the candidate and expose missing uncertainty; do not invent mappings or silently omit the limitation.
- Propose a disposable Modal Sandbox for execution, separate from inference. This is a design selection, not a verified isolation claim or authorization to provision infrastructure. A runner must refuse untrusted execution until credential exclusion, egress, limits, cancellation, and artifact containment are verified on the actual environment. No local-host fallback. Provisioning/access can be configured later.
- Use repository-scoped GitHub App installation access for repository operations, linked to the logged-in owner. OAuth login alone is insufficient. Recheck installation/repository access before each operation. Only the trusted publication path receives a short-lived write token; candidate/reviewer workers never do. Refuse publication without authorized access rather than bypassing permissions.
- The app creates branches/PRs only; it exposes no merge or approval operation. Human decisions are revision-bound records, separate from GitHub merges. A trusted required status check compares the current base/head, mandatory evidence, and authenticated human decision. Repository rules must make it required with stale-approval dismissal and appropriate bypass restrictions before claiming GitHub-enforced merge protection. Without verified rules, label protection unverified and do not describe a review as acceptance-ready. External administrators' authority cannot be eliminated by app logic.
- Persist the minimum owner-scoped review artifacts required for the packet. Raw code/prompts/runner outputs are not application logs. Proposed pilot retention is seven days for raw artifacts, with deletion of artifacts and references tested; retain digest/status metadata without source. Provider retention must be disclosed at configuration and private-source dispatch remains disabled until owner authorization. This is an application proposal, not a claim about provider deletion.
- Keep original-code review primary. Obfuscation/selective masking is an optional experiment, not a shipping prerequisite or an injection defense. No source rewriting for execution.

## Prioritization and evaluation

Mandatory checks always run. Order optional checks by impact tier first, then missing evidence/reviewer disagreement and mean negative selected-token log probability where exact mapping exists; use stable check ID for ties. Unknown impact requires inspection and cannot become low risk. Record the ordering inputs; do not turn this into a correctness percentage.

Create independently labeled clean and defective fixtures spanning the target languages, with additions/deletions, aliases, cycles, dynamic calls, shared resources, Unicode, configuration changes, and malicious repository instructions. Compare graph-only, uncertainty-only, and combined selection against the same fixed optional-check count and time caps, fixed ordering, mandatory checks, and held-out cases. Choose numerical execution limits in implementation configuration; they are engineering controls, not a request for a user spending inventory.

## Deferred validation register

| Gate | When it must pass | Failure behavior | Runnable verification to implement |
| --- | --- | --- | --- |
| Real Gemma bytes, decoded multi-file spans, committed blob identity | Before uncertainty influences live ordering | Signal unavailable; report coverage gap | Fixture and configured endpoint contract test covering Unicode, CRLF, escaped contents, truncation, and subsequent edits |
| Language extraction and reverse traversal | Before declaring each relationship supported | Unresolved edge/file-level scope; unknown impact inspection | Per-language alias, deletion, rename, cycle, dynamic-call and shared-state fixtures |
| Reviewer schema, injection boundaries, retention disclosure | Before private-source dispatch/live review completion | No dispatch without consent; unavailable review | Mock endpoint malformed/oversized/timeout tests plus configured endpoint smoke test |
| Runner isolation and trusted result collection | Before executing any untrusted candidate | Refuse execution; verification unavailable | Disposable runner tests for secret absence, denied egress, timeout/process termination, symlink/artifact escape, and zero-test detection |
| GitHub access, idempotent publication, merge status | Before publication/protected-ready claims respectively | Permission error; no duplicates; protection unverified | Test installation denial, retry reconciliation, candidate/base changes, stale decision and branch-rule bypass cases |
| Artifact expiry and owner isolation | Before storing private-source artifacts | Refuse persistence outside validated controls | Two-owner access tests and clock-controlled expiry/deletion tests |

These are explicit deferred implementation gates, not passed feasibility tests. Plan may schedule them as prerequisites; dependent live features must not proceed on a failed gate. No new user choice is required to write that plan. Failed gates are fixed or logged with impact and next action, and block dependent work.

## Elaborate acceptance

Architecture is ready for planning once both fresh reviewers pass the design checklist. This does not certify application readiness, isolation, language coverage, calibration, or integration. Human phase-transition confirmation remains required by standard orchestration.
