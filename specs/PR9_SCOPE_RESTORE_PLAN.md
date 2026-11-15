# Restore approved release scope

Remove the unapproved e01s05 draft-publication story and GitHub interaction
contract, and restore the affected scope, release ordering, sizing, stories and
epic metadata to approved baseline `0701b3d`. Preserve unrelated implemented
work and evidence in e02/e03/e05 and the e04 packet implementation progress.
Leave product vision, ADRs, code and shared state unchanged.

Verification:

- Compare affected scope and release files against `0701b3d` with `git diff`.
- `python3 specs/experiments/plan_selfcheck.py`
- `rg -n 'e01s05|github-review-interaction' specs/product/SCOPE_LATEST.yaml specs/release-plan.yaml specs/epics` (expect no matches).
- `git diff --check`

The planning self-check currently fails because the shared
`specs/execution-status.yaml` still contains e01s05. The orchestrator owns
that file and must reconcile it before rerunning the check.
The same check passes in a disposable copy after removing that status entry:
five epics, twelve stories, 56 tasks and 59 BCP.
