import { GITHUB_APP_SLUG } from '$app/env/private';
import { error } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.user) throw error(401, 'Sign in before connecting a repository.');
	if (!GITHUB_APP_SLUG) throw error(500, 'GitHub App installation is not configured. Set GITHUB_APP_SLUG.');
	return Response.redirect(`https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new`, 302);
}
