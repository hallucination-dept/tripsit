import { dev } from '$app/env';
import { BETTER_AUTH_URL, GITHUB_APP_CLIENT_ID } from '$app/env/private';
import { error, redirect } from '@sveltejs/kit';
import {
	getGitHubUserAccessToken,
	githubInstallationRequest,
	installationBelongsToGitHubUser,
	missingGitHubAppEnvironment
} from '#lib/github-app.js';
import { upsertProjects } from '#lib/projects.js';

type InstallationRepositories = {
	repositories: Array<{
		id: number;
		full_name: string;
		owner: { login: string };
		name: string;
		default_branch: string;
	}>;
};

export async function GET({ url, cookies, locals }) {
	if (!locals.user) throw error(401, 'Sign in before connecting a repository.');
	if (missingGitHubAppEnvironment.length) {
		throw error(500, `GitHub App is not configured. Set: ${missingGitHubAppEnvironment.join(', ')}`);
	}

	const expectedState = cookies.get('github-project-connect-state');
	const code = url.searchParams.get('code');
	const installationId = Number(url.searchParams.get('installation_id') ?? cookies.get('github-project-installation-id'));

	// GitHub first redirects here after installation. Store the installation ID
	// only long enough to run the standard OAuth flow and verify the GitHub user
	// can access it before linking any repositories to a tripsit.dev account.
	if (!code) {
		if (!expectedState || !Number.isSafeInteger(installationId) || !GITHUB_APP_CLIENT_ID || !BETTER_AUTH_URL) {
			throw error(400, 'The GitHub installation callback was invalid or expired. Start again from Add project.');
		}
		cookies.set('github-project-installation-id', String(installationId), {
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			path: '/',
			maxAge: 60 * 10
		});
		const callbackUrl = `${BETTER_AUTH_URL.replace(/\/$/, '')}/api/github/app/callback`;
		const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
		authorizeUrl.searchParams.set('client_id', GITHUB_APP_CLIENT_ID);
		authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
		authorizeUrl.searchParams.set('state', expectedState);
		return Response.redirect(authorizeUrl.toString(), 302);
	}

	const state = url.searchParams.get('state');

	if (!state || !expectedState || state !== expectedState || !code || !Number.isSafeInteger(installationId)) {
		throw error(400, 'The GitHub installation callback was invalid or expired. Start again from Add project.');
	}

	const userAccessToken = await getGitHubUserAccessToken(code);
	if (!(await installationBelongsToGitHubUser(installationId, userAccessToken))) {
		throw error(403, 'This GitHub installation does not belong to the GitHub user who authorized it.');
	}

	const response = await githubInstallationRequest(installationId, '/installation/repositories?per_page=100');
	const payload = (await response.json()) as InstallationRepositories;
	await upsertProjects(locals.user.id, installationId, payload.repositories);

	cookies.delete('github-project-connect-state', { path: '/', secure: !dev });
	cookies.delete('github-project-installation-id', { path: '/', secure: !dev });
	throw redirect(303, `/?github_project_connected=${payload.repositories.length}`);
}
