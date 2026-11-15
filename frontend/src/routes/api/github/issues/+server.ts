import { githubRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { githubRepository } from '#lib/server/github.ts';

export async function GET({ request, locals, url }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const repository = githubRepository(url.searchParams.get('repository') ?? '');
    const github = await githubRuntime(request.headers, locals.user!.id, signal);
    return github.issues(repository, signal);
  }, 105_000);
}
