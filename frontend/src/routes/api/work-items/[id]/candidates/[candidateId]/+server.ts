import { candidateRuntime } from '#lib/server/generation-runtime.ts';
import { candidateView } from '#lib/server/candidate-view.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Candidate snapshot is unavailable.');
    const owner = locals.user!.id;
    const generation = await candidateRuntime(request.headers, owner, signal);
    return candidateView(await generation.get(owner, params.id, params.candidateId, signal));
  });
}
