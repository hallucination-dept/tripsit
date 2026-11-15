import { agentRuns } from '#lib/server/agent-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';

export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async () => ({ run: await agentRuns.cancel(locals.user!.id, params.id) }));
}
