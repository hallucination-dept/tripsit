import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCardModel, cardLinks, cardSize, geometry, layoutCards, relations, symbolGlyph, visibleRows } from '../src/lib/graph-layout.ts';
import { buildChangeGraph } from '../src/lib/server/change-graph.ts';

const before = [
  'export class Box {', '  size = 1;', '  area() { return this.size ** 2; }', '  grow() { this.size++; }', '}',
  'export const scale = (box: Box, factor: number) => box.size * factor;',
  'export function unrelated() { return 1; }', 'export const other = 2;', ''
].join('\n');
const after = before.replace('return this.size ** 2;', 'return this.size * this.size;') +
  'export const double = (x: number) => x * 2;\nexport const quadruple = (x: number) => double(double(x));\n';
const files: Record<string, string> = { 'src/shapes.ts': after, 'src/use.ts': "import { Box, scale } from './shapes';\nexport const result = scale(new Box(), 2);\n" };
const graph = await buildChangeGraph({ files: Object.keys(files), read: async path => files[path] ?? null,
  changes: [{ path: 'src/shapes.ts', change: 'modified', before, after }] });
const model = buildCardModel(graph);
const shapes = model.cards.get('f:src/shapes.ts')!;
const id = (name: string) => `s:src/shapes.ts#${name}`;
const labels = (open: Set<string>) => visibleRows(shapes, open).map(row => row.type === 'symbol' ? row.node.label : `more:${row.count}`);

test('files become cards with an outline; classes fold their methods and unrelated symbols sit behind "more"', () => {
  assert.deepEqual([...model.cards.keys()].sort(), ['f:src/shapes.ts', 'f:src/use.ts'], 'folders holding focus files are not drawn');
  assert.equal(shapes.breadcrumb, 'src');
  assert.ok(model.defaults.has('f:src/shapes.ts') && model.defaults.has(id('Box')));
  assert.deepEqual(labels(model.defaults), ['Box', 'Box.area', 'Box.grow', 'double', 'quadruple', 'more:3']);
  assert.deepEqual(labels(new Set([...model.defaults, 'more:f:src/shapes.ts'])),
    ['Box', 'Box.area', 'Box.grow', 'scale', 'unrelated', 'other', 'double', 'quadruple', 'more:3']);
  assert.deepEqual(labels(new Set(['f:src/shapes.ts'])), ['Box', 'double', 'quadruple', 'more:3'], 'a closed class hides its methods');
  assert.deepEqual(labels(new Set()), [], 'a closed card shows only its header');
  const rows = visibleRows(shapes, model.defaults);
  assert.equal(cardSize(shapes, rows).height, 2 + geometry.head + 1 + 2 * geometry.listPadding + rows.length * geometry.row);
  assert.deepEqual(['Box.area', 'double', 'scale', 'unrelated'].map(name => symbolGlyph(graph.nodes.find(node => node.id === id(name))!)),
    ['fn', '()=>', '()=>', 'fn']);
});

test('edges attach to visible rows, fall back to the header when folded, and skip references inside one file', () => {
  const anchors = (open: Set<string>) => cardLinks(model, open).map(link => `${link.source.handle}->${link.target.handle}:${link.count}`).sort();
  assert.deepEqual(anchors(model.defaults), ['head->head:1', `head->${id('Box')}:1`], 'the folded scale() import lands on the header');
  assert.deepEqual(anchors(new Set([...model.defaults, 'more:f:src/shapes.ts'])), [`head->${id('Box')}:1`, `head->${id('scale')}:1`]);
  assert.deepEqual(anchors(new Set()), ['head->head:2'], 'a closed card merges its edges');
  assert.ok(graph.edges.some(edge => edge.source === id('quadruple') && edge.target === id('double')));
  assert.ok(cardLinks(model, model.defaults).every(link => link.source.card !== link.target.card));
  assert.deepEqual(relations(model, id('double')).usedBy, ['quadruple']);
  assert.deepEqual(relations(model, 'f:src/use.ts').uses.sort(), ['Box · shapes.ts', 'scale · shapes.ts']);
  assert.deepEqual(relations(model, 'f:src/shapes.ts').usedBy, ['use.ts']);
});

test('the layout is vertical: dependents above dependencies, no overlaps, edges on the facing side', async () => {
  const { nodes, edges } = await layoutCards(model, model.defaults);
  const box = (cardId: string) => nodes.find(node => node.id === cardId)!;
  const use = box('f:src/use.ts'), target = box('f:src/shapes.ts');
  assert.ok(use.position.y + use.height! <= target.position.y, 'use.ts sits above the file it imports');
  for (const a of nodes) for (const b of nodes) {
    if (a === b) continue;
    const apart = a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x ||
      a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y;
    assert.ok(apart, `${a.id} and ${b.id} do not overlap`);
  }
  const toBox = edges.find(edge => edge.targetHandle?.endsWith(id('Box')))!;
  const horizontal = use.position.x >= target.position.x + target.width! || use.position.x + use.width! <= target.position.x;
  assert.match(toBox.sourceHandle!, horizontal ? /^out-[lr]:head$/ : /^out-r:head$/);
  assert.match(toBox.targetHandle!, horizontal ? /^in-[lr]:/ : /^in-r:/);
  assert.match(String(toBox.style), /#6b6b6b/, 'an edge into an unchanged class is grey');
});
