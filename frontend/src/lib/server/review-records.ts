import { createHash, randomUUID } from 'node:crypto';
import { IntakeError } from './intake.ts';
import type { ReviewerResult } from './reviewer.ts';

export type ReviewIdentity = { ownerId: string; itemId: string; candidateId: string; baseSha: string; candidateDigest: string; snapshotDigest: string; policyVersion: string };
export type StoredReview = { id: string; identity: ReviewIdentity; createdAt: string; result: ReviewerResult; digest: string };
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new IntakeError(503, 'Stored review artifacts are unavailable.');
const missing = () => new IntakeError(404, 'Candidate review is unavailable or stale.');
const uuid = (value: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function validIdentity(owner: string, value: ReviewIdentity) {
  if (!owner || owner !== value.ownerId) throw missing();
  if (!uuid(value.itemId) || !uuid(value.candidateId) || !/^[a-f0-9]{40}$/.test(value.baseSha)
    || !/^[a-f0-9]{64}$/.test(value.candidateDigest) || !/^[a-f0-9]{64}$/.test(value.snapshotDigest)
    || typeof value.policyVersion !== 'string' || !value.policyVersion || value.policyVersion.length > 128) {
    throw new IntakeError(400, 'Invalid review revision.');
  }
}
function validateResult(result: ReviewerResult, identity: ReviewIdentity) {
  if (!result || !['completed', 'unavailable'].includes(result.status)
    || result.status === 'completed' && (result.baseSha !== identity.baseSha || result.candidateDigest !== identity.candidateDigest)) {
    throw new IntakeError(400, 'Review does not match the candidate revision.');
  }
}
export function createReviewRecords(database: Database, clock = () => new Date()) {
  async function query(sql: string, values: unknown[]) {
    try { return await database.query(sql, values); }
    catch { throw unavailable(); }
  }
  return {
    async append(owner: string, identity: ReviewIdentity, result: ReviewerResult): Promise<StoredReview> {
      validIdentity(owner, identity); validateResult(result, identity);
      const body = JSON.stringify(result);
      if (Buffer.byteLength(body) > 256 * 1024) throw new IntakeError(413, 'Review artifact exceeds the storage limit.');
      const artifact = { id: randomUUID(), identity, createdAt: clock().toISOString(), body, digest: digest(body) };
      const rows = await query(`UPDATE tripsit_candidate_payloads p SET payload=jsonb_set(p.payload,'{reviews}',
          COALESCE(p.payload->'reviews','[]'::jsonb) || $7::jsonb)
        FROM tripsit_candidates c,tripsit_work_items w,tripsit_snapshots s
        WHERE p.candidate_id=c.id AND p.work_item_id=w.id AND s.work_item_id=w.id
          AND c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3
          AND c.expires_at>$6 AND w.expires_at>$6 AND s.payload->'private'='false'::jsonb
          AND p.payload->>'baseSha'=$4 AND s.payload->>'baseSha'=$4 AND p.payload->>'outputDigest'=$5
          AND jsonb_typeof(COALESCE(p.payload->'reviews','[]'::jsonb))='array'
          AND jsonb_array_length(COALESCE(p.payload->'reviews','[]'::jsonb))<8 RETURNING c.id`,
      [owner, identity.itemId, identity.candidateId, identity.baseSha, identity.candidateDigest, clock(), JSON.stringify(artifact)]);
      if (!rows.rows.length) throw missing();
      return { id: artifact.id, identity: { ...identity }, createdAt: artifact.createdAt, result: structuredClone(result), digest: artifact.digest };
    },
    async list(owner: string, identity: ReviewIdentity): Promise<StoredReview[]> {
      validIdentity(owner, identity);
      const rows = await query(`SELECT p.payload->'reviews' AS reviews FROM tripsit_candidate_payloads p
        JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
        JOIN tripsit_snapshots s ON s.work_item_id=w.id WHERE c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3
          AND c.expires_at>$6 AND w.expires_at>$6 AND s.payload->'private'='false'::jsonb
          AND p.payload->>'baseSha'=$4 AND s.payload->>'baseSha'=$4 AND p.payload->>'outputDigest'=$5`,
      [owner, identity.itemId, identity.candidateId, identity.baseSha, identity.candidateDigest, clock()]);
      if (!rows.rows.length) throw missing();
      try {
        const reviews = rows.rows[0].reviews ?? [];
        if (!Array.isArray(reviews) || reviews.length > 8) throw unavailable();
        return reviews.map(artifact => {
          if (!artifact || !uuid(artifact.id) || !Number.isFinite(Date.parse(artifact.createdAt))
            || typeof artifact.body !== 'string' || Buffer.byteLength(artifact.body) > 256 * 1024 || digest(artifact.body) !== artifact.digest
            || ['ownerId', 'itemId', 'candidateId', 'baseSha', 'candidateDigest'].some(key => artifact.identity?.[key] !== identity[key as keyof ReviewIdentity])) throw unavailable();
          validIdentity(owner, artifact.identity);
          const result = JSON.parse(artifact.body) as ReviewerResult;
          validateResult(result, artifact.identity);
          return { id: artifact.id, identity: { ...artifact.identity }, createdAt: artifact.createdAt, result, digest: artifact.digest };
        });
      } catch { throw unavailable(); }
    }
  };
}
