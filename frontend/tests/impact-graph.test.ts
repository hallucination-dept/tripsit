import assert from 'node:assert/strict';
import test from 'node:test';
import { projectImpactGraph, mentionsNode } from '../src/lib/impact-graph.ts';
import type { ImpactGraph, ImpactNode } from '../src/lib/server/impact.ts';
const node = (id: string, revision: 'base' | 'candidate' = 'candidate', path = `src/${id}.ts`): ImpactNode => ({ id, kind: 'symbol', extraction: 'typescript:lexical',
  source: { revision, path, blobSha: 'a'.repeat(40), start: 0, end: 8, byteLength: 8 } });
const graph = (): ImpactGraph => ({ revision: { baseSha: 'a'.repeat(40), headSha: null, candidateDigest: 'b'.repeat(64) },
  nodes: [node('change'), node('caller'), node('context'), node('old', 'base')], changed: ['change'],
  edges: [{ id: 'call', from: 'caller', to: 'change', relationship: 'calls_symbol_lexical', resolution: 'observed', provenance: 'fixture' },
    { id: 'cycle', from: 'change', to: 'caller', relationship: 'imports_file', resolution: 'observed', provenance: 'fixture' },
    { id: 'missing', from: 'caller', to: null, relationship: 'imports_file', resolution: 'unresolved', provenance: 'fixture' }] });

test('projects only actual nodes and arrow relationships deterministically through cycles', () => {
  const input = graph();
  const affected = [{ node: input.nodes[0], distance: 0 }, { node: input.nodes[1], distance: 1 }];
  const before = structuredClone(input);
  const result = projectImpactGraph(input, affected, { revision: 'candidate', affectedOnly: true });
  assert.equal(result.nodes.length, 2); assert.equal(result.edges.length, 2);
  assert(result.nodes.find(row => row.node.id === 'change')!.x < result.nodes.find(row => row.node.id === 'caller')!.x);
  assert.equal(result.nodes.find(row => row.node.id === 'change')!.status, 'changed');
  assert.equal(result.nodes.find(row => row.node.id === 'caller')!.status, 'downstream');
  assert.equal(result.unresolvedEdges, 1);
  for (const edge of result.edges) { assert(input.edges.some(row => row.id === edge.edge.id)); assert.match(edge.path, /^M/); }
  assert.deepEqual(projectImpactGraph({ ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }, affected, { revision: 'candidate', affectedOnly: true }), result);
  assert.deepEqual(input, before);
});

test('bounded projection keeps selected nodes visible and exposes omissions for 2000-node graphs', () => {
  const input = graph(); input.nodes = Array.from({ length: 2000 }, (_, i) => node(`N${String(i).padStart(4, '0')}`)); input.changed = ['N0000'];
  input.edges = input.nodes.slice(1).map(row => ({ id: row.id, from: row.id, to: 'N0000', relationship: 'imports_file', resolution: 'observed', provenance: 'fixture' }));
  const result = projectImpactGraph(input, [], { selectedId: 'N1999', revision: 'candidate', affectedOnly: false });
  assert.equal(result.nodes.length, 60); assert.equal(result.omittedNodes, 1940);
  assert(result.nodes.some(row => row.node.id === 'N1999'));
  assert(result.edges.length <= 120);
  assert.equal(result.totalNodes, 2000); assert.equal(result.totalEdges, 1999);
  const points = new Set(result.nodes.map(row => `${row.x},${row.y}`)); assert.equal(points.size, 60);
  assert(result.nodes.every(row => row.x >= 0 && row.y >= 0 && row.x + 188 <= result.width && row.y + 64 <= result.height));
});

test('revision and literal path search filter context without fabricating dependencies', () => {
  const input = graph();
  const result = projectImpactGraph(input, [], { revision: 'base', affectedOnly: false, query: 'old.ts' });
  assert.deepEqual(result.nodes.map(row => row.node.id), ['old']); assert.equal(result.hiddenNodes, 3);
  assert.equal(result.edges.length, 0);
  const empty = projectImpactGraph(input, [], { revision: 'candidate', affectedOnly: true, query: '<script>' });
  assert.equal(empty.nodes.length, 0); assert.equal(empty.matchingNodes, 0);
});

test('advice highlights require an explicit known path or node identifier with token boundaries', () => {
  const input = node('candidate:abcdef', 'candidate', 'src/a.ts');
  for (const advice of ['Inspect `src/a.ts`.', 'src/a.ts:12 has a concern.', 'Node candidate:abcdef is mentioned.']) assert(mentionsNode(advice, input));
  for (const advice of ['Inspect src/a.tsx instead.', 'Inspect other/src/a.ts.', 'candidate:abcdef0', '𐐀src/a.ts', 'src/a.ts𐐀', 'General suggestion, no source reference.']) assert(!mentionsNode(advice, input));
  assert(!mentionsNode('anything', { ...input, id: '', source: undefined }));
});
