import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredChecks, createVerification, fileTokenSignal, mandatoryInventory } from '../src/lib/server/verification.ts';
import { mapCandidateTokenBytes } from '../src/lib/server/candidate-output.ts';
import { prioritizeChecks } from '../src/lib/server/priorities.ts';
import { createHash } from 'node:crypto';
const revision = { ownerId: 'owner', itemId: '11111111-1111-1111-1111-111111111111', candidateId: '22222222-2222-2222-2222-222222222222', baseSha: 'a'.repeat(40), candidateDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), policyVersion: 'v1' };
const manifest = JSON.stringify([{ repositoryId: 123, baseSha: revision.baseSha, checks: [{ id: 'caller-regression', language: 'python', path: 'caller.py', export: 'call', cases: [{ args: [2], expected: 4 }], requirementIds: ['R1'], mandatory: true, impact: 'high', timeoutMs: 1000 }] }]);
const context = { identity: revision, repositoryId: 123, files: [{ path: 'caller.py', original: 'def call(x): return x*2', replacement: 'def call(x): return x*3' }], nodes: [{ id: 'node1', path: 'caller.py' }], requirements: [{ id: 'R1', mandatory: false }], comparison: { model: 'gemma', settingsDigest: 'd'.repeat(64), revision: revision.candidateDigest }, disagreements: [] as string[] };
test('mandatory inventory distinguishes configured checks from missing policy and runner evidence', () => {
 const policy = [{id:'R1',mandatory:true,applicability:'unresolved' as const}, {id:'R2',mandatory:true,applicability:'applicable' as const}, {id:'R3',mandatory:true,applicability:'not_applicable' as const}];
 const inventory = mandatoryInventory({manifest},context,policy);
 assert.equal(inventory.configurationStatus,'available'); assert.equal(inventory.runnerAvailable,false);
 assert.deepEqual(inventory.checks,[{id:'caller-regression',requirementIds:['R1']}]);
 assert.deepEqual(inventory.missingRequirements,['R2']); assert.deepEqual(inventory.unresolvedRequirements,['R1']);
 for (const bad of [undefined,'{',JSON.stringify([])]) {
  const unavailable = mandatoryInventory({manifest:bad},context,policy);
  assert.equal(unavailable.configurationStatus,'unavailable'); assert.deepEqual(unavailable.checks,[]);
  assert.deepEqual(unavailable.missingRequirements,['R1','R2']); assert.equal(unavailable.runnerAvailable,false);
 }
});
test('file signals require exact candidate revision, full file node and contained token bytes', () => {
 const content = context.files[0].replacement;
 const raw = new TextEncoder().encode(JSON.stringify({files:[{path:'caller.py',originalBlob:null,content}]}));
 const tokens = Array.from(raw, byte => ({ token: 'fixture', bytes: [byte], logprob: -1 }));
 const observations = { status: 'observed' as const, tokens };
 const mapped = mapCandidateTokenBytes(raw, new Map([['caller.py', null]]), tokens, 'gemma', context.comparison.settingsDigest);
 assert.equal(mapped.status, 'exact'); if (mapped.status !== 'exact') return;
 const identity = { ...revision, candidateDigest: mapped.outputDigest };
 const signal = { ...mapped, mode: 'direct' as const, observationsDigest: createHash('sha256').update(JSON.stringify(observations)).digest('hex') };
 const source = { revision: 'candidate' as const, path: 'caller.py', blobSha: mapped.files[0].blobSha, start: 0, end: Buffer.byteLength(content), byteLength: Buffer.byteLength(content) };
 const supplied = { ...context, identity, comparison: { ...context.comparison, revision: identity.candidateDigest },
  nodes: [{ id: 'node1', path: 'caller.py', kind: 'file', source }], tokenSignal: { mapping: signal, observations } };
 const check = configuredChecks(manifest, supplied)[0];
 assert.equal(fileTokenSignal(check, supplied)?.logprobs.length, Buffer.byteLength(content));
 assert.equal(fileTokenSignal(check, { ...supplied, tokenSignal: { ...supplied.tokenSignal, mapping: { ...signal, outputDigest: 'f'.repeat(64) } } }), undefined);
 assert.equal(fileTokenSignal(check, { ...supplied, nodes: [{ ...supplied.nodes[0], source: { ...source, blobSha: 'f'.repeat(40) } }] }), undefined);
 assert.equal(fileTokenSignal(check, { ...supplied, nodes: [{ ...supplied.nodes[0], source: { ...source, revision: 'base' } }] }), undefined);
 assert.equal(fileTokenSignal({ ...check, nodeIds: [] }, supplied), undefined);
 const broadTokens = [{token:'whole response',bytes:Array.from(raw),logprob:-1}];
 const broadMapping = mapCandidateTokenBytes(raw,new Map([['caller.py',null]]),broadTokens,'gemma',context.comparison.settingsDigest);
 assert.equal(broadMapping.status,'exact'); if (broadMapping.status === 'exact') {
  const broadObservations = {status:'observed' as const,tokens:broadTokens};
  assert.equal(fileTokenSignal(check,{...supplied,tokenSignal:{mapping:{...broadMapping,mode:'direct',observationsDigest:createHash('sha256').update(JSON.stringify(broadObservations)).digest('hex')},observations:broadObservations}}),undefined);
 }
});
test('verified file signals affect optional ordering while mandatory checks remain', () => {
 const raw = new TextEncoder().encode(JSON.stringify({files:[{path:'a.py',originalBlob:null,content:'aaa'},{path:'b.py',originalBlob:null,content:'bbb'}]}));
 const tokens = Array.from(raw, byte => ({ token: 'x', bytes: [byte], logprob: -0.1 }));
 const mapped = mapCandidateTokenBytes(raw, new Map([['a.py', null], ['b.py', null]]), tokens, 'gemma', context.comparison.settingsDigest);
 assert.equal(mapped.status, 'exact'); if (mapped.status !== 'exact') return;
 for (const segment of mapped.files[1].segments) tokens[segment.firstToken].logprob = -4;
 const observations = { status: 'observed' as const, tokens };
 const identity = { ...revision, candidateDigest: mapped.outputDigest };
 const signal = { ...mapped, mode:'direct' as const, observationsDigest: createHash('sha256').update(JSON.stringify(observations)).digest('hex') };
 const files = [{path:'a.py',original:null,replacement:'aaa'}, {path:'b.py',original:null,replacement:'bbb'}];
 const nodes = mapped.files.map((file, index) => ({ id: `n${index}`, path:file.path, kind:'file', source:{revision:'candidate' as const,path:file.path,blobSha:file.blobSha,start:0,end:3,byteLength:3} }));
 const supplied = { ...context, identity, files, nodes, comparison:{...context.comparison,revision:identity.candidateDigest},tokenSignal:{mapping:signal,observations} };
 const template = configuredChecks(manifest, context)[0];
 const checks = nodes.map(node => ({ ...template,id:node.path,path:node.path,nodeIds:[node.id],mandatory:false }));
 const ranked = checks.map(check => ({...check,impact:'high' as const,missingEvidence:true,reviewerDisagreement:false,signal:fileTokenSignal(check,supplied)}));
 const mandatory = {...ranked[0],id:'mandatory',mandatory:true};
 const plan = prioritizeChecks([ranked[0], ranked[1], mandatory], supplied.comparison, {optionalChecks:1,perCheckMs:60000,totalMs:180000});
 assert.equal(plan.selected[0].id, 'b.py'); assert.equal(plan.mandatory[0].id, 'mandatory');
});
test('only server definitions pinned to repository/base can become behavioral oracles', () => {
 assert.equal(configuredChecks(manifest, context).length, 1);
 assert.equal(configuredChecks(manifest, { ...context, repositoryId: 124 }).length, 0);
 assert.equal(configuredChecks(manifest, { ...context, identity: { ...revision, baseSha: 'e'.repeat(40) } }).length, 0);
 for (const change of [{ path: '../secret' }, { export: '__proto__' }, { timeoutMs: 60001 }, { requirementIds: ['unknown'] }]) {
  const bad = JSON.parse(manifest); Object.assign(bad[0].checks[0], change);
  assert.throws(() => configuredChecks(JSON.stringify(bad), context));
 }
});
test('unconfigured or failed admission dispatches no candidate source', async () => {
 let calls = 0;
 const runner = createVerification({ url: 'https://runner.example', token: 'secret', manifest, fetcher: async (_url, options) => { calls++; assert.equal(options?.method, 'GET'); return Response.json({ status: 'unverified' }); } });
 await assert.rejects(runner.run(context, new AbortController().signal, async () => {}));
 assert.equal(calls, 1);
 await assert.rejects(createVerification({}).run(context, new AbortController().signal, async () => {}));
});
test('oracle JSON is bounded and canonical digests match Python lexical key order', async () => {
 const { canonical, verificationDigest } = await import('../src/lib/server/verification.ts');
 const value = [{ args: [], expected: { '2': 2, '10': 10 } }];
 assert.equal(canonical(value), '[{"args":[],"expected":{"10":10,"2":2}}]');
 const { createHash } = await import('node:crypto');
 assert.equal(verificationDigest(value), createHash('sha256').update('[{"args":[],"expected":{"10":10,"2":2}}]').digest('hex'));
 for (const badValue of ['1e999', '1.5', '9007199254740992', '"\\ud800"']) {
  const bad = manifest.replace('"expected":4', '"expected":' + badValue);
  assert.throws(() => configuredChecks(bad, context));
 }
});
test('trusted failed executions bind all oracle/source identities and preserve dispatched plan', async () => {
 const { verificationDigest } = await import('../src/lib/server/verification.ts');
 const admission = { status: 'passed', configurationDigest: '1'.repeat(64), codeDigest: '2'.repeat(64), environmentDigest: '3'.repeat(64) };
 let tamper = false; let posts = 0;
 const runner = createVerification({ url: 'https://runner.example', token: 'secret', manifest, fetcher: async (_url, options) => {
  if (options?.method === 'GET') return Response.json(admission);
  posts++;
  const request = JSON.parse(options!.body as string), check = request.checks[0];
  assert.equal(check.id, 'caller-regression'); assert.equal(request.files[0].content, context.files[0].replacement);
  const { cases, ...definition } = check;
  const binding = { id: check.id, definitionDigest: verificationDigest(definition), oracleDigest: verificationDigest(cases),
   dependencyDigest: verificationDigest(request.files.map(({path,blobSha}: {path:string;blobSha:string}) => ({path,blobSha}))), environmentDigest: admission.environmentDigest };
  return Response.json({identity:request.identity,admission,checks:[binding],executions:[{...binding,id:'execution1',checkId:check.id,collector:'trusted_runner',runnerId:'sandbox1',prId:null,status:'completed',result:'failed',exitCode:1,executedTests:1,...(tamper?{oracleDigest:'f'.repeat(64)}:{})}]});
 } });
 const evidence = await runner.run(context, new AbortController().signal, async () => {});
 assert.equal(evidence.executions[0].result, 'failed'); assert.equal(evidence.checks[0].provenance, 'trusted_repository');
 assert.equal(evidence.dispatchPlan!.mandatory[0].id, 'caller-regression'); assert.equal(posts, 1);
 assert(!JSON.stringify(evidence).includes('expected'));
 tamper = true; await assert.rejects(runner.run(context, new AbortController().signal, async () => {}));
});

