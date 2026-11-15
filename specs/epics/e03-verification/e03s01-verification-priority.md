# e03s01: Explain joint impact and uncertainty priorities

## 1. Identity

e03s01: Explain joint impact and uncertainty priorities

type: feat
context: domain
risk: P1
maturity: 3
bcps: 3 (estimate; not an elapsed-time guarantee).

## 2. User and value

The authenticated named engineer can observe this outcome through the workflow; it is a vertical API/persistence/UI slice, not a layer-only delivery.

## 3. Problem

Run mandatory checks regardless of signals; order optional checks by impact tier, missing evidence/reviewer disagreement, then mean negative selected-token logprob and stable check ID.

## 4. Scope

Unknown impact or missing signals cannot reduce scrutiny; only comparable model/settings and exact spans contribute numerical scores; record omitted checks and fixed budgets.

## 5. Requirements

### ADDED
Run mandatory checks regardless of signals; order optional checks by impact tier, missing evidence/reviewer disagreement, then mean negative selected-token logprob and stable check ID.

## 6. Inputs

Frozen work item, authenticated owner and trusted policy; repository/model content is untrusted data.

## 7. Outputs

Run mandatory checks regardless of signals; order optional checks by impact tier, missing evidence/reviewer disagreement, then mean negative selected-token logprob and stable check ID. Outputs identify owner, revision, provenance and explicit gaps.

## 8. Dependencies

e02s01, e02s02

## 9. Architecture

Affected or proposed paths: frontend/src/lib/server/priorities.ts; frontend/src/routes/api/work-items/[id]/checks/+server.ts; frontend/src/routes/+page.svelte. Use existing route-oriented SvelteKit, #lib imports, strict TypeScript, Svelte runes, pg persistence and Python inference conversion. Ref: ADRs 0001–0003.

## 10. Data and contracts

Use the minimal records in REVIEW_RECORDS_LATEST.md. Store immutable base/head/snapshot/policy identities; access checks on every operation. Atomic optimistic revision checks prevent stale mutations. Raw artifacts expire after seven days; retain only source-free digest/status metadata.

## 11. Security and privacy

Unknown impact or missing signals cannot reduce scrutiny; only comparable model/settings and exact spans contribute numerical scores; record omitted checks and fixed budgets. Trust boundaries and exact denial fixtures are required; no security findings may remain unresolved in affected paths. No untrusted execution or private persistence before their actual admission gates pass.

## 12. Failures and recovery

Return bounded non-sensitive errors; restore loading state. Bound external calls, cancellation and retries; reconcile safe retries by stable operation identity. Do not log raw code, credentials or prompts. Missing configuration is unavailable, never pass.

## 13. Performance and limits

Choose explicit finite input/output, context, node, artifact, request and concurrency limits in implementation configuration; test exhaustion. Optional check budget: 3 checks, 60 seconds per check, 180 seconds total per method; mandatory checks separate and identical. These evaluation defaults are engineering controls, not production capacity claims.

## 14. Compatibility

Preserve existing authenticated review route and review/tokens response and fallback; update all callers atomically if extending fields. No new service, graph database, generalized framework or merge operation.

## 15. Implementation steps

1. Define regression fixtures and assert the happy path, edge cases and security denials below before implementation. → verify: `cd frontend && node --experimental-strip-types tests/priorities.test.ts && node --experimental-strip-types tests/packet.test.ts`
2. Implement explicit priority groups, mapping coverage and fixed optional-check count/time caps with deterministic ordering; explain paths and omitted coverage. Connect the owner UI/API path and fail-closed errors; retain revision provenance. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e03s01.test.ts`
3. Integrate all affected contracts and run frontend diagnostics/build; include no new security findings in affected paths in focused assertions. Ref: ADRs 0001–0003. → verify: `cd frontend && node --experimental-strip-types tests/priorities.test.ts && node --experimental-strip-types tests/packet.test.ts && npm run check && npm run build`
4. Save revision-bound UAT evidence with fixture identifiers, actual commands, statuses and limitations; reject an empty evidence record. → verify: `test -s specs/verifications/e03s01.md`

## 16. Test fixtures

SC-e03s01-P0-01: Within the same impact tier, mapped uncertainty changes a selected check with a visible reason and preserved mandatory checks.

SC-e03s01-P0-02: A high-confidence seeded defect remains mandatory/impact-prioritized; harmless rare tokens do not become defect findings; missing signals never become zero uncertainty.

Tests are planned, not executed. Unit/mock assertions precede live gates; frontend tests use Node 22 strip-types on dependency-injected pure TS helpers and native node:test, with no $app imports. Integration tests use a disposable local PostgreSQL database and fail when required configuration is absent.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authenticated authorized owner and frozen revision
  When the owner exercises this story
  Then Within the same impact tier, mapped uncertainty changes a selected check with a visible reason and preserved mandatory checks.

Scenario: Edge or denial
  Given adversarial or unavailable inputs
  When the operation is attempted
  Then A high-confidence seeded defect remains mandatory/impact-prioritized; harmless rare tokens do not become defect findings; missing signals never become zero uncertainty.
```

## 18. Verification script

1. Run `cd frontend && node --experimental-strip-types --test tests/e03s01.test.ts` against the fixtures above.
2. Run `cd frontend && npm run check && npm run build` for affected frontend code.
3. Exercise the owner API/UI path in a development environment and save request/revision identifiers and observed results in `specs/verifications/e03s01.md`.
4. Confirm failure states and keyboard access in the owner UI; model content remains escaped text.
5. Record actual results; never mark a planned command passing.

## 19. Risks and exclusions

Scope may exceed the roughly 24-hour hackathon window; do not silently reduce coverage or call missing gates complete. Provider/model selection and production infrastructure approval remain deferred. No calibrated correctness claims, automatic merging, universal language support or speculative abstraction. New abstractions require a concrete interface-depth rationale in the build plan.

## 20. Traceability

Scope requirement e03s01; ADRs 0001–0003; QUALITY_BASELINE_LATEST.md; IMPACT_LATEST.md; TEST_PLAN_LATEST.md. Each assertion above must link to an execution/check identity before completion.
