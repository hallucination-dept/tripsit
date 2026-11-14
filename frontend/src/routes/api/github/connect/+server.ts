import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import { githubAppSlug, missingGitHubAppEnvironment } from '#lib/github-app.js';

export async function GET({ cookies, locals }) {
	if (!locals.user) throw error(401, 'Sign in before connecting a repository.');
	if (missingGitHubAppEnvironment.length || !githubAppSlug) {
		throw error(500, `GitHub App is not configured. Set: ${missingGitHubAppEnvironment.join(', ')}`);
	}

	const state = crypto.randomUUID();
	cookies.set('github-project-connect-state', state, {
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		path: '/',
		maxAge: 60 * 10
	});

	return Response.redirect(`https://github.com/apps/${encodeURIComponent(githubAppSlug)}/installations/new`, 302);
}
