import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildImpact, type ImpactFile, type ImpactInput } from '../src/lib/server/impact-extractor.ts';
const bytes = (text: string) => new TextEncoder().encode(text);
const version = (content: string) => ({ blobSha: createHash('sha1').update(`blob ${bytes(content).length}\0`).update(bytes(content)).digest('hex'), content });
const file = (path: string, before: string | null, after = before): ImpactFile => ({ path, base: before === null ? null : version(before), candidate: after === null ? null : version(after) });
const input = (files: ImpactFile[], paths = files.map(value => value.path)): ImpactInput => ({ baseSha: 'a'.repeat(40), candidateDigest: 'b'.repeat(64), files, repositoryPaths: paths, complete: true });

test('extracts real static import/reexport reverse paths to unchanged callers with exact UTF-8 provenance', () => {
  const source = "// é😀\r\nimport {a as renamed} from './a.js';\r\nexport {renamed};\r\n";
  const result = buildImpact(input([file('src/a.ts', 'export const a=1;', 'export const a=2;'), file('src/b.ts', source), file('src/index.ts', "export * from './b';")]));
  assert.equal(result.graph.revision.headSha, null);
  assert.equal(result.graph.revision.candidateDigest, 'b'.repeat(64));
  assert(result.impact.affected.some(item => item.node.source?.path === 'src/index.ts' && item.distance === 2));
  const observed = result.imports.find(item => item.source.path === 'src/b.ts' && item.source.revision === 'candidate')!;
  assert.equal(observed.reason, 'resolved_relative');
  assert.equal(new TextDecoder().decode(bytes(source).slice(observed.source.start, observed.source.end)), "'./a.js'");
  assert.equal(observed.source.blobSha, version(source).blobSha);
  assert.equal(result.coverage.semanticResolution, 'not_performed');
  assert.equal(result.coverage.executableChecks, 'not_run');
  assert.equal(result.impact.requiresInspection, true);
});

test('handles cycles, index imports, additions and deletion base context deterministically', () => {
  const files = [file('a.ts', "import './b';", null), file('b.ts', "import './a';"), file('dir/index.ts', null, 'export const value=1'), file('new.ts', null, "export * from './dir';")];
  const forward = buildImpact(input(files));
  assert.deepEqual(buildImpact(input([...files].reverse(), [...files.map(value => value.path)].reverse())), forward);
  assert(forward.impact.affected.some(item => item.node.source?.path === 'b.ts' && item.node.source.revision === 'base'));
  assert(forward.imports.some(item => item.source.path === 'new.ts' && item.reason === 'resolved_relative'));
  assert(forward.gaps.some(gap => gap.kind === 'missing_module' && gap.revision === 'candidate'));
});

test('retains aliases, external modules, dynamic imports, config and unsupported language boundaries', () => {
  const result = buildImpact(input([file('a.ts', '', "import x from '@/x';import y from 'external';import('./b');require('./b');"), file('b.ts', ''), file('config.json', '{}', '{"x":1}'), file('main.py', 'x=1', 'x=2')]));
  for (const kind of ['non_relative_module', 'dynamic_module', 'unsupported_language', 'non_import_dependencies_unanalyzed']) assert(result.gaps.some(gap => gap.kind === kind));
  assert(result.graph.unsupportedLanguages!.includes('python'));
  assert(result.graph.nodes.every(node => node.kind !== 'check'));
});

test('ambiguity and missing loaded sources remain gaps, never guessed resolution', () => {
  const result = buildImpact(input([file('a.ts', '', "import './target.js';import './unloaded';"), file('target.ts', ''), file('target.js', '')], ['a.ts', 'target.ts', 'target.js', 'unloaded.ts']));
  assert(result.gaps.some(gap => gap.kind === 'ambiguous_module'));
  assert(result.gaps.some(gap => gap.kind === 'module_source_unavailable'));
  assert(result.gaps.some(gap => gap.kind === 'source_coverage_incomplete'));
  assert.equal(result.coverage.complete, false);
  assert(result.graph.edges.filter(edge => edge.resolution === 'unresolved').length >= 2);
});

test('invalid syntax and incomplete repository listing are explicit, including no-op candidates', () => {
  const malformed = input([file('a.ts', 'const x=1;', 'import {')]); malformed.complete = false;
  const result = buildImpact(malformed);
  assert(result.gaps.some(gap => gap.kind === 'parse_error'));
  assert(result.gaps.some(gap => gap.kind === 'repository_coverage_incomplete'));
  const noop = buildImpact(input([file('a.ts', 'export {};')]));
  assert.equal(noop.impact.affected.length, 0);
  assert(noop.gaps.some(gap => gap.kind === 'no_observed_changes'));
});

test('validates actual blob identities, Unicode, paths, source and file limits', () => {
  for (const mutate of [
    (value: ImpactInput) => { value.files[0].base!.blobSha = 'c'.repeat(40); },
    (value: ImpactInput) => { value.files[0].candidate = version('\ud800'); },
    (value: ImpactInput) => { value.files[0].path = '../a.ts'; },
    (value: ImpactInput) => { value.repositoryPaths = new Array(1); },
    (value: ImpactInput) => { value.files = new Array(1); },
    (value: ImpactInput) => { value.files = Array.from({ length: 25 }, (_, i) => file(`${i}.ts`, '', 'x')); },
    (value: ImpactInput) => { value.files[0].candidate = version('x'.repeat(262145)); }
  ]) { const value = input([file('a.ts', '', 'x')]); mutate(value); assert.throws(() => buildImpact(value), /Invalid impact input/); }
});

