// Applies every app-owned SQL file in migrations/ to DATABASE_URL (frontend/.env), in file-name order and in one
// transaction, so either all of them apply or none do. Each file only adds what is missing, so re-running is safe.
// Better Auth's own tables are migrated separately by `npm run auth:migrate`.
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set before running this migration.');

const databaseUrl = new URL(process.env.DATABASE_URL);
// Aiven supplies sslmode=require, which pg treats as strict certificate verification without this flag (as in auth.ts).
if (databaseUrl.searchParams.get('sslmode') === 'require' && !databaseUrl.searchParams.has('uselibpqcompat')) {
  databaseUrl.searchParams.set('uselibpqcompat', 'true');
}

const directory = new URL('../migrations/', import.meta.url);
const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: databaseUrl.toString(), connectionTimeoutMillis: 10_000 });
let applying = null;

console.log(`Migrating ${databaseUrl.hostname}${databaseUrl.pathname}`);
try {
  await client.connect();
  await client.query('BEGIN');
  for (const name of migrations) {
    applying = name;
    await client.query(await readFile(new URL(name, directory), 'utf8'));
  }
  applying = null;
  await client.query('COMMIT');
  console.log(`Applied ${migrations.join(', ')}.`);
} catch (error) {
  if (applying) await client.query('ROLLBACK').catch(() => {});
  console.error(`Migration failed${applying ? ` in ${applying}` : ''}; nothing was changed. ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
