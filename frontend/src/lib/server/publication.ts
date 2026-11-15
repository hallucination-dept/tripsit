import { createHash } from 'node:crypto';
import { IntakeError, whileActive } from './intake.ts';
import { stageCandidate } from './candidate-staging.ts';
import { snapshotPolicy } from './snapshot-policy.ts';
import { assertAcceptanceEvidence } from './human-decision.ts';
import { publicationRemote, writeStagedGitObjects } from './publication-git.ts';
import type { WorkItem } from './records.ts';
import type { StoredCandidate } from './generation.ts';
import type { IssueSnapshot } from './intake.ts';
import type { TreeEntry } from './candidate-staging.ts';
import type { Assessment } from './assessment.ts';
import type { OracleCheck } from './verification.ts';
import type { TrustedRequiredManifest } from './trusted-required-manifest.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{rows: Record<string,unknown>[]}> };
type Access = { repository: string; repositoryId: number; branch: string; token: string };
type Dependencies = { database: Database; intake: {get(owner:string,id:string,signal:AbortSignal):Promise<WorkItem>};
  generation: {get(owner:string,item:string,id:string,signal:AbortSignal):Promise<StoredCandidate>};
  github: { publicationAccess(repository:string,id:number,signal:AbortSignal):Promise<Access>;
    stagingTree(snapshot:IssueSnapshot,signal:AbortSignal):Promise<{baseSha:string;treeSha:string;entries:TreeEntry[]}> };
  acceptance: (owner:string,item:string,candidate:string,signal:AbortSignal)=>Promise<{ assessment:Assessment; manifest:TrustedRequiredManifest; checks:OracleCheck[] }>;
  fetcher?: typeof fetch };
