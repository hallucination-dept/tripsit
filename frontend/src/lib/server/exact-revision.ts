import { IntakeError, whileActive } from './intake.ts';
import { stageCandidate, type TreeEntry } from './candidate-staging.ts';
import type { AssessmentDependencies } from './assessment.ts';

const unavailable = () => new IntakeError(409, 'Exact staged revision is unavailable or stale.');
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Github = AssessmentDependencies['github'] & { stagingTree: (snapshot: Awaited<ReturnType<AssessmentDependencies['intake']['get']>>['snapshot'], signal: AbortSignal) => Promise<{baseSha:string;treeSha:string;entries:TreeEntry[]}> };
export type ExactRevision = { commitSha: string; treeSha: string; commitObject: string };
export type ExactFile = { path:string; content:string; blobSha:string; mode:'100644'|'100755' };

export function createExactRevision(database: Database, github: Github, intake: AssessmentDependencies['intake'], generation: AssessmentDependencies['generation']) {
  async function current(owner:string, itemId:string, candidateId:string) {
    const rows = await database.query(`SELECT t.commit_sha,t.tree_sha,t.objects FROM tripsit_candidate_stages t
      JOIN tripsit_candidates c ON c.id=t.candidate_id JOIN tripsit_candidate_payloads p ON p.candidate_id=c.id
      JOIN tripsit_work_items w ON w.id=p.work_item_id JOIN tripsit_snapshots s ON s.work_item_id=w.id
      WHERE c.id=$3 AND w.id=$2 AND c.owner_id=$1 AND w.owner_id=$1 AND t.owner_id=$1
      AND c.expires_at=w.expires_at AND c.expires_at=t.expires_at AND c.expires_at>now()
      AND t.base_sha=s.payload->>'baseSha' AND t.base_sha=p.payload->>'baseSha'
      AND t.output_digest=c.output_digest AND t.output_digest=p.payload->>'outputDigest'`, [owner,itemId,candidateId]);
    if (rows.rows.length !== 1) throw unavailable();
    return rows.rows[0];
  }
  return async (owner:string, itemId:string, candidateId:string, signal:AbortSignal) => {
    const initial = await current(owner,itemId,candidateId);
    const item = await whileActive(() => intake.get(owner,itemId,signal), signal);
    const stored = await whileActive(() => generation.get(owner,itemId,candidateId,signal), signal);
    const tree = await whileActive(() => github.stagingTree(item.snapshot,signal), signal);
    const staged = stageCandidate(tree.baseSha,tree.treeSha,tree.entries,stored.candidate,item.createdAt);
    if (staged.commitSha !== initial.commit_sha || staged.rootSha !== initial.tree_sha || JSON.stringify(staged.objects.map(o => [o.type,o.sha,o.content])) !== JSON.stringify((initial.objects as typeof staged.objects)?.map(o => [o.type,o.sha,o.content]))) throw unavailable();
    const commit = staged.objects.find(row => row.type === 'commit' && row.sha === staged.commitSha);
    if (!commit) throw unavailable();
    const revision:ExactRevision = { commitSha:staged.commitSha, treeSha:staged.rootSha, commitObject:commit.content };
    const files = new Map<string,ExactFile>();
    const changed = new Map(stored.candidate.files.map(file => [file.path,file]));
    if (tree.entries.some(entry => !['040000','100644','100755'].includes(entry.mode))
      || tree.entries.filter(entry => entry.mode !== '040000').length + stored.candidate.files.filter(file => !tree.entries.some(entry => entry.path === file.path)).length > 24) throw unavailable();
    for (const entry of tree.entries) {
      if (entry.mode === '040000') continue;
      const replacement = changed.get(entry.path);
      if (replacement) continue;
      const rows = await whileActive(() => github.context(item.snapshot,[entry.path],signal),signal);
      if (rows.length !== 1 || rows[0].path !== entry.path || rows[0].originalBlob !== entry.sha || rows[0].content.includes('\0')) throw unavailable();
      files.set(entry.path,{path:entry.path,content:rows[0].content,blobSha:entry.sha,mode:entry.mode as ExactFile['mode']});
    }
    const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    for (const file of stored.candidate.files) {
      const content = decoder.decode(file.content);
      if (content.includes('\0')) throw unavailable();
      const old = tree.entries.find(entry => entry.path === file.path);
      files.set(file.path,{path:file.path,content,blobSha:file.blobSha,mode:(old?.mode ?? '100644') as ExactFile['mode']});
    }
    const full = [...files.values()];
    if (!full.length || full.length > 24 || full.reduce((sum,file) => sum + Buffer.byteLength(file.content),0) > 262144) throw unavailable();
    const recheck = async () => { if (JSON.stringify(await current(owner,itemId,candidateId)) !== JSON.stringify(initial)) throw unavailable(); };
    await recheck();
    return { revision, files:full, recheck };
  };
}
