import { createHash, randomUUID } from 'node:crypto';
import { IntakeError } from './intake.ts';
import type { GeneratedCandidate, StoredCandidate } from './generation.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
const unavailable = () => new IntakeError(503, 'Candidate storage is unavailable; verify migration 002_candidates.sql.');
const missing = () => new IntakeError(404, 'Candidate snapshot is unavailable or stale.');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function serialize(candidate: GeneratedCandidate): string {
  if (!candidate || !/^[a-f0-9]{40}$/.test(candidate.baseSha)
      || !Number.isFinite(Date.parse(candidate.expiresAt))
      || !(candidate.rawOutput instanceof Uint8Array) || candidate.rawOutput.byteLength === 0 || candidate.rawOutput.byteLength > 1_048_576
      || candidate.outputDigest !== sha(candidate.rawOutput) || !text(candidate.model, 128)
      || !candidate.settings || typeof candidate.settings !== 'object' || Array.isArray(candidate.settings)
      || Object.values(candidate.settings).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)
        || typeof value === 'number' && !Number.isFinite(value))
      || JSON.stringify(candidate.settings).length > 4096
      || candidate.mapping?.status !== 'unavailable' || !text(candidate.mapping.reason, 1024)
      || !Array.isArray(candidate.files) || candidate.files.length === 0 || candidate.files.length > 32) {
    throw new IntakeError(400, 'Candidate storage input is invalid.');
  }
  const files = candidate.files.map(file => {
    if (!file || !text(file.path, 1024) || (file.originalBlob !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.originalBlob))
        || !(file.content instanceof Uint8Array) || file.content.byteLength > 1_048_576
        || file.blobSha !== createHash('sha1').update(`blob ${file.content.byteLength}\0`).update(file.content).digest('hex')) {
      throw new IntakeError(400, 'Candidate storage input is invalid.');
    }
    return { path: file.path, originalBlob: file.originalBlob, blobSha: file.blobSha, content: Buffer.from(file.content).toString('base64') };
  });
  const payload = JSON.stringify({ baseSha: candidate.baseSha, expiresAt: candidate.expiresAt,
    outputDigest: candidate.outputDigest, model: candidate.model, settings: candidate.settings,
    mapping: { status: candidate.mapping.status, reason: candidate.mapping.reason },
    rawOutput: Buffer.from(candidate.rawOutput).toString('base64'), files });
  if (Buffer.byteLength(payload) > 4_194_304) throw new IntakeError(400, 'Candidate storage input exceeds the limit.');
  return payload;
}

function deserialize(value: unknown): GeneratedCandidate {
  try {
    const payload = value as Omit<GeneratedCandidate, 'rawOutput' | 'files'> & {
      rawOutput: string; files: Array<Omit<GeneratedCandidate['files'][number], 'content'> & { content: string }>;
    };
    const bytes = (encoded: string) => {
      if (typeof encoded !== 'string' || encoded.length > 1_398_104) throw unavailable();
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.toString('base64') !== encoded) throw unavailable();
      return Uint8Array.from(decoded);
    };
    const candidate = { ...payload, rawOutput: bytes(payload.rawOutput),
      files: payload.files.map(file => ({ ...file, content: bytes(file.content) })) };
    // Revalidate persisted structure and integrity before releasing raw bytes.
    serialize(candidate);
    return candidate;
  } catch { throw unavailable(); }
}

export function createCandidateRecords(database: Database, clock = () => new Date()) {
  async function query(sql: string, values?: unknown[]) {
    try { return await database.query(sql, values); }
    catch { throw unavailable(); }
  }
  function signedIn(owner: string) { if (!owner) throw new IntakeError(401, 'Sign in before accessing candidates.'); }
  return {
    async ready(): Promise<void> {
      const result = await query("SELECT to_regclass('tripsit_candidates') IS NOT NULL AND to_regclass('tripsit_candidate_payloads') IS NOT NULL AS ready");
      if (result.rows[0]?.ready !== true) throw unavailable();
    },
    async create(owner: string, itemId: string, candidate: GeneratedCandidate): Promise<StoredCandidate> {
      signedIn(owner);
      const payload = serialize(candidate);
      const frozen = deserialize(JSON.parse(payload));
      const now = clock();
      if (Date.parse(frozen.expiresAt) <= now.getTime()) throw missing();
      const result = await query(`WITH authorized AS (
        SELECT w.id FROM tripsit_work_items w JOIN tripsit_snapshots s ON s.work_item_id=w.id
        WHERE w.owner_id=$1 AND w.id=$2 AND w.expires_at=$5::timestamptz AND w.expires_at>$6
          AND s.payload->>'baseSha'=$4 AND s.payload->'private'='false'::jsonb
        FOR SHARE OF w,s
      ), inserted AS (
        INSERT INTO tripsit_candidates(id,owner_id,output_digest,created_at,expires_at)
        SELECT $3::uuid,$1,$7,$6,$5 FROM authorized RETURNING id
      ) INSERT INTO tripsit_candidate_payloads(candidate_id,work_item_id,payload)
        SELECT id,$2,$8::jsonb FROM inserted RETURNING candidate_id AS id`,
      [owner, itemId, randomUUID(), frozen.baseSha, frozen.expiresAt, now, frozen.outputDigest, payload]);
      if (!result.rows[0] || Date.parse(frozen.expiresAt) <= clock().getTime()) throw missing();
      return { id: String(result.rows[0].id), candidate: frozen };
    },
    async get(owner: string, itemId: string, id: string): Promise<StoredCandidate | null> {
      signedIn(owner);
      const result = await query(`SELECT c.id,p.payload FROM tripsit_candidates c
        JOIN tripsit_candidate_payloads p ON p.candidate_id=c.id
        JOIN tripsit_work_items w ON w.id=p.work_item_id
        JOIN tripsit_snapshots s ON s.work_item_id=w.id
        WHERE c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3
          AND c.expires_at>$4 AND w.expires_at>$4 AND c.expires_at=w.expires_at
          AND s.payload->'private'='false'::jsonb AND s.payload->>'baseSha'=p.payload->>'baseSha'`,
      [owner, itemId, id, clock()]);
      if (!result.rows[0]) return null;
      const candidate = deserialize(result.rows[0].payload);
      if (Date.parse(candidate.expiresAt) <= clock().getTime()) return null;
      return { id: String(result.rows[0].id), candidate };
    }
  };
}
