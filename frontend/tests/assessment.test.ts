import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAssessment, type AssessmentDependencies } from '../src/lib/server/assessment.ts';
import { IntakeError } from '../src/lib/server/intake.ts';
import type { WorkItem } from '../src/lib/server/records.ts';
import type { StoredCandidate } from '../src/lib/server/generation.ts';
import type { StoredReview } from '../src/lib/server/review-records.ts';
import { mapCandidateTokenBytes, generationSettingsDigest } from '../src/lib/server/candidate-output.ts';
const itemId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const encode = (content: string) => new TextEncoder().encode(content);
const sha = (content: string) => createHash('sha1').update(`blob ${encode(content).length}\0`).update(encode(content)).digest('hex');
function fixture() {
  const item: WorkItem = { id: itemId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), snapshot: { repositoryId: 1, repository: 'team/repo', private: false, issueNumber: 2, issueId: 3, baseSha: 'a'.repeat(40), supplied: { title: 'Change a', body: 'Issue text', provenance: 'supplied' }, inferred: [], ownerConfirmed: [] } };
  const original = 'export const a=1;'; const replacement = 'export const a=2;\r\n// é😀';
  const sources = new Map([['a.ts', original], ['b.ts', "import './a';"], ['c.ts', "export * from './b';"]]);
  const candidate: StoredCandidate = { id: candidateId, candidate: { baseSha: item.snapshot.baseSha, expiresAt: item.expiresAt, outputDigest: 'b'.repeat(64), model: 'SECRET_CONFIDENCE', settings: {}, rawOutput: encode('SECRET_CONFIDENCE'), mapping: { status: 'unavailable', reason: 'SECRET_CONFIDENCE' }, observations: { status: 'observed', tokens: [{ token: 'SECRET_CONFIDENCE', bytes: [], logprob: -1 }] }, files: [{ path: 'a.ts', originalBlob: sha(original), blobSha: sha(replacement), content: encode(replacement) }] } };
  const calls = { intake: 0, generation: 0, context: 0, reviewer: 0, append: 0 };
  const artifacts: StoredReview[] = [];
  const deps: AssessmentDependencies = {
    intake: { async get(owner) { calls.intake++; if (owner !== 'owner') throw new IntakeError(404, 'secret owner data'); return structuredClone(item); } },
    generation: { async get(owner) { calls.generation++; if (owner !== 'owner') throw new IntakeError(404, 'secret candidate data'); return structuredClone(candidate); } },
    github: {
      async reviewerVisibility() { return false; },
      async files() { return [...sources].map(([path, content]) => ({ path, blobSha: sha(content) })); },
      async context(_snapshot, paths) { calls.context++; assert(paths.length <= 8); return paths.map(path => ({ path, originalBlob: sources.has(path) ? sha(sources.get(path)!) : null, content: sources.get(path) ?? '' })); }
    },
    reviews: {
      async append(_owner, identity, result) { calls.append++; const stored = { id: String(calls.append), identity, createdAt: new Date().toISOString(), result, digest: 'c'.repeat(64) }; artifacts.push(stored); return stored; },
      async list() { return structuredClone(artifacts); }
    },
    reviewer: { async review(input) { calls.reviewer++; assert(!JSON.stringify(input).includes('SECRET_CONFIDENCE')); assert.deepEqual(Object.keys(input).sort(), ['baseSha','candidateDigest','files','issue','nodes','private','requirements'].sort()); return { status: 'unavailable', reason: 'Not configured.' }; } }
  };
  return { item, candidate, sources, deps, calls, artifacts, service: createAssessment(deps), signal: new AbortController().signal };
}

test('loads real unchanged caller impact, policy, scoped reviews and exact source provenance', async () => {
  const f = fixture(); const assessment = await f.service.load('owner', itemId, candidateId, f.signal);
  assert.equal(assessment.identity.ownerId, 'owner'); assert.equal(assessment.identity.candidateDigest, 'b'.repeat(64));
  assert(assessment.policy.requirements.some(row => row.mandatory));
  assert(assessment.impact.impact.affected.some(row => row.node.source?.path === 'c.ts' && row.distance === 2));
  assert.equal(assessment.files.find(row => row.path === 'a.ts')?.replacement, 'export const a=2;\r\n// é😀');
  assert.equal(assessment.impact.coverage.complete, true);
  assert.deepEqual(assessment.reviews, []);
  assert.deepEqual(assessment.generation, { model: 'SECRET_CONFIDENCE', settingsDigest: createHash('sha256').update(JSON.stringify(f.candidate.candidate.settings)).digest('hex'), mapping: f.candidate.candidate.mapping, observedTokens: 1 });
});

