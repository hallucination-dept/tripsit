import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { IntakeError } from '../src/lib/server/intake.ts';

const itemId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

test('candidate routes keep auth/CSRF/body bounds, owner scope and no-store boundaries', async () => {
  let calls = 0; let denied = false; let aborted = false;
  const candidate = { id: candidateId, candidate: { baseSha: 'a'.repeat(40), expiresAt: new Date(Date.now() + 60_000).toISOString(), outputDigest: 'b'.repeat(64), model: 'gemma', settings: {}, rawOutput: new Uint8Array([1]), mapping: { status: 'unavailable', reason: 'No mapping.' }, files: [{ path: 'a.ts', originalBlob: null, blobSha: 'c'.repeat(40), content: new TextEncoder().encode('é\r\n') }] } };
  const item = { id: itemId, snapshot: { baseSha: 'a'.repeat(40), private: false } };
  const bridge = globalThis as typeof globalThis & { candidateTestRuntime?: (...args: unknown[]) => unknown; candidateTestIntake?: (...args: unknown[]) => unknown; candidateTestGithub?: (...args: unknown[]) => unknown };
  const check = (owner: string) => { if (denied || owner !== 'owner') throw new IntakeError(404, 'Unavailable.'); };
  bridge.candidateTestRuntime = async () => { calls++; return {
    async create(owner: string, selected: string, paths: string[], signal: AbortSignal) { check(owner); assert.equal(selected, itemId); assert.deepEqual(paths, ['a.ts']); if (aborted) return new Promise(() => {}); assert(!signal.aborted); return candidate; },
    async get(owner: string, selected: string, id: string) { check(owner); assert.equal(selected, itemId); assert.equal(id, candidateId); return candidate; }
  }; };
  bridge.candidateTestIntake = async () => { calls++; return { async get(owner: string, selected: string) { check(owner); assert.equal(selected, itemId); return item; } }; };
  bridge.candidateTestGithub = async () => ({ async files(snapshot: unknown) { assert.equal(snapshot, item.snapshot); return [{ path: 'a.ts', blobSha: 'c'.repeat(40) }]; } });
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const mocks: Record<string, string> = {
      '#lib/server/generation-runtime.ts': 'export const candidateRuntime=(...args)=>globalThis.candidateTestRuntime(...args);',
      '#lib/server/intake-runtime.ts': 'export const intakeRuntime=(...args)=>globalThis.candidateTestIntake(...args);export const githubRuntime=(...args)=>globalThis.candidateTestGithub(...args);',
      '#lib/server/generation-limit.ts': 'export const createGenerationLimit=()=>({run:(_owner,action)=>action()});'
    };
    return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context);
  } });
  try {
    const { POST } = await import('../src/routes/api/work-items/[id]/candidates/+server.ts');
    const { GET } = await import('../src/routes/api/work-items/[id]/candidates/[candidateId]/+server.ts');
    const { GET: files } = await import('../src/routes/api/work-items/[id]/files/+server.ts');
    const request = (body = '{"paths":["a.ts"]}', origin = 'http://localhost', signal?: AbortSignal) => new Request(`http://localhost/api/work-items/${itemId}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) }, body, signal });
    const event = (req: Request, owner: string | null = 'owner', id = itemId) => ({ request: req, locals: { user: owner ? { id: owner } : null }, params: { id, candidateId } });
    assert.equal((await POST(event(request(), null))).status, 401);
    assert.equal(calls, 0);
    assert.equal((await POST(event(request('{}', '')))).status, 403);
    assert.equal((await POST(event(request('{')))).status, 400);
    assert.equal((await POST(event(request(' '.repeat(4097))))).status, 413);
    for (const body of ['{}', '{"paths":[]}', '{"paths":[1]}', '{"paths":["a.ts"],"policy":"none"}']) assert.equal((await POST(event(request(body)))).status, 400);
    assert.equal(calls, 0);
    assert.equal((await POST(event(request(), 'owner', 'bad'))).status, 404);
    assert.equal((await POST(event(request(), 'other'))).status, 404);
    const created = await POST(event(request()));
    assert.equal(created.status, 200); assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal((await created.json()).candidate.files[0].content, 'é\r\n');
    const read = await GET(event(new Request('http://localhost/')));
    assert.equal(read.status, 200); assert.equal((await read.json()).id, candidateId);
    const listed = await files(event(new Request('http://localhost/')));
    assert.deepEqual(await listed.json(), { itemId, baseSha: item.snapshot.baseSha, files: [{ path: 'a.ts', blobSha: 'c'.repeat(40) }] });
    denied = true;
    for (const route of [GET, files]) { const result = await route(event(new Request('http://localhost/'))); assert.equal(result.status, 404); assert.equal(result.headers.get('cache-control'), 'no-store'); }
    denied = false; aborted = true;
    const controller = new AbortController(); const pending = POST(event(request(undefined, undefined, controller.signal))); controller.abort();
    assert.equal((await pending).status, 504);
  } finally { hooks.deregister(); delete bridge.candidateTestRuntime; delete bridge.candidateTestIntake; delete bridge.candidateTestGithub; }
});
