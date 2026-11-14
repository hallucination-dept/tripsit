import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { assessmentView } from '#lib/server/assessment-view.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Assessment is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Assessment overrides are unavailable.');
    const owner = locals.user!.id;
    const { service, reviewerConfigured } = await assessmentRuntime(request.headers, owner, signal);
    return assessmentView(owner, await service.load(owner, params.id, params.candidateId, signal), reviewerConfigured);
  }, 90_000);
}
