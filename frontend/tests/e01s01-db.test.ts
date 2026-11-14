import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';

const snapshot = { repositoryId:5, repository:'team/repo', private:false, issueNumber:2, issueId:20, baseSha:'a'.repeat(40), supplied:{title:"Robert'); DROP TABLE x;--",body:'private fixture',provenance:'supplied' as const},inferred:[],ownerConfirmed:[] };

test('real PostgreSQL isolates owners and physically purges expired payloads and references', async () => {
 const pool = new Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL), connectionTimeoutMillis:5000, query_timeout:5000, statement_timeout:5000 });
 const schema = `intake_test_${Date.now()}_${Math.floor(Math.random()*100000)}`;
 try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const client = await pool.connect();
  try {
   await client.query(`SET search_path TO ${schema}`);
   await client.query(await readFile(new URL('../migrations/001_work_items.sql',import.meta.url),'utf8'));
   let now = new Date('2026-01-01T00:00:00Z');
   const records=createRecords(client,()=>now);
   const created=await records.create('owner-a',snapshot);
   assert.equal((await records.get('owner-a',created.id))?.snapshot.supplied.title,snapshot.supplied.title);
   assert.equal(await records.get('owner-b',created.id),null);
   assert.deepEqual(await records.list('owner-b'),[]);
   const peers=await Promise.all([pool.connect(),pool.connect()]);
   let concurrent;
   try {
    await Promise.all(peers.map(peer=>peer.query(`SET search_path TO ${schema}`)));
    const pids=await Promise.all(peers.map(peer=>peer.query('SELECT pg_backend_pid() AS pid')));
    assert.notEqual(pids[0].rows[0].pid,pids[1].rows[0].pid);
    concurrent=await Promise.all(peers.map(peer=>createRecords(peer,()=>now).create('owner-a',snapshot)));
   } finally {peers.forEach(peer=>peer.release());}
   assert.equal(new Set([created.id,...concurrent.map(row=>row.id)]).size,3);
   assert.equal((await records.list('owner-a')).length,3);
   now=new Date('2026-01-09T00:00:00Z');
   assert.equal(await records.get('owner-a',created.id),null);
   await records.purge();
   await client.query("SET statement_timeout = '25ms'");
   await assert.rejects(()=>client.query('SELECT pg_sleep(1)'),(error:Error & {code?:string})=>error.code==='57014');
   await client.query("SET statement_timeout = '5s'");
   const raw=await client.query('SELECT count(*)::int AS count FROM tripsit_snapshots');
   assert.equal(raw.rows[0].count,0);
   const metadata=await client.query('SELECT * FROM tripsit_work_items');
   assert.equal(metadata.rowCount,3);
   assert(!JSON.stringify(metadata.rows).includes('team/repo'));
   assert(!JSON.stringify(metadata.rows).includes('private fixture'));
   assert(metadata.rows.every(row=>row.status==='expired'));
  } finally {client.release();}
 } finally {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
 }
});

test('database harness refuses absent or non-disposable targets',()=>{
 for(const value of [undefined,'postgres://localhost/production','postgres://remote.example/tripsit_e01s01_test']) assert.throws(()=>testDatabaseUrl(value));
});
