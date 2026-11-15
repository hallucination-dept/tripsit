import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {testDatabaseUrl} from '../src/lib/server/records.ts';
import {createOutcomeFeedback} from '../src/lib/server/outcome-feedback.ts';
test('outcomes persist idempotently and match only the same owner and area',async()=>{
 const pool=new pg.Pool({connectionString:testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL),connectionTimeoutMillis:5000});const client=await pool.connect();
 try{
  for(const name of ['001_work_items.sql','002_candidates.sql','003_candidate_staging.sql','004_revision_packets.sql','005_human_decisions.sql','008_owner_outcomes.sql'])await client.query(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  const item=randomUUID(),candidate=randomUUID(),packet=randomUUID(),decision=randomUUID(),requestId=randomUUID(), base='a'.repeat(40), output='b'.repeat(64),commit='c'.repeat(40), now=new Date(), expires=new Date(Date.now()+3600000);
  const snapshot={repositoryId:123,baseSha:base};
  await client.query('INSERT INTO tripsit_work_items VALUES ($1,$2,$3,$4,$5,$6)',[item,'owner','digest','intake',now,expires]);
  await client.query('INSERT INTO tripsit_snapshots VALUES ($1,$2)',[item,JSON.stringify(snapshot)]);
  await client.query('INSERT INTO tripsit_candidates VALUES ($1,$2,$3,$4,$5)',[candidate,'owner',output,now,expires]);
  await client.query('INSERT INTO tripsit_candidate_payloads VALUES ($1,$2,$3)',[candidate,item,JSON.stringify({baseSha:base,outputDigest:output,files:[{path:'a.ts'}]})]);
  await client.query('INSERT INTO tripsit_candidate_stages VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[candidate,'owner',base,output,commit,'d'.repeat(40),'[]',expires]);
  await client.query('INSERT INTO tripsit_revision_packets VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[packet,candidate,'owner',commit,'e'.repeat(64),'f'.repeat(64),'0'.repeat(64),'{}',now,expires]);
  await client.query('INSERT INTO tripsit_human_decisions(id,packet_id,owner_id,request_id,decision,inspection,unchecked_scope,residual_risk,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[decision,packet,'owner',randomUUID(),'revise','checked','unknown','risk',now,expires]);
  const intake={async get(owner:string){if(owner!=='owner')throw Error('denied');return {id:item,snapshot} as never;}},generation={async get(){return {id:candidate,candidate:{baseSha:base,files:[{path:'a.ts'}]}} as never;}};
  const service=createOutcomeFeedback({database:pool,intake,generation}),signal=new AbortController().signal;
  const input={packetId:packet,decisionId:decision,requestId,area:'a.ts',kind:'escape',severity:'high',evidenceIssue:7};
  const first=await service.record('owner',item,candidate,input,signal);assert.deepEqual(await service.record('owner',item,candidate,input,signal),first);
  assert.equal((await service.list('owner',item,candidate,signal)).findings.length,1);
  await client.query(`INSERT INTO tripsit_owner_outcomes(id,owner_id,request_id,repository_id,area,packet_digest,commit_sha,decision_id,kind,severity,evidence_issue,created_at)
   SELECT md5('outcome'||i)::uuid,'owner',md5('request'||i)::uuid,123,'a.ts',$1,$2,$3,'spot_check','low',7,now()+interval '1 second' FROM generate_series(1,101) i`,['e'.repeat(64),commit,decision]);
  const later=await service.list('owner',item,candidate,signal);
  assert.equal(later.findings.length,100);assert.equal(later.historyTruncated,true);
  assert.equal(later.scrutiny.length,1);assert.equal(later.scrutiny[0].kind,'escape');
  await assert.rejects(service.record('other',item,candidate,input,signal));await assert.rejects(service.record('owner',item,candidate,{...input,area:'other.ts'},signal));
 }finally{client.release();await pool.end();}
});
