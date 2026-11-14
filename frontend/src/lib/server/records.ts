import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { IssueSnapshot } from './intake.ts';

export type WorkItem = { id: string; snapshot: IssueSnapshot; createdAt: string; expiresAt: string };
export type RecordStore = ReturnType<typeof createRecords>;
type Row = { id: string; payload: IssueSnapshot; created_at: Date; expires_at: Date };
function item(row: Row): WorkItem {
  return { id: row.id, snapshot: row.payload, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
}

export function testDatabaseUrl(value?: string): string {
  if (!value) throw new Error('Set TRIPSIT_TEST_DATABASE_URL to an explicitly disposable local database.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/tripsit_e01s01_test') {
    throw new Error('Refusing a database that is not the disposable local tripsit_e01s01_test target.');
  }
  return value;
}

export function createRecords(database: Pick<Pool | PoolClient, 'query'>, clock = () => new Date()) {
  return {
    async create(owner: string, snapshot: IssueSnapshot): Promise<WorkItem> {
      const id = randomUUID();
      const created = clock();
      const expiry = new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
      const payload = JSON.stringify(snapshot);
      const digest = createHash('sha256').update(payload).digest('hex');
      await database.query(`WITH inserted AS (
        INSERT INTO tripsit_work_items(id,owner_id,snapshot_digest,status,created_at,expires_at)
        VALUES ($1,$2,$3,'intake',$4,$5) RETURNING id
      ) INSERT INTO tripsit_snapshots(work_item_id,payload) SELECT id,$6::jsonb FROM inserted`, [id,owner,digest,created,expiry,payload]);
      return { id, snapshot, createdAt: created.toISOString(), expiresAt: expiry.toISOString() };
    },
    async get(owner: string, id: string): Promise<WorkItem | null> {
      const result = await database.query<Row>(`SELECT w.id,s.payload,w.created_at,w.expires_at
        FROM tripsit_work_items w JOIN tripsit_snapshots s ON s.work_item_id=w.id
        WHERE w.owner_id=$1 AND w.id=$2 AND w.expires_at>$3`, [owner,id,clock()]);
      return result.rows[0] ? item(result.rows[0]) : null;
    },
    async list(owner: string): Promise<WorkItem[]> {
      const result = await database.query<Row>(`SELECT w.id,s.payload,w.created_at,w.expires_at
        FROM tripsit_work_items w JOIN tripsit_snapshots s ON s.work_item_id=w.id
        WHERE w.owner_id=$1 AND w.expires_at>$2 ORDER BY w.created_at DESC,w.id LIMIT 20`, [owner,clock()]);
      return result.rows.map(item);
    },
    async purge(): Promise<number> {
      const result = await database.query(`WITH expired AS (
        SELECT id FROM tripsit_work_items WHERE expires_at<=$1 AND status='intake' LIMIT 10000
      ), deleted AS (
        DELETE FROM tripsit_snapshots WHERE work_item_id IN (SELECT id FROM expired)
      ) UPDATE tripsit_work_items SET status='expired' WHERE id IN (SELECT id FROM expired)`, [clock()]);
      return result.rowCount ?? 0;
    }
  };
}
