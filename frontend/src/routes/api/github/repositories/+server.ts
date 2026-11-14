import { githubRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';

export async function GET({ request, locals }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const github = await githubRuntime(request.headers, locals.user!.id, signal);
    return github.repositories(signal);
  });
}
