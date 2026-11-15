import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('stage route enforces owner, origin, body and revision IDs before dispatch', async () => {
 let calls = 0;
 const global = globalThis as typeof globalThis & { stageFixture?: (...args: unknown[]) => unknown };
 global.stageFixture = async () => { calls++; return { candidateCommit: 'a'.repeat(40) }; };
 const hooks = registerHooks({ resolve(specifier, context, next) {
  const mocks: Record<string, string> = {
   '#lib/auth.js': 'export const database={};',
   '#lib/server/generation-runtime.ts': 'export const candidateServices=async()=>({});',
   '#lib/server/staging-service.ts': 'export const createStaging=()=>({stage:(...args)=>globalThis.stageFixture(...args)});'
  };
  return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
 } });
 try {
  const { POST } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/stage/+server.ts');
  const id = '11111111-1111-4111-8111-111111111111';
  const request = (body = '{}', origin = 'http://localhost', query = '') => new Request('http://localhost/stage' + query, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body });
  const event = (req: Request, owner = true, value = id) => ({ request: req, locals: { user: owner ? { id: 'owner' } : null }, params: { id: value, candidateId: id } });
  assert.equal((await POST(event(request(), false))).status, 401);
  assert.equal((await POST(event(request('{}', 'https://evil.example')))).status, 403);
  assert.equal((await POST(event(request('{"result":"accept"}')))).status, 400);
  assert.equal((await POST(event(request('{}', 'http://localhost', '?override=1')))).status, 400);
  assert.equal((await POST(event(request(), true, 'bad'))).status, 404);
  assert.equal(calls, 0);
  const result = await POST(event(request())); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 1);
  for (let i = 0; i < 2; i++) assert.equal((await POST(event(request()))).status, 200);
  assert.equal((await POST(event(request()))).status, 429); assert.equal(calls, 3);
 } finally { hooks.deregister(); delete global.stageFixture; }
});
