# Elaborate: consolidated architecture and unresolved gates

Status: in progress. This document consolidates design choices; it is not an implementation plan or completed quality gate.

## Intended flow

1. An authenticated owner selects a GitHub issue and repository. Snapshot reported behavior, supplied expectations, and optional confirmed criteria; label model-inferred hypotheses.
2. The coordinator freezes the base revision. Gemma proposes bounded edits, retaining generation observations and output provenance.
3. Apply edits in an isolated workspace to create a candidate commit. Invalid patches, out-of-scope paths, and incomplete/truncated generation produce explicit failure rather than a fabricated candidate.
4. Analyze base and candidate graphs. An independent critic inspects relevant source and proposes claims/checks. Combine impact, uncertainty, disagreement, and missing evidence to prioritize verification.
5. Execute approved checks in a separate restricted worker. Attach results to exact candidate, task, check, and environment identities.
6. Publish an authorized implementation branch and issue-linked PR with the current review packet. Failures and uncertainty remain visible; incomplete verification must not be presented as ready for acceptance.
7. The named engineer inspects mandatory areas and accepts, requests revision, or escalates. A changed candidate/base invalidates automatic application of the previous acceptance. Record outcomes and subsequent escaped defects.

Initial verification may occur before a PR exists. Review revisions therefore permit a pending PR reference; publication attaches the PR without changing evidence identity. This resolves a sequencing inconsistency in the first record draft.

## Responsibility boundaries

| Boundary | Responsibility | Excluded authority |
| --- | --- | --- |
| Web/coordinator | User authorization, task and revision state, validated model interactions, check orchestration | Cannot treat model text as policy or execution evidence |
| Gemma inference | Generate edits and token observations | Cannot publish, approve, or access execution credentials |
| Independent critic | Inspect bounded context, produce claims and proposed checks | Cannot approve, execute arbitrary privileged commands, or alter mandatory checks |
| Analysis/execution workers | Analyze source and run controlled checks within resource limits | No production secrets or repository-write credentials |
| Publication service | Create authorized branch and linked PR; report publication status | No automatic merge or AI approval |
| Named owner | Inspect, accept residual risks, request revision, escalate | Cannot silently turn missing mandatory evidence into a pass |

These are logical boundaries, not a requirement for six independently deployed services. Reuse existing components where the authority and execution isolation remain enforceable.

## Minimum state transitions

Track work progression separately from review findings: intake → generating → candidate_created → analyzing → verifying → review_available → human_decided. Publication has its own pending/succeeded/failed state; a review can exist without successful publication.

Failures and cancellation attach to the stage where they occurred. Resume must verify the frozen inputs and avoid duplicate generations or PR publication. A new candidate starts a new review revision rather than overwriting earlier execution. A review_available state means results are available, not that they passed or are eligible for acceptance.

## Design review findings

- Resolved: pre-publication reviews originally required an existing PR; the reference is now optional until publication.
- Open: shared-resource side effects cannot be promised from a syntax-only graph. Initial support must state exactly which edges are established and where human inspection substitutes.
- Open: selected-token text alone may not reconstruct UTF-8 exactly. Real Gemma response bytes and multi-file edit mapping require validation.
- Open: candidate-controlled test reports and exit codes are not independent oracles. Check provenance and the trusted result interpretation must be demonstrated.
- Open: GitHub API permissions for writing content and PRs may also permit undesirable operations. Credential isolation, repository branch rules, and the actual merge guard need validation; a prompt saying "never merge" is insufficient.
- Open: automatic reopening of scrutiny after an escape needs a precise area/failure-class mapping. Start with explicit recorded inspection requirements rather than an uncalibrated reputation score.
- Open: provider keys, live costs, private-source retention, and concrete sandbox settings have not been established. No live action is authorized by this document.

## What finishes Elaborate

Agree on supported initial graph behavior and bounded uncertainty use; resolve or explicitly defer feasibility limitations with consequences visible in scope. Produce concrete execution/GitHub enforcement proposals and reproducible evidence for critical assumptions. Obtain a fresh design review under the orchestrate quality gate, recording real findings rather than inventing a score. Then seek the required phase-transition confirmation before Plan.

Provider/model selection and existing sandbox availability were requested earlier. Until supplied, continue with local design and synthetic evidence; do not assume credentials or permission to provision paid infrastructure.

References: REVIEW_RECORDS_LATEST.md, CHANGE_GRAPH_LATEST.md, UNCERTAINTY_LATEST.md, REVIEW_WORKFLOW_LATEST.md, PRIOR_ART_LATEST.md, FEASIBILITY_LATEST.md, and specs/adr/0001–0002.
