import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChangeGraph, type GraphChange } from '../src/lib/server/change-graph.ts';
import { analyzeSymbols, scanImports } from '../src/lib/server/source-analysis.ts';

const base: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', imports: { '#lib/*': './src/lib/*' } }),
  'tsconfig.json': '{ // comments are allowed here\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
  'svelte.config.js': 'export default {};',
  'src/lib/math.ts': 'export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\nexport const unused = 1;\n',
  'src/lib/format.ts': "import { add } from './math.ts';\nexport function total(values: number[]) { return values.reduce(add, 0); }\n",
  'src/lib/alias-user.ts': "import { add } from '@/lib/math';\nexport const two = add(1, 1);\n",
  'src/hash-user.ts': "import * as math from '#lib/math.ts';\nexport const three = math.add(1, 2);\n",
  'src/routes/page.svelte': "<script lang=\"ts\">\n  import { total } from '$lib/format';\n</script>\n<p>{total([1, 2])}</p>\n",
  'src/other/a.ts': 'export const a = 1;\n',
  'src/other/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
  'docs/guide.md': '# Guide\n',
  'pkg/__init__.py': '',
  'pkg/util.py': 'def helper():\n    return 1\n\n\ndef other():\n    return 2\n',
  'scripts/tool.py': 'from pkg.util import helper\n\n\ndef run():\n    return helper()\n'
};
const after: Record<string, string> = {
  ...base,
  'src/lib/math.ts': 'export function add(a: number, b: number) { return b + a; }\nexport function mul(a: number, b: number) { return a * b; }\nexport const unused = 1;\n',
  'pkg/util.py': 'def helper():\n    return 42\n\n\ndef other():\n    return 2\n'
};
const changes: GraphChange[] = [
  { path: 'pkg/util.py', change: 'modified', before: base['pkg/util.py'], after: after['pkg/util.py'] },
  { path: 'src/lib/math.ts', change: 'modified', before: base['src/lib/math.ts'], after: after['src/lib/math.ts'] }
];
const graph = await buildChangeGraph({ files: Object.keys(after), changes, read: async path => after[path] ?? null });
const node = (id: string) => graph.nodes.find(candidate => candidate.id === id);
const edge = (source: string, target: string) => graph.edges.find(candidate => candidate.source === source && candidate.target === target);

test('changed files expand into their full outline with before/after status and focus on the edits', () => {
  assert.equal(node('f:src/lib/math.ts')?.group, true);
  assert.equal(node('f:src/lib/math.ts')?.change, 'modified');
  assert.equal(node('s:src/lib/math.ts#add')?.change, 'modified');
  assert.equal(node('s:src/lib/math.ts#sub')?.change, 'deleted');
  assert.equal(node('s:src/lib/math.ts#mul')?.change, 'added');
  assert.deepEqual(['add', 'sub', 'mul'].map(name => node(`s:src/lib/math.ts#${name}`)?.focus), [true, true, true]);
  assert.equal(node('s:src/lib/math.ts#unused')?.change, 'unchanged');
  assert.equal(node('s:src/lib/math.ts#unused')?.focus, false);
  assert.equal(node('f:src/lib/math.ts')?.hiddenSymbols, 0);
  assert.match(graph.symbolDiffs['s:src/lib/math.ts#add'], /-export function add\(a: number, b: number\) \{ return a \+ b; \}/);
  assert.equal(node('s:pkg/util.py#helper')?.change, 'modified');
  assert.equal(node('s:pkg/util.py#other')?.focus, false);
  const outline = graph.nodes.filter(current => current.parent === 'f:src/lib/math.ts').map(current => current.label);
  assert.deepEqual(outline, ['add', 'mul', 'sub', 'unused'], 'source order; a deleted symbol sorts at its old line');
});

test('importers connect to the edited symbols they use, through relative, tsconfig, package and python imports', () => {
  assert.equal(node('f:src/lib/format.ts')?.change, 'unchanged');
  assert.equal(edge('f:src/lib/format.ts', 's:src/lib/math.ts#add')?.changed, true);
  assert.ok(edge('f:src/lib/alias-user.ts', 's:src/lib/math.ts#add'));
  assert.ok(edge('f:src/hash-user.ts', 'f:src/lib/math.ts'), 'namespace imports point at the file');
  assert.ok(edge('f:scripts/tool.py', 's:pkg/util.py#helper'));
});

