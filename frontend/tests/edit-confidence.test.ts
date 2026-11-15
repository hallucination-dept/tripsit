import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChangeGraph, type GraphChange } from '../src/lib/server/change-graph.ts';
import { CaptureError, collectEditTokens, editTokensAvailable, parseCapture, scoreEdits, type CapturedCall } from '../src/lib/server/edit-confidence.ts';
import type { FileEdit } from '../src/lib/server/pi-agent.ts';
import { isUnusual, ringBelow, tintAlpha } from '../src/lib/edit-confidence.ts';

type Spec = string | [text: string, negentropy: number | null, logprob?: number, alternatives?: [string, number][]];
// Captured tokens for one written value; plain strings are confident tokens.
function value(path: (string | number)[], specs: Spec[]) {
  let cursor = 0;
  const tokens = specs.map(spec => {
    const [text, negentropy, logprob, alternatives] = typeof spec === 'string' ? [spec, 0.99, Math.log(0.99), undefined] : spec;
    const token = [cursor, cursor + text.length, logprob ?? Math.log(0.9), negentropy, text, alternatives ?? null];
    cursor += text.length;
    return token;
  });
  return { path, tokens, text: specs.map(spec => typeof spec === 'string' ? spec : spec[0]).join('') };
}
const capture = (calls: { id: string; name: 'edit' | 'write'; values: ReturnType<typeof value>[] }[]) =>
  parseCapture({ requests: [{ at: 0, calls: calls.map(call => ({ ...call, values: call.values.map(({ path, tokens }) => ({ path, tokens })) })) }] });

async function graphOf(changes: GraphChange[]) {
  const files = Object.fromEntries(changes.filter(change => change.after !== null).map(change => [change.path, change.after!]));
  return buildChangeGraph({ files: Object.keys(files), changes, read: async path => files[path] ?? null });
}

const base = [
  'export function total(items: Item[]) {',
  '  return items.reduce((sum, item) => sum + item.price, 0);',
  '}',
  '',
  'export function count(items: Item[]) {',
  '  return items.length;',
  '}',
  ''
].join('\n');

test('edit tokens score the changed lines of each symbol and file, not re-emitted or foreign text', async () => {
  const oldText = 'export function total(items: Item[]) {\n  return items.reduce((sum, item) => sum + item.price, 0);';
  // The first line of the replacement repeats the original line; its tokens must not count even when they look shaky.
  const replacement = value(['edits', 0, 'newText'], [
    'export', ' function', [' total', 0.05], '(items', ':', ' Item', '[])', ' {', '\n',
    ['  ', 0.1], 'const', [' kept', 0.4, Math.log(0.55), [[' kept', Math.log(0.55)], [' valid', Math.log(0.3)], [' priced', Math.log(0.1)]]],
    ' =', ' items', '.filter', '(item', ' =>', ' item', '.price', [' !==', 0.7], ' null', ');', '\n',
    '  ', 'return', [' kept', 0.95], '.reduce', '((sum', ',', ' item', ')', ' =>', ' sum', ' +', ' item', '.price', ',', ' 0', ');'
  ]);
  const edited = base.replace(oldText, replacement.text);
  const content = value(['content'], ['export', ' const', ' rate', ' =', [' 0.1', 0.5], ';', '\n']);
  const final = `${edited}\nexport const version = 2;\n`; // appended by bash after the edit
  const edits: FileEdit[] = [
    { toolCallId: 'e1', tool: 'edit', path: 'src/cart.ts', before: base, after: edited, parts: [{ oldText, newText: replacement.text }] },
    { toolCallId: 'w1', tool: 'write', path: 'src/rate.ts', before: null, after: content.text, parts: [{ oldText: null, newText: content.text }] }
  ];
  const files = [{ path: 'src/cart.ts', before: base, after: final }, { path: 'src/rate.ts', before: null, after: content.text }];
  const graph = await graphOf([{ path: 'src/cart.ts', change: 'modified', before: base, after: final },
    { path: 'src/rate.ts', change: 'added', before: null, after: content.text }]);
  const result = scoreEdits({ edits, files, graph, calls: capture([{ id: 'e1', name: 'edit', values: [replacement] }, { id: 'w1', name: 'write', values: [content] }]) });

  assert.equal(result.status, 'scored');
  if (result.status !== 'scored') return;
  assert.equal(result.metric, 'negentropy');
  assert.deepEqual([result.files, result.scoredFiles], [2, 2]);
  const byNode = new Map(result.nodes.map(node => [node.nodeId, node]));
  const total = byNode.get('s:src/cart.ts#total')!;
  // 12 + 15 non-whitespace tokens on the two changed lines; the repeated signature line and indentation are left out.
  assert.equal(total.tokens, 27);
  assert.equal(total.confidence, 0.4);
  assert.deepEqual({ text: total.weakest.text, line: total.weakest.line }, { text: ' kept', line: 2 });
  assert.deepEqual(total.weakest.alternatives.map(option => option.text), [' kept', ' valid', ' priced']);
  assert.equal(total.minProbability, 0.55);
  assert.equal(byNode.get('f:src/cart.ts')!.tokens, 27, 'the bash-appended line has no tokens');
  assert.equal(byNode.has('s:src/cart.ts#count'), false, 'untouched symbols are not scored');
  assert.equal(byNode.has('s:src/cart.ts#version'), false);
  assert.equal(byNode.get('s:src/rate.ts#rate')!.confidence, 0.5);
  assert.equal(result.tokens, 33);
  // 1 - (1 - F)^n with F the share of the run's tokens at or below the node's minimum.
  assert.ok(Math.abs(total.adjusted! - (1 - (1 - 1 / 33) ** 27)) < 1e-4);
  assert.deepEqual(result.nodes.map(node => node.nodeId).slice(0, 2), ['f:src/cart.ts', 's:src/cart.ts#total']);
  assert.equal(isUnusual(total), false, 'one shaky token in 27 is typical for this run');
});

