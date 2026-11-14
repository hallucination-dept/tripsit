# Independent review, execution, and evaluation — points 4–6

Status: proposed design. Provider integration, sandbox configuration, and evaluation effectiveness are not yet verified.

## Point 4: independent reviewer

Use one separately selected model through a configured OpenAI-compatible endpoint. The initial protocol uses chat requests and server-side validation; provider-specific advanced features are optional. Do not require the reviewer to expose probabilities or activations. Record endpoint/provider identity, model identifier, prompt version, settings, and available model revision metadata.

The first pass receives the frozen task snapshot with expectation provenance, base/candidate diff, relevant repository context, graph paths and gaps, and repository policy supplied by the trusted coordinator. It does not receive the coding agent's justification or generation confidence. Retrieved repository content is source-tagged untrusted data, including comments, documentation, and tool output.

Ask the reviewer to seek counterexamples and independently assess correctness, security, performance, and affected consumers. Require a structured response containing claims, source references, expectation links, impact reasoning, proposed checks, and unresolved questions. A clean response is not approval. State explicitly which files or paths were inspected and which context was omitted because of budget limits.

Validate response sizes, field types, enums, source paths/spans, and referenced IDs. Unsupported claims remain hypotheses, not findings presented as established defects. A reproducible counterexample is preferred, but static evidence may substantiate a finding without execution; preserve its evidence type and limitations. Materially invalid responses become unavailable review evidence, not a successful review.

The reviewer has no merge, publishing, policy-write, or secret access. It can request bounded source reads and proposed checks through the coordinator. A model request is not executable authority: approved runner policy validates the request and execution limits. New dependencies or requested network access cannot silently expand permissions.

After the independent first pass, the coordinator combines claims with graph impact and generation uncertainty to prioritize verification. A subsequent reviewer pass may inspect actual results and revise claims, preserving earlier findings and contradictions. Different-model disagreement is a triage signal, not independent proof.

Prompt-injection controls are layered. Model susceptibility cannot be ruled out by instructions or masking. Privilege boundaries and mandatory check enforcement must remain effective even when model output is malicious. Original code remains the primary view; selective masking/renaming stays an evaluated research option.

## Point 5: controlled execution

Separate the trusted coordinator, source acquisition/publication, inference, and candidate execution. The execution worker never receives GitHub write credentials, model API keys, production secrets, host sockets, or coordinator control channels.

Proposed execution candidate: a disposable Modal Sandbox distinct from the GPU inference container. No infrastructure is provisioned by this design. Before adoption, verify OS isolation, explicit egress restrictions, process termination, resource/time/output limits, and artifact handling against the actual deployed configuration.

Source acquisition verifies the repository and commit before copying source into execution. Treat symlinks, archive traversal, submodules, and repository-supplied commands/configuration as untrusted. Repository URLs and provider endpoints must be constrained against server-side network abuse; authorization must be checked before reading or writing private repositories.

Dependency preparation is a separate untrusted execution stage with constrained registry access, no publishing credentials, recorded manifests/lockfiles, and lifecycle hooks disabled where practical. If hooks are necessary, execute them only inside the same restricted boundary and record that choice. Verification runs with outbound networking blocked unless a specific check has an explicit approved exception. Tests needing unavailable services are reported as unavailable/inconclusive.

The runner controls checkout identity, check definition, environment, command invocation, deadlines, and result collection. Candidate stdout and test reports are untrusted artifacts. Record exit status, test discovery/execution counts where supported, expected oracle/check digests, versions, and artifact digests. No generic parser can guarantee arbitrary repository tests are honest; distinguish trusted independent checks from candidate-supplied suite results.

Trusted result collection enforces artifact path, type, size, and count limits, rejects unsafe links, and does not execute reports. Artifact digests detect changes but do not certify truth. Keep sensitive code and outputs access-controlled. Explicitly separate policy failures, check failures, no tests executed, cancellation, timeouts, and infrastructure errors.

