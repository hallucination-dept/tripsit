import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredChecks, verificationDigest } from '../src/lib/server/verification.ts';
import { trustedRequiredManifest } from '../src/lib/server/trusted-required-manifest.ts';
import { baselinePolicy } from '../src/lib/server/policy.ts';

const policy=baselinePolicy('unknown'), base='a'.repeat(40);
const identity={ownerId:'owner',itemId:'11111111-1111-4111-8111-111111111111',candidateId:'22222222-2222-4222-8222-222222222222',baseSha:base,candidateDigest:'b'.repeat(64),snapshotDigest:'c'.repeat(64),policyVersion:policy.version};
const context={identity,repositoryId:123,files:[{path:'app.py',original:'old',replacement:'new'}],nodes:[],requirements:policy.requirements,comparison:{model:'gemma',settingsDigest:'d'.repeat(64),revision:identity.candidateDigest},disagreements:[]};
const checksRaw=JSON.stringify([{repositoryId:123,baseSha:base,checks:[{id:'security',language:'python',path:'app.py',export:'main',cases:[{args:[],expected:1}],requirementIds:[policy.requirements[0].id],mandatory:true,impact:'high',timeoutMs:1000}]}]);
const {nodeIds: _nodes,...definition}=configuredChecks(checksRaw,context)[0];
const manifest={schemaVersion:1,version:'operator-2026-01',repositoryId:123,baseSha:base,policyVersion:policy.version,complete:true,controls:[
 {id:policy.requirements[0].id,applicability:'applicable',reason:'Owner access paths apply.',checks:[{id:'security',digest:verificationDigest(definition)}]},
 {id:policy.requirements[1].id,applicability:'not_applicable',reason:'This frozen change has no interface.',checks:[]}
]};
test('binds explicit operator assertion to exact repo, base, policy and trusted check definition',()=>{
 const result=trustedRequiredManifest(JSON.stringify([manifest]),checksRaw,context,policy.requirements);
 assert.equal(result.status,'operator_asserted');
 if(result.status==='operator_asserted') { assert.match(result.manifestDigest,/^[a-f0-9]{64}$/);assert.equal(result.controls.length,2); }
});
test('missing, ambiguous, stale, incomplete or tampered assertions remain unavailable',()=>{
 const variants=[undefined,'{',JSON.stringify([]),JSON.stringify([manifest,manifest]),
  ...[{complete:false},{repositoryId:124},{baseSha:'e'.repeat(40)},{policyVersion:'wrong'}, {controls:[]}, {controls:[manifest.controls[0],manifest.controls[0]]},
   {controls:[{...manifest.controls[0],reason:' '},manifest.controls[1]]},
   {controls:[{...manifest.controls[0],checks:[]},manifest.controls[1]]},
   {controls:[{...manifest.controls[0],checks:[{id:'security',digest:'f'.repeat(64)}]},manifest.controls[1]]},
   {controls:[manifest.controls[0],{...manifest.controls[1],applicability:'unresolved'}]}].map(change=>JSON.stringify([{...manifest,...change}]))];
 for(const value of variants) assert.equal(trustedRequiredManifest(value,checksRaw,context,policy.requirements).status,'unavailable');
 assert.equal(trustedRequiredManifest(JSON.stringify([manifest]),undefined,context,policy.requirements).status,'unavailable');
});