test('replacements keep their own tokens whatever their order in the call, and missing top-k falls back to probability', async () => {
  const before = 'export const a = 1;\nexport const b = 2;\n';
  const first = value(['edits', 0, 'newText'], ['export', ' const', ' b', ' =', [' 20', null, Math.log(0.3)], ';']);
  const second = value(['edits', 1, 'newText'], ['export', ' const', ' a', ' =', [' 10', null, Math.log(0.6)], ';']);
  const after = 'export const a = 10;\nexport const b = 20;\n';
  const edits: FileEdit[] = [{ toolCallId: 'e1', tool: 'edit', path: 'src/n.ts', before, after,
    parts: [{ oldText: 'export const b = 2;', newText: first.text }, { oldText: 'export const a = 1;', newText: second.text }] }];
  const graph = await graphOf([{ path: 'src/n.ts', change: 'modified', before, after }]);
  const result = scoreEdits({ edits, graph, files: [{ path: 'src/n.ts', before, after }], calls: capture([{ id: 'e1', name: 'edit', values: [first, second] }]) });
  assert.equal(result.status === 'scored' && result.metric, 'probability');
  if (result.status !== 'scored') return;
  const byNode = new Map(result.nodes.map(node => [node.nodeId, node]));
  assert.equal(byNode.get('s:src/n.ts#b')!.weakest.text, ' 20');
  assert.equal(byNode.get('s:src/n.ts#a')!.confidence, 0.6);
  assert.equal(byNode.get('s:src/n.ts#a')!.adjusted, null, 'too few tokens in the run to adjust for length');
});

test('edits that do not replay exactly, and runs without tokens, report confidence as unavailable', async () => {
  const before = 'export const a = 1;\n', after = 'export const a = 2;\n';
  const graph = await graphOf([{ path: 'src/x.ts', change: 'modified', before, after }]);
  const tokens = value(['edits', 0, 'newText'], ['export', ' const', ' a', ' =', ' 2', ';']);
  // pi matched loosely: the recorded file differs from replaying the replacement.
  const loose: FileEdit[] = [{ toolCallId: 'e1', tool: 'edit', path: 'src/x.ts', before, after, parts: [{ oldText: 'export const a =  1;', newText: tokens.text }] }];
  const files = [{ path: 'src/x.ts', before, after }];
  const result = scoreEdits({ edits: loose, graph, files, calls: capture([{ id: 'e1', name: 'edit', values: [tokens] }]) });
  assert.deepEqual(result, { status: 'unavailable', reason: 'The recorded edits could not be matched to the model’s tokens.' });
  assert.equal(scoreEdits({ edits: [], graph, files, calls: [] }).status, 'unavailable');
  const wrongCall = scoreEdits({ edits: [{ ...loose[0], parts: [{ oldText: 'export const a = 1;', newText: tokens.text }] }], graph, files,
    calls: capture([{ id: 'other', name: 'edit', values: [tokens] }]) });
  assert.equal(wrongCall.status, 'unavailable', 'tokens of another call never score this edit');
});

