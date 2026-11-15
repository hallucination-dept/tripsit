import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutcomeFeedback} from '../src/lib/server/outcome-feedback.ts';
const item='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222',packet='33333333-3333-4333-8333-333333333333',decision='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555';
const input={packetId:packet,decisionId:decision,requestId,area:'src/a.ts',kind:'escape',severity:'high',evidenceIssue:42};
function fixture(){let writes=0;const work={id:item,snapshot:{repositoryId:10,baseSha:'a'.repeat(40)}};const stored={id:candidate,candidate:{baseSha:work.snapshot.baseSha,files:[{path:'src/a.ts'}]}};
 const intake={async get(owner:string){if(owner!=='owner')throw Error('denied');return work as never;}};const generation={async get(){return stored as never;}};
 const database={async query(sql:string,values?:unknown[]){if(sql.includes('INSERT INTO')){writes++;assert.equal(values![0],'owner');assert.match(sql,/FOR SHARE OF d,r,p,c,w,s,t/);return {rows:[{id:'record'}]};}return {rows:[]};}};
 return {service:createOutcomeFeedback({database,intake,generation}),writes:()=>writes};}
test('records owner-reported escape only for an existing candidate area',async()=>{const f=fixture();assert.deepEqual(await f.service.record('owner',item,candidate,input,new AbortController().signal),{id:'record'});assert.equal(f.writes(),1);});
test('rejects another owner, unknown areas, unsafe evidence and forged fields',async()=>{for(const [owner,changed] of [['other',input],['owner',{...input,area:'different'}],['owner',{...input,evidenceIssue:-1}],['owner',{...input,packetDigest:'forged'}]] as const){const f=fixture();await assert.rejects(f.service.record(owner,item,candidate,changed,new AbortController().signal));assert.equal(f.writes(),0);}});
test('later matching searches are scoped to owner, repository and exact changed paths',async()=>{const f=fixture();const result=await f.service.list('owner',item,candidate,new AbortController().signal);assert.equal(result.areaCoverage,'partial');assert.deepEqual(result.findings,[]);});
