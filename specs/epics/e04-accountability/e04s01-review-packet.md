# e04s01: Show revision-bound evidence and gaps

## 1. Identity

e04s01: Show revision-bound evidence and gaps

type: feat
context: domain
risk: P1
maturity: 3
bcps: 3 (estimate; not an elapsed-time guarantee).

## 2. User and value

The authenticated named engineer can observe this outcome through the workflow; it is a vertical API/persistence/UI slice, not a layer-only delivery.

## 3. Problem

Present requirements, impact, token signal coverage, reviewer claims, evidence conflicts, failures, missing checks and required inspection as distinct fields for the frozen revision.

## 4. Scope

Never expose another owner artifacts; render untrusted text safely; passing checks prove only exercised properties; failed/unavailable/stale results cannot become green confidence.

## 5. Requirements

### ADDED
Present requirements, impact, token signal coverage, reviewer claims, evidence conflicts, failures, missing checks and required inspection as distinct fields for the frozen revision.

## 6. Inputs

Frozen work item, authenticated owner and trusted policy; repository/model content is untrusted data.

## 7. Outputs

Present requirements, impact, token signal coverage, reviewer claims, evidence conflicts, failures, missing checks and required inspection as distinct fields for the frozen revision. Outputs identify owner, revision, provenance and explicit gaps.

## 8. Dependencies

e03s02

## 9. Architecture

Affected or proposed paths: frontend/src/lib/server/packet.ts; frontend/src/routes/api/work-items/[id]/packet/+server.ts; frontend/src/routes/+page.svelte. Use existing route-oriented SvelteKit, #lib imports, strict TypeScript, Svelte runes, pg persistence and Python inference conversion. Ref: ADRs 0001–0003.

## 10. Data and contracts

Use the minimal records in REVIEW_RECORDS_LATEST.md. Store immutable base/head/snapshot/policy identities; access checks on every operation. Atomic optimistic revision checks prevent stale mutations. Raw artifacts expire after seven days; retain only source-free digest/status metadata.

## 11. Security and privacy

Never expose another owner artifacts; render untrusted text safely; passing checks prove only exercised properties; failed/unavailable/stale results cannot become green confidence. Trust boundaries and exact denial fixtures are required; no security findings may remain unresolved in affected paths. No untrusted execution or private persistence before their actual admission gates pass.

## 12. Failures and recovery

Return bounded non-sensitive errors; restore loading state. Bound external calls, cancellation and retries; reconcile safe retries by stable operation identity. Do not log raw code, credentials or prompts. Missing configuration is unavailable, never pass.

## 13. Performance and limits

Choose explicit finite input/output, context, node, artifact, request and concurrency limits in implementation configuration; test exhaustion. Optional check budget: 3 checks, 60 seconds per check, 180 seconds total per method; mandatory checks separate and identical. These evaluation defaults are engineering controls, not production capacity claims.

## 14. Compatibility

Preserve existing authenticated review route and review/tokens response and fallback; update all callers atomically if extending fields. No new service, graph database, generalized framework or merge operation.

## 15. Implementation steps

1. Define regression fixtures and assert the happy path, edge cases and security denials below before implementation. → verify: `cd frontend && node --experimental-strip-types --test tests/e04s01.test.ts`
2. Implement packet read model and accessible UI with explicit evidence reuse assessment within a PR; never reuse across new PRs. Connect the owner UI/API path and fail-closed errors; retain revision provenance. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e04s01.test.ts`
3. Integrate all affected contracts and run frontend diagnostics/build; include no new security findings in affected paths in focused assertions. Ref: ADRs 0001–0003. → verify: `(cd frontend && node --experimental-strip-types --test tests/e04s01.test.ts) && (cd frontend && npm run check && npm run build)`
4. Save revision-bound UAT evidence with fixture identifiers, actual commands, statuses and limitations; reject an empty evidence record. → verify: `test -s specs/verifications/e04s01.md`

## 16. Test fixtures

SC-e04s01-P0-01: The owner can follow a downstream failure from requirement to graph path, check, execution and unchanged code without fabricated token confidence.

SC-e04s01-P0-02: Changing base/candidate, expectations, policy, dependencies or check/environment invalidates affected evidence; unknown impact forces full mandatory rerun and remains a gap.

Tests are planned, not executed. Unit/mock assertions precede live gates; frontend tests use Node 22 strip-types on dependency-injected pure TS helpers and native node:test, with no $app imports. Integration tests use a disposable local PostgreSQL database and fail when required configuration is absent.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authenticated authorized owner and frozen revision
  When the owner exercises this story
  Then The owner can follow a downstream failure from requirement to graph path, check, execution and unchanged code without fabricated token confidence.

Scenario: Edge or denial
  Given adversarial or unavailable inputs
  When the operation is attempted
  Then Changing base/candidate, expectations, policy, dependencies or check/environment invalidates affected evidence; unknown impact forces full mandatory rerun and remains a gap.
```

## 18. Verification script

1. Run `cd frontend && node --experimental-strip-types --test tests/e04s01.test.ts` against the fixtures above.
2. Run `cd frontend && npm run check && npm run build` for affected frontend code.
3. Exercise the owner API/UI path in a development environment and save request/revision identifiers and observed results in `specs/verifications/e04s01.md`.
4. Confirm failure states and keyboard access in the owner UI; model content remains escaped text.
5. Record actual results; never mark a planned command passing.

## 19. Risks and exclusions

Scope may exceed the roughly 24-hour hackathon window; do not silently reduce coverage or call missing gates complete. Provider/model selection and production infrastructure approval remain deferred. No calibrated correctness claims, automatic merging, universal language support or speculative abstraction. New abstractions require a concrete interface-depth rationale in the build plan.

## 20. Traceability

Scope requirement e04s01; ADRs 0001–0003; QUALITY_BASELINE_LATEST.md; IMPACT_LATEST.md; TEST_PLAN_LATEST.md. Each assertion above must link to an execution/check identity before completion.
