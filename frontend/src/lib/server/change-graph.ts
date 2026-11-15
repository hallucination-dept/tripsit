import { posix } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import ts from 'typescript';
import { analyzeSymbols, scanImports, sourceLanguage, type SourceImport, type SourceLanguage, type SourceSymbol, type SymbolForm } from './source-analysis.ts';

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'unchanged';
export type GraphNode = {
  id: string; kind: 'directory' | 'others' | 'file' | 'symbol'; label: string; path: string; parent: string | null;
  change: ChangeKind; group: boolean; containsChanges: boolean; files: number;
  symbolKind: SourceSymbol['kind'] | null; symbolForm: SymbolForm; hiddenSymbols: number; lines: string | null;
  // Symbols that changed, or that use or are used by a changed symbol in the same file.
  focus: boolean;
};
// `changed`: an end of the edge is edited. `change`: the dependency itself is new, gone, or present before and after.
export type GraphEdge = { id: string; source: string; target: string; count: number; changed: boolean; change: 'added' | 'deleted' | 'unchanged' };
export type ChangeGraph = {
  nodes: GraphNode[]; edges: GraphEdge[]; symbolDiffs: Record<string, string>;
  stats: { files: number; changedFiles: number; focusFiles: number; hiddenNeighbors: number; symbols: number };
};
export type GraphChange = { path: string; change: 'added' | 'modified' | 'deleted'; before: string | null; after: string | null };
type Options = {
  files: string[]; changes: GraphChange[]; read: (path: string) => Promise<string | null>;
  maxNeighbors?: number; maxSymbolsPerFile?: number; maxSourceFiles?: number;
};

type Side = 'before' | 'after';
const sides: Side[] = ['before', 'after'];
const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const ancestors = (path: string) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));
const within = (dir: string, root: string) => root === '' || dir === root || dir.startsWith(`${root}/`);
const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n… truncated …\n` : value;
export const nodeIds = {
  directory: (path: string) => `d:${path}`, others: (path: string) => `o:${path}`,
  file: (path: string) => `f:${path}`, symbol: (path: string, name: string) => `s:${path}#${name}`
};

const scriptSuffixes = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue', '.d.ts',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.svelte'];
type PathRule = { scope: string; base: string; pattern: string; targets: string[] };

function matchPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === specifier ? '' : null;
  const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
  return specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length
    ? specifier.slice(prefix.length, specifier.length - suffix.length) : null;
}

