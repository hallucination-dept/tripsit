import { createHash, randomUUID } from 'node:crypto';
import { IntakeError, whileActive } from './intake.ts';
import { snapshotPolicy } from './snapshot-policy.ts';
import type { WorkItem } from './records.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Dependencies = { database: Database; intake: { get(owner: string, item: string, signal: AbortSignal): Promise<WorkItem> } };
const invalid = () => new IntakeError(400, 'Provide an inspection, unchecked scope and residual risk for a revision or escalation.');
const stale = () => new IntakeError(409, 'Packet or evidence is stale; freeze a new packet.');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= 4096 && Buffer.from(v).toString('utf8') === v;
const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function createHumanDecision({ database, intake }: Dependencies) {
 async function query(sql: string, values: unknown[]) {
  try { return await database.query(sql, values); } catch { throw new IntakeError(503, 'Decision storage is unavailable.'); }
 }
 return {
  async list(owner: string, itemId: string, candidateId: string, packetId: string, signal: AbortSignal) {
   if (!owner) throw new IntakeError(401, 'Sign in before reading decisions.');
   if (![itemId, candidateId, packetId].every(uuid)) throw invalid();
   await whileActive(() => intake.get(owner, itemId, signal), signal);
   const result = await query(`SELECT d.id,d.decision,d.inspection,d.unchecked_scope,d.residual_risk,d.created_at
    FROM tripsit_human_decisions d JOIN tripsit_revision_packets r ON r.id=d.packet_id
    JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id JOIN tripsit_candidates c ON c.id=p.candidate_id
    JOIN tripsit_work_items w ON w.id=p.work_item_id
    WHERE d.packet_id=$4 AND c.id=$3 AND w.id=$2 AND d.owner_id=$1 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1
      AND d.expires_at>now() AND r.expires_at>now() AND c.expires_at>now() AND w.expires_at>now()
    ORDER BY d.created_at,d.id LIMIT 16`, [owner,itemId,candidateId,packetId]);
   await whileActive(() => intake.get(owner, itemId, signal), signal);
   return result.rows.map(row => ({ id: row.id, decision: row.decision, inspection: row.inspection,
    uncheckedScope: row.unchecked_scope, residualRisk: row.residual_risk, createdAt: row.created_at, historical: true as const }));
  },
  async record(owner: string, itemId: string, candidateId: string, packetId: string, input: unknown, signal: AbortSignal) {
   if (!owner) throw new IntakeError(401, 'Sign in before recording a decision.');
   if (![itemId, candidateId, packetId].every(uuid) || !input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
   const value = input as Record<string, unknown>;
   if (Object.keys(value).sort().join(',') !== 'decision,inspection,requestId,residualRisk,uncheckedScope' || !uuid(value.requestId)
    || !text(value.inspection) || !text(value.uncheckedScope) || !text(value.residualRisk)) throw invalid();
   if (value.decision === 'accept') throw new IntakeError(409, 'Acceptance is unavailable until required evidence and inspection are verified.');
   if (value.decision !== 'revise' && value.decision !== 'escalate') throw invalid();
   const item = await whileActive(() => intake.get(owner, itemId, signal), signal);
   const selected = await query(`SELECT p.payload,s.payload AS snapshot,r.body,r.packet_digest,r.source_digest,r.snapshot_digest,r.commit_sha,t.base_sha,t.output_digest
    FROM tripsit_revision_packets r JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id
    JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
    JOIN tripsit_snapshots s ON s.work_item_id=w.id JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
    WHERE r.id=$4 AND c.id=$3 AND w.id=$2 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1 AND t.owner_id=$1
      AND r.expires_at>now() AND c.expires_at>now() AND w.expires_at>now() AND t.expires_at>now()
      AND r.commit_sha=t.commit_sha AND t.base_sha=s.payload->>'baseSha' AND t.output_digest=c.output_digest`, [owner,itemId,candidateId,packetId]);
   const row = selected.rows[0];
   if (!row || typeof row.body !== 'string' || Buffer.byteLength(row.body)>2_097_152 || typeof row.packet_digest !== 'string'
     || digest(row.body)!==row.packet_digest || digest(canonical(row.payload))!==row.source_digest || digest(canonical(row.snapshot))!==row.snapshot_digest
     || canonical(item.snapshot)!==canonical(row.snapshot)) throw stale();
   let packet;
   try { packet=JSON.parse(row.body); } catch { throw stale(); }
   const policy=snapshotPolicy(item);
   if (!packet || packet.acceptanceReady!==false || packet.candidateCommit!==row.commit_sha || packet.identity?.ownerId!==owner
    || packet.identity?.itemId!==itemId || packet.identity?.candidateId!==candidateId || packet.identity?.baseSha!==item.snapshot.baseSha
    || packet.identity?.candidateDigest!==row.output_digest || row.base_sha!==item.snapshot.baseSha
    || packet.identity?.policyVersion!==policy.policy.version || packet.identity?.snapshotDigest!==policy.snapshotDigest) throw stale();
   await whileActive(() => intake.get(owner,itemId,signal),signal);
   const now=new Date(), id=randomUUID();
   const inserted = await query(`WITH locked AS (SELECT r.id,r.expires_at FROM tripsit_revision_packets r
    JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id JOIN tripsit_candidates c ON c.id=p.candidate_id
    JOIN tripsit_work_items w ON w.id=p.work_item_id JOIN tripsit_snapshots s ON s.work_item_id=w.id
    JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
    WHERE r.id=$4 AND c.id=$3 AND w.id=$2 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1 AND t.owner_id=$1
      AND r.expires_at>$11 AND c.expires_at>$11 AND w.expires_at>$11 AND t.expires_at>$11
      AND r.body=$5 AND r.packet_digest=$6 AND r.commit_sha=$7 AND t.commit_sha=$7
      AND t.base_sha=$17 AND t.output_digest=$18 AND c.output_digest=$18
      AND r.source_digest=$19 AND r.snapshot_digest=$20
      AND p.payload=$8::jsonb AND s.payload=$9::jsonb
    FOR UPDATE OF p FOR SHARE OF r,c,w,s,t)
    INSERT INTO tripsit_human_decisions(id,packet_id,owner_id,request_id,decision,inspection,unchecked_scope,residual_risk,created_at,expires_at)
    SELECT $10,id,$1,$12,$13,$14,$15,$16,$11,expires_at FROM locked
    WHERE (SELECT count(*) FROM tripsit_human_decisions d WHERE d.packet_id=locked.id)<16
       OR EXISTS (SELECT 1 FROM tripsit_human_decisions d WHERE d.packet_id=locked.id AND d.request_id=$12)
    ON CONFLICT(packet_id,request_id) DO UPDATE SET request_id=EXCLUDED.request_id
    WHERE tripsit_human_decisions.owner_id=EXCLUDED.owner_id AND tripsit_human_decisions.decision=EXCLUDED.decision
      AND tripsit_human_decisions.inspection=EXCLUDED.inspection AND tripsit_human_decisions.unchecked_scope=EXCLUDED.unchecked_scope
      AND tripsit_human_decisions.residual_risk=EXCLUDED.residual_risk
    RETURNING id,created_at`, [owner,itemId,candidateId,packetId,row.body,row.packet_digest,row.commit_sha,JSON.stringify(row.payload),JSON.stringify(row.snapshot),id,now,value.requestId,value.decision,value.inspection,value.uncheckedScope,value.residualRisk,row.base_sha,row.output_digest,row.source_digest,row.snapshot_digest]);
   if (!inserted.rows[0]) throw stale();
   return { id: inserted.rows[0].id, owner, packetId, packetDigest: row.packet_digest, candidateCommit: row.commit_sha,
    decision: value.decision, inspection: value.inspection, uncheckedScope: value.uncheckedScope, residualRisk: value.residualRisk, createdAt: inserted.rows[0].created_at };
  }
 };
}
