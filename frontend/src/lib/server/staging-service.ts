import { IntakeError, whileActive, type IssueSnapshot } from './intake.ts';
import type { WorkItem } from './records.ts';
import type { StoredCandidate } from './generation.ts';
import { stageCandidate, type TreeEntry } from './candidate-staging.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Dependencies = {
  intake: { get(owner: string, id: string, signal: AbortSignal): Promise<WorkItem> };
  generation: { get(owner: string, itemId: string, id: string, signal: AbortSignal): Promise<StoredCandidate> };
  github: { stagingTree(snapshot: IssueSnapshot, signal: AbortSignal): Promise<{ baseSha: string; treeSha: string; entries: TreeEntry[] }> };
  database: Database;
};
export function createStaging({ intake, generation, github, database }: Dependencies) {
  return {
    async stage(owner: string, itemId: string, candidateId: string, signal: AbortSignal) {
      if (!owner) throw new IntakeError(401, 'Sign in before staging a candidate.');
      const item = await whileActive(() => intake.get(owner, itemId, signal), signal);
      if (item.snapshot.private !== false) throw new IntakeError(403, 'Private candidate staging is unavailable.');
      const stored = await whileActive(() => generation.get(owner, itemId, candidateId, signal), signal);
      const tree = await whileActive(() => github.stagingTree(item.snapshot, signal), signal);
      const stage = stageCandidate(tree.baseSha, tree.treeSha, tree.entries, stored.candidate, item.createdAt);
      const current = await whileActive(() => intake.get(owner, itemId, signal), signal);
      if (JSON.stringify(current) !== JSON.stringify(item)) throw new IntakeError(409, 'Candidate staging is stale.');
      const files = stored.candidate.files.map(file => ({ path: file.path, originalBlob: file.originalBlob, blobSha: file.blobSha, content: Buffer.from(file.content).toString('base64') }));
      let rows;
      try {
        rows = await database.query(`WITH locked AS (SELECT c.id,c.expires_at FROM tripsit_candidates c
          JOIN tripsit_candidate_payloads p ON p.candidate_id=c.id JOIN tripsit_work_items w ON w.id=p.work_item_id
          JOIN tripsit_snapshots s ON s.work_item_id=w.id
          WHERE c.owner_id=$1 AND w.owner_id=$1 AND w.id=$2 AND c.id=$3 AND c.expires_at= w.expires_at AND c.expires_at>now()
            AND c.output_digest=$5 AND p.payload->>'outputDigest'=$5 AND p.payload->>'baseSha'=$4 AND p.payload->'files'=$9::jsonb
            AND s.payload=$10::jsonb AND s.payload->>'baseSha'=$4 AND w.created_at=$11::timestamptz FOR SHARE OF c,p,w,s)
          INSERT INTO tripsit_candidate_stages(candidate_id,owner_id,base_sha,output_digest,commit_sha,tree_sha,objects,expires_at)
          SELECT id,$1,$4,$5,$6,$7,$8::jsonb,expires_at FROM locked
          ON CONFLICT (candidate_id) DO UPDATE SET candidate_id=EXCLUDED.candidate_id
          WHERE tripsit_candidate_stages.owner_id=EXCLUDED.owner_id AND tripsit_candidate_stages.base_sha=EXCLUDED.base_sha
            AND tripsit_candidate_stages.output_digest=EXCLUDED.output_digest AND tripsit_candidate_stages.commit_sha=EXCLUDED.commit_sha
            AND tripsit_candidate_stages.tree_sha=EXCLUDED.tree_sha AND tripsit_candidate_stages.objects=EXCLUDED.objects
          RETURNING commit_sha`, [owner, itemId, candidateId, stage.baseSha, stored.candidate.outputDigest, stage.commitSha,
            stage.rootSha, JSON.stringify(stage.objects), JSON.stringify(files), JSON.stringify(item.snapshot), item.createdAt]);
      } catch { throw new IntakeError(503, 'Candidate staging storage is unavailable.'); }
      if (!rows.rows.length || rows.rows[0].commit_sha !== stage.commitSha) throw new IntakeError(409, 'Candidate staging is stale.');
      return { baseSha: stage.baseSha, candidateCommit: stage.commitSha, candidateDigest: stored.candidate.outputDigest };
    }
  };
}
