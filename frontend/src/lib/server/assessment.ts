import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { IntakeError, whileActive, type IssueSnapshot } from './intake.ts';
import type { WorkItem } from './records.ts';
import type { StoredCandidate, GenerationContext } from './generation.ts';
import { generationSettingsDigest } from './candidate-output.ts';
import { buildImpact, type ImpactFile } from './impact-extractor.ts';
import { snapshotPolicy } from './snapshot-policy.ts';
import type { ReviewIdentity, StoredReview } from './review-records.ts';
import type { ReviewerInput, ReviewerResult } from './reviewer.ts';
import type { VerificationContext, VerificationEvidence } from './verification.ts';
import type { StoredVerification } from './verification-records.ts';

export type Assessment = {
  identity: ReviewIdentity;
  repositoryId: number;
  repositoryPrivate?: boolean;
  verifications?: StoredVerification[];
  generation: { model: string; settingsDigest: string; mapping: { status: 'unavailable'; reason: string }; observedTokens: number };
  policy: ReturnType<typeof snapshotPolicy>['policy'];
  impact: ReturnType<typeof buildImpact>;
  reviews: StoredReview[];
  files: Array<{ path: string; original: string | null; replacement: string }>;
};
export type AssessmentDependencies = {
  intake: { get(owner: string, itemId: string, signal: AbortSignal): Promise<WorkItem> };
  generation: { get(owner: string, itemId: string, candidateId: string, signal: AbortSignal): Promise<StoredCandidate> };
  github: {
    reviewerVisibility(repository: string, repositoryId: number, signal: AbortSignal): Promise<boolean>;
    files(snapshot: IssueSnapshot, signal: AbortSignal): Promise<Array<{ path: string; blobSha: string }>>;
    context(snapshot: IssueSnapshot, paths: string[], signal: AbortSignal): Promise<GenerationContext[]>;
  };
  reviews: {
    list(owner: string, identity: ReviewIdentity): Promise<StoredReview[]>;
    append(owner: string, identity: ReviewIdentity, result: ReviewerResult): Promise<StoredReview>;
  };
  reviewer: { review(input: ReviewerInput, signal: AbortSignal): Promise<ReviewerResult> };
  verification?: { run(input: VerificationContext, signal: AbortSignal, authorize: () => Promise<void>): Promise<VerificationEvidence> };
  verificationRecords?: { list(owner: string, identity: ReviewIdentity): Promise<StoredVerification[]>; append(owner: string, identity: ReviewIdentity, result: VerificationEvidence): Promise<StoredVerification> };
};
class AssessmentError extends IntakeError {}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const blob = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function fail(status = 502): never { throw new AssessmentError(status, 'Assessment is unavailable, invalid or stale.'); }
function pathValid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && encoder.encode(value).byteLength <= 1024
    && decoder.decode(encoder.encode(value)) === value && value === posix.normalize(value) && !value.startsWith('/')
    && !/[\\:\u0000-\u001f\u007f]/u.test(value) && !value.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git');
}
function gitBlob(bytes: Uint8Array) { return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'); }

export function createAssessment(dependencies: AssessmentDependencies) {
  async function bounded<T>(owner: string, itemId: string, candidateId: string, signal: AbortSignal, action: (active: AbortSignal) => Promise<T>, timeoutMs = 90_000): Promise<T> {
    if (!owner) fail(401);
    if (!uuid(itemId) || !uuid(candidateId)) fail(404);
    const active = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try { return await whileActive(() => action(active), active); }
    catch (error) {
      if (error instanceof AssessmentError) throw error;
      const status = active.aborted ? 504 : error instanceof IntakeError && [400,401,403,404,409,410,413,429,502,503,504].includes(error.status) ? error.status : 502;
      fail(status);
    }
  }
  async function admit(owner: string, itemId: string, candidateId: string, signal: AbortSignal) {
    const item = structuredClone(await whileActive(() => dependencies.intake.get(owner, itemId, signal), signal));
    if (item.id !== itemId || typeof item.snapshot.private !== 'boolean') fail(403);
    if (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now()) fail(410);
    const stored = structuredClone(await whileActive(() => dependencies.generation.get(owner, itemId, candidateId, signal), signal));
    if (stored.id !== candidateId || stored.candidate.baseSha !== item.snapshot.baseSha || stored.candidate.expiresAt !== item.expiresAt) fail(409);
    const policy = snapshotPolicy(item);
    if (!blob(item.snapshot.baseSha) || !/^[a-f0-9]{64}$/u.test(stored.candidate.outputDigest)
      || !Array.isArray(stored.candidate.files) || !stored.candidate.files.length || stored.candidate.files.length > 24) fail();
    const paths = new Set<string>();
    for (const file of stored.candidate.files) {
      if (!file || !pathValid(file.path) || paths.has(file.path) || !(file.content instanceof Uint8Array)
        || file.content.byteLength > 262_144 || file.blobSha !== gitBlob(file.content)
        || file.originalBlob !== null && !blob(file.originalBlob)) fail();
      decoder.decode(file.content); paths.add(file.path);
    }
    const identity: ReviewIdentity = { ownerId: owner, itemId, candidateId, baseSha: item.snapshot.baseSha,
      candidateDigest: stored.candidate.outputDigest, snapshotDigest: policy.snapshotDigest, policyVersion: policy.policy.version };
    const generation: Assessment['generation'] = { model: stored.candidate.model, settingsDigest: generationSettingsDigest(stored.candidate.settings), mapping: { ...stored.candidate.mapping }, observedTokens: stored.candidate.observations?.tokens.length ?? 0 };
    const stamp = JSON.stringify([identity, generation, item.expiresAt, stored.candidate.files.map(file => [file.path, file.originalBlob, file.blobSha])]);
    return { item, stored, identity, generation, stamp, policy: policy.policy };
  }
  async function fresh(owner: string, itemId: string, candidateId: string, stamp: string, signal: AbortSignal) {
    if ((await admit(owner, itemId, candidateId, signal)).stamp !== stamp) fail(409);
  }
  async function load(owner: string, itemId: string, candidateId: string, signal: AbortSignal): Promise<{ assessment: Assessment; stamp: string; issue: ReviewerInput['issue'] }> {
    const initial = await admit(owner, itemId, candidateId, signal);
    const tree = await whileActive(() => dependencies.github.files(initial.item.snapshot, signal), signal);
    if (!Array.isArray(tree) || tree.length > 4096) fail();
    const originals = new Map<string, string>();
    for (const file of tree) {
      if (!file || !pathValid(file.path) || !blob(file.blobSha) || originals.has(file.path)) fail();
      originals.set(file.path, file.blobSha);
    }
    const replacements = new Map(initial.stored.candidate.files.map(file => [file.path, file]));
    for (const [path, file] of replacements) if ((originals.get(path) ?? null) !== file.originalBlob) fail(409);
    const essential = [...replacements.keys()].sort(compare);
    const optional = [...originals.keys()].filter(path => !replacements.has(path)).sort(compare).slice(0, 24 - essential.length);
    const files: ImpactFile[] = [];
    const gaps: Assessment['impact']['gaps'] = [];
    let total = 0;
    async function acquire(paths: string[], required: boolean) {
      const context = await whileActive(() => dependencies.github.context(initial.item.snapshot, paths, signal), signal);
      if (!Array.isArray(context) || context.length !== paths.length) fail();
      const seen = new Set<string>();
      for (const row of context) {
        if (!row || !paths.includes(row.path) || seen.has(row.path) || typeof row.content !== 'string'
          || decoder.decode(encoder.encode(row.content)) !== row.content || row.originalBlob !== (originals.get(row.path) ?? null)
          || row.originalBlob !== null && gitBlob(encoder.encode(row.content)) !== row.originalBlob
          || row.originalBlob === null && row.content !== '') fail();
        seen.add(row.path);
      }
      for (const row of [...context].sort((a, b) => compare(a.path, b.path))) {
        const replacement = replacements.get(row.path);
        const content = replacement ? decoder.decode(replacement.content) : row.content;
        const cost = encoder.encode(row.content).byteLength + encoder.encode(content).byteLength;
        if (total + cost > 262_144) {
          if (required) fail(413);
          gaps.push({ kind: 'optional_context_limit', path: row.path, revision: 'base', detail: 'Optional context omitted to preserve the combined 256 KiB source limit.' }); continue;
        }
        total += cost;
        files.push({ path: row.path, base: row.originalBlob === null ? null : { blobSha: row.originalBlob, content: row.content }, candidate: { blobSha: replacement?.blobSha ?? row.originalBlob!, content } });
      }
    }
    for (let offset = 0; offset < essential.length; offset += 8) await acquire(essential.slice(offset, offset + 8), true);
    for (let offset = 0; offset < optional.length; offset += 8) {
      const batch = optional.slice(offset, offset + 8);
      try { await acquire(batch, false); }
      catch (error) {
        if (!(error instanceof IntakeError) || ![413,502].includes(error.status)) throw error;
        for (const path of batch) gaps.push({ kind: 'optional_context_unavailable', path, revision: 'base', detail: 'Optional source acquisition failed or exceeded its bound; unknown callers remain.' });
      }
    }
    if (originals.size > optional.length + [...replacements.keys()].filter(path => originals.has(path)).length) gaps.push({ kind: 'optional_context_limit', path: '', revision: 'base', detail: 'At most 24 essential and optional source files are acquired.' });
    const repositoryPaths = [...new Set([...originals.keys(), ...replacements.keys()])].sort(compare);
    const impact = buildImpact({ baseSha: initial.identity.baseSha, candidateDigest: initial.identity.candidateDigest, files, repositoryPaths, complete: true });
    impact.gaps.push(...gaps);
    impact.gaps.sort((a, b) => compare(a.kind, b.kind) || compare(a.path, b.path) || compare(a.revision ?? '', b.revision ?? ''));
    const reviews = await whileActive(() => dependencies.reviews.list(owner, initial.identity), signal);
    const verifications = dependencies.verificationRecords ? await whileActive(() => dependencies.verificationRecords!.list(owner, initial.identity), signal) : [];
    await fresh(owner, itemId, candidateId, initial.stamp, signal);
    return { stamp: initial.stamp, issue: { title: initial.item.snapshot.supplied.title, body: initial.item.snapshot.supplied.body }, assessment: { identity: initial.identity, repositoryId: initial.item.snapshot.repositoryId, repositoryPrivate: initial.item.snapshot.private, verifications, generation: initial.generation, policy: initial.policy, impact, reviews,
      files: files.map(file => ({ path: file.path, original: file.base?.content ?? null, replacement: file.candidate!.content })) } };
  }
  return {
    async load(owner: string, itemId: string, candidateId: string, signal: AbortSignal): Promise<Assessment> {
      return bounded(owner, itemId, candidateId, signal, async active => (await load(owner, itemId, candidateId, active)).assessment);
    },
    async verify(owner: string, itemId: string, candidateId: string, signal: AbortSignal): Promise<StoredVerification> {
      return bounded(owner, itemId, candidateId, signal, async active => {
        if (!dependencies.verification || !dependencies.verificationRecords) fail(503);
        const { assessment, stamp } = await load(owner, itemId, candidateId, active);
        if ((assessment.verifications?.length ?? 0) >= 4) fail(429);
        const authorize = async () => {
          const current = await admit(owner, itemId, candidateId, active);
          if (current.stamp !== stamp) fail(409);
          if (typeof await whileActive(() => dependencies.github.reviewerVisibility(current.item.snapshot.repository, current.item.snapshot.repositoryId, active), active) !== 'boolean')
            throw new AssessmentError(403, 'Repository access is unavailable or invalid.');
        };
        await authorize();
        const result = await whileActive(() => dependencies.verification!.run(verificationContext(assessment), active, authorize), active);
        await fresh(owner, itemId, candidateId, stamp, active);
        const stored = await whileActive(() => dependencies.verificationRecords!.append(owner, assessment.identity, result), active);
        await fresh(owner, itemId, candidateId, stamp, active);
        return stored;
      }, 1_200_000);
    },
    async review(owner: string, itemId: string, candidateId: string, signal: AbortSignal): Promise<StoredReview> {
      return bounded(owner, itemId, candidateId, signal, async active => {
        const { assessment, stamp, issue } = await load(owner, itemId, candidateId, active);
        if (assessment.reviews.length >= 8) fail(429);
        const current = await admit(owner, itemId, candidateId, active);
        if (current.stamp !== stamp) fail(409);
        const visibility = await whileActive(() => dependencies.github.reviewerVisibility(current.item.snapshot.repository, current.item.snapshot.repositoryId, active), active);
        if (typeof visibility !== 'boolean') throw new AssessmentError(403, 'Repository access is unavailable or invalid.');
        const input: ReviewerInput = { baseSha: assessment.identity.baseSha, candidateDigest: assessment.identity.candidateDigest, private: current.item.snapshot.private || visibility,
          requirements: assessment.policy.requirements.map(row => ({ id: row.id, criterion: row.criterion, provenance: row.provenance, mandatory: row.mandatory })),
          nodes: assessment.impact.graph.nodes.map(node => ({ id: node.id, path: node.source!.path })), files: assessment.files,
          issue };
        const result = await whileActive(() => dependencies.reviewer.review(input, active), active);
        await fresh(owner, itemId, candidateId, stamp, active);
        if (!result || !['unavailable','completed'].includes(result.status) || result.status === 'completed'
          && (result.baseSha !== assessment.identity.baseSha || result.candidateDigest !== assessment.identity.candidateDigest)) fail(409);
        const stored = await whileActive(() => dependencies.reviews.append(owner, assessment.identity, result), active);
        await fresh(owner, itemId, candidateId, stamp, active);
        return stored;
      });
    }
  };
}

export function verificationContext(assessment: Assessment): VerificationContext {
  const current = assessment.reviews.filter(review => Object.entries(assessment.identity).every(([key, value]) => review.identity[key as keyof ReviewIdentity] === value));
  const claims = current.flatMap(review => review.result.status === 'completed' ? review.result.claims : []);
  return { identity: assessment.identity, repositoryId: assessment.repositoryId, files: assessment.files,
    nodes: assessment.impact.graph.nodes.map(node => ({ id: node.id, path: node.source!.path })),
    requirements: assessment.policy.requirements, comparison: { model: assessment.generation.model, settingsDigest: assessment.generation.settingsDigest, revision: assessment.identity.candidateDigest },
    impactUnknown: true, disagreements: assessment.policy.requirements.filter(requirement =>
      claims.some(claim => claim.requirementIds.includes(requirement.id) && claim.stance === 'supports')
      && claims.some(claim => claim.requirementIds.includes(requirement.id) && claim.stance === 'contradicts')).map(requirement => requirement.id) };
}
