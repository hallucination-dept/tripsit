import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { Pool } from 'pg';

function connectionStringForNodePostgres(connectionString: string | undefined) {
	if (!connectionString) return undefined;

	const databaseUrl = new URL(connectionString);
	// Aiven supplies sslmode=require. pg currently interprets it as strict
	// certificate verification unless this compatibility flag is present.
	if (
		(databaseUrl.protocol === 'postgres:' || databaseUrl.protocol === 'postgresql:') &&
		databaseUrl.searchParams.get('sslmode') === 'require' &&
		!databaseUrl.searchParams.has('uselibpqcompat')
	) {
		databaseUrl.searchParams.set('uselibpqcompat', 'true');
	}

	return databaseUrl.toString();
}

export const database = new Pool({ connectionString: connectionStringForNodePostgres(DATABASE_URL), connectionTimeoutMillis: 5_000, query_timeout: 5_000, statement_timeout: 5_000 });
// Without a listener, an idle client dropped by the network emits an unhandled 'error' and crashes the server.
database.on('error', (error) => console.error(`PostgreSQL idle client error: ${error.message}`));

export const missingAuthEnvironment = [
	'DATABASE_URL',
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_URL',
	'GITHUB_APP_CLIENT_ID',
	'GITHUB_APP_CLIENT_SECRET'
].filter((key) => !({ DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET }[key]));

export const auth = betterAuth({
	baseURL: BETTER_AUTH_URL,
	secret: BETTER_AUTH_SECRET || 'replace-this-before-running-in-production',
	database,
	emailAndPassword: {
		enabled: true
	},
	socialProviders:
		GITHUB_APP_CLIENT_ID && GITHUB_APP_CLIENT_SECRET
			? { github: { clientId: GITHUB_APP_CLIENT_ID, clientSecret: GITHUB_APP_CLIENT_SECRET, disableDefaultScope: true } }
			: {},
	plugins: [sveltekitCookies(getRequestEvent)]
});