test('settings identity is stable across JSONB key order', async () => {
  const f = fixture();
  f.candidate.candidate.settings = { z: 1, a: true };
  const first = await f.service.load('owner', itemId, candidateId, f.signal);
  f.candidate.candidate.settings = { a: true, z: 1 };
  const second = await f.service.load('owner', itemId, candidateId, f.signal);
  assert.equal(first.generation.settingsDigest, second.generation.settingsDigest);
});

test('denies invalid IDs, unauthorized owners, malformed and expired snapshots before context/reviewer', async () => {
  for (const mode of ['id', 'owner', 'malformed', 'expired']) {
    const f = fixture(); if (mode === 'malformed') f.item.snapshot.private = undefined as unknown as boolean; if (mode === 'expired') f.item.expiresAt = new Date(0).toISOString();
    await assert.rejects(() => f.service.review(mode === 'owner' ? 'other' : 'owner', mode === 'id' ? 'bad' : itemId, candidateId, f.signal), (error: Error) => !error.message.includes('secret'));
    assert.equal(f.calls.context, 0); assert.equal(f.calls.reviewer, 0); assert.equal(f.calls.append, 0);
  }
});

test('supports verified new files and refuses stale originals or unsafe/corrupt candidate bytes', async () => {
  const added = fixture(); added.candidate.candidate.files[0].path = 'new.ts'; added.candidate.candidate.files[0].originalBlob = null;
  const result = await added.service.load('owner', itemId, candidateId, added.signal);
  assert.equal(result.files.find(row => row.path === 'new.ts')?.original, null);
  for (const mode of ['stale', 'missing-original', 'unsafe', 'blob', 'unicode']) {
    const f = fixture(); const file = f.candidate.candidate.files[0];
    if (mode === 'stale') file.originalBlob = 'd'.repeat(40);
    if (mode === 'missing-original') file.originalBlob = null;
    if (mode === 'unsafe') file.path = '../outside';
    if (mode === 'blob') file.blobSha = 'd'.repeat(40);
    if (mode === 'unicode') file.content = new Uint8Array([255]);
    await assert.rejects(() => f.service.load('owner', itemId, candidateId, f.signal));
    assert.equal(f.calls.reviewer, 0); assert.equal(f.calls.append, 0);
  }
});

test('optional oversized/unavailable context stays explicit, while access denials stop loading', async () => {
  for (const status of [413, 502, 403]) {
    const f = fixture(); const context = f.deps.github.context;
    f.deps.github.context = async (snapshot, paths, signal) => { if (!paths.includes('a.ts')) throw new IntakeError(status, 'secret context'); return context(snapshot, paths, signal); };
    if (status === 403) await assert.rejects(() => f.service.load('owner', itemId, candidateId, f.signal), { status: 403 });
    else { const result = await f.service.load('owner', itemId, candidateId, f.signal); assert.equal(result.impact.coverage.complete, false); assert(result.impact.gaps.some(gap => gap.kind === 'optional_context_unavailable')); }
  }
  const f = fixture(); f.sources.set('b.ts', 'x'.repeat(150_000));
  const result = await f.service.load('owner', itemId, candidateId, f.signal);
  assert.equal(result.impact.coverage.complete, false);
  assert(result.impact.gaps.some(gap => gap.kind === 'optional_context_limit'));
});

test('essential combined source limit fails closed instead of truncating', async () => {
  const f = fixture(); const text = 'x'.repeat(140_000); f.sources.set('a.ts', text);
  f.candidate.candidate.files[0] = { path: 'a.ts', originalBlob: sha(text), blobSha: sha(text), content: encode(text) };
  await assert.rejects(() => f.service.load('owner', itemId, candidateId, f.signal), { status: 413 });
  assert.equal(f.calls.reviewer, 0);
});

