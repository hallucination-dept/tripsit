import { intakeRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';
import { snapshotPolicy } from '#lib/server/snapshot-policy.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.id)) throw new IntakeError(404, 'Issue snapshot is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Policy overrides are unavailable.');
    const intake = await intakeRuntime(request.headers, locals.user!.id, signal);
    const item = await intake.get(locals.user!.id, params.id, signal);
    return snapshotPolicy(item);
  });
}
