import assert from 'node:assert/strict';
import test from 'node:test';
import { attention, byAttention, flagIndex, strongest } from '../src/lib/flag-levels.ts';
import { buildCardModel } from '../src/lib/graph-layout.ts';
import { buildChangeGraph } from '../src/lib/server/change-graph.ts';
import { attachFlags, FlagInputError, flagsMarkdown, parseFlag, type FlagInput } from '../src/lib/server/flags.ts';

const flag = (overrides: Partial<FlagInput>): FlagInput =>
  ({ path: 'src/shapes.ts', symbol: null, kind: 'assumption', confidence: 'medium', reason: 'Guessed.', alternatives: null, ...overrides });

test('flag input is validated and normalized', () => {
  assert.deepEqual(parseFlag({ path: './src//a.ts', symbol: '  ', kind: 'judgement_call', confidence: 'high', reason: ' Picked\n  the cache. ' }),
    { path: 'src/a.ts', symbol: null, kind: 'judgement_call', confidence: 'high', reason: 'Picked the cache.', alternatives: null });
  for (const bad of [null, [], { path: '/etc/passwd', kind: 'assumption', confidence: 'low', reason: 'x' },
    { path: 'src/../../x.ts', kind: 'assumption', confidence: 'low', reason: 'x' }, { path: 'a.ts', kind: 'guess', confidence: 'low', reason: 'x' },
    { path: 'a.ts', kind: 'assumption', confidence: '90%', reason: 'x' }, { path: 'a.ts', kind: 'assumption', confidence: 'low', reason: '' },
    { path: 'a.ts', kind: 'assumption', confidence: 'low', reason: 'x'.repeat(601) }]) {
    assert.throws(() => parseFlag(bad), FlagInputError, JSON.stringify(bad));
  }
});

test('attention rises as confidence falls and for high-impact edits', () => {
  assert.equal(attention({ kind: 'assumption', confidence: 'low' }), 'high');
  assert.equal(attention({ kind: 'assumption', confidence: 'medium' }), 'medium');
  assert.equal(attention({ kind: 'judgement_call', confidence: 'high' }), 'low');
  assert.equal(attention({ kind: 'high_impact', confidence: 'high' }), 'medium');
  assert.equal(attention({ kind: 'high_impact', confidence: 'medium' }), 'high');
  assert.equal(strongest([{ kind: 'judgement_call', confidence: 'high' }, { kind: 'assumption', confidence: 'medium' }]), 'medium');
  assert.equal(strongest([]), null);
});

test('flags attach to symbols, methods, files or nothing, and are indexed per card', async () => {
  const before = 'export class Box { scale(k: number) { return k; } }\nexport function area(b: Box) { return 1; }\n';
  const after = 'export class Box { scale(k: number) { return k * 2; } }\nexport function area(b: Box) { return 2; }\n';
  const files: Record<string, string> = { 'src/shapes.ts': after, 'src/use.ts': "import { area } from './shapes';\nexport const a = area;\n" };
  const graph = await buildChangeGraph({ files: Object.keys(files), changes: [{ path: 'src/shapes.ts', change: 'modified', before, after }],
    read: async path => files[path] ?? null });
  const flags = attachFlags([flag({ symbol: 'area()' }), flag({ symbol: 'scale' }), flag({ symbol: 'Box.scale' }), flag({ symbol: 'missing' }),
    flag({ path: 'src/use.ts', symbol: 'a' }), flag({ path: 'docs/none.md' })], graph);
  assert.deepEqual(flags.map(current => current.nodeId), ['s:src/shapes.ts#area', 's:src/shapes.ts#Box.scale', 's:src/shapes.ts#Box.scale',
    'f:src/shapes.ts', 'f:src/use.ts', null]);
  assert.deepEqual(flags.map(current => current.id), ['flag-1', 'flag-2', 'flag-3', 'flag-4', 'flag-5', 'flag-6']);
  const model = buildCardModel(graph);
  const index = flagIndex(flags, model.owner, new Set(model.cards.keys()));
  assert.equal(index.byCard.get('f:src/shapes.ts')?.length, 4, "a file card collects its symbols' flags");
  assert.equal(index.byNode.get('s:src/shapes.ts#Box.scale')?.length, 2);
  assert.equal(index.byCard.get('f:src/use.ts')?.length, 1);
});

