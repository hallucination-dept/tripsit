# Review records — point 1

Status: proposed for discussion. No database schema, public API, or implementation is committed by this document.

## Identity and revision boundary

A work item links one GitHub issue to a named authenticated owner and a task snapshot. An issue may be a bug report, an improvement request, or a structured user story. Owner-confirmed acceptance criteria are optional. Record the GitHub repository ID as well as its current display name; a URL alone is not durable identity.

Preserve the reported problem, supplied expected behavior, reproduction steps, and any explicit acceptance criteria. Distinguish supplied expectations from model-inferred hypotheses and owner-confirmed criteria. A reproduced failure and regression check can support resolving a bug report without requiring a formal user story. Material ambiguity still requires a human decision; the model cannot promote its interpretation into an approved requirement.

A review revision identifies the work item, repository, base commit SHA, candidate commit SHA, task snapshot, and policy version. Its PR reference is optional until publication, then attached without changing the frozen code identity. A PR URL and branch name are references, not revision identities. The merge base and eventual merge target must be checked again before acceptance remains applicable.

A new PR requires fresh verification and human sign-off. Within an existing PR, rerun affected checks and explicitly revalidate any reused evidence against unchanged source dependencies, task expectations, check definitions, environment, and policy. Unknown impact triggers a full rerun of required checks and explicit reporting of remaining gaps; a full rerun does not establish graph completeness. Historical executions retain their original revision. Link them to a new revision only through a recorded reuse assessment. Human acceptance never silently transfers to a new candidate SHA.

## Minimal records

| Record | Required information | Authority |
| --- | --- | --- |
| Work item | ID, GitHub repository ID, issue number/URL, named owner, task snapshot | Issue supplies the reported problem; ownership does not imply every expectation is confirmed |
| Requirement or expectation | ID within snapshot, category: intent/functional/non_functional, criterion, source/version, provenance: supplied/inferred/owner_confirmed/trusted_baseline, applicability and reason; confirmation identity/time when applicable | Preserve provenance; model-inferred expectations remain hypotheses; mandatory baseline controls come from trusted policy |
| Review revision | ID, work item, optional PR identity until publication, base/candidate SHAs, task snapshot, policy version, creation time | Trusted coordinator freezes inputs |
| Generation | ID, revision, model identity, prompt/template digest, settings, output artifact digest, token signal artifact and mapping status | Inference service supplies observations |
| Graph node | ID within revision, kind, source reference or requirement/check reference, extraction method | Analyzer supplies supported relationships |
| Graph edge | Endpoints, relationship, provenance, resolution status: observed/inferred/unresolved | Never treat an inferred edge as established fact |
| Claim | ID, revision, proposition, requirement/node references, author/reviewer identity, supporting and contradicting evidence references | Reviewer proposes; evidence supports or contradicts |
| Verification check | ID, revision, target claims/requirements, exact check definition digest, oracle provenance, tool/environment specification, mandatory status | Trusted policy controls mandatory checks; model can propose additions |
| Execution | ID, check, revision, runner identity, input/configuration digests, tool versions, start/end, limits, termination status, exit code, artifact references | Controlled runner records execution |
| Assessment | Revision, affected behavior, impact and reasons, model signals and provenance, evidence gaps, required inspection | Policy and analysis produce an explainable assessment |
| Human decision | Revision, authenticated owner, accept/revise/escalate, evidence references, completed inspection, unchecked scope and reasons, accepted residual risk, time | Named human only |
| Outcome | ID, affected area and review/decision references, spot-check or escaped defect, severity, evidence, reporter and time | Observations inform future scrutiny |

IDs are opaque identifiers unless explicitly scoped above. Source references include repository-relative path, blob digest, and a half-open UTF-8 byte span; display line numbers are derived. Generated token alignment remains a separate feasibility requirement, not an assumed property.

Graph nodes may reference unchanged affected code. Missing dependencies are recorded as gaps even when no target node can be resolved. No edge probability is assumed to be a calibrated correctness probability.

Artifacts record a digest, byte size, media type, and access-controlled storage reference. A digest detects mismatch against a recorded artifact; it does not establish that the producer or contents are trustworthy. Artifact retention and redaction must protect private source and secrets.

## Results and evidence integrity

Keep execution lifecycle separate from behavioral interpretation. Record completed, timed_out, cancelled, or infrastructure_error, together with exit code when available. Behavioral results are passed, failed, or inconclusive; unavailable checks and stale evidence are explicit assessment gaps.

An exit code of zero and a stdout string saying "passed" are insufficient by themselves. The check definition and test oracle must be identified, expected tests must actually run, and a trusted interpreter of the result must establish what was exercised. Candidate-controlled test changes remain visible and cannot rewrite mandatory policy.

AI-generated checks can carry useful evidence, but oracle provenance must reveal their origin. A test generated from the same mistaken interpretation as the implementation is not independent confirmation of the requirement.

Record conflicting evidence rather than allowing the latest reviewer message to replace it. No single passed test changes a claim into universal correctness. Missing uncertainty signals remain missing, not zero uncertainty.

## Worked linkage

Issue 42 asks that discounts preserve refund consistency. Owner-confirmed requirement AC-02 states the expected rounding behavior. Gemma produces candidate SHA A from base SHA B.

The graph links the changed discount function to an unchanged refund caller. Claim C1 says AC-02 holds. Check T1 exercises a rounding boundary; execution E1 records a counterexample and contradicts C1. A high token probability cannot override E1.

Gemma repairs the implementation as SHA A2. A new review revision records rerun checks; E1 remains historical evidence against A. The owner can accept A2 with recorded residual risks. That decision does not approve a later SHA A3.

## Decisions to discuss before locking point 1

Agreed direction: one named owner per work item, issue intake without mandatory formal acceptance criteria, immutable revision-bound evidence, and fresh verification/sign-off for each new PR. Working default after the user's instruction to continue: revalidate unaffected evidence within a PR and rerun affected checks; unknown impact requires a full rerun. Optional owner-confirmed criteria strengthen the task definition without becoming an intake prerequisite.

Human sign-off records acceptance but does not itself execute a merge. A final merge guard must verify that the accepted revision and required inspection still apply to the actual merge candidate. The enforcement mechanism belongs to the execution/GitHub design step.

## Review checklist for this proposal

- A reviewer assertion cannot create runner evidence or a human decision.
- New code, requirements, base, or policy cannot inherit an old acceptance silently.
- A downstream finding can reference unchanged code and contradict a requirement claim.
- A failed, missing, cancelled, or stale check cannot be displayed as passing.
- Model signals, impact, and behavioral evidence remain separately inspectable.

No executable contract validation exists yet. Planning must turn these cases into runnable checks before implementation is accepted.
