import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGraphSvg } from '../src/lib/graph-image.ts';
import { buildChangeGraph } from '../src/lib/server/change-graph.ts';
import { graphComment, graphImageKey, publicOrigin, validGraphImageKey } from '../src/lib/server/graph-comment.ts';

const runId = '0123abcd-0000-4000-8000-000000000001';

test('image keys are signed per run and checked in constant time', () => {
  const key = graphImageKey('secret', runId);
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(validGraphImageKey('secret', runId, key), true);
  assert.equal(validGraphImageKey('secret', '0123abcd-0000-4000-8000-000000000002', key), false, 'a key opens only its own run');
  assert.equal(validGraphImageKey('other secret', runId, key), false);
  assert.equal(validGraphImageKey('secret', runId, null), false);
  assert.equal(validGraphImageKey('', runId, key), false, 'without a server secret nothing is served');
});

test('comments need a public https origin and link the image to the interactive run', () => {
  assert.equal(publicOrigin('https://tripsit.example.com/some/path'), 'https://tripsit.example.com');
  for (const value of ['http://tripsit.example.com', 'https://localhost:5173', 'https://127.0.0.1', 'not a url', undefined]) assert.equal(publicOrigin(value), null, String(value));
  const body = graphComment('https://tripsit.example.com', runId, 'k-1');
  const image = `https://tripsit.example.com/api/agent-runs/${runId}/graph.svg?key=k-1&amp;theme=`;
  assert.ok(body.includes(`<a href="https://tripsit.example.com/agent?run=${runId}"><picture><source media="(prefers-color-scheme: dark)" srcset="${image}dark">` +
    `<img alt="Dependency graph of this change" src="${image}light"></picture></a>`), body);
  assert.match(body, /\[Open the interactive graph\]\(https:\/\/tripsit\.example\.com\/agent\?run=/);
});

test('the graph picture is a transparent SVG with change badges and escaped names', async () => {
  const before = 'export function add(a: number, b: number) { return a + b; }\nexport function gone() { return add(1, 2); }\n';
  const after = 'export function add(a: number, b: number) { return b + a; }\nexport const fresh = () => add(2, 3);\n';
  const useBefore = "import { add, gone } from './math';\nexport const four = add(2, 2) + gone();\n";
  const files = { 'src/math.ts': after, 'src/use<&>.ts': "import { add } from './math';\nexport const four = add(2, 2);\n" };
  const graph = await buildChangeGraph({ files: Object.keys(files), changes: [{ path: 'src/math.ts', change: 'modified', before, after },
    { path: 'src/use<&>.ts', change: 'modified', before: useBefore, after: files['src/use<&>.ts'] }],
    read: async path => files[path as keyof typeof files] ?? null });
  const svg = await renderGraphSvg(graph);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/);
  assert.doesNotMatch(svg, /<rect[^>]*class="background"|<script/i);
  assert.match(svg, /\.strong\{fill:#1f2328\}/, 'light theme by default');
  assert.match(await renderGraphSvg(graph, 'dark'), /\.strong\{fill:#f0f6fc\}/, 'dark theme on request');
  for (const label of ['MODIFIED', 'ADDED', 'REMOVED']) assert.ok(svg.includes(`>${label}<`), label);
  assert.match(svg, /stroke-dasharray="6 4"/, 'the removed call from four to gone() is dashed');
  assert.equal(graph.edges.find(edge => edge.target === 's:src/math.ts#gone')?.change, 'deleted');
  assert.ok(svg.includes('use&#60;&#38;&#62;.ts') && !svg.includes('use<&>.ts'), 'names are escaped');
  assert.match(svg, /fill="#4ade80" fill-opacity="0.12" stroke="#4ade80"/, 'badges carry the change colour');
  assert.doesNotMatch(svg, /class="card[^"]*"[^>]*stroke="#/, 'cards themselves are not colour coded');
});
