import { agentRuns } from '#lib/server/agent-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async () => ({ run: await agentRuns.get(locals.user!.id, params.id) }));
}
