import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelGeneration } from '../src/lib/server/model-generation.ts';
const prompt = { instruction: 'trusted instruction', data: '{"untrusted":"data"}' };
const signal = () => new AbortController().signal;
const payload = (changes: Record<string, unknown> = {}) => ({ model: 'gemma', choices: [{ finish_reason: 'stop', message: { content: '{"files":[]}' } }], ...changes });
const response = (body: unknown) => new Response(JSON.stringify(body));

test('sends fixed bounded chat settings and preserves exact Unicode/CRLF response bytes', async () => {
  const content = 'é😀\r\n';
  const adapter = createModelGeneration({ url: 'https://model.example/prefix/', token: 'secret', model: 'gemma', fetcher: async (url, init) => {
    assert.equal(String(url), 'https://model.example/prefix/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'gemma', messages: [{ role: 'system', content: prompt.instruction }, { role: 'user', content: prompt.data }], temperature: 0, max_tokens: 2048, logprobs: true, top_logprobs: 0 });
    return response(payload({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  } });
  const result = await adapter.generate(prompt, signal());
  assert.deepEqual(result.rawOutput, new TextEncoder().encode(content));
  assert.equal(result.model, 'gemma');
  assert.deepEqual(result.settings, { temperature: 0, max_tokens: 2048, logprobs: true, top_logprobs: 0 });
});

test('rejects missing configuration and unsafe endpoints without network calls', async () => {
  for (const url of [undefined, 'http://model.example', 'https://user:pass@model.example', 'https://model.example/?token=x', 'https://model.example/#x', 'file:///tmp/x', 'invalid']) {
    let calls = 0;
    const adapter = createModelGeneration({ url, token: 'secret', model: 'gemma', fetcher: async () => { calls++; return response(payload()); } });
    await assert.rejects(() => adapter.generate(prompt, signal()), { status: 503 });
    assert.equal(calls, 0);
  }
  for (const config of [{ token: undefined, model: 'gemma' }, { token: 'secret', model: undefined }]) {
    await assert.rejects(() => createModelGeneration({ url: 'https://model.example', ...config }).generate(prompt, signal()), { status: 503 });
  }
});

test('allows HTTP loopback only with an explicitly injected fixture fetcher', async () => {
  const config = { url: 'http://localhost:1234', token: 'fixture', model: 'gemma' };
  await assert.rejects(() => createModelGeneration(config).generate(prompt, signal()), { status: 503 });
  assert.equal((await createModelGeneration({ ...config, fetcher: async () => response(payload()) }).generate(prompt, signal())).model, 'gemma');
});

test('rejects malformed, truncated, oversized or wrong-model output with stable safe errors', async () => {
  const cases = [() => response(null), () => response(payload({ model: 'other' })), () => response(payload({ choices: [] })), () => response(payload({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] })), () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: '\ud800' } }] })), () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(1_048_577) } }] })), () => new Response('x'.repeat(2_097_153)), () => new Response(new Uint8Array([255])), () => new Response('{'), () => new Response('secret upstream error', { status: 500 }), () => { throw new Error('secret upstream error'); }];
  for (const result of cases) {
    const adapter = createModelGeneration({ url: 'https://model.example', token: 'secret', model: 'gemma', fetcher: async () => result() });
    await assert.rejects(() => adapter.generate(prompt, signal()), (error: { status: number; message: string }) => error.status === 502 && !error.message.includes('secret'));
  }
});

test('bounds cancellation even when fetch ignores signal', async () => {
  const controller = new AbortController();
  const adapter = createModelGeneration({ url: 'https://model.example', token: 'secret', model: 'gemma', fetcher: async () => { controller.abort(); return new Promise(() => {}); } });
  await assert.rejects(() => adapter.generate(prompt, controller.signal), { status: 502 });
});

test('preserves raw selected-token observations without claiming exact content mapping', async () => {
  const tokens = [{ token: 'é', bytes: [195, 169], logprob: -0.5 }];
  for (const observed of [true, false]) {
    const adapter = createModelGeneration({ url: 'https://model.example', token: 'secret', model: 'gemma', fetcher: async () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: 'é' }, ...(observed ? { logprobs: { content: tokens } } : {}) }] })) });
    const result = await adapter.generate(prompt, signal());
    assert.deepEqual(result.observations, { status: observed ? 'observed' : 'unavailable', tokens: observed ? tokens : [] });
  }
});

test('rejects malformed or unbounded raw observations', async () => {
  for (const tokens of [[{ token: 'x', bytes: [256], logprob: -1 }], [{ token: 'x', bytes: null, logprob: 0.1 }], [{ token: 'x', bytes: null, logprob: null }], Array.from({ length: 8193 }, () => ({ token: 'x', bytes: null, logprob: -1 }))]) {
    const adapter = createModelGeneration({ url: 'https://model.example', token: 'secret', model: 'gemma', fetcher: async () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: 'x' }, logprobs: { content: tokens } }] })) });
    await assert.rejects(() => adapter.generate(prompt, signal()), { status: 502 });
  }
});
