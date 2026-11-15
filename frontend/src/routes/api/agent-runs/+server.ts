import { agentConfigured, agentRuns } from '#lib/server/agent-runtime.ts';
import { parseRunInput } from '#lib/server/agent-runs.ts';
import { githubRepository } from '#lib/server/github.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { githubRuntime } from '#lib/server/intake-runtime.ts';

export async function GET({ request, locals }) {
  return withIntake(request, locals.user?.id, async () => ({ runs: await agentRuns.list(locals.user!.id) }));
}

export async function POST({ request, locals }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const input = parseRunInput(await readJson(request, 64 * 1024, signal));
    const repository = githubRepository(input.repository);
    if (!agentConfigured()) throw new IntakeError(503, 'The agent model is not configured.');
    await agentRuns.ready();
    const github = await githubRuntime(request.headers, locals.user!.id, signal);
    const archive = await github.archive(repository, signal);
    return { run: await agentRuns.start(locals.user!.id, archive, input.instruction) };
  });
}