test('traces changed lexical symbols to unchanged aliased cross-file callers with exact declaration provenance', () => {
  const callee = '// é😀\r\nexport function price(n: number) { return n + 1; }\r\nexport const untouched = 1;';
  const replacement = callee.replace('n + 1', 'n - 1');
  const caller = "import {price as quote} from './price.js';\nexport function invoice() { return quote(3); }";
  const result = buildImpact(input([file('price.ts', callee, replacement), file('invoice.ts', caller)]));
  const symbol = result.graph.nodes.find(node => node.kind === 'symbol' && node.source?.path === 'price.ts' && node.source.revision === 'candidate')!;
  assert(symbol, 'changed callable declaration is a graph symbol');
  assert.equal(new TextDecoder().decode(bytes(replacement).slice(symbol.source!.start, symbol.source!.end)), 'export function price(n: number) { return n - 1; }');
  assert(result.graph.changed.includes(symbol.id));
  const affectedCaller = result.impact.affected.find(item => item.node.kind === 'symbol' && item.node.source?.path === 'invoice.ts' && item.node.source.revision === 'candidate')!;
  assert(affectedCaller, 'unchanged caller is reached by a lexical call relationship');
  assert.equal(affectedCaller.distance, 1);
  assert(result.graph.edges.some(edge => edge.from === affectedCaller.node.id && edge.to === symbol.id && edge.relationship === 'calls_symbol_lexical' && edge.resolution === 'observed'));
  assert.equal(affectedCaller.node.source!.blobSha, version(caller).blobSha);
});

test('shadowed imports, property dispatch, overload ambiguity and unsupported languages stay explicit', () => {
  const result = buildImpact(input([
    file('a.ts', 'export function f() { return 1; }', 'export function f() { return 2; }'),
    file('b.ts', "import { f } from './a'; export function test(f:()=>number) { return f(); } export function dynamic(x:any) { return x.f(); }"),
    file('main.py', 'print(1)'), file('main.cpp', 'int main(){}'), file('main.cs', 'class C {}'), file('main.rs', 'fn main(){}')
  ]));
  assert(!result.graph.edges.some(edge => edge.relationship === 'calls_symbol_lexical' && result.graph.nodes.find(node => node.id === edge.to)?.source?.path === 'a.ts'));
  assert(result.gaps.some(gap => gap.kind === 'unresolved_call'));
  const coverage = result.coverage as typeof result.coverage & { languages: Array<{ language: string; extraction: string; resolution: string; executableChecks: string }> };
  for (const language of ['javascript', 'typescript', 'python', 'cpp', 'csharp', 'rust']) {
    const row = coverage.languages.find(row => row.language === language)!;
    assert(row, language);
    assert.equal(row.executableChecks, 'not_run');
    assert.equal(row.resolution, ['javascript', 'typescript'].includes(language) ? 'lexical_direct_calls_only' : 'unavailable');
  }
});

test('resolves const arrows and reexport aliases, retains deletion/rename base callers and cycles', () => {
  const sources = [
    file('amount.js', 'export const amount = () => 1;', null),
    file('new.js', null, 'export const amount = () => 2;'),
    file('barrel.js', "export {amount as value} from './amount.js';", "export {amount as value} from './new.js';"),
    file('regression.test.js', "import {value} from './barrel.js'; export const regression = () => value();"),
    file('cycle.js', 'export function left() { return right(); } export function right() { return left(); }',
      'export function left() { return right() + 1; } export function right() { return left(); }')
  ];
  const result = buildImpact(input(sources));
  for (const side of ['base', 'candidate']) {
    const caller = result.impact.affected.find(item => item.node.kind === 'symbol' && item.node.source?.path === 'regression.test.js' && item.node.source.revision === side)!;
    assert(caller);
    assert.equal(caller.distance, 1);
    const edge = result.graph.edges.find(edge => edge.id === caller.viaEdge)!;
    const target = result.graph.nodes.find(node => node.id === edge.to)!;
    assert.equal(target.source?.path, side === 'base' ? 'amount.js' : 'new.js');
  }
  assert(result.graph.edges.filter(edge => edge.relationship === 'calls_symbol_lexical' && edge.from.startsWith('candidate:')).length >= 3);
  assert.deepEqual(buildImpact(input([...sources].reverse())), result);
});

test('overloads, optional and computed calls are unresolved and source bounds cap symbol growth', () => {
  const result = buildImpact(input([file('a.ts', `export function f(x: number): number;
export function f(x: string): string;
export function f(x: any) { return x; }
export function caller() { return f(1); }
const x: any = {}; x?.f(); x['f']();`)]));
  assert(result.gaps.some(gap => gap.kind === 'ambiguous_symbol'));
  assert(result.gaps.some(gap => gap.kind === 'unresolved_call'));
  assert.equal(result.graph.edges.filter(edge => edge.relationship === 'calls_symbol_lexical').length, 0);
  const many = Array.from({ length: 1000 }, (_, index) => `function f${index}() {}`).join('\n');
  assert.throws(() => buildImpact(input([file('many.ts', many)])), /Invalid impact input/);
});
