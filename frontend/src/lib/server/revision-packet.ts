import { createHash, randomUUID } from 'node:crypto';
import { assessmentView } from './assessment-view.ts';
import { IntakeError, whileActive } from './intake.ts';
import { stageCandidate, type TreeEntry } from './candidate-staging.ts';
import type { WorkItem } from './records.ts';
import type { StoredCandidate } from './generation.ts';
import type { IssueSnapshot } from './intake.ts';
import type { Assessment } from './assessment.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
type Dependencies = {
  database: Database;
  assessment: { load(owner: string, item: string, candidate: string, signal: AbortSignal): Promise<Assessment> };
  intake: { get(owner: string, item: string, signal: AbortSignal): Promise<WorkItem> };
  generation: { get(owner: string, item: string, candidate: string, signal: AbortSignal): Promise<StoredCandidate> };
  github: { reviewerVisibility(repository: string, repositoryId: number, signal: AbortSignal): Promise<boolean>; stagingTree(snapshot: IssueSnapshot, signal: AbortSignal): Promise<{baseSha:string;treeSha:string;entries:TreeEntry[]}> };
};
const unavailable = () => new IntakeError(409, 'Staged revision or evidence changed; refresh and retry.');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function createRevisionPacket({ database, assessment, github, intake, generation }: Dependencies) {
  async function query(sql: string, values: unknown[]) {
    try { return await database.query(sql, values); }
    catch { throw new IntakeError(503, 'Revision packet storage is unavailable.'); }
  }
  return {
    async get(owner: string, item: string, candidate: string, id: string, signal: AbortSignal) {
      if (!owner) throw new IntakeError(401, 'Sign in before reading a packet.');
      await whileActive(() => intake.get(owner, item, signal), signal);
      const result = await query(`SELECT r.body,r.packet_digest,r.commit_sha FROM tripsit_revision_packets r
        JOIN tripsit_candidate_payloads p ON p.candidate_id=r.candidate_id
        JOIN tripsit_candidates c ON c.id=p.candidate_id JOIN tripsit_work_items w ON w.id=p.work_item_id
        WHERE r.id=$4 AND w.id=$2 AND c.id=$3 AND r.owner_id=$1 AND c.owner_id=$1 AND w.owner_id=$1
          AND r.expires_at>now() AND c.expires_at>now() AND w.expires_at>now()`, [owner, item, candidate, id]);
      const row = result.rows[0];
      if (!row || typeof row.body !== 'string' || Buffer.byteLength(row.body) > 2_097_152
        || typeof row.packet_digest !== 'string' || digest(row.body) !== row.packet_digest || !sha(row.commit_sha)) throw unavailable();
      let packet;
      try { packet = JSON.parse(row.body); } catch { throw unavailable(); }
      if (!packet || packet.acceptanceReady !== false || packet.candidateCommit !== row.commit_sha
        || packet.identity?.ownerId !== owner || packet.identity?.itemId !== item || packet.identity?.candidateId !== candidate) throw unavailable();
      await whileActive(() => intake.get(owner, item, signal), signal);
      return { id, packetDigest: row.packet_digest, packet, historical: true as const };
    },
    async freeze(owner: string, item: string, candidate: string, signal: AbortSignal) {
      if (!owner) throw new IntakeError(401, 'Sign in before freezing a packet.');
      const baseline = await query(`SELECT p.payload,s.payload AS snapshot,t.commit_sha,t.base_sha,t.output_digest,t.expires_at,t.tree_sha,t.objects
        FROM tripsit_candidate_payloads p JOIN tripsit_candidates c ON c.id=p.candidate_id
        JOIN tripsit_work_items w ON w.id=p.work_item_id JOIN tripsit_snapshots s ON s.work_item_id=w.id
        JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
        WHERE w.id=$2 AND c.id=$3 AND w.owner_id=$1 AND c.owner_id=$1 AND t.owner_id=$1
          AND c.expires_at=w.expires_at AND c.expires_at=t.expires_at AND c.expires_at>now()
          AND t.base_sha=s.payload->>'baseSha' AND t.base_sha=p.payload->>'baseSha'
          AND t.output_digest=c.output_digest AND t.output_digest=p.payload->>'outputDigest'`, [owner, item, candidate]);
      const row = baseline.rows[0];
      if (!row || !sha(row.commit_sha) || !row.snapshot || typeof row.snapshot !== 'object' || Array.isArray(row.snapshot)) throw unavailable();
      const snapshot = row.snapshot as Record<string, unknown>;
      if (snapshot.private !== false || typeof snapshot.repository !== 'string' || !Number.isSafeInteger(snapshot.repositoryId)) throw unavailable();
      const currentItem = await whileActive(() => intake.get(owner, item, signal), signal);
      const stored = await whileActive(() => generation.get(owner, item, candidate, signal), signal);
      const tree = await whileActive(() => github.stagingTree(currentItem.snapshot, signal), signal);
      const reconstructed = stageCandidate(tree.baseSha, tree.treeSha, tree.entries, stored.candidate, currentItem.createdAt);
      if (reconstructed.commitSha !== row.commit_sha || reconstructed.rootSha !== row.tree_sha
        || JSON.stringify(reconstructed.objects.map(o => [o.type,o.sha,o.content])) !== JSON.stringify((row.objects as typeof reconstructed.objects)?.map(o => [o.type,o.sha,o.content]))) throw unavailable();
      const view = await whileActive(() => assessment.load(owner, item, candidate, signal), signal);
      if (view.identity.ownerId !== owner || view.identity.itemId !== item || view.identity.candidateId !== candidate
        || view.identity.baseSha !== row.base_sha || view.identity.candidateDigest !== row.output_digest) throw unavailable();
      if (await whileActive(() => github.reviewerVisibility(snapshot.repository as string, snapshot.repositoryId as number, signal), signal) !== false) throw unavailable();
      const original = assessmentView(owner, view, false).packet;
      const { packetDigest: _oldDigest, ...parts } = original;
      const packet = { ...parts, candidateCommit: row.commit_sha, acceptanceReady: false as const };
      const body = JSON.stringify(packet);
      if (Buffer.byteLength(body) > 2_097_152) throw new IntakeError(413, 'Revision packet exceeds its storage limit.');
      const packetDigest = digest(body);
      const sourceDigest = digest(canonical(row.payload));
      const snapshotDigest = digest(canonical(row.snapshot));
      const now = new Date();
      const saved = await query(`WITH locked AS (
        SELECT c.id,c.expires_at FROM tripsit_candidate_payloads p JOIN tripsit_candidates c ON c.id=p.candidate_id
        JOIN tripsit_work_items w ON w.id=p.work_item_id JOIN tripsit_snapshots s ON s.work_item_id=w.id
        JOIN tripsit_candidate_stages t ON t.candidate_id=c.id
        WHERE w.id=$2 AND c.id=$3 AND w.owner_id=$1 AND c.owner_id=$1 AND t.owner_id=$1
          AND c.expires_at=w.expires_at AND c.expires_at=t.expires_at AND c.expires_at>$9
          AND t.commit_sha=$4 AND t.base_sha=$5 AND t.output_digest=$6 AND t.tree_sha=$13 AND t.objects=$14::jsonb
          AND c.output_digest=$6 AND p.payload=$7::jsonb AND s.payload=$8::jsonb
        FOR UPDATE OF p FOR SHARE OF c,w,s,t
      ) INSERT INTO tripsit_revision_packets(id,candidate_id,owner_id,commit_sha,packet_digest,source_digest,snapshot_digest,body,created_at,expires_at)
        SELECT $10,id,$1,$4,$11,$15,$16,$12,$9,expires_at FROM locked
        WHERE (SELECT count(*) FROM tripsit_revision_packets r WHERE r.candidate_id=locked.id)<16
          OR EXISTS (SELECT 1 FROM tripsit_revision_packets r WHERE r.candidate_id=locked.id AND r.packet_digest=$11 AND r.source_digest=$15 AND r.snapshot_digest=$16)
        ON CONFLICT (candidate_id,packet_digest,source_digest,snapshot_digest) DO UPDATE SET packet_digest=EXCLUDED.packet_digest
        WHERE tripsit_revision_packets.owner_id=EXCLUDED.owner_id AND tripsit_revision_packets.commit_sha=EXCLUDED.commit_sha
          AND tripsit_revision_packets.body=EXCLUDED.body AND tripsit_revision_packets.source_digest=EXCLUDED.source_digest
          AND tripsit_revision_packets.snapshot_digest=EXCLUDED.snapshot_digest
        RETURNING id,packet_digest`, [owner, item, candidate, row.commit_sha, row.base_sha, row.output_digest,
          JSON.stringify(row.payload), JSON.stringify(row.snapshot), now, randomUUID(), packetDigest, body, row.tree_sha, JSON.stringify(row.objects), sourceDigest, snapshotDigest]);
      if (!saved.rows[0] || saved.rows[0].packet_digest !== packetDigest) throw unavailable();
      return { id: saved.rows[0].id, packetDigest, packet };
    }
  };
}
