# e01s01: Snapshot an owner-selected GitHub issue

## 1. Identity

e01s01: Snapshot an owner-selected GitHub issue

type: feat
context: domain
risk: P0
maturity: 3
bcps: 5 (estimate; not an elapsed-time guarantee).

## 2. User and value

The authenticated named engineer can observe this outcome through the workflow; it is a vertical API/persistence/UI slice, not a layer-only delivery.

## 3. Problem

Select accessible repositories and issues through installation access; snapshot repository ID, base SHA, issue problem, supplied expectations and inferred hypotheses without requiring formal acceptance criteria.

## 4. Scope

Reject missing sessions, cross-owner access, removed installation permissions, oversized/malformed input and ambiguous owner binding; expire private artifacts after seven days and delete references.

## 5. Requirements

### ADDED
Select accessible repositories and issues through installation access; snapshot repository ID, base SHA, issue problem, supplied expectations and inferred hypotheses without requiring formal acceptance criteria.

## 6. Inputs

Frozen work item, authenticated owner and trusted policy; repository/model content is untrusted data.

## 7. Outputs

Select accessible repositories and issues through installation access; snapshot repository ID, base SHA, issue problem, supplied expectations and inferred hypotheses without requiring formal acceptance criteria. Outputs identify owner, revision, provenance and explicit gaps.

## 8. Dependencies

Existing Better Auth session and configured development services. No production mutation is authorized by this plan.

## 9. Architecture

Detailed implementation contract: [e01s01-implementation.md](e01s01-implementation.md). Reuse existing GitHub OAuth sign-in; no second login flow.

Affected or proposed paths: frontend/src/lib/server/github.ts; frontend/src/lib/server/records.ts; frontend/src/routes/api/work-items/+server.ts; frontend/src/routes/+page.svelte. Use existing route-oriented SvelteKit, #lib imports, strict TypeScript, Svelte runes, pg persistence and Python inference conversion. Ref: ADRs 0001–0003.

## 10. Data and contracts

Use the minimal records in REVIEW_RECORDS_LATEST.md. Store immutable base/head/snapshot/policy identities; access checks on every operation. Atomic optimistic revision checks prevent stale mutations. Raw artifacts expire after seven days; retain only source-free digest/status metadata.

## 11. Security and privacy

Reject missing sessions, cross-owner access, removed installation permissions, oversized/malformed input and ambiguous owner binding; expire private artifacts after seven days and delete references. Trust boundaries and exact denial fixtures are required; no security findings may remain unresolved in affected paths. No untrusted execution or private persistence before their actual admission gates pass.

## 12. Failures and recovery

Return bounded non-sensitive errors; restore loading state. Bound external calls, cancellation and retries; reconcile safe retries by stable operation identity. Do not log raw code, credentials or prompts. Missing configuration is unavailable, never pass.

## 13. Performance and limits

Choose explicit finite input/output, context, node, artifact, request and concurrency limits in implementation configuration; test exhaustion. Optional check budget: 3 checks, 60 seconds per check, 180 seconds total per method; mandatory checks separate and identical. These evaluation defaults are engineering controls, not production capacity claims.

## 14. Compatibility

Preserve existing authenticated review route and review/tokens response and fallback; update all callers atomically if extending fields. No new service, graph database, generalized framework or merge operation.

## 15. Implementation steps

