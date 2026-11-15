import { randomUUID } from 'node:crypto';
import { IntakeError, whileActive } from './intake.ts';
import type { WorkItem } from './records.ts';
import type { StoredCandidate } from './generation.ts';

type Database = { query(sql:string, values?:unknown[]):Promise<{rows:Record<string,unknown>[]}> };
type Dependencies = { database:Database; intake:{get(owner:string,item:string,signal:AbortSignal):Promise<WorkItem>}; generation:{get(owner:string,item:string,candidate:string,signal:AbortSignal):Promise<StoredCandidate>} };
const invalid = () => new IntakeError(400,'Outcome details are invalid.');
const uuid = (v:unknown):v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function createOutcomeFeedback({database,intake,generation}:Dependencies) {
 async function query(sql:string,values:unknown[]) { try { return await database.query(sql,values); } catch { throw new IntakeError(503,'Outcome feedback storage is unavailable.'); } }
 async function current(owner:string,item:string,candidate:string,signal:AbortSignal) {
  if (!owner) throw new IntakeError(401,'Sign in before accessing outcomes.');
  if (!uuid(item) || !uuid(candidate)) throw invalid();
  const work = await whileActive(()=>intake.get(owner,item,signal),signal);
  const stored = await whileActive(()=>generation.get(owner,item,candidate,signal),signal);
  if (work.id !== item || stored.id !== candidate || stored.candidate.baseSha !== work.snapshot.baseSha) throw new IntakeError(409,'Candidate revision changed.');
  return {work,stored};
 }
 return {
  async list(owner:string,item:string,candidate:string,signal:AbortSignal) {
   const {work,stored}=await current(owner,item,candidate,signal);
   const decisions=await query(`SELECT d.id,d.packet_id,r.commit_sha,d.decision FROM tripsit_human_decisions d
    JOIN tripsit_revision_packets r ON r.id=d.packet_id JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id
    JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
    WHERE w.id=$2 AND c.id=$3 AND w.owner_id=$1 AND c.owner_id=$1 AND r.owner_id=$1 AND d.owner_id=$1
      AND w.expires_at>now() AND c.expires_at>now() AND r.expires_at>now() AND d.expires_at>now()
    ORDER BY d.created_at DESC,d.id LIMIT 16`,[owner,item,candidate]);
   const paths=stored.candidate.files.map(file=>file.path);
   const findings=await query(`SELECT area,kind,severity,evidence_issue,commit_sha,packet_digest,decision_id,created_at
    FROM tripsit_owner_outcomes WHERE owner_id=$1 AND repository_id=$2 AND area=ANY($3::text[])
    ORDER BY created_at DESC,id DESC LIMIT 100`,[owner,work.snapshot.repositoryId,paths]);
   const scrutiny=await query(`SELECT DISTINCT ON (area) area,kind,severity,evidence_issue,commit_sha,packet_digest,decision_id,created_at
    FROM tripsit_owner_outcomes WHERE owner_id=$1 AND repository_id=$2 AND area=ANY($3::text[]) AND kind='escape'
    ORDER BY area,created_at DESC,id DESC`,[owner,work.snapshot.repositoryId,paths]);
   await whileActive(()=>intake.get(owner,item,signal),signal);
   return {decisions:decisions.rows,findings:findings.rows,scrutiny:scrutiny.rows,historyTruncated:findings.rows.length===100,areaCoverage:'partial' as const};
  },
  async record(owner:string,item:string,candidate:string,input:unknown,signal:AbortSignal) {
   const {work,stored}=await current(owner,item,candidate,signal);
   if (!input || typeof input!=='object' || Array.isArray(input)) throw invalid();
   const value=input as Record<string,unknown>;
   if (Object.keys(value).sort().join(',')!=='area,decisionId,evidenceIssue,kind,packetId,requestId,severity'
    || !uuid(value.requestId) || !uuid(value.packetId) || !uuid(value.decisionId)
    || typeof value.area!=='string' || !stored.candidate.files.some(file=>file.path===value.area)
    || !['escape','spot_check'].includes(String(value.kind)) || !['low','medium','high','critical'].includes(String(value.severity))
    || !Number.isSafeInteger(value.evidenceIssue) || Number(value.evidenceIssue)<1) throw invalid();
   await whileActive(()=>intake.get(owner,item,signal),signal);
   const result=await query(`WITH eligible AS (SELECT d.id,r.packet_digest,r.commit_sha FROM tripsit_human_decisions d
     JOIN tripsit_revision_packets r ON r.id=d.packet_id JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id
     JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
     JOIN tripsit_snapshots s ON s.work_item_id=w.id JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
     WHERE w.id=$2 AND c.id=$3 AND r.id=$4 AND d.id=$5 AND w.owner_id=$1 AND c.owner_id=$1 AND r.owner_id=$1 AND d.owner_id=$1 AND t.owner_id=$1
       AND w.expires_at>now() AND c.expires_at>now() AND r.expires_at>now() AND d.expires_at>now() AND t.expires_at>now()
       AND r.commit_sha=t.commit_sha AND t.base_sha=$7 AND t.output_digest=c.output_digest AND p.payload->>'outputDigest'=c.output_digest
       AND s.payload->>'repositoryId'=$6 AND s.payload->>'baseSha'=$7
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.payload->'files') f WHERE f->>'path'=$8)
     FOR SHARE OF d,r,p,c,w,s,t)
    INSERT INTO tripsit_owner_outcomes(id,owner_id,request_id,repository_id,area,packet_digest,commit_sha,decision_id,kind,severity,evidence_issue,created_at)
    SELECT $9,$1,$10,$6::bigint,$8,packet_digest,commit_sha,id,$11,$12,$13,now() FROM eligible
    ON CONFLICT(owner_id,request_id) DO UPDATE SET request_id=EXCLUDED.request_id
    WHERE tripsit_owner_outcomes.repository_id=EXCLUDED.repository_id AND tripsit_owner_outcomes.area=EXCLUDED.area
     AND tripsit_owner_outcomes.packet_digest=EXCLUDED.packet_digest AND tripsit_owner_outcomes.commit_sha=EXCLUDED.commit_sha
     AND tripsit_owner_outcomes.decision_id=EXCLUDED.decision_id AND tripsit_owner_outcomes.kind=EXCLUDED.kind
     AND tripsit_owner_outcomes.severity=EXCLUDED.severity AND tripsit_owner_outcomes.evidence_issue=EXCLUDED.evidence_issue
    RETURNING id`,[owner,item,candidate,value.packetId,value.decisionId,String(work.snapshot.repositoryId),work.snapshot.baseSha,value.area,randomUUID(),value.requestId,value.kind,value.severity,value.evidenceIssue]);
   if (!result.rows.length) throw new IntakeError(409,'Decision or candidate revision is unavailable.');
   return {id:result.rows[0].id};
  }
 };
}
