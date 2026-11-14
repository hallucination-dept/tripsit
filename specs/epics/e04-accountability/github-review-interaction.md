# GitHub and TripSit review interaction contract

type: feat
context: domain
Status: planned; this document does not enable publication, commands or decisions.
Requirement delta: ADDED to e04s01, e04s02, e01s03 and new e01s05; ADR 0003 remains authoritative for admission and merge protection.

## User flow and ownership

1. Build an owner-accessible, revision-bound packet in TripSit.
2. On an explicit owner action, publish a draft implementation PR linked to its issue. Include an evidence summary and links into TripSit even when evidence is missing; label those gaps and the draft state honestly.
3. Review in GitHub or open TripSit for interactive requirement → claim → graph path → check → execution → source inspection, including unchanged downstream code.
4. Authorized commands request an explanation or a new candidate. Revisions get fresh packets, affected verification and human inspection; they never inherit acceptance silently.
5. Record accept/revise/escalate in TripSit and reconcile the GitHub status against current evidence and exact base/head. A human performs the GitHub merge.

Draft creation requires the packet contract (e04s01), not a prior accepted decision. e04s02 is required for acceptance/readiness reconciliation. The serialized story queue is e04s01 → e01s05 draft publication → e04s02 human inspection → e01s03 updates/readiness. This explicit split avoids requiring a human to sign off an unpublished PR. An inspection recorded before PR creation does not authorize the new PR: attach its identity, revalidate verification and obtain fresh PR-bound sign-off.

## Revision and storage contract

Bind packet links, comments, commands, review events and decisions to the authenticated owner, numeric repository and installation identity, work item/candidate IDs, GitHub PR identity when available, base/head SHAs, candidate/snapshot digests, policy version and packet digest. Before publication head SHA is absent; it must be attached only after verifying committed blobs match the candidate. A PR URL, branch name or query parameter is never authority.

Retain immutable historical packets and decisions subject to the existing seven-day raw-artifact expiry. A changed base/head, requirements, policy or evidence creates a new packet and invalidates affected readiness. Keep original event/review identities and supersession links. Old links must show the requested historical revision with a stale banner, or a safe expired/unavailable result; never silently select the latest candidate.

## GitHub evidence surface

Use one App-owned top-level PR summary comment and a short PR-body link. The summary identifies base/head, packet digest, requirements covered, reviewer counterexamples/conflicts, actual check outcomes, missing/stale evidence, human decision state and protection-unverified state. Label reviewer claims and proposed checks separately from runner evidence. Do not publish raw prompts, logs, private source or owner risk notes by default; render bounded escaped text and suppress incidental mentions.

Each displayed finding/check has a stable packet-scoped reference and a deep link. Update only the App-owned summary on explicit publication/status reconciliation; preserve human-edited PR text. Use a durable publication operation and stored comment ID to reconcile lost responses, retries and redelivery without duplicate PRs or summaries. Recheck current access and installation authority before every write. Compare the stored published packet/version before applying summary updates so a stale worker cannot overwrite a newer summary. Posted summaries remain on GitHub under its retention rules after local artifact expiry; label expired details and never promise that local purge deletes GitHub copies. Private publication requires explicit disclosure authorization identifying this destination and exported fields before any write.

Proposed authenticated UI route: `/work-items/{itemId}/candidates/{candidateId}/packets/{packetDigest}?focus={kind}&reference={id}`. Allowed focus kinds: requirement, claim, node, check, execution. Validate references against that exact packet; unknown references produce a clear unavailable selection rather than another object's details. Build links from the configured canonical TripSit origin. Links contain no tokens, grant no access and return users to the same authorized packet after login.

## Interactive dashboard

Provide keyboard-operable graph/list views with selectable nodes and edges, linked requirement/claim/check/execution details and exact blob/source spans. Selecting a counterexample or failed check highlights its known graph path and unchanged affected source. Unsupported or inferred edges, partial context, missing token mappings, unavailable executions and conflicts remain visible. A list/trace alternative must offer equivalent navigation; a decorative graph alone does not satisfy this contract. A source edit or packet refresh cannot move an open historical link to a new revision without an explicit user action.

## GitHub conversation commands

MVP command surface is a top-level PR conversation comment, not arbitrary natural-language instructions or inline-thread automation:

- `/tripsit explain <packetDigest> <findingId>` requests a bounded explanation of an existing finding and evidence, with a dashboard link. It cannot claim new execution or acceptance.
- `/tripsit revise <packetDigest> <findingId>` requests one new bounded candidate addressing that finding. Treat comment and repository text as untrusted input; preserve mandatory policy. Link the resulting candidate/packet in the reply. Updating the published branch requires a separate explicit owner publication action.

