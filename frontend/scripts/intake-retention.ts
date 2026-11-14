import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';

const run = promisify(execFile);
const intervalMs = 25;
const script = fileURLToPath(import.meta.url);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function verify(pool: Pool, connection: string) {
  const schema = `retention_${randomBytes(12).toString('hex')}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(await readFile(new URL('../migrations/001_work_items.sql', import.meta.url), 'utf8'));
    const snapshot = { repositoryId: 1, repository: 'fixture/retention-fixture-source', private: false,
      issueNumber: 1, issueId: 1, baseSha: 'a'.repeat(40),
      supplied: { title: 'retention-fixture-source', body: 'retention-fixture-source', provenance: 'supplied' as const },
      inferred: [], ownerConfirmed: [] };
    const expired = await createRecords(client, () => new Date(Date.now() - 8 * 86400_000)).create('retention-owner', snapshot);
    const second = await createRecords(client).create('retention-owner', snapshot);
    const active = await createRecords(client).create('retention-owner', snapshot);
    const cycles: { purged: number; elapsedMs: number }[] = [];
    for (const expiredId of [expired.id, second.id]) {
      if (expiredId === second.id) {
        // Simulate the next expiry boundary without changing application retention policy.
        await client.query('UPDATE tripsit_work_items SET expires_at=$1 WHERE id=$2', [new Date(Date.now() - 1), second.id]);
      }
      await wait(intervalMs);
      const started = Date.now();
      const result = await run(process.execPath, ['--experimental-strip-types', script, '--purge', schema], {
        env: { ...process.env, TRIPSIT_TEST_DATABASE_URL: connection }, timeout: 6000, maxBuffer: 4096
      });
      const cycle = JSON.parse(result.stdout);
      assert.equal(cycle.purged, 1);
      const source = await client.query('SELECT count(*)::int AS count FROM tripsit_snapshots WHERE work_item_id=$1', [expiredId]);
      assert.equal(source.rows[0].count, 0);
      cycles.push({ purged: cycle.purged, elapsedMs: Date.now() - started });
    }
    assert(await createRecords(client).get('retention-owner', active.id));
    const raw = await client.query('SELECT count(*)::int AS count FROM tripsit_snapshots');
    const metadata = await client.query('SELECT * FROM tripsit_work_items ORDER BY id');
    assert.equal(raw.rows[0].count, 1);
    assert.equal(metadata.rowCount, 3);
    assert.equal(metadata.rows.filter(row => row.status === 'expired').length, 2);
    assert(!JSON.stringify(metadata.rows).includes('retention-fixture-source'));
    const sources = await Promise.all([import.meta.url, new URL('../src/lib/server/records.ts', import.meta.url),
      new URL('../migrations/001_work_items.sql', import.meta.url)].map(async path => digest(await readFile(new URL(path), 'utf8'))));
    const target = new URL(connection);
    return { status: 'passed_local_only', codeDigest: digest(JSON.stringify(sources)),
      configDigest: digest(JSON.stringify({ host: target.hostname, port: target.port || '5432', database: target.pathname,
        user: target.username, intervalMs, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 })),
      intervalMs, cycles, rawRemaining: raw.rows[0].count, metadataRetained: metadata.rowCount,
      expiredMetadata: 2, productionScheduleVerified: false };
  } finally {
    try { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { client.release(); }
  }
}

async function main() {
  const connection = testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL);
  const target = new URL(connection);
  if (target.search || target.hash) throw new Error('Connection overrides are not allowed.');
  const pool = new Pool({ connectionString: connection, connectionTimeoutMillis: 1000, query_timeout: 1000, statement_timeout: 1000 });
  try {
    if (process.argv[2] === '--purge') {
      const schema = process.argv[3];
      if (process.argv.length !== 4 || !/^retention_[a-f0-9]{24}$/.test(schema ?? '')) throw new Error('Invalid retention worker.');
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schema}`);
        console.log(JSON.stringify({ purged: await createRecords(client).purge() }));
      } finally { client.release(); }
    } else {
      if (process.argv.length !== 2) throw new Error('Unsupported retention arguments.');
      console.log(JSON.stringify(await verify(pool, connection)));
    }
  } finally { await pool.end(); }
}

const deadline = setTimeout(() => { console.error('Retention verification unavailable: overall deadline exceeded.'); process.exit(1); }, 25_000);
main().catch(() => { console.error('Retention verification unavailable: check disposable local database configuration and controls.'); process.exitCode = 1; })
  .finally(() => clearTimeout(deadline));
