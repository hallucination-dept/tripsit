import {
	GITHUB_APP_CLIENT_ID,
	GITHUB_APP_CLIENT_SECRET,
	GITHUB_APP_ID,
	GITHUB_APP_PRIVATE_KEY,
	GITHUB_APP_SLUG
} from '$app/env/private';
import { SignJWT, importPKCS8 } from 'jose';

const githubApiVersion = '2022-11-28';

export const missingGitHubAppEnvironment = [
	'GITHUB_APP_ID',
	'GITHUB_APP_CLIENT_ID',
	'GITHUB_APP_CLIENT_SECRET',
	'GITHUB_APP_SLUG',
	'GITHUB_APP_PRIVATE_KEY'
].filter(
	(key) =>
		!({
			GITHUB_APP_ID,
			GITHUB_APP_CLIENT_ID,
			GITHUB_APP_CLIENT_SECRET,
			GITHUB_APP_SLUG,
			GITHUB_APP_PRIVATE_KEY
		}[key])
);

export const githubAppSlug = GITHUB_APP_SLUG;

function githubHeaders(token: string) {
	return {
		Accept: 'application/vnd.github+json',
		Authorization: `Bearer ${token}`,
		'X-GitHub-Api-Version': githubApiVersion
	};
}

async function appJwt() {
	if (missingGitHubAppEnvironment.length) {
		throw new Error(`GitHub App is not configured. Set: ${missingGitHubAppEnvironment.join(', ')}`);
	}

	const privateKey = await importPKCS8(GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'RS256');
	return new SignJWT({})
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuedAt(Math.floor(Date.now() / 1000) - 60)
		.setExpirationTime('9m')
		.setIssuer(GITHUB_APP_CLIENT_ID || GITHUB_APP_ID!)
		.sign(privateKey);
}

async function githubResponse(path: string, token: string, init?: RequestInit) {
	const response = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: { ...githubHeaders(token), ...init?.headers }
	});

	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		throw new Error(payload.message ?? `GitHub request failed with status ${response.status}.`);
	}

	return response;
}

export async function getInstallationAccessToken(installationId: number, repositoryId?: number) {
	const jwt = await appJwt();
	const response = await githubResponse(`/app/installations/${installationId}/access_tokens`, jwt, {
		method: 'POST',
		body: repositoryId ? JSON.stringify({ repository_ids: [repositoryId] }) : undefined,
		headers: repositoryId ? { 'Content-Type': 'application/json' } : undefined
	});
	const payload = (await response.json()) as { token: string };
	return payload.token;
}

export async function githubInstallationRequest(
	installationId: number,
	path: string,
	init?: RequestInit,
	repositoryId?: number
) {
	const token = await getInstallationAccessToken(installationId, repositoryId);
	return githubResponse(path, token, init);
}

export async function getGitHubUserAccessToken(code: string) {
	if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
		throw new Error('GitHub App OAuth credentials are not configured.');
	}

	const response = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: GITHUB_APP_CLIENT_ID,
			client_secret: GITHUB_APP_CLIENT_SECRET,
			code
		})
	});
	const payload = (await response.json()) as { access_token?: string; error_description?: string };
	if (!response.ok || !payload.access_token) {
		throw new Error(payload.error_description ?? 'GitHub did not return a user access token.');
	}
	return payload.access_token;
}

export async function installationBelongsToGitHubUser(installationId: number, userAccessToken: string) {
	const response = await githubResponse('/user/installations?per_page=100', userAccessToken);
	const payload = (await response.json()) as { installations: Array<{ id: number }> };
	return payload.installations.some((installation) => installation.id === installationId);
}
