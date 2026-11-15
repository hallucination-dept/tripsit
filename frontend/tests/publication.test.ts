import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { stageCandidate } from '../src/lib/server/candidate-staging.ts';
import { createPublication } from '../src/lib/server/publication.ts';
import { snapshotPolicy } from '../src/lib/server/snapshot-policy.ts';
const itemId='11111111-1111-4111-8111-111111111111', candidateId='22222222-2222-4222-8222-222222222222', packetId='33333333-3333-4333-8333-333333333333';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value,(_key,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
function fixture(accepted=true) {
 const snapshot={repositoryId:1,repository:'team/repo',private:false,issueNumber:4,issueId:5,baseSha:'a'.repeat(40),supplied:{title:'Fix',body:'',provenance:'supplied' as const},inferred:[],ownerConfirmed:[]};
 const item={id:itemId,snapshot,createdAt:'2026-01-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z'};
 const content=Buffer.from('hello\n'), blobSha=createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
 const candidate={baseSha:snapshot.baseSha,outputDigest:'b'.repeat(64),files:[{path:'new.txt',originalBlob:null,content,blobSha}]};
 const tree={baseSha:snapshot.baseSha,treeSha:'4b825dc642cb6eb9a060e54bf8d69288fbee4904',entries:[]};
 const stage=stageCandidate(tree.baseSha,tree.treeSha,tree.entries,candidate as never,item.createdAt);
 const policy=snapshotPolicy(item); for (const requirement of policy.policy.requirements) if(requirement.mandatory) requirement.applicability='applicable';
 const payload={candidate:'fixture'};
 const packet={acceptanceReady:true,candidateCommit:stage.commitSha,identity:{ownerId:'owner',itemId,candidateId,baseSha:snapshot.baseSha,candidateDigest:candidate.outputDigest,snapshotDigest:policy.snapshotDigest,policyVersion:policy.policy.version},requirementCoverage:policy.policy.requirements.filter(requirement=>requirement.mandatory).map(requirement=>({id:requirement.id,mandatory:true,applicability:'applicable',status:'passed_exercised_checks'}))};
 const body=JSON.stringify(packet), packetDigest=sha(body);
 const row={body,packet_digest:packetDigest,source_digest:sha(canonical(payload)),snapshot_digest:sha(canonical(snapshot)),commit_sha:stage.commitSha,payload,snapshot,tree_sha:stage.rootSha,objects:stage.objects,base_sha:snapshot.baseSha,output_digest:candidate.outputDigest,decision_id:'decision',inspection:'inspected',unchecked_scope:'none',residual_risk:'none'};
 let operation:any; let ref:string|null=null; let pull:any; let objectIndex=0; let postPulls=0; let writeCalls=0; let accessAllowed=true; let visible=true; let baseCurrent=snapshot.baseSha;
 const database={async query(sql:string,values:any[]=[]){
  if(sql.includes('JOIN LATERAL')) return {rows:accepted?[row]:[]};
  if(sql.startsWith('INSERT INTO tripsit_publication_operations')) { if(operation)return {rows:[]}; operation={status:'pending'};return {rows:[operation]}; }
  if(sql.startsWith('SELECT * FROM tripsit_publication_operations')) return {rows:operation?[operation]:[]};
  if(sql.includes("SET status='creating'")) {if(operation.status!=='pending')return{rows:[]};operation.status='creating';return{rows:[operation]};}
  if(sql.includes("SET status='completed'")) {operation.status='completed';return{rows:[operation]};}
  throw Error('unexpected query');
 }};
 const github={async publicationAccess(){if(!accessAllowed)throw Error('revoked');return {repository:'team/repo',repositoryId:1,branch:'main',token:'fixture'};},async stagingTree(){return tree;}};
 const fetcher:typeof fetch=async (url,init)=>{
  const u=new URL(String(url)), path=u.pathname.replace('/repos/team/repo','');
  if(init?.method==='GET'&&path==='/git/ref/heads/main')return Response.json({object:{sha:baseCurrent}});
  if(init?.method==='GET'&&path==='/issues/4')return Response.json({id:5});
  if(init?.method==='GET'&&path.includes('/git/ref/heads/'))return ref?Response.json({object:{sha:ref}}):new Response('',{status:404});
  if(init?.method==='GET'&&path==='/pulls')return Response.json(pull&&visible?[pull]:[]);
  writeCalls++;
  if(path==='/git/refs'){ref=JSON.parse(String(init.body)).sha;return Response.json({ref});}
  if(path==='/pulls'){postPulls++;const args=JSON.parse(String(init.body));pull={number:7,state:'open',body:args.body,base:{ref:'main',repo:{id:1}},head:{ref:args.head,sha:stage.commitSha,repo:{id:1}}};return new Response('',{status:502});}
  const object=stage.objects[objectIndex++%stage.objects.length];return Response.json({sha:object.sha});
 };
 const service=createPublication({database,intake:{async get(owner){if(owner!=='owner')throw Error('denied');return item;}},generation:{async get(){return {id:candidateId,candidate:candidate as never};}},github,fetcher,policy:()=>policy});
 return {service,stats:()=>({postPulls,writeCalls}),revoke:()=>{accessAllowed=false;},changeBase:()=>{baseCurrent='f'.repeat(40);},showPull:(value:boolean)=>{visible=value;},stage};
}

test('refuses missing acceptance before any GitHub write',async()=>{
 const f=fixture(false);await assert.rejects(f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal),{status:409});assert.equal(f.stats().writeCalls,0);
});

test('denies a changed base or revoked repository access before writes',async()=>{
 for (const mode of ['base','access']) {
  const f=fixture(); if(mode==='base')f.changeBase(); else f.revoke();
  await assert.rejects(f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal));
  assert.equal(f.stats().writeCalls,0);
 }
});

test('ambiguous PR creation stays pending until a matching PR becomes visible',async()=>{
 const f=fixture(); f.showPull(false);
 await assert.rejects(f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal),{status:409});
 const writes=f.stats().writeCalls; assert.equal(f.stats().postPulls,1);
 await assert.rejects(f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal),{status:409});
 assert.equal(f.stats().writeCalls,writes); f.showPull(true);
 const result=await f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal);
 assert.equal(result.number,7); assert.equal(f.stats().postPulls,1);
});

test('publishes exact staged commit and reconciles lost PR response without duplicate',async()=>{
 const f=fixture();const first=await f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal);
 assert.equal(first.commit,f.stage.commitSha);assert.equal(first.url,'https://github.com/team/repo/pull/7');assert.equal(first.protection,'unverified');
 const writes=f.stats().writeCalls;const second=await f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal);
 assert.deepEqual(second,first);assert.equal(f.stats().writeCalls,writes);assert.equal(f.stats().postPulls,1);
 f.revoke();await assert.rejects(f.service.publish('owner',itemId,candidateId,packetId,new AbortController().signal));assert.equal(f.stats().writeCalls,writes);
});
