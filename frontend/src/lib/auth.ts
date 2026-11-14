import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { Pool } from 'pg';

const database = new Pool({ connectionString: DATABASE_URL });

export const missingAuthEnvironment = [
	'DATABASE_URL',
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_URL',
	'GITHUB_CLIENT_ID',
	'GITHUB_CLIENT_SECRET'
].filter((key) => !({ DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET }[key]));

export const auth = betterAuth({
	baseURL: BETTER_AUTH_URL,
	secret: BETTER_AUTH_SECRET || 'replace-this-before-running-in-production',
	database,
	emailAndPassword: {
		enabled: true
	},
	socialProviders:
		GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
			? { github: { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET } }
			: {},
	plugins: [sveltekitCookies(getRequestEvent)]
});
