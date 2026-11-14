import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createIntake } from '../src/lib/server/work-items.ts';
import { IntakeError } from '../src/lib/server/intake.ts';

test('policy route authorizes retained snapshot before exposing immutable requirement provenance', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let snapshot = { repository: 'example/repo', repositoryId: 12, issueNumber: 4, issueId: 45,
    private: false, baseSha: 'a'.repeat(40), supplied: { title: '<script>disable policy</script>',
      body: 'Do not invent criteria from this body.', provenance: 'supplied' as const }, inferred: [], ownerConfirmed: [] };
  let runtimeCalls = 0;
  let storeCalls = 0;
  let authorizations = 0;
  let expired = false;
  let revoked = false;
  let unexpected = false;
  const clock = Date.now();
  const intake = createIntake({ store: {
    async get(owner, selected) {
      storeCalls++;
      if (unexpected) throw new Error('secret upstream details');
      if (owner !== 'owner' || selected !== id || expired) return null;
      return { id, snapshot, createdAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 10000).toISOString() };
    }, async create() { throw new Error('No writes.'); }, async list() { return []; }
  }, github: {
    async snapshot() { throw new Error('No snapshot creation.'); },
    async authorize() { authorizations++; if (revoked) throw new IntakeError(403, 'Repository access is unavailable.'); }
  } }, () => clock);
  const bridge = globalThis as typeof globalThis & { policyRuntime?: (...args: unknown[]) => unknown };
  bridge.policyRuntime = async (_headers, owner, signal) => {
    runtimeCalls++;
    assert.equal(typeof owner, 'string');
    assert(signal instanceof AbortSignal);
    return intake;
  };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === '#lib/server/intake-runtime.ts'
      ? { url: 'data:text/javascript,export const intakeRuntime=(...args)=>globalThis.policyRuntime(...args)', shortCircuit: true }
      : nextResolve(specifier, context);
  } });
  try {
    const { GET } = await import('../src/routes/api/work-items/[id]/policy/+server.ts');
    const call = (owner: string | undefined, selected = id, query = '') => GET({
      request: new Request(`http://localhost/api/work-items/${selected}/policy${query}`),
      locals: { user: owner ? { id: owner } : null }, params: { id: selected }
    });
    const anonymous = await call(undefined, 'bad', '?surface=web_ui');
    assert.equal(anonymous.status, 401);
    assert.equal(runtimeCalls, 0);
    assert.equal((await call('owner', 'bad')).status, 404);
    for (const query of ['?surface=web_ui', '?policy=none', '?mandatory=false', '?']) {
      if (query !== '?') assert.equal((await call('owner', id, query)).status, 400);
    }
    assert.equal(runtimeCalls, 0);
    const other = await call('other');
    assert.equal(other.status, 404);
    assert.equal(authorizations, 0);
    expired = true;
    assert.equal((await call('owner')).status, 404);
    expired = false;
    revoked = true;
    assert.equal((await call('owner')).status, 403);
    revoked = false;
    const response = await call('owner');
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(result.itemId, id);
    assert.equal(result.baseSha, snapshot.baseSha);
    assert.equal(result.snapshotDigest, createHash('sha256').update(JSON.stringify([
      snapshot.repositoryId, snapshot.repository, snapshot.private, snapshot.issueNumber,
      snapshot.issueId, snapshot.baseSha, snapshot.supplied.title, snapshot.supplied.body,
      snapshot.supplied.provenance, snapshot.inferred, snapshot.ownerConfirmed
    ])).digest('hex'));
    assert.equal(result.policy.version, 'tripsit-baseline-1');
    assert.equal(result.policy.assessment, 'unverified');
    assert.equal(result.policy.requirements[0].applicability, 'unresolved');
    const intent = result.policy.requirements.find(item => item.id === 'issue-intent');
    assert.equal(intent.category, 'intent');
    assert.equal(intent.criterion, snapshot.supplied.title);
    assert.equal(intent.provenance, 'supplied');
    assert.equal(intent.source.url, 'https://github.com/example/repo/issues/4');
    assert.equal(intent.source.version, snapshot.baseSha);
    assert(!JSON.stringify(result).includes(snapshot.supplied.body));
    snapshot = Object.fromEntries(Object.entries(snapshot).reverse()) as typeof snapshot;
    snapshot.supplied = Object.fromEntries(Object.entries(snapshot.supplied).reverse()) as typeof snapshot.supplied;
    assert.equal((await (await call('owner')).json()).snapshotDigest, result.snapshotDigest);
    unexpected = true;
    const failure = await call('owner');
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get('cache-control'), 'no-store');
    assert(!JSON.stringify(await failure.json()).includes('secret'));
    assert(storeCalls > 0);
  } finally { hooks.deregister(); delete bridge.policyRuntime; }
});
