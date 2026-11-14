import { intakeRuntime, githubRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async signal => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.id)) throw new IntakeError(404, 'Issue snapshot is unavailable.');
    const owner = locals.user!.id;
    const item = await (await intakeRuntime(request.headers, owner, signal)).get(owner, params.id, signal);
    const github = await githubRuntime(request.headers, owner, signal);
    return { itemId: item.id, baseSha: item.snapshot.baseSha, files: await github.files(item.snapshot, signal) };
  });
}
