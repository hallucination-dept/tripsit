import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildChangeGraph } from '../src/lib/server/change-graph.ts';
import { parseCapture, scoreEdits } from '../src/lib/server/edit-confidence.ts';
import { runPiAgent } from '../src/lib/server/pi-agent.ts';

// Both fixtures come from one real gemma-4-31B-it edit call (tests/fixtures/gemma4_edit_call.json at the repository
// root): the Modal service's SSE replay of it (token_capture.sse_events) and its edit tokens (token_capture.edit_tokens).
const fixtures = new URL('./fixtures/', import.meta.url);
const replay = await readFile(new URL('gemma4-edit.sse', fixtures));
const captured = JSON.parse(await readFile(new URL('gemma4-edit-capture.json', fixtures), 'utf8'));

test('pi applies a replayed Gemma 4 edit and the run scores it with the captured tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-confidence-'));
  const workspace = join(root, 'repo'), home = join(root, 'home'), agentDir = join(root, 'agent');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(agentDir)]);
  const before = 'def total(items):\n    return sum(item.price for item in items)\n';
  await writeFile(join(workspace, 'cart.py'), before);
  let requests = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (requests++ === 0) { response.end(replay); return; }
      const text = requests === 2 ? 'Done' : 'No flags.';
      const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      response.end(chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const outcome = await runPiAgent({ workspace, agentDir, home, repository: 'team/shop', instruction: 'Skip unpriced items and add a discount.',
      model: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: 'k', model: 'm', contextWindow: 32_000, maxTokens: 2_000 },
      signal: AbortSignal.timeout(20_000), onEvent: () => {} });
    const after = await readFile(join(workspace, 'cart.py'), 'utf8');
    assert.match(after, /discount=0/);
    assert.deepEqual(outcome.edits.map(edit => [edit.toolCallId, edit.tool, edit.path]), [['chatcmpl-tool-852fb1ae04983dd0', 'edit', 'cart.py']]);

    const changes = [{ path: 'cart.py', change: 'modified' as const, before, after }];
    const graph = await buildChangeGraph({ files: ['cart.py'], changes, read: async () => after });
    const result = scoreEdits({ edits: outcome.edits, calls: parseCapture(captured), graph, files: changes });
    assert.equal(result.status, 'scored');
    if (result.status !== 'scored') return;
    assert.equal(result.metric, 'probability', 'the fixture was generated without top-k logprobs');
    const total = result.nodes.find(node => node.nodeId === 's:cart.py#total')!;
    assert.deepEqual([total.weakest.text, total.weakest.line], ['amount', 2]);
    assert.ok(total.confidence > 0.5 && total.confidence < 0.6);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
