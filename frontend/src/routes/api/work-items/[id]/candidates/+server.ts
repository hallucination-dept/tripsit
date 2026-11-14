import { candidateRuntime } from '#lib/server/generation-runtime.ts';
import { candidateView } from '#lib/server/candidate-view.ts';
import { createGenerationLimit } from '#lib/server/generation-limit.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError, readJson } from '#lib/server/intake.ts';

const limit = createGenerationLimit();

export async function POST({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.id)) throw new IntakeError(404, 'Issue snapshot is unavailable.');
    const value = await readJson(request, 4096, signal);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError(400, 'Select one to eight file paths.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 8
      || input.paths.some(path => typeof path !== 'string')) throw new IntakeError(400, 'Select one to eight file paths.');
    const paths = input.paths as string[];
    const owner = locals.user!.id;
    return limit.run(owner, async () => candidateView(await (await candidateRuntime(request.headers, owner, signal)).create(owner, params.id, paths, signal)));
  }, 90_000);
}