Only process newly created commands from the linked named owner, after resolving the actor's numeric GitHub identity from the existing authenticated account binding and rechecking repository/installation access. Repository membership, author_association, display names and webhook signature alone do not authorize costs or changes. Ignore App/bot/self events and ordinary comments; edited/deleted commands do not launch another run. Deny stale packet/base/head, unknown findings, removed access, missing provider consent/admission and exhausted budgets without model dispatch.

Verify the raw-body webhook HMAC before parsing; bound request size, allowed event/action, comment length, deadlines, output and concurrent/cumulative per-owner costs. Persist command identity `(repositoryId, commentId, action)` and delivery ID before scheduling. Track admitted/running/completed/failed/unknown outcomes. Retried delivery or a lost response must reconcile the same action and App-owned reply, never launch duplicate inference. Ambiguous dispatch completion requires manual reconciliation rather than automatic expensive retry. Use the existing bounded model/runner interfaces; no host execution or new coordinating service.

## GitHub review and human decision synchronization

Ingest signed PR review submission, edit and dismissal events as external observations. Store review ID, actor identity, commit ID, state and delivery identity, and reconcile against current GitHub state to handle duplicates/out-of-order events. Show pending synchronization and failure states rather than assuming delivery succeeded.

A GitHub approval does not supply TripSit's inspection checklist, unchecked scope or residual risk and cannot create an accepted TripSit decision. Offer the authorized owner a link to finish that decision in TripSit. Requests for changes appear as unresolved feedback; they invalidate readiness until a named owner records how they were addressed or escalated against the current packet. Dismissed/superseded reviews retain history and cease contributing to current status. GitHub review authority and the app's single-owner decision model remain distinct.

Record TripSit decisions with evidence references and inspection detail. Publish only a bounded decision summary/reference back to the App-owned PR summary and trusted status check; keep risk-note text in the authenticated dashboard unless explicitly approved for disclosure. A failed GitHub update leaves synchronization pending. AI replies, GitHub approvals, comments and webhook payload fields cannot impersonate a human decision or perform a merge/approval API operation.

## Implementation ownership and verification

- e04s01 owns immutable packet reads, deep-link resolution and interactive graph/trace UI. Tests: `tests/packet-links.test.ts`, `tests/packet-navigation.test.ts`; real browser test: `tests/packet-navigation-flow.test.mjs`.
- e04s02 owns external review observations, decision identity/inspection validation and bidirectional status reconciliation. Tests: `tests/decision-sync.test.ts`, `tests/e04s02.test.ts`.
- e01s05 owns authorized draft creation and the initial idempotent summary/link surface. Tests: `tests/draft-publication.test.ts`, `tests/github-packet.test.ts`.
- e01s03 owns later explicit publication updates, final readiness, authenticated webhook command admission and response/revision orchestration. Tests: `tests/github-packet.test.ts`, `tests/github-commands.test.ts`, `tests/e01s03.test.ts`.

Every new task starts failing. These test paths are implementation deliverables, not existing passing evidence. Integration also requires frontend check/build, current authorization/expiry regressions, signed live webhook delivery, authenticated deep-link/browser UAT and the existing configured publication gate. Mock events alone cannot establish actual GitHub enforcement or provider/runner admission.

Reuse the existing packet, GitHub adapter, Better Auth account binding, candidate generation, bounded limits and record expiry patterns. No new dependency is planned ([OK] existing native crypto/fetch and installed stack). Reason for depth: one shared interaction contract prevents GitHub messages, deep links and dashboard decisions from assigning different identities or authority to the same revision; no new generic integration framework is required.

## API facts checked for this plan

GitHub treats top-level PR conversation comments as issue comments; create through `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` with a `body`, and update the stored App-owned comment through the matching issue-comment endpoint. These differ from inline pull-request review comments. [GitHub issue-comment API](https://docs.github.com/en/rest/issues/comments).

Subscribe only to required events: `issue_comment` created for commands, `pull_request_review` submitted/edited/dismissed for observations, and relevant `pull_request` revision/lifecycle actions for invalidation. Match the server-recorded PR rather than treating an arbitrary issue comment as a PR command. [GitHub event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Validate `X-Hub-Signature-256` against HMAC-SHA256 over the raw body using constant-time comparison before trusting event data. [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