1. Define RED intake fixtures for account selection, two-owner denials, revoked permissions, malformed/oversized JSON, hostile issue text, null body, PR-as-issue rejection, upstream timeout/cancellation and immutable provenance. Use injected pure TypeScript boundaries without Svelte runtime imports. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts`
2. Reuse existing Better Auth GitHub OAuth login: listUserAccounts with session headers, choose exactly one owned github record, getAccessToken with its LOCAL id, and compare GET /user id to its external accountId. Verify user repository access separately from the configured App installation. Resolve installation on server, mint a repository-scoped read-only token; fixed GitHub origin, bounded response reads, timeout, cancellation, no automatic retries or token persistence. Ref: ADR 0003 and e01s01-implementation.md. → verify: `cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts`
3. Export the existing pg pool from auth.ts without changing auth behavior. Add app-owned versioned SQL migration and records module: immutable owner-scoped snapshot, source-free digest/status metadata, separate seven-day expiring raw payload and references, parameterized queries and transactional purge. Add disposable PostgreSQL test and purge command; missing test configuration fails. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e01s01-db.test.ts`
4. Implement authenticated POST/GET /api/work-items and GET /api/work-items/[id] through thin routes and testable intake helpers. Check ownership before external calls, revalidate user plus installation repository access before every retained-source read/create, reject expired source, freeze repository ID/base SHA/issue snapshot. Do not trust browser installation IDs, owner IDs, upstream URLs or model instructions. Ref: ADR 0003. → verify: `cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts`
5. Extend the signed-in page with repository full-name and issue-number selection, create/reload/detail controls and escaped immutable snapshot display. Show supplied issue text separately from empty inferred and owner-confirmed expectations, missing criteria, expiry and unavailable states; labels, alert/live regions and finally cleanup. Preserve current OAuth and code review UI. Document server-only App configuration, development migration and verified retention purge invocation. Ref: ADR 0003. → verify: `(cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts) && (cd frontend && npm run check && npm run build)`
6. Integrate focused tests, real disposable PostgreSQL two-owner/concurrency/expiry/reference-deletion checks, frontend diagnostics/build and security inspection: no new security findings in affected paths. No production database or auth schema mutation. Ref: ADR 0003. → verify: `(cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts) && (cd frontend && node --experimental-strip-types --test tests/e01s01-db.test.ts) && (cd frontend && npm run check && npm run build)`
7. Implement fail-closed configured live gate: actual linked user access and repository-scoped installation read; revoked access/second-owner denial; real disposable PostgreSQL deletion and verified purge invocation. Bind gate evidence to code/config/migration revisions; missing credentials or unverified controls fail. No private persistence before admission; no production mutations. Ref: ADR 0003. → verify: `python3 specs/experiments/live_gates.py e01s01 --require-configured`
8. Exercise authenticated browser create/reload/detail flow against an authorized development issue; inspect database, live-gate and hostile-input evidence. Save actual revision/fixture/commands/exits/results/limitations in e01s01.md; file presence alone cannot pass UAT. Ref: ADR 0003. → verify: `cd frontend && node scripts/intake-browser.mjs`

## 16. Test fixtures

Additional explicit cases: installed Better Auth local versus external account IDs; no/ambiguous linked GitHub account; user/App repository access intersection; PR masquerading as issue; null body; changed repository ID; oversized input and upstream response; safe error redaction; actual database concurrency and physical purge/reference deletion.

SC-e01s01-P0-01: A signed-in owner selects a private or public accessible issue and sees immutable supplied versus inferred expectations at a frozen base SHA.

SC-e01s01-P0-02: A second owner or revoked installation cannot read artifacts; a clock advance deletes raw source and references while digest/status metadata remains.

Tests are planned, not executed. Unit/mock assertions precede live gates; frontend tests use Node 22 strip-types on dependency-injected pure TS helpers and native node:test, with no $app imports. Integration tests use a disposable local PostgreSQL database and fail when required configuration is absent.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authenticated authorized owner and frozen revision
  When the owner exercises this story
  Then A signed-in owner selects a private or public accessible issue and sees immutable supplied versus inferred expectations at a frozen base SHA.

Scenario: Edge or denial
  Given adversarial or unavailable inputs
  When the operation is attempted
  Then A second owner or revoked installation cannot read artifacts; a clock advance deletes raw source and references while digest/status metadata remains.
```

## 18. Verification script

1. Run `cd frontend && node --experimental-strip-types --test tests/e01s01.test.ts` against the fixtures above.
2. Run `cd frontend && npm run check && npm run build` for affected frontend code.
3. Exercise the owner API/UI path in a development environment and save request/revision identifiers and observed results in `specs/verifications/e01s01.md`.
4. Run `python3 specs/experiments/live_gates.py e01s01 --require-configured` only with configured authorized development resources; absent configuration or failed isolation blocks dependent live operations.
5. Record actual results; never mark a planned command passing.

## 19. Risks and exclusions

Scope may exceed the roughly 24-hour hackathon window; do not silently reduce coverage or call missing gates complete. Provider/model selection and production infrastructure approval remain deferred. No calibrated correctness claims, automatic merging, universal language support or speculative abstraction. New abstractions require a concrete interface-depth rationale in the build plan.

## 20. Traceability

Scope requirement e01s01; ADRs 0001–0003; QUALITY_BASELINE_LATEST.md; IMPACT_LATEST.md; TEST_PLAN_LATEST.md. Each assertion above must link to an execution/check identity before completion.
