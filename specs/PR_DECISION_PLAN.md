# Pull request decision plan

Status: implemented 2026-11-15; not yet tried against a real repository.

Goal: when an agent run has finished and opened a pull request, its owner can approve and merge it, or reject and
close it, from the run view. This is the human approval step: nothing merges without that click.

## Behaviour

- **Approve & merge**: as the signed-in user (their linked GitHub token), after checking they can push. Submits an
  approving review on the reviewed head commit (best effort; GitHub refuses approving your own pull request), then
  merges with `sha` set to that commit, so a branch that moved after the review is never merged unseen. Tries squash,
  then merge commit, then rebase, moving on only when the repository disallows a method. GitHub's refusal (conflicts,
  required checks or reviews) is shown to the reviewer. Deletes the `tripsit/…` branch afterwards.
- **Reject & close**: closes the pull request and deletes the branch.
- A pull request merged or closed on GitHub already is recorded as such.
- The run keeps the decision (`result.decision`: action, time, merge commit) and a log line; a run decides once, and
  parallel clicks are refused. The UI asks for confirmation before either action.

## Tasks

1. `github.ts`: `decidePullRequest(repository, pullRequest, action)` with a non-throwing request helper for PUT, PATCH
   and DELETE. Verify: `cd frontend && node --experimental-strip-types --test tests/pr-decision.test.ts`
2. `agent-runs.ts`: `decide(owner, id, action, perform)` records the decision on a finished run.
   Verify: `cd frontend && node --experimental-strip-types --test tests/agent-runs.test.ts`
3. `POST /api/agent-runs/[id]/decision` with `{ "action": "merge" | "close" }`.
   Verify: `cd frontend && npm run check`
4. Run view: approve and reject buttons with a confirm step, the outcome afterwards.
   Verify: `cd frontend && npm run check && npm run build`
