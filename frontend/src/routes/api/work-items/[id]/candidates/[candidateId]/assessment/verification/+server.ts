import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';

const limit = createGenerationLimit();

export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Assessment is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Verification overrides are unavailable.');
    const body = await readJson(request, 1024, signal);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new IntakeError(400, 'Request verification with an empty JSON object.');
    const owner = locals.user!.id;
    return limit.run(owner, async () => {
      const { service } = await assessmentRuntime(request.headers, owner, signal);
      return { verification: await service.verify(owner, params.id, params.candidateId, signal) };
    });
  }, 1_200_000);
}
