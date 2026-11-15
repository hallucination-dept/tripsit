import { githubRepository } from '#lib/server/github.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { githubRuntime } from '#lib/server/intake-runtime.ts';

export async function GET({ request, locals, url }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    const repository = githubRepository(url.searchParams.get('repository') ?? '');
    const number = Number(url.searchParams.get('number'));
    const github = await githubRuntime(request.headers, locals.user!.id, signal);
    return { issue: await github.issue(repository, number, signal) };
  });
}
