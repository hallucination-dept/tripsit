import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('packet route rejects unauthenticated, invalid origin, overrides, malformed IDs and excess requests', async () => {
 let calls = 0;
 const bridge = globalThis as typeof globalThis & { packetFixture?: () => unknown };
 bridge.packetFixture = () => { calls++; return { packet: { acceptanceReady: false } }; };
 const hooks = registerHooks({ resolve(specifier, context, next) {
  const mocks: Record<string, string> = {
   '#lib/auth.js': 'export const database={};',
   '#lib/server/assessment-runtime.ts': 'export const assessmentRuntime=async()=>({service:{},github:{},intake:{},generation:{}});',
   '#lib/server/revision-packet.ts': 'export const createRevisionPacket=()=>({freeze:()=>globalThis.packetFixture(),get:()=>globalThis.packetFixture()});'
  };
  return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
 } });
 try {
  const { POST } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/packet/+server.ts');
  const { GET } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/packet/[packetId]/+server.ts');
  const id = '11111111-1111-4111-8111-111111111111';
  const request = (body = '{}', origin = 'http://localhost', query = '') => new Request('http://localhost/packet' + query, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body });
  const event = (req: Request, owner = true, item = id) => ({ request: req, locals: { user: owner ? { id: 'owner' } : null }, params: { id: item, candidateId: id } });
  const getEvent = (owner = true, packetId = id) => ({ request: new Request('http://localhost/packet/' + packetId), locals: { user: owner ? { id: 'owner' } : null }, params: { id, candidateId: id, packetId } });
  assert.equal((await GET(getEvent(false))).status, 401);
  assert.equal((await GET(getEvent(true, 'bad'))).status, 404);
  assert.equal((await POST(event(request(), false))).status, 401);
  assert.equal((await POST(event(request('{}', 'https://evil.example')))).status, 403);
  assert.equal((await POST(event(request('{"accept":true}')))).status, 400);
  assert.equal((await POST(event(request('{}', 'http://localhost', '?sha=override')))).status, 400);
  assert.equal((await POST(event(request(), true, 'bad'))).status, 404); assert.equal(calls, 0);
  for (let i = 0; i < 3; i++) { const response = await POST(event(request())); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); }
  assert.equal((await POST(event(request()))).status, 429); assert.equal(calls, 3);
  const stored = await GET(getEvent()); assert.equal(stored.status, 200); assert.equal(stored.headers.get('cache-control'), 'no-store'); assert.equal(calls, 4);
 } finally { hooks.deregister(); delete bridge.packetFixture; }
});
