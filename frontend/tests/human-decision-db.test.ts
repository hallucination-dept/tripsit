import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { testDatabaseUrl } from '../src/lib/server/records.ts';
import { createHumanDecision } from '../src/lib/server/human-decision.ts';
import { snapshotPolicy } from '../src/lib/server/snapshot-policy.ts';

const itemId='11111111-1111-4111-8111-111111111111', candidateId='22222222-2222-4222-8222-222222222222', packetId='33333333-3333-4333-8333-333333333333';
const snapshot={ repositoryId:1, repository:'a/b', private:false, issueNumber:1, issueId:2, baseSha:'a'.repeat(40), supplied:{ title:'fix', body:'', provenance:'supplied' as const }, inferred:[], ownerConfirmed:[] };
const item={ id:itemId, snapshot, createdAt:'2026-01-01T00:00:00.000Z', expiresAt:'2099-01-01T00:00:00.000Z' };
const policy=snapshotPolicy(item), identity={ ownerId:'owner',itemId,candidateId,baseSha:snapshot.baseSha,candidateDigest:'b'.repeat(64),snapshotDigest:policy.snapshotDigest,policyVersion:policy.policy.version };
const body=JSON.stringify({identity,candidateCommit:'c'.repeat(40),acceptanceReady:false});
const payload={reviews:[]};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value,(_key,entry)=>entry && typeof entry==='object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])) : entry);
const row={payload,snapshot,body,packet_digest:digest(body),source_digest:digest(canonical(payload)),snapshot_digest:digest(canonical(snapshot)),commit_sha:'c'.repeat(40),base_sha:snapshot.baseSha,output_digest:identity.candidateDigest};
const input={requestId:'44444444-4444-4444-8444-444444444444',decision:'revise',inspection:'Inspected affected caller.',uncheckedScope:'Other modules not checked.',residualRisk:'Regression may remain.'};

test('decisions are owner scoped, idempotent, and reject a concurrent evidence append',async()=>{
 const pool=new pg.Pool({connectionString:testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL),connectionTimeoutMillis:5000});
 const client=await pool.connect();
 try {
  for(const migration of ['001_work_items.sql','002_candidates.sql','003_candidate_staging.sql','004_revision_packets.sql','005_human_decisions.sql']) await client.query(await readFile(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
  await client.query('INSERT INTO tripsit_work_items VALUES ($1,$2,$3,$4,$5,$6)',[itemId,'owner','digest','intake',item.createdAt,item.expiresAt]);
  await client.query('INSERT INTO tripsit_snapshots VALUES ($1,$2)',[itemId,JSON.stringify(snapshot)]);
  await client.query('INSERT INTO tripsit_candidates VALUES ($1,$2,$3,$4,$5)',[candidateId,'owner',identity.candidateDigest,item.createdAt,item.expiresAt]);
  await client.query('INSERT INTO tripsit_candidate_payloads VALUES ($1,$2,$3)',[candidateId,itemId,JSON.stringify(payload)]);
  await client.query('INSERT INTO tripsit_candidate_stages VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[candidateId,'owner',snapshot.baseSha,identity.candidateDigest,row.commit_sha,'d'.repeat(40),'[]',item.expiresAt]);
  await client.query('INSERT INTO tripsit_revision_packets VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[packetId,candidateId,'owner',row.commit_sha,row.packet_digest,row.source_digest,row.snapshot_digest,body,item.createdAt,item.expiresAt]);
  const intake={async get(){return item;}}; const service=createHumanDecision({database:pool,intake}); const signal=new AbortController().signal;
  const first=await service.record('owner',itemId,candidateId,packetId,input,signal);
  assert.deepEqual(await service.record('owner',itemId,candidateId,packetId,input,signal),first);
  assert.equal((await service.list('owner',itemId,candidateId,packetId,signal)).length,1);
  assert.equal((await service.list('other',itemId,candidateId,packetId,signal)).length,0);
  await assert.rejects(service.record('other',itemId,candidateId,packetId,input,signal));
  await assert.rejects(service.record('owner',itemId,candidateId,packetId,{...input,decision:'accept'},signal),{status:409});
  let resume!:()=>void, loaded!:()=>void;
  const pause=new Promise<void>(resolve=>resume=resolve), ready=new Promise<void>(resolve=>loaded=resolve);
  const database={async query(sql:string,values?:unknown[]){const result=await pool.query(sql,values); if(sql.startsWith('SELECT')){loaded();await pause;}return result;}};
  const delayed=createHumanDecision({database,intake});
  const pending=delayed.record('owner',itemId,candidateId,packetId,{...input,requestId:'55555555-5555-4555-8555-555555555555'},signal);
  await ready;
  await client.query("UPDATE tripsit_candidate_payloads SET payload=jsonb_set(payload,'{reviews}','[{}]'::jsonb) WHERE candidate_id=$1",[candidateId]);
  resume(); await assert.rejects(pending,{status:409});
  assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_human_decisions')).rows[0].count,1);
 } finally {client.release();await pool.end();}
});
