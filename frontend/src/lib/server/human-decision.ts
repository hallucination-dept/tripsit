import { createHash, randomUUID } from 'node:crypto';
import { IntakeError, whileActive } from './intake.ts';
import { snapshotPolicy } from './snapshot-policy.ts';
import type { WorkItem } from './records.ts';
import type { Assessment } from './assessment.ts';
import type { OracleCheck } from './verification.ts';
import { verificationDigest } from './verification.ts';
import type { TrustedRequiredManifest } from './trusted-required-manifest.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Dependencies = { database: Database; intake: { get(owner: string, item: string, signal: AbortSignal): Promise<WorkItem> };
 acceptance?: (owner: string, item: string, candidate: string, signal: AbortSignal) => Promise<{ assessment: Assessment; manifest: TrustedRequiredManifest; checks: OracleCheck[] }> };
const invalid = () => new IntakeError(400, 'Provide an inspection, unchecked scope and residual risk for a revision or escalation.');
const stale = () => new IntakeError(409, 'Packet or evidence is stale; freeze a new packet.');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= 4096 && Buffer.from(v).toString('utf8') === v;
const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function assertAcceptanceEvidence(packet: any, row: Record<string, unknown>, item: WorkItem, current: { assessment: Assessment; manifest: TrustedRequiredManifest; checks: OracleCheck[] }) {
 const policy = snapshotPolicy(item);
    const manifest = current.manifest;
    if (manifest.status !== 'operator_asserted' || canonical(manifest) !== canonical(packet.requiredManifest)
      || manifest.repositoryId !== item.snapshot.repositoryId || manifest.baseSha !== row.base_sha
      || manifest.policyVersion !== policy.policy.version || canonical(current.assessment.identity) !== canonical(packet.identity)) throw stale();
    const controls = manifest.controls.filter(control => control.applicability === 'applicable');
    const required = new Set(controls.flatMap(control => control.checks.map(check => check.id)));
    if (!controls.length || !required.size) throw stale();
    const latest = current.assessment.verifications?.at(-1);
    const result = latest?.result as unknown as { exactRevision?: {commitSha?:string;treeSha?:string;commitObject?:string}; expectedCases?: Record<string,number>; checks?: Array<Record<string,unknown>>; executions?: Array<Record<string,unknown>>; admission?: {status?:string;environmentDigest?:string} } | undefined;
    const objects = Array.isArray(row.objects) ? row.objects : [];
    const commit = objects.find(object => object?.type === 'commit' && object.sha === row.commit_sha);
    if (!latest || canonical(latest.identity) !== canonical(packet.identity) || !result?.exactRevision
      || result.exactRevision.commitSha !== row.commit_sha || result.exactRevision.treeSha !== row.tree_sha
      || !commit || result.exactRevision.commitObject !== commit.content || result.admission?.status !== 'passed'
      || !Array.isArray(result.checks) || !Array.isArray(result.executions) || !result.expectedCases) throw stale();
    for (const id of required) {
      const definitions = current.checks.filter(check => check.id === id && check.mandatory);
      const observations = result.executions.filter(execution => execution.checkId === id);
      const recorded = result.checks.filter(check => check.id === id);
      if (definitions.length !== 1 || observations.length !== 1 || recorded.length !== 1) throw stale();
      const check = definitions[0], execution = observations[0], definition = recorded[0];
      const {cases, ...withoutCases} = check;
      const {nodeIds: _nodes, ...assertedDefinition} = check;
      if (!controls.some(control => control.checks.some(entry => entry.id === id && entry.digest === verificationDigest(assertedDefinition)))
        || !cases.length || result.expectedCases[id] !== cases.length || execution.executedTests !== cases.length
        || execution.collector !== 'trusted_runner' || execution.status !== 'completed' || execution.result !== 'passed' || execution.exitCode !== 0
        || definition.definitionDigest !== verificationDigest(withoutCases) || definition.oracleDigest !== verificationDigest(cases)
        || definition.environmentDigest !== result.admission.environmentDigest
        || ['definitionDigest','oracleDigest','environmentDigest','dependencyDigest'].some(key => execution[key] !== definition[key])) throw stale();
      for (const prior of current.assessment.verifications ?? []) {
        const previous = prior.result as unknown as { exactRevision?: unknown; executions: Array<Record<string,unknown>> };
        for (const failure of previous.executions.filter(entry => entry.checkId === id && entry.result === 'failed')) {
          if (canonical(prior.identity) !== canonical(packet.identity) || canonical(previous.exactRevision) !== canonical(result.exactRevision)
            || ['definitionDigest','oracleDigest','environmentDigest','dependencyDigest'].some(key => failure[key] !== definition[key])) throw stale();
        }
      }
    }
}

