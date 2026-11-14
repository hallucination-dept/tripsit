# e01s05: Publish a draft PR with linked review evidence

## 1. Identity

e01s05; type: feat; context: domain; risk: P0; bcps: 3 (estimate; not an elapsed-time guarantee).

## 2. User and value

The named owner starts GitHub review before sign-off and can open the exact TripSit packet from each finding.

## 3. Problem

A PR must exist before GitHub comments and PR-bound human inspection. Draft creation must not imply accepted or protected-ready code.

## 4. Scope

One explicitly authorized draft per durable publication operation, exact candidate blobs, originating issue link, one App-owned evidence summary and authenticated packet links. No automatic acceptance, merge or GitHub approval.

## 5. Requirements

### ADDED
Publish a draft after e04s01 packet availability without requiring e04s02 acceptance. Summarize model proposals separately from actual executions, expose failures/gaps and preserve exact revision identity. Human decisions follow draft creation; final readiness is e01s03.

## 6. Inputs

Authenticated owner, current repository/installation access, immutable candidate and packet, expected base/head when applicable and an explicit publication request. Browser/model data cannot grant write authority.

## 7. Outputs

One issue-linked draft PR, recorded repository/installation/PR identity, verified committed head SHA, durable operation/comment IDs and packet references. Lost responses reconcile existing writes.

## 8. Dependencies

e04s01. Execution order: e04s01 → e01s05 → e04s02 → e01s03. Missing mandatory evidence may be displayed in a draft; unavailable authorization, artifact admission or safe publication controls still deny publication.

## 9. Architecture

Reuse the GitHub adapter and existing owner-scoped candidate/packet records. Proposed draft coordinator in frontend/src/lib/server/publication.ts and protected POST /api/work-items/[id]/publish; e01s03 later extends updates/readiness without duplicating initial publication. Contract: [GitHub review interaction](../e04-accountability/github-review-interaction.md), ADR0003.

## 10. Data and contracts

Freeze repository and installation IDs, work item/candidate, base/head, candidate/snapshot/policy and packet digests. Record operation lifecycle and App comment ID; reconcile timeouts rather than blind retry. A new PR requires new PR-bound verification/sign-off; prior acceptance cannot transfer.

## 11. Security and privacy

Use repository-scoped short-lived write authority only in trusted publication. Reauthorize before writes, reject base/head changes and never overwrite human commits or PR text. Summaries disclose bounded approved fields only; private export requires destination-specific authorization and admission. Packet links require current owner access. No new security findings in affected paths.

## 12. Failures and recovery

Return bounded safe errors and restore loading state. Timeouts/lost responses reconcile by operation and published content before further writes. Missing App permissions or unavailable storage fails closed. Summary synchronization failure remains visible and cannot mark readiness green.

## 13. Performance and limits

Use bounded GitHub requests, response sizes, candidate limits, operation deadlines and per-owner concurrency. No untrusted host execution. Reuse existing transport bounds; no new dependency planned.

## 14. Compatibility

Preserve auth, intake, manual candidate generation and review APIs. Publish a draft without a merge/approval endpoint. Expired links show unavailable; GitHub retains already disclosed summaries under its own retention rules.

## 15. Implementation steps

1. Define RED fixtures for draft publication before acceptance, exact candidate blobs, immutable packet links, duplicate/lost-response reconciliation, changed-head denial, safe summary rendering and private disclosure refusal; no new security findings in affected paths. → verify: `cd frontend && node --experimental-strip-types tests/draft-publication.test.ts && node --experimental-strip-types tests/github-packet.test.ts`
2. Split explicit draft creation from readiness; render and reconcile one App-owned evidence summary with immutable dashboard links and safe disclosures. Preserve human PR text, expected head, retry identity and no new security findings in affected paths. → verify: `cd frontend && node --experimental-strip-types tests/github-packet.test.ts && node --experimental-strip-types tests/draft-publication.test.ts`
3. Connect explicit owner draft action to repository-scoped publication and authenticated packet links without acceptance/readiness or merge operations. Include no new security findings in affected paths and full frontend checks. → verify: `cd frontend && node --experimental-strip-types tests/draft-publication.test.ts && node --experimental-strip-types tests/github-packet.test.ts && npm run check && npm run build`
4. Verify real authorized issue-to-one-draft publication, App summary retry reconciliation and authenticated historical packet links; missing configured controls fail, and no new security findings in affected paths. Save actual live evidence without claiming final readiness. → verify: `python3 specs/experiments/live_gates.py e01s05 --require-configured`

## 16. Test fixtures

Cover one valid public issue/candidate, missing evidence, duplicate request, response loss after branch/PR/comment creation, human-edited PR text, changed base/head, revoked access, unauthorized private export, stale worker and unauthorized/expired packet links. Mock tests do not establish configured publication acceptance.

## 17. Acceptance criteria

```gherkin
Scenario: Required outcome
  Given an authorized owner, exact candidate and packet with explicit gaps and no accepted decision
  When the owner requests draft publication
  Then one issue-linked draft contains exact candidate blobs, one evidence summary and revision-bound dashboard links without a ready claim

Scenario: Edge or denial
  Given a lost response, repeated delivery, changed head or revoked repository access
  When draft publication is retried or resumed
  Then existing writes reconcile without duplicates and stale or unauthorized writes are refused without overwriting human changes
```

## 18. Verification script

Run the task commands above, frontend preflight, then configured draft publication and authenticated browser deep-link checks on authorized development resources. Save actual revision/fixture/command/exit/limitations evidence in specs/verifications/e01s05.md; report presence alone does not establish UAT. Implement the e01s05 configured gate before running it; missing controls must fail rather than skip.

## 19. Risks and exclusions

No publication authorization is granted by writing this plan. Production changes, private dispatch, untrusted execution, automatic work start and merges remain separately gated. GitHub copies are not deleted by local artifact purge. Existing PR permissions and required checks must be verified against real configuration before protected-ready claims.

## 20. Traceability

New requirement e01s05; ADR0003; github-review-interaction.md; adjacent e04s01/e04s02/e01s03. All tasks planned/failing; no implementation or live acceptance claimed.
