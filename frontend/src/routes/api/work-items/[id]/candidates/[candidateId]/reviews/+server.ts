import { assessmentRuntime } from '#lib/server/assessment-runtime.ts';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';

const limit = createGenerationLimit();

export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Candidate review is unavailable.');
    const input = await readJson(request, 4096, signal);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new IntakeError(400, 'Submit an empty review request for the selected candidate.');
    const owner = locals.user!.id;
    return limit.run(owner, async () => ({ review: await (await assessmentRuntime(request.headers, owner, signal)).review(owner, params.id, params.candidateId, signal) }));
  }, 90_000);
}