export function createHumanDecision({ database, intake, acceptance }: Dependencies) {
 async function query(sql: string, values: unknown[]) {
  try { return await database.query(sql, values); } catch { throw new IntakeError(503, 'Decision storage is unavailable.'); }
 }
 return {
  async list(owner: string, itemId: string, candidateId: string, packetId: string, signal: AbortSignal) {
   if (!owner) throw new IntakeError(401, 'Sign in before reading decisions.');
   if (![itemId, candidateId, packetId].every(uuid)) throw invalid();
   await whileActive(() => intake.get(owner, itemId, signal), signal);
   const result = await query(`SELECT d.id,d.decision,d.inspection,d.deep_inspection,d.unchecked_scope,d.residual_risk,d.created_at
    FROM tripsit_human_decisions d JOIN tripsit_revision_packets r ON r.id=d.packet_id
    JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id JOIN tripsit_candidates c ON c.id=p.candidate_id
    JOIN tripsit_work_items w ON w.id=p.work_item_id
    WHERE d.packet_id=$4 AND c.id=$3 AND w.id=$2 AND d.owner_id=$1 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1
      AND d.expires_at>now() AND r.expires_at>now() AND c.expires_at>now() AND w.expires_at>now()
    ORDER BY d.created_at,d.id LIMIT 16`, [owner,itemId,candidateId,packetId]);
   await whileActive(() => intake.get(owner, itemId, signal), signal);
   return result.rows.map(row => ({ id: row.id, decision: row.decision, inspection: row.inspection,
    deepInspection: row.deep_inspection, uncheckedScope: row.unchecked_scope, residualRisk: row.residual_risk, createdAt: row.created_at, historical: true as const }));
  },
  async record(owner: string, itemId: string, candidateId: string, packetId: string, input: unknown, signal: AbortSignal) {
   if (!owner) throw new IntakeError(401, 'Sign in before recording a decision.');
   if (![itemId, candidateId, packetId].every(uuid) || !input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
   const value = input as Record<string, unknown>;
   if (![ 'decision,inspection,requestId,residualRisk,uncheckedScope', 'decision,deepInspection,inspection,requestId,residualRisk,uncheckedScope' ].includes(Object.keys(value).sort().join(',')) || !uuid(value.requestId)
    || !text(value.inspection) || !text(value.uncheckedScope) || !text(value.residualRisk)) throw invalid();
   if (value.decision !== 'accept' && value.decision !== 'revise' && value.decision !== 'escalate') throw invalid();
   if (value.deepInspection !== undefined && typeof value.deepInspection !== 'boolean') throw invalid();
   const item = await whileActive(() => intake.get(owner, itemId, signal), signal);
   const selected = await query(`SELECT p.payload,s.payload AS snapshot,r.body,r.packet_digest,r.source_digest,r.snapshot_digest,r.commit_sha,t.base_sha,t.output_digest,t.tree_sha,t.objects
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
   if (value.decision === 'accept') {
    if (value.deepInspection !== true) throw stale();
    if (!acceptance) throw stale();
    const current = await whileActive(() => acceptance(owner,itemId,candidateId,signal),signal);
    assertAcceptanceEvidence(packet,row,item,current);
   }
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
      AND t.tree_sha=$21 AND t.objects=$22::jsonb
      AND p.payload=$8::jsonb AND s.payload=$9::jsonb
    FOR UPDATE OF p FOR SHARE OF r,c,w,s,t)
    INSERT INTO tripsit_human_decisions(id,packet_id,owner_id,request_id,decision,inspection,unchecked_scope,residual_risk,created_at,expires_at,deep_inspection)
    SELECT $10,id,$1,$12,$13,$14,$15,$16,$11,expires_at,$23 FROM locked
    WHERE (SELECT count(*) FROM tripsit_human_decisions d WHERE d.packet_id=locked.id)<16
       OR EXISTS (SELECT 1 FROM tripsit_human_decisions d WHERE d.packet_id=locked.id AND d.request_id=$12)
    ON CONFLICT(packet_id,request_id) DO UPDATE SET request_id=EXCLUDED.request_id
    WHERE tripsit_human_decisions.owner_id=EXCLUDED.owner_id AND tripsit_human_decisions.decision=EXCLUDED.decision
      AND tripsit_human_decisions.inspection=EXCLUDED.inspection AND tripsit_human_decisions.unchecked_scope=EXCLUDED.unchecked_scope
      AND tripsit_human_decisions.residual_risk=EXCLUDED.residual_risk
      AND tripsit_human_decisions.deep_inspection=EXCLUDED.deep_inspection
    RETURNING id,created_at`, [owner,itemId,candidateId,packetId,row.body,row.packet_digest,row.commit_sha,JSON.stringify(row.payload),JSON.stringify(row.snapshot),id,now,value.requestId,value.decision,value.inspection,value.uncheckedScope,value.residualRisk,row.base_sha,row.output_digest,row.source_digest,row.snapshot_digest,row.tree_sha,JSON.stringify(row.objects),value.deepInspection===true]);
   if (!inserted.rows[0]) throw stale();
   return { id: inserted.rows[0].id, owner, packetId, packetDigest: row.packet_digest, candidateCommit: row.commit_sha,
    decision: value.decision, inspection: value.inspection, deepInspection: value.deepInspection===true, uncheckedScope: value.uncheckedScope, residualRisk: value.residualRisk, createdAt: inserted.rows[0].created_at };
  }
 };
}
