import { createHash, randomUUID } from 'node:crypto';
import { IntakeError } from './intake.ts';
import type { ReviewIdentity } from './review-records.ts';
import type { VerificationEvidence } from './verification.ts';

export type StoredVerification = { id: string; identity: ReviewIdentity; createdAt: string; result: VerificationEvidence; digest: string };
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new IntakeError(503, 'Stored verification artifacts are unavailable.');
const missing = () => new IntakeError(404, 'Candidate verification is unavailable or stale.');
const invalid = () => new IntakeError(400, 'Verification does not match the candidate revision or trusted collector.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 128): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hashFields = ['definitionDigest', 'environmentDigest', 'dependencyDigest', 'oracleDigest'] as const;
const identityFields = ['ownerId', 'itemId', 'candidateId', 'baseSha', 'candidateDigest', 'snapshotDigest', 'policyVersion'] as const;
function validIdentity(owner: string, value: ReviewIdentity) {
  if (!text(owner) || !object(value) || owner !== value.ownerId) throw missing();
  if (Object.keys(value).length !== identityFields.length || !uuid(value.itemId) || !uuid(value.candidateId)
    || typeof value.baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.baseSha)
    || !hash(value.candidateDigest) || !hash(value.snapshotDigest) || !text(value.policyVersion)) throw invalid();
}
function references(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 256 && value.every(id => text(id)) && new Set(value).size === value.length;
}
function validateResult(result: VerificationEvidence) {
  if (!object(result) || Object.keys(result).some(key => !['checks', 'executions', 'admission', 'dispatchPlan'].includes(key))
    || !Array.isArray(result.checks) || !result.checks.length || result.checks.length > 32
    || !Array.isArray(result.executions) || !result.executions.length || result.executions.length > 32
    || !object(result.admission) || result.admission.status !== 'passed'
    || !hash(result.admission.configurationDigest) || !hash(result.admission.codeDigest) || !hash(result.admission.environmentDigest)) throw invalid();
  const ids = new Set<string>();
  for (const check of result.checks) {
    if (!object(check) || !text(check.id) || ids.has(check.id) || typeof check.mandatory !== 'boolean'
      || !['unknown', 'critical', 'high', 'medium', 'low'].includes(check.impact)
      || !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 3_600_000
      || !['trusted_policy', 'trusted_repository', 'owner_defined'].includes(check.provenance)
      || hashFields.some(key => !hash(check[key])) || check.environmentDigest !== result.admission.environmentDigest
      || !references(check.requirementIds) || !check.requirementIds.length || !references(check.nodeIds)) throw invalid();
    ids.add(check.id);
  }
  const executions = new Set<string>();
  const executedChecks = new Set<string>();
  for (const execution of result.executions) {
    const check = result.checks.find(check => check.id === execution?.checkId);
    if (!object(execution) || !text(execution.id) || executions.has(execution.id) || !check || executedChecks.has(execution.checkId)
      || execution.collector !== 'trusted_runner' || !text(execution.runnerId) || execution.prId !== null && !text(execution.prId)
      || hashFields.some(key => execution[key] !== check[key])
      || !['completed', 'timed_out', 'cancelled', 'infrastructure_error'].includes(execution.status)
      || !['passed', 'failed', 'inconclusive'].includes(execution.result)
      || !Number.isSafeInteger(execution.executedTests) || execution.executedTests < 0 || execution.executedTests > 65536
      || execution.exitCode !== null && (!Number.isSafeInteger(execution.exitCode) || Math.abs(execution.exitCode) > 255)
      || execution.result === 'passed' && (execution.status !== 'completed' || execution.executedTests < 1 || execution.exitCode !== 0)
      || execution.status !== 'completed' && execution.result !== 'inconclusive') throw invalid();
    executions.add(execution.id); executedChecks.add(execution.checkId);
  }
  if (result.dispatchPlan !== undefined && (!object(result.dispatchPlan)
    || !['mandatory', 'selected', 'omitted'].every(key => Array.isArray(result.dispatchPlan?.[key as 'mandatory'])
      && result.dispatchPlan[key as 'mandatory'].length <= 256))) throw invalid();
}
export function createVerificationRecords(database: Database, clock = () => new Date()) {
  async function query(sql: string, values: unknown[]) {
    try { return await database.query(sql, values); } catch { throw unavailable(); }
  }
  return {
    async append(owner: string, identity: ReviewIdentity, result: VerificationEvidence): Promise<StoredVerification> {
      validIdentity(owner, identity);
      const frozenIdentity = { ...identity };
      let body: string;
      let frozen: VerificationEvidence;
      try { body = JSON.stringify(result); frozen = JSON.parse(body); } catch { throw invalid(); }
      if (Buffer.byteLength(body) > 512 * 1024) throw new IntakeError(413, 'Verification artifact exceeds the storage limit.');
      validateResult(frozen);
      const now = clock();
      const artifact = { id: randomUUID(), identity: frozenIdentity, createdAt: now.toISOString(), body, digest: digest(body) };
      const appended = `jsonb_set(p.payload,'{verifications}',COALESCE(p.payload->'verifications','[]'::jsonb) || $7::jsonb)`;
      const rows = await query(`UPDATE tripsit_candidate_payloads p SET payload=${appended}
        FROM tripsit_candidates c,tripsit_work_items w,tripsit_snapshots s
        WHERE p.candidate_id=c.id AND p.work_item_id=w.id AND s.work_item_id=w.id
          AND c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3
          AND c.expires_at>$6 AND w.expires_at>$6 AND c.expires_at=w.expires_at AND s.payload->'private'='false'::jsonb
          AND p.payload->>'baseSha'=$4 AND s.payload->>'baseSha'=$4 AND p.payload->>'outputDigest'=$5 AND c.output_digest=$5
          AND jsonb_typeof(COALESCE(p.payload->'verifications','[]'::jsonb))='array'
          AND jsonb_array_length(COALESCE(p.payload->'verifications','[]'::jsonb))<4
          AND octet_length((${appended})::text)<=4194304 RETURNING c.id`,
      [owner, frozenIdentity.itemId, frozenIdentity.candidateId, frozenIdentity.baseSha, frozenIdentity.candidateDigest, now, JSON.stringify(artifact)]);
      if (!rows.rows.length) throw missing();
      return { id: artifact.id, identity: frozenIdentity, createdAt: artifact.createdAt, result: frozen, digest: artifact.digest };
    },
    async list(owner: string, identity: ReviewIdentity): Promise<StoredVerification[]> {
      validIdentity(owner, identity);
      const rows = await query(`SELECT p.payload->'verifications' AS verifications,octet_length(p.payload::text) AS payload_bytes FROM tripsit_candidate_payloads p
        JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
        JOIN tripsit_snapshots s ON s.work_item_id=w.id WHERE c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3
          AND c.expires_at>$6 AND w.expires_at>$6 AND c.expires_at=w.expires_at AND s.payload->'private'='false'::jsonb
          AND p.payload->>'baseSha'=$4 AND s.payload->>'baseSha'=$4 AND p.payload->>'outputDigest'=$5 AND c.output_digest=$5`,
      [owner, identity.itemId, identity.candidateId, identity.baseSha, identity.candidateDigest, clock()]);
      if (!rows.rows.length) throw missing();
      try {
        const verifications = rows.rows[0].verifications ?? [];
        const size = rows.rows[0].payload_bytes;
        if (!Array.isArray(verifications) || verifications.length > 4 || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 4_194_304) throw unavailable();
        const ids = new Set<string>();
        return verifications.map(artifact => {
          if (!object(artifact) || !uuid(artifact.id) || ids.has(artifact.id as string) || typeof artifact.createdAt !== 'string' || !Number.isFinite(Date.parse(artifact.createdAt))
            || typeof artifact.body !== 'string' || Buffer.byteLength(artifact.body) > 512 * 1024 || digest(artifact.body) !== artifact.digest
            || !object(artifact.identity)) throw unavailable();
          const storedIdentity = artifact.identity as ReviewIdentity;
          validIdentity(owner, storedIdentity);
          if (['ownerId', 'itemId', 'candidateId', 'baseSha', 'candidateDigest'].some(key => storedIdentity[key as keyof ReviewIdentity] !== identity[key as keyof ReviewIdentity])) throw unavailable();
          const result = JSON.parse(artifact.body) as VerificationEvidence;
          validateResult(result); ids.add(artifact.id as string);
          return { id: artifact.id as string, identity: { ...storedIdentity }, createdAt: artifact.createdAt, result, digest: artifact.digest as string };
        });
      } catch { throw unavailable(); }
    }
  };
}