Use bounded request lifetimes and cancellation propagation across browser, coordinator, model calls, and execution jobs. Retry only classified transient operations when safe; inference and publication require duplicate-cost and duplicate-PR handling. A cancelled run cannot become an acceptance-ready packet through late results.

The publication service alone may create an authorized implementation branch and linked PR. It cannot merge or submit an AI approval. Human sign-off and the final merge guard must refer to the current candidate and base; the mechanism for enforcing this remains a GitHub integration decision to validate.

## Point 6: evaluation and accountable decisions

Use controlled clean and defective changes with independently established expectations. Include functional bugs, downstream shared-state failures, security-sensitive changes, misleading instructions, missing evidence, dynamic dependency gaps, and an issue with ambiguous expected behavior. Maintain clean cases to measure false alarms. Proposed initial language cases are Python and TypeScript; results apply only to evaluated coverage.

For bug-fix claims, reproduce the reported failure on the base and run the same independent check on the candidate where feasible. Label changed expectations, non-reproduced reports, and oracle uncertainty explicitly. Include high-confidence defects and harmless low-confidence code so confidence cannot stand in for ground truth.

Compare graph-only, uncertainty-only, and combined optional-check selection using the same candidate changes, mandatory-check policy, critic context, tool access, and optional execution budget. Record model seeds/settings when supported and run ordering. Hold out cases before tuning. This isolates prioritization effects; any separate context or reviewer-model experiment must be labeled separately.

Budget each stage separately: source analysis, generation, review, mandatory checks, and optional verification. Record actual model tokens, requests, execution time, and costs where available. Numeric limits remain unset until estimates are obtained; absence of a budget is not permission for unlimited execution.

Report severe and total defect detection, missed defects, false alarms, optional budget used, incomplete analyses, and human decision time when measured. Define the unit as a labeled defect or clean change and deduplicate repeated findings. Do not label a small seeded demonstration as calibrated field performance or assign correctness probabilities without representative independent outcomes.

Use blinded human adjudication of disputed findings where feasible. A later controlled human study can compare ordinary summaries, evidence packets, and packets with uncertainty, measuring correct acceptance/rejection and time. This study is not required to claim the pilot workflow exists, but is required before claiming it reduces human effort safely.

The decision packet shows the issue/expectations, exact revision, affected paths, supported/contradicted/unresolved claims, check provenance/results, analysis gaps, and inspection obligations. Do not compress these into a green confidence badge.

Low-risk bounded changes allow concise sign-off. High-risk authentication, payments, destructive migrations, or CI permission changes require named human code inspection. Unknown impact increases scrutiny. A high-confidence model result cannot lower the policy tier.

Only the authenticated authorized owner can accept, request revision, or escalate. Acceptance records what was checked and by whom, unchecked scope and why, inspection outcome, residual risks, and time. Unresolved mandatory failures cannot be accepted through an ordinary residual-risk checkbox. Any exception process requires separate explicit policy and is outside the pilot.

Record random spot-check selections and results, including low-risk accepted changes, plus escaped defects and affected areas. An escape increases scrutiny for the relevant area/failure class. Pilot records show an inspection-required state and regression follow-up; automatic trust recovery or an area correctness score is deferred.

## Feasibility gates before implementation planning is locked

- Exact token-to-code reconstruction and revision mapping, including Unicode and multi-file output.
- Supported graph extraction with explicit unresolved calls and shared-resource boundaries.
- Reviewer response validation and unavailable-review handling on the selected endpoint.
- Runner isolation, credential exclusion, explicit egress behavior, timeout/cancellation, and safe artifact collection.
- Reproduction of a known defect on base and repaired behavior on candidate with traceable evidence.
- Mandatory-review enforcement and stale-sign-off rejection for changed candidate/base.

## Remaining choices

Concrete evaluation repositories, reviewer endpoint/model, sandbox configuration, publication authentication, retention, and numerical budgets remain open. Resolve through focused experiments and estimates. Credentials are required only when a selected live experiment is ready; do not record their values in specs.

All six Elaborate topics now have draft designs. No feasibility gate has passed, no fresh reviewer quality gate has run, and Elaborate is not complete.