test('the rest of the repository collapses into directories and other-file buckets', () => {
  assert.equal(node('d:src')?.group, true);
  assert.equal(node('d:src/lib')?.containsChanges, true);
  assert.equal(node('d:src/other')?.group, false);
  assert.equal(node('d:src/other')?.files, 2);
  assert.equal(node('d:docs')?.files, 1);
  assert.equal(node('d:src/routes')?.files, 1);
  assert.equal(node('o:')?.label, '3 other files');
  assert.ok(edge('d:src/routes', 'f:src/lib/format.ts'), '$lib imports resolve through svelte.config.js');
  assert.equal(edge('d:src/routes', 'f:src/lib/format.ts')?.changed, false);
  assert.equal(graph.stats.changedFiles, 2);
  const seen = new Set<string>();
  for (const current of graph.nodes) {
    if (current.parent) assert.ok(seen.has(current.parent), `${current.id} follows its parent`);
    seen.add(current.id);
  }
});

test('deleted files keep their previous imports and importers', async () => {
  const deleted = await buildChangeGraph({
    files: Object.keys(base).filter(path => path !== 'src/other/a.ts'),
    changes: [{ path: 'src/other/a.ts', change: 'deleted', before: base['src/other/a.ts'], after: null }],
    read: async path => base[path] ?? null
  });
  assert.equal(deleted.nodes.find(current => current.id === 's:src/other/a.ts#a')?.change, 'deleted');
  assert.ok(deleted.edges.some(current => current.source === 'f:src/other/b.ts' && current.target === 's:src/other/a.ts#a'));
});

test('source analysis covers classes, components, python methods and multi-line imports', () => {
  const classes = analyzeSymbols('a.ts', 'class Box {\n  size = 1;\n  constructor() {}\n  get half() { return 1; }\n  area() { return this.size ** 2; }\n  grow = () => this.size++;\n}\nexport const twice = (x: number) => x * 2;\nexport function plain() {}\n')!;
  assert.deepEqual(classes.map(symbol => `${symbol.kind}:${symbol.name}:${symbol.form}`),
    ['class:Box:null', 'method:Box.constructor:constructor', 'method:Box.half:getter', 'method:Box.area:null', 'method:Box.grow:arrow',
      'function:twice:arrow', 'function:plain:null']);
  assert.doesNotMatch(classes[0].text, /area/);
  const component = analyzeSymbols('Card.svelte', '<script>\n  let count = $state(0);\n  function bump() { count++; }\n</script>\n<button onclick={bump}>{count}</button>\n')!;
  assert.deepEqual(component.map(symbol => symbol.name), ['count', 'bump', '(template)']);
  assert.ok(component.find(symbol => symbol.name === '(template)')!.references.includes('bump'));
  const python = analyzeSymbols('m.py', 'import os\n\n@dataclass\nclass Job:\n    name: str\n\n    def run(self):\n        return os.getcwd()\n')!;
  assert.deepEqual(python.map(symbol => `${symbol.kind}:${symbol.name}:${symbol.start}`), ['method:Job.run:7', 'class:Job:3', 'module:(module):1']);
  const imports = scanImports("import {\n  a,\n  type B as C,\n} from './x';\nimport D, * as E from \"y\";\nconst z = await import('./z');\n", 'script');
  assert.deepEqual(imports.map(record => record.specifier), ['./x', 'y', './z']);
  assert.deepEqual(imports[0].bindings, [{ local: 'a', imported: 'a' }, { local: 'C', imported: 'B' }]);
  assert.deepEqual(imports[1].bindings, [{ local: 'E', imported: '*' }, { local: 'D', imported: 'default' }]);
  const py = scanImports('from .models import (\n    User as U,\n    Team,\n)\nimport os.path as osp\n', 'python');
  assert.deepEqual(py, [{ specifier: 'os.path', bindings: [{ local: 'osp', imported: '*' }] },
    { specifier: '.models', bindings: [{ local: 'U', imported: 'User' }, { local: 'Team', imported: 'Team' }] }]);
});
