import pg from 'pg';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL must be set before running this migration.');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.searchParams.get('sslmode') === 'require') {
	databaseUrl.searchParams.set('uselibpqcompat', 'true');
}

const database = new pg.Pool({ connectionString: databaseUrl.toString() });

try {
	await database.query(`
		CREATE TABLE IF NOT EXISTS github_project (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			github_installation_id BIGINT NOT NULL,
			github_repository_id BIGINT NOT NULL,
			full_name TEXT NOT NULL,
			repository_owner TEXT NOT NULL,
			repository_name TEXT NOT NULL,
			default_branch TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (user_id, github_repository_id)
		);
		CREATE INDEX IF NOT EXISTS github_project_user_id_idx ON github_project (user_id);
	`);
	console.log('GitHub project tables are ready.');
} finally {
	await database.end();
}
