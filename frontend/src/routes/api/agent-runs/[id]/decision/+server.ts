import { agentRuns } from '#lib/server/agent-runtime.ts';
import { parseDecisionInput } from '#lib/server/agent-runs.ts';
import { readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { githubRuntime } from '#lib/server/intake-runtime.ts';

// The run owner's approve-and-merge or reject-and-close of its pull request: { "action": "merge" | "close" }.
export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const action = parseDecisionInput(await readJson(request, 1024, signal));
    const github = await githubRuntime(request.headers, locals.user!.id, signal);
    return { run: await agentRuns.decide(locals.user!.id, params.id, ({ repository, pullRequest }) =>
      github.decidePullRequest(repository, pullRequest, action, signal)) };
  }, 90_000);
}