test('revocation during context or reviewer and stale reviewer output cannot append artifacts', async () => {
  for (const mode of ['context-private', 'review-private', 'candidate-stale', 'review-stale']) {
    const f = fixture();
    if (mode === 'context-private') { const context = f.deps.github.context; f.deps.github.context = async (...args) => { const result = await context(...args); f.item.snapshot.private = true; return result; }; }
    else f.deps.reviewer.review = async () => { f.calls.reviewer++; if (mode === 'review-private') f.item.snapshot.private = true; if (mode === 'candidate-stale') f.candidate.candidate.outputDigest = 'd'.repeat(64); return mode === 'review-stale' ? { status: 'completed', baseSha: 'd'.repeat(40), candidateDigest: 'b'.repeat(64), model: 'reviewer', destination: 'https://review.example', retentionDisclosure: 'none', promptDigest: 'e'.repeat(64), responseDigest: 'f'.repeat(64), claims: [], checks: [] } : { status: 'unavailable', reason: 'Not configured.' }; };
    await assert.rejects(() => f.service.review('owner', itemId, candidateId, f.signal));
    assert.equal(f.calls.append, 0);
    if (mode === 'context-private') assert.equal(f.calls.reviewer, 0);
  }
});

test('review dispatch excludes generation signals and retains prior conflicting/unavailable artifacts', async () => {
  const f = fixture();
  const first = await f.service.review('owner', itemId, candidateId, f.signal);
  assert.equal(first.result.status, 'unavailable');
  for (const stance of ['supports', 'contradicts'] as const) {
    f.deps.reviewer.review = async input => {
      f.calls.reviewer++;
      assert(!JSON.stringify(input).includes('SECRET_CONFIDENCE'));
      return { status: 'completed', baseSha: input.baseSha, candidateDigest: input.candidateDigest, model: 'independent',
        destination: 'https://review.example', retentionDisclosure: 'No retention.', promptDigest: 'd'.repeat(64), responseDigest: 'e'.repeat(64),
        claims: [{ id: 'C1', requirementIds: [input.requirements[0].id], nodeIds: [], statement: 'Conflicting proposal.', stance, counterexample: stance === 'contradicts' ? 'Counterexample proposal.' : null }], checks: [] };
    };
    await f.service.review('owner', itemId, candidateId, f.signal);
  }
  const loaded = await f.service.load('owner', itemId, candidateId, f.signal);
  assert.equal(loaded.reviews.length, 3); assert.equal(f.calls.reviewer, 3);
  assert.deepEqual(loaded.reviews.map(review => review.result.status === 'completed' ? review.result.claims[0].stance : review.result.status), ['unavailable', 'supports', 'contradicts']);
});

test('cancellation bounds noncooperative source dependencies and never dispatches review', async () => {
  const f = fixture(); const controller = new AbortController();
  f.deps.github.context = async () => { controller.abort(); return new Promise(() => {}); };
  await assert.rejects(() => f.service.review('owner', itemId, candidateId, controller.signal), { status: 504 });
  assert.equal(f.calls.reviewer, 0); assert.equal(f.calls.append, 0);
});

test('full immutable artifact capacity refuses reviewer cost before dispatch', async () => {
  const f = fixture();
  const assessment = await f.service.load('owner', itemId, candidateId, f.signal);
  for (let index = 0; index < 8; index++) f.artifacts.push({ id: String(index), identity: assessment.identity, createdAt: new Date().toISOString(), digest: 'c'.repeat(64), result: { status: 'unavailable', reason: 'Earlier attempt.' } });
  await assert.rejects(() => f.service.review('owner', itemId, candidateId, f.signal), { status: 429 });
  assert.equal(f.calls.reviewer, 0); assert.equal(f.calls.append, 0);
});

