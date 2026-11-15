import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import test from 'node:test';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { ImpactGraph } from '../src/lib/server/impact.ts';

test('graph renders keyboard buttons, real arrows and escaped review text with source inspection', async () => {
  const component = new URL('../src/lib/ImpactGraph.svelte', import.meta.url);
  const compiled = compile(await readFile(component, 'utf8'), { generate: 'server', filename: component.pathname });
  assert.equal(compiled.warnings.length, 0);
  const temporary = new URL(`.impact-graph-${randomUUID()}.mjs`, import.meta.url);
  try {
    await writeFile(temporary, compiled.js.code);
    const Component = (await import(temporary.href)).default;
    const source = { revision: 'candidate' as const, path: 'src/value.ts', blobSha: 'a'.repeat(40), start: 7, end: 15, byteLength: 40 };
    const graph: ImpactGraph = { revision: { baseSha: 'a'.repeat(40), headSha: null, candidateDigest: 'b'.repeat(64) }, changed: ['changed'],
      nodes: [{ id: 'changed', kind: 'symbol', source, extraction: 'typescript:callable' }, { id: 'caller', kind: 'symbol', source: { ...source, path: 'src/caller.ts' }, extraction: 'typescript:callable' }],
      edges: [{ id: 'call', from: 'caller', to: 'changed', relationship: 'calls_symbol_lexical', resolution: 'observed', provenance: 'typescript:lexical' }] };
    const { body } = render(Component, { props: { graph, affected: graph.nodes.map((node, distance) => ({ node, distance })),
      advice: [{ id: 'review', text: 'Inspect src/value.ts. <script>globalThis.graphInjected = true</script>' }] } });
    assert.equal((body.match(/data-node-id=/g) ?? []).length, 2);
    assert(body.includes('aria-pressed="true"'));
    assert(body.includes('marker-end="url('));
    assert(body.includes('UTF-8 bytes 7–15 of 40'));
    assert(body.includes('Mentioned in review'));
    assert(body.includes('&lt;script>globalThis.graphInjected = true&lt;/script>'));
    assert(!body.includes('<script>globalThis.graphInjected'));
  } finally { await unlink(temporary).catch(() => {}); }
});