export function createResolver(paths: Set<string>, configs: Map<string, string>) {
  const aliasRules: PathRule[] = [], importRules: PathRule[] = [], baseUrls: { scope: string; base: string }[] = [], svelteRoots: string[] = [];
  for (const [path, text] of configs) {
    const dir = dirOf(path), name = baseName(path);
    if (name.startsWith('svelte.config.')) { svelteRoots.push(dir); continue; }
    if (name === 'package.json') {
      try {
        const imports = JSON.parse(text).imports;
        for (const [pattern, target] of Object.entries(imports && typeof imports === 'object' ? imports : {})) {
          const value = typeof target === 'string' ? target : target && typeof target === 'object'
            ? (target as Record<string, unknown>).default ?? (target as Record<string, unknown>).import ?? (target as Record<string, unknown>).node : null;
          if (typeof value === 'string') importRules.push({ scope: dir, base: dir, pattern, targets: [value] });
        }
      } catch { /* invalid package.json files contribute no rules */ }
      continue;
    }
    const options = ts.parseConfigFileTextToJson(path, text).config?.compilerOptions;
    if (!options || typeof options !== 'object') continue;
    const base = typeof options.baseUrl === 'string' ? posix.join(dir, options.baseUrl) : dir;
    if (typeof options.baseUrl === 'string') baseUrls.push({ scope: dir, base });
    for (const [pattern, targets] of Object.entries(options.paths && typeof options.paths === 'object' ? options.paths : {})) {
      if (Array.isArray(targets)) aliasRules.push({ scope: dir, base, pattern, targets: targets.filter((target): target is string => typeof target === 'string') });
    }
  }
  const nearestFirst = <T extends { scope: string }>(rules: T[], dir: string) =>
    rules.filter(rule => within(dir, rule.scope)).sort((a, b) => b.scope.length - a.scope.length);
  const tryScript = (base: string) => {
    const normalized = posix.normalize(base);
    if (normalized.startsWith('..') || normalized.startsWith('/')) return null;
    for (const suffix of scriptSuffixes) if (paths.has(normalized + suffix)) return normalized + suffix;
    const swapped = normalized.replace(/\.([mc]?)js(x?)$/, (_match, kind: string, jsx: string) => `.${kind}ts${jsx}`);
    return swapped !== normalized && paths.has(swapped) ? swapped : null;
  };
  const tryPython = (base: string) => [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`].map(path => posix.normalize(path)).find(path => paths.has(path)) ?? null;

  function resolveScript(from: string, specifier: string): string[] {
    const fromDir = dirOf(from);
    const found = (path: string | null) => path ? [path] : [];
    if (specifier.startsWith('.')) return found(tryScript(posix.join(fromDir, specifier)));
    if (specifier === '$lib' || specifier.startsWith('$lib/')) {
      const root = svelteRoots.filter(root => within(fromDir, root)).sort((a, b) => b.length - a.length)[0];
      if (root !== undefined) return found(tryScript(posix.join(root, 'src/lib', specifier.slice(4))));
    }
    for (const rule of [...nearestFirst(importRules, fromDir), ...nearestFirst(aliasRules, fromDir)]) {
      const captured = matchPattern(rule.pattern, specifier);
      if (captured === null) continue;
      for (const target of rule.targets) {
        const hit = tryScript(posix.join(rule.base, target.replace('*', captured)));
        if (hit) return [hit];
      }
    }
    for (const base of nearestFirst(baseUrls, fromDir)) {
      const hit = tryScript(posix.join(base.base, specifier));
      if (hit) return [hit];
    }
    return [];
  }

  function resolvePython(from: string, record: SourceImport): string[] {
    const dots = record.specifier.match(/^\.*/)![0].length;
    const modulePath = record.specifier.slice(dots).split('.').filter(Boolean).join('/');
    const results: string[] = [];
    const withSubmodules = (base: string) => {
      const module = modulePath ? tryPython(base) : null;
      if (module) results.push(module);
      for (const binding of record.bindings) {
        const submodule = tryPython(posix.join(base, binding.imported));
        if (submodule) results.push(submodule);
      }
    };
    if (dots > 0) {
      let dir = dirOf(from);
      for (let level = 1; level < dots; level++) dir = dirOf(dir);
      withSubmodules(posix.join(dir || '.', modulePath));
      if (!results.length && !modulePath) { const init = tryPython(dir || '.'); if (init) results.push(init); }
    } else {
      for (const root of ['', 'src', ...ancestors(from)]) {
        withSubmodules(posix.join(root || '.', modulePath));
        if (results.length) break;
      }
    }
    return [...new Set(results)];
  }

  return {
    resolve: (from: string, record: SourceImport, language: SourceLanguage) =>
      language === 'python' ? resolvePython(from, record) : resolveScript(from, record.specifier)
  };
}

export async function buildChangeGraph(options: Options): Promise<ChangeGraph> {
  const maxNeighbors = options.maxNeighbors ?? 60, maxSymbols = options.maxSymbolsPerFile ?? 80, maxSources = options.maxSourceFiles ?? 20_000;
  const changes = new Map(options.changes.map(change => [change.path, change]));
  const paths = [...new Set([...options.files, ...options.changes.filter(change => change.change === 'deleted').map(change => change.path)])].sort();
  const pathSet = new Set(paths);
  const load = (path: string) => {
    const change = changes.get(path);
    return change ? Promise.resolve(change.after ?? change.before) : options.read(path);
  };

  // Source texts (deleted files use their previous content) and resolver configuration.
  const texts = new Map<string, string>();
  const sources = paths.filter(path => sourceLanguage(path)).slice(0, maxSources);
  for (let index = 0; index < sources.length; index += 64) {
    const batch = sources.slice(index, index + 64);
    const loaded = await Promise.all(batch.map(load));
    batch.forEach((path, offset) => { const text = loaded[offset]; if (text !== null) texts.set(path, text); });
  }
  const configs = new Map<string, string>();
  for (const path of paths.filter(path => /(?:^|\/)(?:tsconfig\.json|jsconfig\.json|package\.json|svelte\.config\.[cm]?[jt]s)$/.test(path))) {
    const text = baseName(path).startsWith('svelte.config.') ? '' : await load(path);
    if (text !== null) configs.set(path, text);
  }
  const resolver = createResolver(pathSet, configs);

  const importsIn = (path: string, text: string | null) => {
    const targets = new Map<string, SourceImport[]>();
    const language = sourceLanguage(path);
    if (text === null || !language) return targets;
    for (const record of scanImports(text, language)) {
      for (const target of resolver.resolve(path, record, language)) {
        if (target !== path) targets.set(target, [...(targets.get(target) ?? []), record]);
      }
    }
    return targets;
  };
  const outgoing = new Map<string, Map<string, SourceImport[]>>();
  const incoming = new Map<string, Set<string>>();
  for (const [path, text] of texts) {
    const targets = importsIn(path, text);
    if (targets.size) outgoing.set(path, targets);
    for (const target of targets.keys()) incoming.set(target, (incoming.get(target) ?? new Set<string>()).add(path));
  }
  // Imports before and after the change; unchanged files have the same imports on both sides.
  const importSides = (path: string) => {
    const change = changes.get(path);
    const current = outgoing.get(path) ?? new Map<string, SourceImport[]>();
    return change && texts.has(path) ? { before: importsIn(path, change.before), after: importsIn(path, change.after) } : { before: current, after: current };
  };

  // Focus: changed files and their direct imports and importers.
  const changed = paths.filter(path => changes.has(path));
  const scores = new Map<string, number>();
  for (const path of changed) {
    for (const neighbor of [...(outgoing.get(path)?.keys() ?? []), ...(incoming.get(path) ?? [])]) {
      if (!changes.has(neighbor)) scores.set(neighbor, (scores.get(neighbor) ?? 0) + 1);
    }
  }
  const neighbors = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([path]) => path);
  const focus = new Set([...changed, ...neighbors.slice(0, maxNeighbors)]);
  const expanded = new Set([...focus].flatMap(ancestors));
  const representative = (path: string) => {
    if (focus.has(path)) return nodeIds.file(path);
    for (const dir of ancestors(path)) if (!expanded.has(dir)) return nodeIds.directory(dir);
    return nodeIds.others(dirOf(path));
  };

  const nodes = new Map<string, GraphNode>();
  const addNode = (node: Pick<GraphNode, 'id' | 'kind' | 'label' | 'path' | 'parent'> & Partial<GraphNode>) => {
    const full: GraphNode = { change: 'unchanged', group: false, containsChanges: false, files: 0, symbolKind: null, symbolForm: null,
      hiddenSymbols: 0, lines: null, focus: false, ...node };
    nodes.set(full.id, full);
    return full;
  };
  const parentOf = (dir: string) => dir ? nodeIds.directory(dir) : null;
  for (const dir of [...expanded].sort()) addNode({ id: nodeIds.directory(dir), kind: 'directory', label: `${baseName(dir)}/`, path: dir, parent: parentOf(dirOf(dir)), group: true });
  for (const path of paths) {
    const id = representative(path);
    let node = nodes.get(id);
    if (!node) {
      const subject = id.slice(2);
      node = id.startsWith('f:')
        ? addNode({ id, kind: 'file', label: baseName(path), path, parent: parentOf(dirOf(path)), change: changes.get(path)?.change ?? 'unchanged' })
        : id.startsWith('d:')
          ? addNode({ id, kind: 'directory', label: `${baseName(subject)}/`, path: subject, parent: parentOf(dirOf(subject)) })
          : addNode({ id, kind: 'others', label: 'other files', path: subject, parent: parentOf(subject) });
    }
    if (!node.group) node.files++;
    for (const dir of ancestors(path)) { const group = nodes.get(nodeIds.directory(dir)); if (group?.group) group.files++; }
    if (changes.has(path)) {
      node.containsChanges = true;
      for (const dir of ancestors(path)) { const group = nodes.get(nodeIds.directory(dir)); if (group) group.containsChanges = true; }
    }
  }
  for (const node of nodes.values()) if (node.kind === 'others') node.label = `${node.files} other file${node.files === 1 ? '' : 's'}`;

  // Changed files expand into symbols whose status compares their source before and after.
  type SymbolEntry = { symbol: SourceSymbol; id: string; references: Record<Side, string[]> };
  const symbolsByFile = new Map<string, Map<string, SymbolEntry>>();
  const symbolDiffs: Record<string, string> = {};
  for (const path of changed) {
    const change = changes.get(path)!;
    const before = change.before === null ? [] : analyzeSymbols(path, change.before);
    const after = change.after === null ? [] : analyzeSymbols(path, change.after);
    if (!before || !after || (change.before === null && change.after === null)) continue;
    const previous = new Map(before.map(symbol => [symbol.name, symbol])), next = new Map(after.map(symbol => [symbol.name, symbol]));
    const names = [...new Set([...next.keys(), ...previous.keys()])];
    const status = (name: string): ChangeKind => !previous.has(name) ? 'added' : !next.has(name) ? 'deleted'
      : previous.get(name)!.text !== next.get(name)!.text ? 'modified' : 'unchanged';
    const current = (name: string) => next.get(name) ?? previous.get(name)!;
    const edited = names.filter(name => status(name) !== 'unchanged');
    if (!edited.length) continue;
    const related = new Set<string>();
    for (const name of edited) for (const reference of current(name).references) if (names.includes(reference)) related.add(reference);
    for (const name of names) if (current(name).references.some(reference => edited.includes(reference))) related.add(name);
    // The whole outline is sent in source order; focus symbols are kept first when the cap applies.
    const focused = (name: string) => edited.includes(name) || related.has(name);
    const visible = [...names.filter(focused), ...names.filter(name => !focused(name))].slice(0, maxSymbols)
      .sort((a, b) => current(a).start - current(b).start || a.localeCompare(b));
    const fileNode = nodes.get(nodeIds.file(path))!;
    fileNode.group = true;
    fileNode.hiddenSymbols = names.length - visible.length;
    const entries = new Map<string, SymbolEntry>();
    for (const name of visible) {
      const symbol = current(name), id = nodeIds.symbol(path, name), kind = status(name);
      addNode({ id, kind: 'symbol', label: name, path, parent: fileNode.id, change: kind, containsChanges: kind !== 'unchanged',
        symbolKind: symbol.kind, symbolForm: symbol.form, focus: focused(name),
        lines: symbol.start === symbol.end ? `${symbol.start}` : `${symbol.start}–${symbol.end}` });
      entries.set(name, { symbol, id, references: { before: previous.get(name)?.references ?? [], after: next.get(name)?.references ?? [] } });
      if (kind !== 'unchanged') {
        const lines = (text: string | undefined) => text ? `${text.replace(/\n$/, '')}\n` : '';
        const patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, lines(previous.get(name)?.text), lines(next.get(name)?.text), '', '', { context: 3 });
        symbolDiffs[id] = clip(patch.replace(/^=+\n/, ''), 20_000);
      }
    }
    symbolsByFile.set(path, entries);
  }

  // Edges point from the dependent to its dependency.
  // Each edge is recorded from the code before and after the change, which tells new dependencies from removed ones.
  const edges = new Map<string, { id: string; source: string; target: string; seen: Record<Side, number> }>();
  const connect = (source: string, target: string, side: Side) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const id = `${source}->${target}`;
    const edge = edges.get(id) ?? { id, source, target, seen: { before: 0, after: 0 } };
    edge.seen[side]++;
    edges.set(id, edge);
  };
  const symbolTarget = (path: string, imported: string) => {
    const entries = symbolsByFile.get(path);
    const hit = !entries ? undefined : imported === 'default' ? [...entries.values()].find(entry => entry.symbol.isDefault) : entries.get(imported);
    return hit ? hit.id : representative(path);
  };
  for (const from of texts.keys()) {
    if (symbolsByFile.has(from)) continue;
    const imports = importSides(from);
    for (const side of sides) {
      for (const [to, records] of imports[side]) {
        const bindings = records.flatMap(record => record.bindings).filter(binding => binding.imported !== '*');
        if (!symbolsByFile.has(to) || !bindings.length) connect(representative(from), representative(to), side);
        for (const binding of symbolsByFile.has(to) ? bindings : []) connect(representative(from), symbolTarget(to, binding.imported), side);
      }
    }
  }
  for (const [path, entries] of symbolsByFile) {
    const imports = importSides(path);
    for (const side of sides) {
      const locals = new Map<string, { target: string; imported: string }>();
      for (const [to, records] of imports[side]) for (const record of records) for (const binding of record.bindings) locals.set(binding.local, { target: to, imported: binding.imported });
      const reached = new Set<string>();
      for (const { id, references } of entries.values()) {
        for (const reference of references[side]) {
          const local = entries.get(reference);
          if (local) { connect(id, local.id, side); continue; }
          const binding = locals.get(reference);
          if (!binding) continue;
          connect(id, binding.imported === '*' ? representative(binding.target) : symbolTarget(binding.target, binding.imported), side);
          reached.add(binding.target);
        }
      }
      for (const to of imports[side].keys()) if (!reached.has(to)) connect(nodeIds.file(path), representative(to), side);
    }
  }
  const graphEdges = [...edges.values()].map(({ id, source, target, seen }): GraphEdge => ({
    id, source, target, count: seen.after || seen.before,
    changed: nodes.get(source)!.change !== 'unchanged' || nodes.get(target)!.change !== 'unchanged',
    change: seen.before && seen.after ? 'unchanged' : seen.after ? 'added' : 'deleted'
  }));

  const depth = (node: GraphNode): number => node.parent ? 1 + depth(nodes.get(node.parent)!) : 0;
  const ordered = [...nodes.values()].map(node => ({ node, depth: depth(node) })).sort((a, b) => a.depth - b.depth).map(row => row.node);
  return {
    nodes: ordered, edges: graphEdges, symbolDiffs,
    stats: { files: paths.length, changedFiles: changed.length, focusFiles: focus.size,
      hiddenNeighbors: Math.max(0, neighbors.length - maxNeighbors), symbols: [...symbolsByFile.values()].reduce((sum, entries) => sum + entries.size, 0) }
  };
}
