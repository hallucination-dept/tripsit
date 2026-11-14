import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { IntakeError } from '../src/lib/server/intake.ts';
const itemId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

test('assessment routes authenticate, bind revisions, protect paid mutations and never cache artifacts', async () => {
  let calls = 0; let denied = false; let hang = false;
  const bridge = globalThis as typeof globalThis & { assessmentRouteRuntime?: (...args: unknown[]) => unknown };
  bridge.assessmentRouteRuntime = async () => {
    calls++;
    const action = async (owner: string, item: string, candidate: string, signal: AbortSignal) => {
      assert.equal(owner, 'owner'); assert.equal(item, itemId); assert.equal(candidate, candidateId); assert(!signal.aborted);
      if (denied) throw new IntakeError(404, 'Candidate unavailable.');
      if (hang) return new Promise(() => {});
      return { identity: { ownerId: owner }, marker: 'frozen' };
    };
    return { load: action, review: action };
  };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const source = specifier === '#lib/server/assessment-runtime.ts' ? 'export const assessmentRuntime=(...args)=>globalThis.assessmentRouteRuntime(...args);'
      : specifier === '#lib/server/generation-limit.ts' ? 'export const createGenerationLimit=()=>({run:(_owner,action)=>action()});' : null;
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
  } });
  try {
    const { GET } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/assessment/+server.ts');
    const { POST } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/reviews/+server.ts');
    const request = (body = '{}', origin = 'http://localhost', signal?: AbortSignal) => new Request('http://localhost/reviews', { method: 'POST', body, signal, headers: { origin, 'Content-Type': 'application/json' } });
    const event = (req: Request, owner: string | null = 'owner', id = itemId) => ({ request: req, locals: { user: owner ? { id: owner } : null }, params: { id, candidateId } });
    assert.equal((await GET(event(new Request('http://localhost/'), null))).status, 401);
    assert.equal((await POST(event(request(), null))).status, 401);
    for (const route of [GET, POST]) assert.equal((await route(event(request(), 'owner', 'bad'))).status, 404);
    assert.equal((await POST(event(request('{}', 'http://other')))).status, 403);
    assert.equal((await POST(event(new Request('http://localhost/reviews', { method: 'POST', headers: { origin: 'http://localhost' }, body: '{}' })))).status, 415);
    for (const body of ['{', 'null', '[]', '{"url":"https://other"}', '{"identity":{}}']) assert.equal((await POST(event(request(body)))).status, 400);
    assert.equal((await POST(event(request(' '.repeat(4097))))).status, 413);
    assert.equal(calls, 0);
    const loaded = await GET(event(new Request('http://localhost/')));
    assert.equal(loaded.status, 200); assert.equal(loaded.headers.get('cache-control'), 'no-store');
    assert.equal((await loaded.json()).marker, 'frozen');
    const reviewed = await POST(event(request()));
    assert.equal(reviewed.status, 200); assert.equal(reviewed.headers.get('cache-control'), 'no-store');
    assert.equal((await reviewed.json()).review.marker, 'frozen');
    denied = true;
    for (const route of [GET, POST]) { const response = await route(event(request())); assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store'); }
    denied = false; hang = true;
    const controller = new AbortController(); const pending = POST(event(request('{}', undefined, controller.signal))); controller.abort();
    assert.equal((await pending).status, 504);
  } finally { hooks.deregister(); delete bridge.assessmentRouteRuntime; }
});
