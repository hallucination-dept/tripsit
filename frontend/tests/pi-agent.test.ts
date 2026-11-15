import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runPiAgent, type AgentEvent } from '../src/lib/server/pi-agent.ts';

const chunk = (delta: object, finish: string | null = null) =>
  ({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] });
const toolCall = (id: string, name: string, args: object) =>
  [chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }), chunk({}, 'tool_calls')];
const reply = (content: string) => [chunk({ role: 'assistant', content }), chunk({}, 'stop')];

// A scripted OpenAI-compatible streaming server: each request gets the next scripted turn.
async function fakeModel(turns: object[][]) {
  const requests: { headers: IncomingHttpHeaders; body: Record<string, any> }[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', part => { raw += part; });
    request.on('end', () => {
      requests.push({ headers: request.headers, body: JSON.parse(raw) });
      const turn = turns[requests.length - 1] ?? reply('No more scripted turns.');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const value of turn) response.write(`data: ${JSON.stringify(value)}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() };
}

test('pi edits the workspace through confined tools with a secret-free shell and reports its summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-pi-test-'));
  const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
  process.env.TRIPSIT_PI_SECRET = 'do-not-leak';
  const model = await fakeModel([
    toolCall('call_1', 'write', { path: 'hello.txt', content: 'hi\n' }),
    toolCall('call_2', 'bash', { command: 'echo "secret=[$TRIPSIT_PI_SECRET]"; pwd' }),
    toolCall('call_3', 'read', { path: '/etc/hosts' }),
    reply('Done: created hello.txt'),
    toolCall('call_4', 'flag', { path: 'hello.txt', kind: 'assumption', confidence: 'low', reason: 'Assumed a trailing newline.' }),
    reply('Flagged.')
  ]);
  const events: AgentEvent[] = [];
  try {
    const outcome = await runPiAgent({ workspace, agentDir, home, repository: 'team/app', instruction: 'Create hello.txt',
      model: { baseUrl: model.url, apiKey: 'test-key', model: 'fake-model', contextWindow: 32_000, maxTokens: 2_000 },
      signal: AbortSignal.timeout(20_000), onEvent: event => events.push(event) });
    assert.equal(outcome.summary, 'Done: created hello.txt', 'the flag review turn does not replace the summary');
    assert.deepEqual(outcome.flags.map(flag => flag.reason), ['Assumed a trailing newline.']);
    assert.equal(await readFile(join(workspace, 'hello.txt'), 'utf8'), 'hi\n');
    assert.equal(model.requests.length, 6, 'after editing, the agent gets one flag review turn');
    assert.match(JSON.stringify(model.requests[4].body.messages.at(-1)), /review your change as the human reviewer/);
    const first = model.requests[0];
    assert.equal(first.headers.authorization, 'Bearer test-key');
    assert.equal(first.body.model, 'fake-model');
    assert.equal(first.body.stream, true);
    assert.equal(first.body.max_tokens, 2_000);
    assert.equal('store' in first.body, false);
    assert.equal(first.body.messages[0].role, 'system');
    assert.match(first.body.messages[0].content, /team\/app/);
    assert.deepEqual(first.body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort(), ['bash', 'edit', 'flag', 'read', 'write']);
    assert.match(first.body.messages[0].content, /judgement_call/, 'the system prompt explains review flags');
    const afterBash = JSON.stringify(model.requests[2].body.messages);
    assert.match(afterBash, /secret=\[\]/);
    assert.ok(afterBash.includes(await realpath(workspace)), 'bash runs inside the workspace');
    assert.equal(afterBash.includes('do-not-leak'), false);
    assert.match(JSON.stringify(model.requests[3].body.messages), /outside the repository/);
    assert.deepEqual(events.filter(event => event.kind === 'tool').map(event => event.text.split(':')[0]),
      ['write', 'bash', 'read', 'flag (assumption, low confidence)']);
    assert.ok(events.some(event => event.kind === 'error' && /read failed: .*outside the repository/.test(event.text)));
    assert.deepEqual(events.at(-1), { kind: 'assistant', text: 'Flagged.' });
  } finally {
    delete process.env.TRIPSIT_PI_SECRET;
    model.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation stops the session and reports a run failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-pi-test-'));
  const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
  const model = await fakeModel([toolCall('call_1', 'bash', { command: 'sleep 5' })]);
  const controller = new AbortController();
  try {
    const run = runPiAgent({ workspace, agentDir, home, repository: 'team/app', instruction: 'Wait',
      model: { baseUrl: model.url, apiKey: 'test-key', model: 'fake-model', contextWindow: 32_000, maxTokens: 2_000 },
      signal: controller.signal, onEvent: event => { if (event.kind === 'tool') controller.abort(); } });
    await assert.rejects(run, /cancelled or timed out/);
  } finally {
    model.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the flag tool records valid review flags and tells the model about invalid ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-pi-test-'));
  const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
  const model = await fakeModel([
    toolCall('call_1', 'flag', { path: './src/pay.ts', symbol: 'charge', kind: 'high_impact', confidence: 'medium',
      reason: 'Rounds cents   half-up.', alternatives: null }),
    toolCall('call_2', 'flag', { path: '../outside.ts', kind: 'assumption', confidence: 'low', reason: 'x' }),
    toolCall('call_3', 'flag', { path: 'a.ts', kind: 'guess', confidence: 'low', reason: 'x' }),
    reply('Done')
  ]);
  const events: AgentEvent[] = [];
  try {
    const outcome = await runPiAgent({ workspace, agentDir, home, repository: 'team/app', instruction: 'Change billing',
      model: { baseUrl: model.url, apiKey: 'test-key', model: 'fake-model', contextWindow: 32_000, maxTokens: 2_000 },
      signal: AbortSignal.timeout(20_000), onEvent: event => events.push(event) });
    assert.deepEqual(outcome.flags, [{ path: 'src/pay.ts', symbol: 'charge', kind: 'high_impact', confidence: 'medium',
      reason: 'Rounds cents half-up.', alternatives: null }]);
    const replies = JSON.stringify(model.requests[3].body.messages);
    assert.match(replies, /Flag recorded \(1\)/);
    assert.equal(model.requests.length, 4, 'no review turn when nothing was edited');
    assert.match(replies, /path must be a file path inside the repository/);
    assert.ok(events.some(event => event.kind === 'tool' && event.text.startsWith('flag (high_impact, medium confidence): ./src/pay.ts › charge')));
    assert.equal(events.filter(event => event.kind === 'error').length, 2, 'both invalid flags are reported');
  } finally {
    model.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('edit and write calls record the file before and after with their call id; bash writes are not recorded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-pi-edits-'));
  const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
  const model = await fakeModel([
    toolCall('call_w', 'write', { path: 'notes/a.txt', content: 'one\n' }),
    toolCall('call_e', 'edit', { path: 'notes/a.txt', edits: [{ oldText: 'one', newText: 'two' }] }),
    toolCall('call_b', 'bash', { command: 'echo three >> notes/a.txt' }),
    reply('Done'),
    reply('No flags.')
  ]);
  try {
    const outcome = await runPiAgent({ workspace, agentDir, home, repository: 'team/app', instruction: 'Write notes',
      model: { baseUrl: model.url, apiKey: 'test-key', model: 'fake-model', contextWindow: 32_000, maxTokens: 2_000 },
      signal: AbortSignal.timeout(20_000), onEvent: () => {} });
    assert.deepEqual(outcome.edits, [
      { toolCallId: 'call_w', tool: 'write', path: 'notes/a.txt', before: null, after: 'one\n', parts: [{ oldText: null, newText: 'one\n' }] },
      { toolCallId: 'call_e', tool: 'edit', path: 'notes/a.txt', before: 'one\n', after: 'two\n', parts: [{ oldText: 'one', newText: 'two' }] }
    ]);
    assert.equal(await readFile(join(workspace, 'notes/a.txt'), 'utf8'), 'two\nthree\n');
  } finally {
    model.close();
    await rm(root, { recursive: true, force: true });
  }
});