test('authorization revoked after admission sends no source to runner', async () => {
 let posts = 0;
 const runner = createVerification({ url: 'https://runner.example', token: 'secret', manifest, fetcher: async (_url, options) => {
  if (options?.method === 'POST') posts++;
  return Response.json({ status: 'passed', configurationDigest: '1'.repeat(64), codeDigest: '2'.repeat(64), environmentDigest: '3'.repeat(64) });
 } });
 await assert.rejects(runner.run(context, new AbortController().signal, async () => { throw new Error('revoked'); }));
 assert.equal(posts, 0);
});

test('exact evidence requires runner revision echo and records expected case counts', async () => {
 const { verificationDigest } = await import('../src/lib/server/verification.ts');
 const admission = {status:'passed',configurationDigest:'1'.repeat(64),codeDigest:'2'.repeat(64),environmentDigest:'3'.repeat(64)};
 const exactRevision={commitSha:'a'.repeat(40),treeSha:'b'.repeat(40),commitObject:'Y29tbWl0'};
 const files=[{path:'caller.py',content:context.files[0].replacement,blobSha:'d'.repeat(40),mode:'100644' as const}];
 let tamper=false;
 const runner=createVerification({url:'https://runner.example',token:'secret',manifest,fetcher:async (_url,options)=>{
  if(options?.method==='GET') return Response.json(admission);
  const request=JSON.parse(options!.body as string), check=request.checks[0];
  assert.deepEqual(request.revision,exactRevision); assert.deepEqual(request.files,files);
  const {cases,...definition}=check;
  const binding={id:check.id,definitionDigest:verificationDigest(definition),oracleDigest:verificationDigest(cases),dependencyDigest:verificationDigest(files.map(({path,blobSha})=>({path,blobSha}))),environmentDigest:admission.environmentDigest};
  return Response.json({identity:request.identity,revision:tamper?{...exactRevision,treeSha:'c'.repeat(40)}:exactRevision,admission,checks:[binding],executions:[{...binding,id:'run',checkId:check.id,collector:'trusted_runner',runnerId:'runner',prId:null,status:'completed',result:'passed',exitCode:0,executedTests:1}]});
 }});
 const input={...context,exact:{revision:exactRevision,files}};
 const evidence=await runner.run(input,new AbortController().signal,async()=>{});
 assert.deepEqual(evidence.exactRevision,exactRevision); assert.deepEqual(evidence.expectedCases,{'caller-regression':1});
 tamper=true; await assert.rejects(runner.run(input,new AbortController().signal,async()=>{}));
});
