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
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'gemma', messages: [{ role: 'system', content: prompt.instruction }, { role: 'user', content: prompt.data }], temperature: 0, max_tokens: 2048 });
    return response(payload({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  } });
  const result = await adapter.generate(prompt, signal());
  assert.deepEqual(result.rawOutput, new TextEncoder().encode(content));
  assert.equal(result.model, 'gemma');
  assert.deepEqual(result.settings, { temperature: 0, max_tokens: 2048 });
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

test('rejects missing, malformed or oversized text with stable safe errors', async () => {
  const cases = [() => response(null), () => response(payload({ choices: [] })), () => response(payload({ choices: [{ message: { content: 42 } }] })), () => response(payload({ choices: [null] })), () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: '\ud800' } }] })), () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(1_048_577) } }] })), () => new Response('x'.repeat(2_097_153)), () => new Response(new Uint8Array([255])), () => new Response('{'), () => new Response('secret upstream error', { status: 500 }), () => { throw new Error('secret upstream error'); }];
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

test('preserves exact provider token bytes and logprobs without deriving bytes from token text', async () => {
  const content = 'é😀\r\n';
  const tokens = [
    { token: 'é', bytes: [195, 169], logprob: -0.1 },
    { token: 'display differs', bytes: [240, 159, 152, 128], logprob: -1 },
    { token: '\r\n', bytes: [13, 10], logprob: 0 }
  ];
  const adapter = createModelGeneration({ url: 'https://model.example', token: 'fixture', model: 'gemma',
    fetcher: async () => response(payload({ choices: [{ finish_reason: 'stop', message: { content }, logprobs: { content: tokens } }] })) });
  const result = await adapter.generate(prompt, signal());
  assert.deepEqual(result.observations, { status: 'observed', tokens });
  assert.equal(result.finishReason, 'stop');
});

test('missing, malformed, oversized or mismatched token observations remain unavailable', async () => {
  const valid = { token: 'x', bytes: [120], logprob: -1 };
  for (const logprobs of [undefined, {}, { content: [] }, { content: [{ ...valid, bytes: null }] },
    { content: [{ ...valid, bytes: [256] }] }, { content: [{ ...valid, bytes: [121] }] },
    { content: [{ ...valid, logprob: 1 }] }, { content: Array.from({ length: 8193 }, () => valid) }]) {
    const adapter = createModelGeneration({ url: 'https://model.example', token: 'fixture', model: 'gemma',
      fetcher: async () => response(payload({ choices: [{ finish_reason: 'stop', message: { content: 'x' }, logprobs }] })) });
    const result = await adapter.generate(prompt, signal());
    assert.deepEqual(result.observations, { status: 'unavailable', tokens: [] });
  }
});

test('truncated or unknown completion never produces a candidate', async () => {
  for (const finish_reason of ['length', 'content_filter', null, undefined, { stop: true }]) {
    const adapter = createModelGeneration({ url: 'https://model.example', token: 'fixture', model: 'gemma',
      fetcher: async () => response(payload({ choices: [{ finish_reason, message: { content: '{"files":[]}' } }] })) });
    await assert.rejects(() => adapter.generate(prompt, signal()), { status: 502 });
  }
});

test('reports inference deadline expiry as a sanitized timeout instead of invalid output', async () => {
  const controller = new AbortController();
  const adapter = createModelGeneration({ url: 'https://model.example', token: 'fixture', model: 'gemma', fetcher: async () => {
    controller.abort(new DOMException('private upstream timeout detail', 'TimeoutError'));
    return new Promise(() => {});
  } });
  await assert.rejects(() => adapter.generate(prompt, controller.signal), (error: { status: number; message: string }) => error.status === 504 && !error.message.includes('private'));
});
