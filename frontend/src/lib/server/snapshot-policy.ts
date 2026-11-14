import { createHash } from 'node:crypto';
import { baselinePolicy } from './policy.ts';
import type { WorkItem } from './records.ts';

export function snapshotPolicy(item: WorkItem) {
  const snapshot = item.snapshot;
  const snapshotDigest = createHash('sha256').update(JSON.stringify([
    snapshot.repositoryId, snapshot.repository, snapshot.private, snapshot.issueNumber,
    snapshot.issueId, snapshot.baseSha, snapshot.supplied.title, snapshot.supplied.body,
    snapshot.supplied.provenance, snapshot.inferred, snapshot.ownerConfirmed
  ])).digest('hex');
  return { itemId: item.id, baseSha: snapshot.baseSha, snapshotDigest,
    policy: baselinePolicy('unknown', [{ id: 'issue-intent', category: 'intent',
      criterion: snapshot.supplied.title, provenance: 'supplied',
      source: { name: 'GitHub issue', version: snapshot.baseSha,
        url: `https://github.com/${snapshot.repository}/issues/${snapshot.issueNumber}` } }]) };
}
