import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeImpact, type ImpactGraph, type ImpactNode, type ImpactEdge } from '../src/lib/server/impact.ts';
const revision = { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) };
const node = (id: string, kind: ImpactNode['kind'] = 'symbol'): ImpactNode => ({ id, kind, extraction: 'fixture-validated', language: 'typescript', ...(kind === 'check' ? { checkId: id } : { source: { revision: 'candidate' as const, path: `src/${id}.ts`, blobSha: 'c'.repeat(40), start: 0, end: 4, byteLength: 10 } }) });
const edge = (id: string, from: string, to: string | null, resolution: ImpactEdge['resolution'] = 'observed'): ImpactEdge => ({ id, from, to, resolution, relationship: 'depends_on', provenance: 'fixture import/call resolution' });
const graph = (): ImpactGraph => ({ revision, nodes: [node('changed'), node('caller'), node('check', 'check')], edges: [edge('call', 'caller', 'changed'), edge('test', 'check', 'caller')], changed: ['changed'] });

test('reaches unchanged cross-file caller and check with revision, spans and explainable paths', () => {
  const result = analyzeImpact(graph());
  assert.deepEqual(result.revision, revision);
  assert.deepEqual(result.affected.map(item => [item.node.id, item.distance, item.viaEdge, item.dependency]), [['changed', 0, null, null], ['caller', 1, 'call', 'changed'], ['check', 2, 'test', 'caller']]);
  assert.deepEqual(result.affected[1].node.source, node('caller').source);
  assert.deepEqual(result.edges.map(item => item.id), ['call', 'test']);
  assert.equal(result.requiresInspection, true);
  assert.equal(result.coverage.extraction, 'not_run');
  assert.equal(result.coverage.semanticResolution, 'not_verified');
  assert.equal(result.coverage.executableChecks, 'not_run');
});

test('cycles and aliases are deterministic, with inferred paths kept visibly uncertain', () => {
  const input = graph(); input.edges.push(edge('cycle', 'changed', 'check'), edge('alias', 'check', 'changed', 'inferred'));
  const first = analyzeImpact(input);
  const reversed = analyzeImpact({ ...input, nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() });
  assert.deepEqual(first, reversed);
  assert.equal(first.affected.length, 3);
  assert(first.gaps.some(gap => gap.kind === 'inferred_relationship' && gap.reference === 'alias'));
  assert.equal(first.edges.find(item => item.id === 'alias')?.resolution, 'inferred');
});

test('deletion and config/shared-resource dependencies retain base provenance and unresolved gaps', () => {
  const deleted = node('deleted'); deleted.source!.revision = 'base';
  const input: ImpactGraph = { revision, nodes: [deleted, node('config', 'configuration'), node('shared', 'resource'), node('consumer')], edges: [edge('config-read', 'consumer', 'config'), edge('shared-read', 'consumer', 'shared'), edge('ambiguous', 'consumer', null, 'unresolved'), edge('missing', 'consumer', 'not-extracted')], changed: ['deleted', 'config', 'shared', 'missing-change'] };
  const result = analyzeImpact(input);
  assert.equal(result.affected.find(item => item.node.id === 'deleted')?.node.source?.revision, 'base');
  assert(result.affected.some(item => item.node.id === 'consumer'));
  assert(result.gaps.some(gap => gap.kind === 'unresolved_relationship'));
  assert(result.gaps.some(gap => gap.kind === 'missing_node' && gap.reference === 'missing'));
  assert(result.gaps.some(gap => gap.kind === 'missing_changed_node'));
  assert.equal(result.requiresInspection, true);
});

test('file fallback and unsupported languages never claim extraction or executable coverage', () => {
  const input = graph(); input.nodes[0].kind = 'file'; input.nodes[0].extraction = 'file-level'; input.unsupportedLanguages = ['rust', 'cpp'];
  const result = analyzeImpact(input);
  assert(result.gaps.some(gap => gap.kind === 'file_fallback'));
  assert.deepEqual(result.coverage.unsupportedLanguages, ['cpp', 'rust']);
  assert(result.gaps.some(gap => gap.kind === 'unsupported_language' && gap.reference === 'rust'));
  assert(result.gaps.some(gap => gap.kind === 'graph_completeness_unverified'));
});

test('depth cutoff is explicit, while malformed revisions, spans, graph identities and limits fail closed', () => {
  const result = analyzeImpact(graph(), { maxNodes: 10, maxEdges: 10, maxDepth: 1 });
  assert.deepEqual(result.affected.map(item => item.node.id), ['changed', 'caller']);
  assert(result.gaps.some(gap => gap.kind === 'depth_limit'));
  for (const mutate of [
    (input: ImpactGraph) => { input.revision = { ...revision, headSha: 'branch-name' }; },
    (input: ImpactGraph) => { input.nodes[0].source!.end = 11; },
    (input: ImpactGraph) => { input.nodes[0].source!.start = -1; },
    (input: ImpactGraph) => { input.nodes[0].source!.path = '../outside'; },
    (input: ImpactGraph) => { input.nodes.push(input.nodes[0]); },
    (input: ImpactGraph) => { input.edges.push(input.edges[0]); },
    (input: ImpactGraph) => { input.edges[0].resolution = 'certain' as never; }
  ]) { const input = graph(); mutate(input); assert.throws(() => analyzeImpact(input), /Invalid impact graph/); }
  assert.throws(() => analyzeImpact(graph(), { maxNodes: 2, maxEdges: 10, maxDepth: 1 }), /Invalid impact graph/);
  assert.throws(() => analyzeImpact(graph(), { maxNodes: 10, maxEdges: 1, maxDepth: 1 }), /Invalid impact graph/);
  assert.throws(() => analyzeImpact(graph(), { maxNodes: 10, maxEdges: 10, maxDepth: 65 }), /Invalid impact graph/);
});