const stale = () => new IntakeError(409,'Publication requires a current accepted decision and matching staged revision.');
const canonical = (value:unknown) => JSON.stringify(value,(_key,entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key,entry[key]])) : entry);
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
const uuid = (value:string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

/** Trusted publication path; never merges, approves, or force-updates a ref. */
export function createPublication({database,intake,generation,github,fetcher,acceptance}:Dependencies) {
 async function query(sql:string,values:unknown[]) { try {return await database.query(sql,values);} catch {throw new IntakeError(503,'Publication storage is unavailable.');} }
 return { async publish(owner:string,itemId:string,candidateId:string,packetId:string,signal:AbortSignal) {
  if (!owner) throw new IntakeError(401,'Sign in before publishing.');
  if (![itemId,candidateId,packetId].every(uuid)) throw stale();
  const item = await whileActive(() => intake.get(owner,itemId,signal),signal);
  if (!Number.isSafeInteger(item.snapshot.issueNumber) || item.snapshot.issueNumber < 1) throw stale();
  async function admitted() {
   const result = await query(`SELECT r.body,r.packet_digest,r.source_digest,r.snapshot_digest,r.commit_sha,p.payload,s.payload AS snapshot,
     t.tree_sha,t.objects,t.base_sha,t.output_digest,d.id AS decision_id,d.inspection,d.deep_inspection,d.unchecked_scope,d.residual_risk,d.outcome_epoch,e.version AS current_epoch
     FROM tripsit_revision_packets r JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id
     JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
     JOIN tripsit_snapshots s ON s.work_item_id=w.id JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
     JOIN LATERAL (SELECT * FROM tripsit_human_decisions WHERE packet_id=r.id AND owner_id=$1 AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1) d ON d.decision='accept'
     JOIN tripsit_outcome_epochs e ON e.owner_id=$1 AND e.repository_id=(s.payload->>'repositoryId')::bigint
     WHERE r.id=$4 AND c.id=$3 AND w.id=$2 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1 AND t.owner_id=$1
       AND r.expires_at>now() AND c.expires_at>now() AND w.expires_at>now() AND t.expires_at>now()
       AND r.commit_sha=t.commit_sha AND t.base_sha=s.payload->>'baseSha' AND t.output_digest=c.output_digest`,[owner,itemId,candidateId,packetId]);
   const row=result.rows[0];
   if (!row || typeof row.body !== 'string' || Buffer.byteLength(row.body)>2097152 || typeof row.packet_digest !== 'string'
     || digest(row.body)!==row.packet_digest || digest(canonical(row.payload))!==row.source_digest || digest(canonical(row.snapshot))!==row.snapshot_digest
     || canonical(item.snapshot)!==canonical(row.snapshot) || row.outcome_epoch == null || row.outcome_epoch !== row.current_epoch || row.deep_inspection !== true || ![row.inspection,row.unchecked_scope,row.residual_risk].every(value => typeof value==='string' && value.trim())) throw stale();
   let packet; try { packet=JSON.parse(row.body); } catch { throw stale(); }
   const policy=snapshotPolicy(item);
   if (packet?.acceptanceReady!==false || packet.candidateCommit!==row.commit_sha || packet.identity?.ownerId!==owner
     || packet.identity?.itemId!==itemId || packet.identity?.candidateId!==candidateId || packet.identity?.baseSha!==item.snapshot.baseSha
     || packet.identity?.candidateDigest!==row.output_digest || row.base_sha!==item.snapshot.baseSha
     || packet.identity?.snapshotDigest!==policy.snapshotDigest || packet.identity?.policyVersion!==policy.policy.version) throw stale();
   const current=await whileActive(()=>acceptance(owner,itemId,candidateId,signal),signal);
   assertAcceptanceEvidence(packet,row,item,current);
   return Object.assign(row,{manifest:current.manifest});
  }
  const initial=await admitted();
  const stored=await whileActive(()=>generation.get(owner,itemId,candidateId,signal),signal);
  const tree=await whileActive(()=>github.stagingTree(item.snapshot,signal),signal);
  const stage=stageCandidate(tree.baseSha,tree.treeSha,tree.entries,stored.candidate,item.createdAt);
  if (stage.commitSha!==initial.commit_sha || stage.rootSha!==initial.tree_sha || canonical(stage.objects)!==canonical(initial.objects)) throw stale();
  const branch=`tripsit/${candidateId}`;
  const access=await whileActive(()=>github.publicationAccess(item.snapshot.repository,item.snapshot.repositoryId,signal),signal);
  if (access.repositoryId!==item.snapshot.repositoryId || access.repository.toLowerCase()!==item.snapshot.repository.toLowerCase()) throw stale();
  const remote=publicationRemote(access.repository,access.token,fetcher);
  const guard=async()=>{ const current=await admitted(); if (current.decision_id!==initial.decision_id || current.packet_digest!==initial.packet_digest || current.commit_sha!==initial.commit_sha || current.tree_sha!==initial.tree_sha || canonical(current.objects)!==canonical(initial.objects)) throw stale();
    const currentAccess=await whileActive(()=>github.publicationAccess(item.snapshot.repository,item.snapshot.repositoryId,signal),signal);
    if (currentAccess.repositoryId!==item.snapshot.repositoryId || currentAccess.repository.toLowerCase()!==access.repository.toLowerCase() || currentAccess.branch!==access.branch) throw stale();
    if (await remote.ref(access.branch,signal)!==item.snapshot.baseSha) throw stale(); };
  if (await remote.ref(access.branch,signal)!==item.snapshot.baseSha) throw stale();
  const issue=await remote.issue(item.snapshot.issueNumber,signal);
  if (!issue || Array.isArray(issue) || issue.id!==item.snapshot.issueId || Object.hasOwn(issue,'pull_request')) throw stale();
  await guard();
  const reserved=await query(`INSERT INTO tripsit_publication_operations(candidate_id,packet_id,owner_id,commit_sha,branch,status,expires_at)
    VALUES($1,$2,$3,$4,$5,'pending',$6) ON CONFLICT(candidate_id) DO NOTHING RETURNING status`,[candidateId,packetId,owner,stage.commitSha,branch,item.expiresAt]);
  const existing=reserved.rows.length ? {status:'pending'} : (await query('SELECT * FROM tripsit_publication_operations WHERE candidate_id=$1 AND owner_id=$2 AND packet_id=$3 AND commit_sha=$4 AND branch=$5 AND expires_at>now()',[candidateId,owner,packetId,stage.commitSha,branch])).rows[0];
  if (!existing) throw stale();
  const marker=`<!-- tripsit-candidate:${candidateId} packet:${initial.packet_digest} -->`;
  async function findPull() {
    const pulls=await remote.pullRequests(branch,access.branch,signal);
    const matches=pulls.filter((value:any)=>value && value.state==='open' && value.base?.ref===access.branch && value.base?.repo?.id===item.snapshot.repositoryId
      && value.head?.ref===branch && value.head?.sha===stage.commitSha && value.head?.repo?.id===item.snapshot.repositoryId
      && typeof value.body==='string' && value.body.includes(marker) && Number.isSafeInteger(value.number) && value.number>0);
    if (matches.length>1 || pulls.length!==matches.length) throw stale();
    return matches[0] as {number:number}|undefined;
  }
  async function finish(pull:{number:number}) {
    const url=`https://github.com/${access.repository}/pull/${pull.number}`;
    await guard();
    const result=await query(`UPDATE tripsit_publication_operations SET status='completed',pr_number=$6,pr_url=$7
      WHERE candidate_id=$1 AND owner_id=$2 AND packet_id=$3 AND commit_sha=$4 AND branch=$5 AND expires_at>now() RETURNING status`,[candidateId,owner,packetId,stage.commitSha,branch,pull.number,url]);
    if (!result.rows.length) throw stale();
    return {number:pull.number,url,branch,commit:stage.commitSha,protection:'unverified' as const};
  }
  if (existing.status==='completed' || existing.status==='creating') {
    const found=await findPull(); if (!found) throw new IntakeError(409,'Publication is pending reconciliation; no duplicate was created.');
    return finish(found);
  }
  if (existing.status!=='pending') throw stale();
  await writeStagedGitObjects(stage.objects,remote.object,guard,signal);
  const currentRef=await remote.ref(branch,signal);
  if (currentRef===null) {
    await guard();
    if (await remote.ref(access.branch,signal)!==item.snapshot.baseSha) throw stale();
    try { await remote.createRef(branch,stage.commitSha,signal); } catch { /* Reconcile a possibly completed ref creation. */ }
  }
  if (await remote.ref(branch,signal)!==stage.commitSha || await remote.ref(access.branch,signal)!==item.snapshot.baseSha) throw stale();
  const already=await findPull(); if (already) return finish(already);
  await guard();
  const claim=await query(`UPDATE tripsit_publication_operations SET status='creating' WHERE candidate_id=$1 AND owner_id=$2 AND packet_id=$3 AND commit_sha=$4 AND branch=$5 AND status='pending' AND expires_at>now() RETURNING status`,[candidateId,owner,packetId,stage.commitSha,branch]);
  if (!claim.rows.length) { const found=await findPull(); if (found) return finish(found); throw new IntakeError(409,'Publication is pending reconciliation; no duplicate was created.'); }
  await guard();
  if (await remote.ref(branch,signal)!==stage.commitSha || await remote.ref(access.branch,signal)!==item.snapshot.baseSha) throw stale();
  if (initial.manifest.status!=='operator_asserted') throw stale();
  const required = initial.manifest.controls.map(row=>`${row.id}: ${row.applicability === 'not_applicable' ? 'not applicable' : 'passed exercised checks'}`).join('\n');
  try { await remote.createPull(branch,access.branch,`TripSit: issue #${item.snapshot.issueNumber}`,`${marker}\n\nCloses #${item.snapshot.issueNumber}\n\nRevision: ${stage.commitSha}\nPacket: ${initial.packet_digest}\n\nMandatory policy evidence:\n${required}\n\nEvidence and merge protection remain subject to human review.`,signal); } catch { /* A lost response is reconciled by reading GitHub. */ }
  const found=await findPull(); if (!found) throw new IntakeError(409,'Publication is pending reconciliation; no duplicate was created.');
  return finish(found);
 } };
}
