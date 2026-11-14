# Independent Plan review

type: feat
context: domain
Status: PASS; human confirmation required before Build.

## Review scope and rubric

Two independent reviewers assessed the completed Plan draft against the locked scope/ADRs, implementation contracts, dependency order, security/live admission gates, preservation of existing behavior, fixture coverage, runnable task verification, metadata and dependency slopcheck. These are summarized reviewer reports supplied by the parent orchestrator; full reviewer messages remain in the conversation. The 20-item rubric assigns five points per satisfied item; standard orchestration threshold is 94%.

| Reviewer | Round 1 | Must-fix | Should-fix | Result |
| --- | --- | --- | --- | --- |
| A | 19/20, 95% | None | Full comparative evaluation needs an executable end-to-end report command beyond unittest invariants | PASS threshold; improvement applied below |
| B | 20/20, 100% | None | None | PASS |

Both reviewers independently ran `python3 specs/experiments/plan_selfcheck.py`, `python3 specs/experiments/elaborate_selfcheck.py` and `git diff --check`; each command exited 0. They did not certify application, live provider, runner or production behavior.

## Findings and dispositions

1. A's should-fix is applied in e05s01 task 2, story §15/§18 and TEST_PLAN_LATEST.md. The planned `evaluate.py` invocation requires a frozen manifest, held-out split, all three methods, actual executions and a complete JSON report. Its implementation must reject digest mismatch, absent method executions, unequal budgets or empty clean/defective denominators. Unit tests alone cannot complete evaluation. The planning validator now asserts the complete invocation is present. The evaluation command itself is an unrun Build deliverable.
2. Both reviewers suggested considering earlier comparative evaluation. The queue keeps evaluation completion after the end-to-end publication milestone so it evaluates the complete workflow. Fixture preparation, independent labels and frozen manifest may start earlier without changing scope, tuning held-out data or bypassing live gates; this is now explicit in the evaluation story/test plan.
3. B noted `test -s` is a weak semantic evidence check. It remains a necessary presence assertion only. TEST_PLAN_LATEST.md already requires verify-work to inspect revision/configuration, command exits, fixture observations and limitations; the evaluation story repeats that arbitrary text is not proof. No task becomes passing merely because its evidence file exists.

## Post-disposition validation and handoff

After these changes, the implementing agent reran:

- `python3 specs/experiments/plan_selfcheck.py`: exit 0; 5 epics, 12 scope stories, 53 unrun tasks, 59 estimated BCP; complete evaluation invocation now asserted.
- `python3 specs/experiments/elaborate_selfcheck.py`: exit 0 for the original narrow synthetic scenarios.
- `git diff --check`: exit 0.

No application or live checks ran. All implementation tasks remain failing/unrun and all stories todo. Plan quality gate is satisfied by two independent passing reviews with no must-fix; A's improvement is applied. Phases 1–3 are complete, current phase remains 3 until human confirmation authorizes entry to Build. No application readiness, isolation, language coverage, protection or calibration is certified. Roughly 24 hours remains a delivery risk rather than grounds to silently omit scope.