test('verification rechecks revision after remote execution and never persists stale or unauthorized results', async () => {
 const f=fixture(); let ran=0; let saved=0;
 f.deps.verificationRecords={async list(){return[];},async append(){saved++;throw new Error('must not append');}};
 f.deps.verification={async run(context){ran++;assert.equal(context.repositoryId,1);assert(context.files.some(file=>file.path==='b.ts'));f.candidate.candidate.outputDigest='e'.repeat(64);return{checks:[],executions:[],admission:{status:'passed',configurationDigest:'1'.repeat(64),codeDigest:'2'.repeat(64),environmentDigest:'3'.repeat(64)}};}};
 await assert.rejects(f.service.verify('owner',itemId,candidateId,f.signal),{status:409});assert.equal(ran,1);assert.equal(saved,0);
 await assert.rejects(f.service.verify('other',itemId,candidateId,f.signal),{status:404});assert.equal(ran,1);
});

test('verification context carries revision-bound token mapping and candidate node sources', async () => {
 const f = fixture(); const candidate = f.candidate.candidate;
 const raw = encode(JSON.stringify({files:[{path:'a.ts',originalBlob:candidate.files[0].originalBlob,content:new TextDecoder().decode(candidate.files[0].content)}]}));
 const tokens = Array.from(raw, byte => ({token:'x',bytes:[byte],logprob:-1}));
 const observations = {status:'observed' as const,tokens};
 const mapped = mapCandidateTokenBytes(raw,new Map([['a.ts',candidate.files[0].originalBlob]]),tokens,candidate.model,generationSettingsDigest(candidate.settings));
 assert.equal(mapped.status,'exact'); if(mapped.status !== 'exact') return;
 candidate.rawOutput=raw; candidate.outputDigest=mapped.outputDigest; candidate.observations=observations;
 candidate.tokenByteMapping={...mapped,mode:'direct',observationsDigest:createHash('sha256').update(JSON.stringify(observations)).digest('hex')};
 f.deps.verificationRecords={async list(){return[];},async append(){throw new Error('fixture stop');}};
 f.deps.verification={async run(context){assert.equal(context.tokenSignal?.mapping.outputDigest,context.identity.candidateDigest);assert(context.nodes.some(node=>node.kind==='file' && node.source?.revision==='candidate' && node.source.blobSha===mapped.files[0].blobSha));throw new Error('fixture stop');}};
 await assert.rejects(f.service.verify('owner',itemId,candidateId,f.signal));
});

test('review allows authorized private repositories and denies malformed visibility or revoked access', async () => {
 for (const mode of ['snapshot-private', 'current-private', 'malformed', 'revoked']) {
  const f = fixture();
  if (mode === 'snapshot-private') f.item.snapshot.private = true;
  f.deps.github.reviewerVisibility = async () => {
   if (mode === 'revoked') throw new IntakeError(403, 'Access revoked.');
   return mode === 'malformed' ? undefined as unknown as boolean : mode === 'current-private';
  };
  if (mode === 'malformed' || mode === 'revoked') {
   await assert.rejects(() => f.service.review('owner', itemId, candidateId, f.signal));
   assert.equal(f.calls.reviewer, 0); assert.equal(f.calls.append, 0);
  } else {
   f.deps.reviewer.review = async input => { f.calls.reviewer++; assert.equal(input.private, true); return {status:'unavailable',reason:'Fixture.'}; };
   await f.service.review('owner', itemId, candidateId, f.signal);
   assert.equal(f.calls.reviewer, 1); assert.equal(f.calls.append, 1);
  }
 }
});

test('private repositories reach an admitted runner only with current access', async () => {
  for (const mode of ['private', 'changed', 'denied', 'invalid']) {
    const f = fixture(); let ran = 0;
    if (mode === 'private') f.item.snapshot.private = true;
    f.deps.github.reviewerVisibility = async () => {
      if (mode === 'denied') throw new IntakeError(403, 'revoked');
      return mode === 'changed' ? true : mode === 'invalid' ? undefined as unknown as boolean : false;
    };
    f.deps.verification = { async run() { ran++; throw new Error('unexpected'); } };
    f.deps.verificationRecords = { async list() { return []; }, async append() { throw new Error('unexpected'); } };
    await assert.rejects(() => f.service.verify('owner', itemId, candidateId, f.signal));
    assert.equal(ran, ['private', 'changed'].includes(mode) ? 1 : 0);
  }
});
