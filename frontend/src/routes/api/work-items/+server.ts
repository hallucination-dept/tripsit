import { intakeRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { readJson } from '#lib/server/intake.ts';

export async function POST({ request, locals }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const input = await readJson(request, 4096, signal);
    const intake = await intakeRuntime(request.headers, locals.user!.id, signal);
    return { item: await intake.create(locals.user!.id, input, signal) };
  });
}

export async function GET({ request, locals }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const intake = await intakeRuntime(request.headers, locals.user!.id, signal);
    return { items: await intake.list(locals.user!.id, signal) };
  });
}
