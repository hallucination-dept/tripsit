import { createHash } from 'node:crypto';
import { intakeRuntime } from '#lib/server/intake-runtime.ts';
import { withIntake } from '#lib/server/intake-http.ts';
import { IntakeError } from '#lib/server/intake.ts';
import { baselinePolicy } from '#lib/server/policy.ts';

export async function GET({ request, locals, params }) {
  return withIntake(request, locals.user?.id, async (signal) => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.id)) throw new IntakeError(404, 'Issue snapshot is unavailable.');
    if ([...new URL(request.url).searchParams].length) throw new IntakeError(400, 'Policy overrides are unavailable.');
    const intake = await intakeRuntime(request.headers, locals.user!.id, signal);
    const item = await intake.get(locals.user!.id, params.id, signal);
    const snapshot = item.snapshot;
    // Canonical snapshot content digest; not the database's original serialization digest.
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
  });
}
