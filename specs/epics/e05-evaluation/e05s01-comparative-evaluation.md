# e05s01: Compare prioritization on independently labeled fixtures

## 1. Identity

e05s01: Compare prioritization on independently labeled fixtures

type: feat
context: domain
risk: P0
maturity: 3
bcps: 5 (estimate; not an elapsed-time guarantee).

## 2. User and value

The authenticated named engineer can observe this outcome through the workflow; it is a vertical API/persistence/UI slice, not a layer-only delivery.

## 3. Problem

Compare graph-only, uncertainty-only and combined optional check selection under equal fixed budgets, mandatory checks, ordering and time caps on independently labeled clean/defective held-out fixtures.

## 4. Scope

Freeze labels, split and budget before evaluation; do not tune on held-out data; unavailable tools/languages are reported not counted passing; no correctness/calibration claims.

## 5. Requirements

### ADDED
Compare graph-only, uncertainty-only and combined optional check selection under equal fixed budgets, mandatory checks, ordering and time caps on independently labeled clean/defective held-out fixtures.

## 6. Inputs

Frozen work item, authenticated owner and trusted policy; repository/model content is untrusted data.

## 7. Outputs

Compare graph-only, uncertainty-only and combined optional check selection under equal fixed budgets, mandatory checks, ordering and time caps on independently labeled clean/defective held-out fixtures. Outputs identify owner, revision, provenance and explicit gaps.

## 8. Dependencies

e01s03

Fixture preparation, independent labeling and manifest freezing may start earlier as independent work. Full evaluation completion remains after the end-to-end issue-to-PR milestone; this ordering does not waive frozen held-out data or any live admission gate.

## 9. Architecture

Affected or proposed paths: specs/experiments/evaluate.py; specs/experiments/fixtures/; specs/verifications/EVALUATION_LATEST.md. Use existing route-oriented SvelteKit, #lib imports, strict TypeScript, Svelte runes, pg persistence and Python inference conversion. Ref: ADRs 0001–0003.

## 10. Data and contracts

Use the minimal records in REVIEW_RECORDS_LATEST.md. Store immutable base/head/snapshot/policy identities; access checks on every operation. Atomic optimistic revision checks prevent stale mutations. Raw artifacts expire after seven days; retain only source-free digest/status metadata.

## 11. Security and privacy

Freeze labels, split and budget before evaluation; do not tune on held-out data; unavailable tools/languages are reported not counted passing; no correctness/calibration claims. Trust boundaries and exact denial fixtures are required; no security findings may remain unresolved in affected paths. No untrusted execution or private persistence before their actual admission gates pass.

## 12. Failures and recovery

Return bounded non-sensitive errors; restore loading state. Bound external calls, cancellation and retries; reconcile safe retries by stable operation identity. Do not log raw code, credentials or prompts. Missing configuration is unavailable, never pass.

## 13. Performance and limits

Choose explicit finite input/output, context, node, artifact, request and concurrency limits in implementation configuration; test exhaustion. Optional check budget: 3 checks, 60 seconds per check, 180 seconds total per method; mandatory checks separate and identical. These evaluation defaults are engineering controls, not production capacity claims.

## 14. Compatibility

Preserve existing authenticated review route and review/tokens response and fallback; update all callers atomically if extending fields. No new service, graph database, generalized framework or merge operation.

## 15. Implementation steps

1. Define regression fixtures and assert the happy path, edge cases and security denials below before implementation. → verify: `python3 -m unittest discover -s specs/experiments/tests -p test_evaluation.py`
2. Create independently labeled fixtures and freeze manifest/split digests before outcomes; implement evaluate.py to execute all three methods and emit the complete comparative report. Validate frozen manifest and split digests, revision-bound real execution IDs, identical mandatory checks/equal optional budgets, nonempty clean/defective held-out denominators and explicit unavailable results. Missing executions or empty denominators fail; unit invariants alone cannot complete evaluation. Ref: ADR 0003. → verify: `python3 specs/experiments/evaluate.py --manifest specs/experiments/fixtures/evaluation-manifest.json --split held-out --methods graph-only uncertainty-only combined --require-executions --report specs/verifications/EVALUATION_LATEST.json`
3. Integrate all affected contracts and run frontend diagnostics/build; include no new security findings in affected paths in focused assertions. Ref: ADRs 0001–0003. → verify: `(python3 -m unittest discover -s specs/experiments/tests -p test_evaluation.py) && (cd frontend && npm run check && npm run build)`
4. Save revision-bound UAT evidence with fixture identifiers, actual commands, statuses and limitations; reject an empty evidence record. → verify: `test -s specs/verifications/e05s01.md`

## 16. Test fixtures

SC-e05s01-P0-01: A saved reproducible report includes detection, severe misses, false alarms, cost and unavailable results per method/language without assuming combined wins.

SC-e05s01-P0-02: High-confidence defects, harmless uncertain names, unsupported relationships and malicious instructions expose failure modes rather than being excluded after outcomes.

Tests are planned, not executed. Unit/mock assertions precede live gates; frontend tests use Node 22 strip-types on dependency-injected pure TS helpers and native node:test, with no $app imports. Integration tests use a disposable local PostgreSQL database and fail when required configuration is absent.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authenticated authorized owner and frozen revision
  When the owner exercises this story
  Then A saved reproducible report includes detection, severe misses, false alarms, cost and unavailable results per method/language without assuming combined wins.

Scenario: Edge or denial
  Given adversarial or unavailable inputs
  When the operation is attempted
  Then High-confidence defects, harmless uncertain names, unsupported relationships and malicious instructions expose failure modes rather than being excluded after outcomes.
```

## 18. Verification script

1. Run `python3 -m unittest discover -s specs/experiments/tests -p test_evaluation.py` against the fixtures above.
2. Run `python3 specs/experiments/evaluate.py --manifest specs/experiments/fixtures/evaluation-manifest.json --split held-out --methods graph-only uncertainty-only combined --require-executions --report specs/verifications/EVALUATION_LATEST.json` and inspect all three method reports, frozen input/split digests, actual execution IDs, equal budget accounting and nonempty denominators. This command is an implementation deliverable and has not run at Plan time.
3. Run `cd frontend && npm run check && npm run build` for affected frontend code.
4. Exercise the owner API/UI path in a development environment and save request/revision identifiers and observed results in `specs/verifications/e05s01.md`.
5. Confirm failure states and keyboard access in the owner UI; model content remains escaped text.
6. Record actual results; never mark a planned command passing.

A nonempty evidence file is only a presence gate. verify-work must inspect its revision identities, actual command exit/results, scenario observations and limitations before accepting the task; arbitrary text never counts as proof.

## 19. Risks and exclusions

Scope may exceed the roughly 24-hour hackathon window; do not silently reduce coverage or call missing gates complete. Provider/model selection and production infrastructure approval remain deferred. No calibrated correctness claims, automatic merging, universal language support or speculative abstraction. New abstractions require a concrete interface-depth rationale in the build plan.

## 20. Traceability

Scope requirement e05s01; ADRs 0001–0003; QUALITY_BASELINE_LATEST.md; IMPACT_LATEST.md; TEST_PLAN_LATEST.md. Each assertion above must link to an execution/check identity before completion.