test('captured token records are validated', () => {
  const ok = { requests: [{ at: 1, calls: [{ id: 'c', name: 'write', values: [{ path: ['content'], tokens: [[0, 1, -0.1, 0.5, 'x', [['x', -0.1], ['y', -2]]]] }] }] }] };
  const [call] = parseCapture(ok) as CapturedCall[];
  assert.deepEqual(call.values[0].tokens[0].alternatives!.map(option => option.text), ['x', 'y']);
  const broken = (token: unknown[]) => ({ requests: [{ calls: [{ id: 'c', name: 'write', values: [{ path: ['content'], tokens: [token] }] }] }] });
  for (const bad of [null, { requests: 'x' }, { requests: [{ calls: [{ id: 'c', name: 'bash', values: [] }] }] },
    broken([0, 1, 0.5, null, 'x', null]), broken([0, 1, -0.1, 1.5, 'x', null]), broken([2, 1, -0.1, null, 'x', null]), broken([0, 1, -0.1, null, 'x'])]) {
    assert.throws(() => parseCapture(bad), CaptureError, JSON.stringify(bad));
  }
});

test('the token endpoints are probed, read and cleared through the model service', async () => {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fetcher = (status: number, body: unknown) => async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status });
  };
  const signal = AbortSignal.timeout(5_000);
  assert.equal(await editTokensAvailable('https://m/runs/r', 'k', signal, fetcher(200, { requests: [] })), true);
  assert.equal(await editTokensAvailable('https://m/runs/r', 'k', signal, fetcher(404, {})), false);
  assert.equal(await editTokensAvailable('https://m/runs/r', 'k', signal, async () => { throw new Error('offline'); }), false);
  calls.length = 0;
  assert.deepEqual(await collectEditTokens('https://m/runs/r', 'k', signal, fetcher(200, { requests: [] })), []);
  assert.deepEqual(calls, [{ url: 'https://m/runs/r/tokens', method: 'GET', auth: 'Bearer k' }, { url: 'https://m/runs/r/tokens', method: 'DELETE', auth: 'Bearer k' }]);
  await assert.rejects(collectEditTokens('https://m/runs/r', 'k', signal, fetcher(500, {})), CaptureError);
});

test('the graph tint grows as confidence falls and rings are highlighted below the threshold', () => {
  assert.equal(tintAlpha(1), 0);
  const levels = [0.95, 0.8, 0.68, 0.4, 0.1, 0].map(tintAlpha);
  assert.deepEqual([...levels].sort((a, b) => a - b), levels, 'less confident edits get a stronger tint');
  assert.equal(tintAlpha(0), 0.5);
  assert.equal(tintAlpha(-0.2), 0.5, 'out-of-range values are clamped');
  assert.ok(tintAlpha(0.95) < 0.1, 'confident edits stay nearly transparent');
  assert.ok(ringBelow > 0.68 && ringBelow < 0.92, 'the live runs\' 61% and 68% edits are highlighted, the 92% one is not');
});

test('classes and files aggregate the scores of the edits inside them', async () => {
  const before = ['export class Cart {', '  items: number[] = [];', '', '  add(price: number) {', '    this.items.push(price);', '  }', '',
    '  total() {', '    return this.items.length;', '  }', '}', ''].join('\n');
  const oldText = '    this.items.push(price);';
  const replacement = value(['edits', 0, 'newText'], ['    ', 'if', ' (', 'price', ' <', ' 0', ')', ' throw', ' new', ' Error', "('", ['negative', 0.3], "');", '\n',
    '    ', 'this', '.items', '.push', '(price', ');']);
  const after = before.replace(oldText, replacement.text);
  const graph = await graphOf([{ path: 'src/cart.ts', change: 'modified', before, after }]);
  const result = scoreEdits({ graph, files: [{ path: 'src/cart.ts', before, after }], calls: capture([{ id: 'e1', name: 'edit', values: [replacement] }]),
    edits: [{ toolCallId: 'e1', tool: 'edit', path: 'src/cart.ts', before, after, parts: [{ oldText, newText: replacement.text }] }] });
  assert.equal(result.status, 'scored');
  if (result.status !== 'scored') return;
  const byNode = new Map(result.nodes.map(node => [node.nodeId, node]));
  for (const id of ['s:src/cart.ts#Cart.add', 's:src/cart.ts#Cart', 'f:src/cart.ts']) {
    assert.deepEqual([byNode.get(id)?.confidence, byNode.get(id)?.tokens, byNode.get(id)?.weakest.text], [0.3, 12, 'negative'], id);
  }
  assert.equal(byNode.has('s:src/cart.ts#Cart.total'), false, 'an untouched method has no score');
  assert.equal([...byNode.keys()].some(id => id.endsWith('#(module)')), false, 'code inside the class is not module code');
});

