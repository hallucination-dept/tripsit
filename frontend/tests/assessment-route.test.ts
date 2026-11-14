import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { IntakeError } from '../src/lib/server/intake.ts';

const itemId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const base = `http://localhost/api/work-items/${itemId}/candidates/${candidateId}/assessment`;

test('assessment routes enforce auth, owner, CSRF, exact empty JSON, queries, UUIDs, cancellation and no-store', async () => {
  let calls = 0; let configured = false; let hanging = false;
  const bridge = globalThis as typeof globalThis & { assessmentRuntimeFixture?: (...args: unknown[]) => unknown };
  bridge.assessmentRuntimeFixture = async (_headers, owner, signal) => {
    calls++;
    if (owner !== 'owner') throw new IntakeError(404, 'Unavailable.');
    return { reviewerConfigured: configured, service: {
      async load(selectedOwner: string, item: string, candidate: string) {
        assert.equal(selectedOwner, owner); assert.equal(item, itemId); assert.equal(candidate, candidateId);
        if (hanging) return new Promise(() => {});
        assert(!(signal as AbortSignal).aborted); return { identity: { ownerId: owner }, marker: 'actual-assessment' };
      },
      async review(selectedOwner: string, item: string, candidate: string) {
        assert.equal(selectedOwner, owner); assert.equal(item, itemId); assert.equal(candidate, candidateId);
        return { id: 'review', result: { status: 'unavailable', reason: 'Reviewer is not configured.' } };
      }
    } };
  };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const mocks: Record<string, string> = {
      '#lib/server/assessment-runtime.ts': 'export const assessmentRuntime=(...args)=>globalThis.assessmentRuntimeFixture(...args);',
      '#lib/server/assessment-view.ts': 'export const assessmentView=(owner,assessment,reviewerConfigured)=>({identity:assessment.identity,marker:assessment.marker,reviewerConfigured});'
    };
    return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
  } });
  try {
    const { GET } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/assessment/+server.ts');
    const { POST } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/assessment/reviews/+server.ts');
    const event = (request: Request, owner: string | null = 'owner', id = itemId, candidate = candidateId) => ({ request, locals: { user: owner ? { id: owner } : null }, params: { id, candidateId: candidate } });
    const request = (body = '{}', origin = 'http://localhost', query = '', signal?: AbortSignal) => new Request(base + '/reviews' + query, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body, signal });
    assert.equal((await GET(event(new Request(base), null))).status, 401);
    assert.equal((await POST(event(request(), null))).status, 401);
    assert.equal(calls, 0);
    assert.equal((await POST(event(request('{}', 'https://other.example')))).status, 403);
    for (const body of ['null', '[]', '{', '{"result":"passed"}', '{"url":"https://evil.example"}']) assert.equal((await POST(event(request(body)))).status, 400);
    assert.equal((await POST(event(request(' '.repeat(1025))))).status, 413);
    for (const route of [GET, POST]) {
      const req = route === GET ? new Request(base + '?config=none') : request('{}', 'http://localhost', '?result=pass');
      assert.equal((await route(event(req))).status, 400);
      assert.equal((await route(event(route === GET ? new Request(base) : request(), 'owner', 'bad'))).status, 404);
      assert.equal((await route(event(route === GET ? new Request(base) : request(), 'owner', itemId, 'bad'))).status, 404);
    }
    assert.equal(calls, 0);
    assert.equal((await GET(event(new Request(base), 'other'))).status, 404);
    const loaded = await GET(event(new Request(base)));
    assert.equal(loaded.status, 200); assert.equal(loaded.headers.get('cache-control'), 'no-store');
    assert.equal((await loaded.json()).reviewerConfigured, false);
    const unavailable = await POST(event(request()));
    assert.equal(unavailable.status, 200); assert.equal(unavailable.headers.get('cache-control'), 'no-store');
    assert.equal((await unavailable.json()).review.result.status, 'unavailable');
    const limited = await POST(event(request()));
    assert.equal(limited.status, 200);
    assert.equal((await POST(event(request()))).status, 200);
    assert.equal((await POST(event(request()))).status, 429);
    hanging = true; configured = true;
    const controller = new AbortController();
    const pending = GET(event(new Request(base, { signal: controller.signal })));
    controller.abort();
    const cancelled = await pending;
    assert.equal(cancelled.status, 504); assert.equal(cancelled.headers.get('cache-control'), 'no-store');
  } finally { hooks.deregister(); delete bridge.assessmentRuntimeFixture; }
});