test('the pull request lists flags, most important first', () => {
  assert.equal(flagsMarkdown([]), '');
  const text = flagsMarkdown([flag({ kind: 'judgement_call', confidence: 'high', reason: 'Chose LRU.' }),
    flag({ symbol: 'charge', kind: 'high_impact', confidence: 'low', reason: 'Rounds `cents`.', alternatives: "Banker's rounding" })]);
  const lines = text.split('\n').filter(line => line.startsWith('- '));
  assert.deepEqual(lines, ["- **High impact** (low confidence) · `src/shapes.ts` › `charge`: Rounds `cents`. _Alternatives:_ Banker's rounding",
    '- **Judgement call** (high confidence) · `src/shapes.ts`: Chose LRU.']);
  assert.deepEqual(byAttention([flag({ confidence: 'high' }), flag({ confidence: 'low' })]).map(current => current.confidence), ['low', 'high']);
});

test('flags pop out as comment bubbles beside the card, level with their rows, and open in place', async () => {
  const { visibleRows, cardBubbles, nodeSize, wrapText, layoutCards, bubbleGeometry, geometry } = await import('../src/lib/graph-layout.ts');
  assert.deepEqual(wrapText('Added `chunk instanceof ArrayBuffer` check', 14), ['Added `chunk', 'instanceof', 'ArrayBuffer`', 'check']);
  assert.deepEqual(wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  const before = 'export function one() { return 1; }\nexport function two() { return 2; }\nexport const keep = 1;\n';
  const after = 'export function one() { return 10; }\nexport function two() { return 20; }\nexport const keep = 1;\n';
  const files: Record<string, string> = { 'src/a.ts': after, 'src/use.ts': "import { one } from './a';\nexport const x = one();\n" };
  const graph = await buildChangeGraph({ files: Object.keys(files), changes: [{ path: 'src/a.ts', change: 'modified', before, after }],
    read: async path => files[path] ?? null });
  const flags = attachFlags([flag({ path: 'src/a.ts', symbol: 'two', kind: 'judgement_call', reason: 'Picked ten times the old value. '.repeat(4).trim() }),
    flag({ path: 'src/a.ts', symbol: null, kind: 'high_impact' }), flag({ path: 'src/a.ts', symbol: 'keep' })], graph);
  const model = buildCardModel(graph, flags);
  const card = model.cards.get('f:src/a.ts')!;
  const rows = visibleRows(card, model.defaults);
  assert.ok(rows.every(row => row.type !== ('flag' as string)), 'flags are not rows of the card');
  const bubbles = cardBubbles(card, rows, model.defaults);
  const headCenter = 1 + geometry.head / 2;
  const twoCenter = 2 + geometry.head + geometry.listPadding + rows.findIndex(row => row.id === 's:src/a.ts#two') * geometry.row + geometry.row / 2;
  assert.deepEqual(bubbles.map(bubble => [bubble.flag.symbol, bubble.anchor]), [[null, headCenter], ['keep', headCenter], ['two', twoCenter]],
    'the file flag and the flag on the hidden "keep" point at the header, the flag on two() at its row');
  assert.ok(bubbles.every(bubble => bubble.top === bubble.anchor), 'each bubble hangs from the row it points at, even when bubbles overlap');
  const closed = bubbles[2];
  assert.equal(closed.lines.length, 2);
  assert.ok(closed.lines[0].startsWith('Judgement call: Picked') && closed.lines[1].endsWith('…'));
  const opened = cardBubbles(card, rows, new Set([...model.defaults, closed.id])).find(bubble => bubble.id === closed.id)!;
  assert.equal(opened.lines[0], 'Judgement call · medium confidence');
  assert.ok(opened.lines.join(' ').includes('the old value. Picked ten times the old value.'), 'the whole reason is shown');
  assert.ok(opened.height > closed.height);
  const size = nodeSize(card, rows, bubbles);
  assert.equal(size.width, geometry.fileWidth + bubbleGeometry.gutter + bubbleGeometry.width);
  assert.equal(size.height, Math.max(size.cardHeight, ...bubbles.map(bubble => bubble.top + bubble.height)));
  const { edges } = await layoutCards(model, model.defaults);
  const intoA = edges.filter(edge => edge.target === 'f:src/a.ts');
  assert.ok(intoA.length > 0 && intoA.every(edge => edge.targetHandle?.startsWith('in-l:')), 'edges reach the flagged card on the side without bubbles');
});

test('zoomed out, closed bubbles shrink to an icon; open ones always show everything', async () => {
  const { bubbleMode, bubbleGeometry } = await import('../src/lib/graph-layout.ts');
  const below = bubbleGeometry.iconBelowZoom - 0.01, at = bubbleGeometry.iconBelowZoom;
  assert.deepEqual([bubbleMode(false, below), bubbleMode(false, at), bubbleMode(false, 1.5)], ['icon', 'preview', 'preview']);
  assert.deepEqual([bubbleMode(true, 0.1), bubbleMode(true, 2)], ['open', 'open']);
});