test('low-confidence edits get one "Low confidence" bubble on their most specific row', async () => {
  const { buildCardModel, cardBubbles, visibleRows, confidenceBubbleId } = await import('../src/lib/graph-layout.ts');
  const before = ['export class Cart {', '  add(price: number) {', '    this.items.push(price);', '  }', '}', ''].join('\n');
  const oldText = '    this.items.push(price);';
  const replacement = value(['edits', 0, 'newText'], ['    ', 'if', ' (', 'price', ' <', ' 0', ')', ' throw', ' new', ' Error', "('",
    ['negative', 0.3, Math.log(0.6), [['negative', Math.log(0.6)], ['invalid', Math.log(0.25)]]], "');", '\n', '    ', 'this', '.items', '.push', '(price', ');']);
  const after = before.replace(oldText, replacement.text);
  const graph = await graphOf([{ path: 'src/cart.ts', change: 'modified', before, after }]);
  const confidence = scoreEdits({ graph, files: [{ path: 'src/cart.ts', before, after }], calls: capture([{ id: 'e1', name: 'edit', values: [replacement] }]),
    edits: [{ toolCallId: 'e1', tool: 'edit', path: 'src/cart.ts', before, after, parts: [{ oldText, newText: replacement.text }] }] });
  const model = buildCardModel(graph, [], confidence);
  const card = model.cards.get('f:src/cart.ts')!;
  assert.deepEqual(card.lows.map(low => low.nodeId), ['s:src/cart.ts#Cart.add'], 'the class and file repeat the same low spot, so only the method gets a bubble');
  const rows = visibleRows(card, model.defaults);
  const closed = cardBubbles(card, rows, model.defaults, model.metric);
  assert.equal(closed.length, 1);
  const [bubble] = closed;
  assert.equal(bubble.kind, 'confidence');
  assert.equal(bubble.id, confidenceBubbleId('s:src/cart.ts#Cart.add'));
  assert.ok(rows.findIndex(row => row.id === 's:src/cart.ts#Cart.add') >= 0 && bubble.anchor > 51, 'it points at the method row, not the header');
  assert.match(bubble.lines.join(' '), /^Low confidence: 30% · least sure `negative` at 60%/);
  const open = cardBubbles(card, rows, new Set([...model.defaults, bubble.id]), model.metric)[0];
  assert.ok(open.lines.includes('Min. token negentropy 0.300'));
  assert.deepEqual(open.lines.slice(-2), ['Least sure, line 3: `negative` 60%', 'or `invalid` 25%']);
  assert.ok(open.height > bubble.height);
  const confident = buildCardModel(graph, [], { ...confidence, nodes: confidence.status === 'scored' ? confidence.nodes.map(node => ({ ...node, confidence: 0.9 })) : [] } as typeof confidence);
  assert.equal(confident.cards.get('f:src/cart.ts')!.lows.length, 0, 'confident edits get no bubble');
});

test('opening a bubble does not change the size the layout reserves, so cards stay put', async () => {
  const { buildCardModel, cardBubbles, visibleRows, nodeSize } = await import('../src/lib/graph-layout.ts');
  const before = 'export function add(price: number) {\n  return price;\n}\n';
  const oldText = '  return price;';
  const replacement = value(['edits', 0, 'newText'], ['  ', 'return', ' Math', '.max', '(', ['0', 0.3, Math.log(0.5), [['0', Math.log(0.5)], ['1', Math.log(0.3)]]], ',', ' price', ');']);
  const after = before.replace(oldText, replacement.text);
  const graph = await graphOf([{ path: 'src/a.ts', change: 'modified', before, after }]);
  const confidence = scoreEdits({ graph, files: [{ path: 'src/a.ts', before, after }], calls: capture([{ id: 'e1', name: 'edit', values: [replacement] }]),
    edits: [{ toolCallId: 'e1', tool: 'edit', path: 'src/a.ts', before, after, parts: [{ oldText, newText: replacement.text }] }] });
  const model = buildCardModel(graph, [], confidence);
  const card = model.cards.get('f:src/a.ts')!, rows = visibleRows(card, model.defaults);
  const closed = cardBubbles(card, rows, model.defaults, model.metric);
  const opened = cardBubbles(card, rows, new Set([...model.defaults, closed[0].id]), model.metric);
  assert.ok(opened[0].height > closed[0].height, 'the open bubble is taller');
  assert.equal(opened[0].restHeight, closed[0].height);
  assert.deepEqual(nodeSize(card, rows, opened), nodeSize(card, rows, closed));
});
