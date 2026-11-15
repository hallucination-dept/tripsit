import { database } from '#lib/auth.js';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { candidateServices } from '#lib/server/generation-runtime.ts';
import { createStaging } from '#lib/server/staging-service.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';
import { withIntake } from '#lib/server/intake-http.ts';

const limit = createGenerationLimit();

export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if ([params.id, params.candidateId].some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new IntakeError(404, 'Candidate is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Staging overrides are unavailable.');
    const body = await readJson(request, 1024, signal);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new IntakeError(400, 'Request staging with an empty JSON object.');
    const owner = locals.user!.id;
    return limit.run(owner, async () => {
      const services = await candidateServices(request.headers, owner, signal);
      return { stage: await createStaging({ ...services, database }).stage(owner, params.id, params.candidateId, signal) };
    });
  }, 90_000);
}
