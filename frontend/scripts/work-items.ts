import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';

const operation = process.argv[2];
if (!['migrate','purge'].includes(operation)) throw new Error('Use work-items.ts migrate|purge with an explicitly disposable local database.');
const pool = new Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL) });
try {
  if (operation === 'migrate') {
    for (const migration of ['001_work_items.sql', '002_candidates.sql']) {
      await pool.query(await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
    }
    console.log('App-owned work-item migration applied to disposable development database.');
  } else {
    console.log(`Purged ${await createRecords(pool).purge()} expired development snapshots.`);
  }
} finally { await pool.end(); }
