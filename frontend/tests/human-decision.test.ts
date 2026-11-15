import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
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
function fixture() {
 let inserts=0;
 const database={async query(sql:string, values?:unknown[]){ if(sql.startsWith('SELECT')) return {rows:[structuredClone(row)]}; inserts++; assert.match(sql,/p.payload=\$8::jsonb/); assert.match(sql,/FOR UPDATE OF p/); return {rows:[{id:values![9],created_at:values![10]}]}; }};
 const intake={async get(owner:string){ if(owner!=='owner') throw new Error('denied'); return item; }};
 return { database,intake,inserts:()=>inserts, service:createHumanDecision({database,intake}) };
}
test('records only named owner revision/escalation for the exact frozen packet',async()=>{
 for(const decision of ['revise','escalate']) { const f=fixture(); const result=await f.service.record('owner',itemId,candidateId,packetId,{...input,decision},new AbortController().signal); assert.equal(result.decision,decision); assert.equal(result.candidateCommit,row.commit_sha); assert.equal(result.packetDigest,row.packet_digest); assert.equal(f.inserts(),1); }
});
test('rejects acceptance, missing inspection and cross-owner before writing',async()=>{
 for(const [owner,value] of [['owner',{...input,decision:'accept'}],['owner',{...input,inspection:'  '}],['other',input]] as const) {const f=fixture(); await assert.rejects(f.service.record(owner,itemId,candidateId,packetId,value,new AbortController().signal)); assert.equal(f.inserts(),0);}
});
test('changed evidence or packet digest fails closed',async()=>{
 for(const field of ['source_digest','snapshot_digest','packet_digest','commit_sha'] as const) { const f=fixture(); const get=f.database.query; f.database.query=async (sql,values)=>{const out=await get(sql,values); if(sql.startsWith('SELECT')) out.rows[0][field]='f'.repeat(64); return out;}; await assert.rejects(f.service.record('owner',itemId,candidateId,packetId,input,new AbortController().signal)); assert.equal(f.inserts(),0); }
});
