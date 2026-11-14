import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Candidate assessment is unavailable.');
    const owner = locals.user!.id;
    return (await assessmentRuntime(request.headers, owner, signal)).load(owner, params.id, params.candidateId, signal);
  }, 90_000);
}
