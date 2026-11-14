# e04s02: Record accountable human inspection decisions

## 1. Identity

e04s02: Record accountable human inspection decisions

type: feat
context: domain
risk: P0
maturity: 3
bcps: 4 (estimate; not an elapsed-time guarantee).

## 2. User and value

The authenticated named engineer can observe this outcome through the workflow; it is a vertical API/persistence/UI slice, not a layer-only delivery.

## 3. Problem

Allow only the authenticated authorized owner to record accept/revise/escalate against exact base/candidate/policy with completed inspection, unchecked scope, residual risk and timestamp.

## 4. Scope

AI cannot accept; unresolved mandatory failures block accept; high/sensitive/unknown impact requires deeper named inspection; changed revisions invalidate acceptance.

## 5. Requirements

### ADDED
Allow only the authenticated authorized owner to record accept/revise/escalate against exact base/candidate/policy with completed inspection, unchecked scope, residual risk and timestamp.

### MODIFIED — GitHub and TripSit interaction

**Before:** Human decisions were recorded in TripSit without an external GitHub review synchronization contract.

**After:** Reconcile GitHub approvals, change requests, edits and dismissals as revision-bound external observations. Only an authorized named owner completing TripSit inspection can accept; publish a bounded decision reference/status back to GitHub, with pending/stale states and no GitHub approval or merge operation.

Contract: [GitHub and TripSit review interaction](github-review-interaction.md).

## 6. Inputs

Frozen work item, authenticated owner and trusted policy; repository/model content is untrusted data.

## 7. Outputs

Allow only the authenticated authorized owner to record accept/revise/escalate against exact base/candidate/policy with completed inspection, unchecked scope, residual risk and timestamp. Outputs identify owner, revision, provenance and explicit gaps.

## 8. Dependencies

e04s01 and e01s05 (authorized draft publication with exact PR/head identity before PR-bound human inspection).

## 9. Architecture

Affected or proposed paths: frontend/src/lib/server/decisions.ts; frontend/src/routes/api/work-items/[id]/decision/+server.ts; frontend/src/routes/+page.svelte. Use existing route-oriented SvelteKit, #lib imports, strict TypeScript, Svelte runes, pg persistence and Python inference conversion. Ref: ADRs 0001–0003.

## 10. Data and contracts

Use the minimal records in REVIEW_RECORDS_LATEST.md. Store immutable base/head/snapshot/policy identities; access checks on every operation. Atomic optimistic revision checks prevent stale mutations. Raw artifacts expire after seven days; retain only source-free digest/status metadata.

## 11. Security and privacy

AI cannot accept; unresolved mandatory failures block accept; high/sensitive/unknown impact requires deeper named inspection; changed revisions invalidate acceptance. Trust boundaries and exact denial fixtures are required; no security findings may remain unresolved in affected paths. No untrusted execution or private persistence before their actual admission gates pass.

## 12. Failures and recovery

Return bounded non-sensitive errors; restore loading state. Bound external calls, cancellation and retries; reconcile safe retries by stable operation identity. Do not log raw code, credentials or prompts. Missing configuration is unavailable, never pass.

## 13. Performance and limits

Choose explicit finite input/output, context, node, artifact, request and concurrency limits in implementation configuration; test exhaustion. Optional check budget: 3 checks, 60 seconds per check, 180 seconds total per method; mandatory checks separate and identical. These evaluation defaults are engineering controls, not production capacity claims.

## 14. Compatibility

Preserve existing authenticated review route and review/tokens response and fallback; update all callers atomically if extending fields. No new service, graph database, generalized framework or merge operation.

## 15. Implementation steps

1. Define regression fixtures and assert the happy path, edge cases and security denials below before implementation. → verify: `cd frontend && node --experimental-strip-types --test tests/e04s02.test.ts`
2. Implement decision validation, revision concurrency checks and concise/deeper inspection forms without merge or GitHub approval operations. Connect the owner UI/API path and fail-closed errors; retain revision provenance. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e04s02.test.ts`
3. Integrate all affected contracts and run frontend diagnostics/build; include no new security findings in affected paths in focused assertions. Ref: ADRs 0001–0003. → verify: `(cd frontend && node --experimental-strip-types --test tests/e04s02.test.ts) && (cd frontend && npm run check && npm run build)`
4. Save revision-bound UAT evidence with fixture identifiers, actual commands, statuses and limitations; reject an empty evidence record. → verify: `test -s specs/verifications/e04s02.md`

### GitHub interaction implementation additions

5. Persist and reconcile signed revision-bound external GitHub review observations including edits/dismissals and unresolved change requests; no fabricated human acceptance and no new security findings in affected paths. → verify: `cd frontend && node --experimental-strip-types tests/decision-sync.test.ts`
6. Integrate named-owner inspection with exact PR/packet identity and publish bounded decision summary/status; failed writes remain pending, notes stay authenticated and AI never approves/merges. Include no new security findings in affected paths. → verify: `cd frontend && node --experimental-strip-types tests/e04s02.test.ts && node --experimental-strip-types tests/decision-sync.test.ts && npm run check && npm run build`

## 16. Test fixtures

SC-e04s02-P0-01: A bounded low-risk change permits concise sign-off while a sensitive or unknown-impact case requires recorded deeper inspection.

SC-e04s02-P0-02: Missing inspection, failed mandatory evidence, cross-owner requests, stale SHA and model-generated approval cannot create an accepted decision.

Tests are planned, not executed. Unit/mock assertions precede live gates; frontend tests use Node 22 strip-types on dependency-injected pure TS helpers and native node:test, with no $app imports. Integration tests use a disposable local PostgreSQL database and fail when required configuration is absent.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authenticated authorized owner and frozen revision
  When the owner exercises this story
  Then A bounded low-risk change permits concise sign-off while a sensitive or unknown-impact case requires recorded deeper inspection.

Scenario: Edge or denial
  Given adversarial or unavailable inputs
  When the operation is attempted
  Then Missing inspection, failed mandatory evidence, cross-owner requests, stale SHA and model-generated approval cannot create an accepted decision.
```

```gherkin
Scenario: GitHub approval is an observation
  Given a signed approval targets the current PR head
  When TripSit reconciles the real GitHub review actor and state
  Then the review appears in the packet but acceptance still requires named-owner inspection, unchecked scope and residual-risk fields

Scenario: Dismissal and changed revision
  Given a decision and external review exist for a prior packet
  When GitHub dismisses the review, changes base/head or revokes access
  Then reconciliation preserves history and invalidates affected readiness; retries and out-of-order events cannot resurrect acceptance
```

## 18. Verification script

1. Run `cd frontend && node --experimental-strip-types --test tests/e04s02.test.ts` against the fixtures above.
2. Run `cd frontend && npm run check && npm run build` for affected frontend code.
3. Exercise the owner API/UI path in a development environment and save request/revision identifiers and observed results in `specs/verifications/e04s02.md`.
4. Confirm failure states and keyboard access in the owner UI; model content remains escaped text.
5. Record actual results; never mark a planned command passing.

## 19. Risks and exclusions

Scope may exceed the roughly 24-hour hackathon window; do not silently reduce coverage or call missing gates complete. Provider/model selection and production infrastructure approval remain deferred. No calibrated correctness claims, automatic merging, universal language support or speculative abstraction. New abstractions require a concrete interface-depth rationale in the build plan.

## 20. Traceability

Scope requirement e04s02; ADRs 0001–0003; QUALITY_BASELINE_LATEST.md; IMPACT_LATEST.md; TEST_PLAN_LATEST.md. Each assertion above must link to an execution/check identity before completion.
