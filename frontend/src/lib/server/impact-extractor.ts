import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import { analyzeImpact, type ImpactGraph, type ImpactSource } from './impact.ts';

export type ImpactFile = { path: string; base: { blobSha: string; content: string } | null; candidate: { blobSha: string; content: string } | null };
export type ImpactInput = { baseSha: string; candidateDigest: string; files: ImpactFile[]; repositoryPaths: string[]; complete: boolean };
type Side = 'base' | 'candidate';
type Gap = { kind: string; path: string; revision: Side | null; detail: string };
type ImportReference = { edgeId: string; source: ImpactSource; specifier: string | null; reason: string };
const encoder = new TextEncoder();
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const invalid = (): never => { throw new Error('Invalid impact input'); };
function validText(value: unknown): value is string {
  return typeof value === 'string' && new TextDecoder('utf-8', { ignoreBOM: true }).decode(encoder.encode(value)) === value;
}
function validPath(value: unknown): value is string {
  return validText(value) && value.length > 0 && encoder.encode(value).byteLength <= 1024
    && value === posix.normalize(value) && !value.startsWith('/')
    && !/[\\:*?"<>|\u0000-\u001f\u007f]/u.test(value)
    && !value.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/u.test(part));
}
function sha(content: Uint8Array): string { return createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex'); }
const nodeId = (side: Side, path: string) => `${side}:${createHash('sha256').update(path).digest('hex')}`;
function language(path: string) {
  const extension = posix.extname(path).toLowerCase();
  return ['.ts', '.tsx', '.mts', '.cts'].includes(extension) ? 'typescript'
    : ['.js', '.jsx', '.mjs', '.cjs'].includes(extension) ? 'javascript'
    : ({ '.py': 'python', '.rs': 'rust', '.cpp': 'cpp', '.cc': 'cpp', '.h': 'cpp', '.cs': 'csharp', '.json': 'json' }[extension] ?? (extension.slice(1) || 'unknown'));
}

export function buildImpact(input: ImpactInput) {
  if (!input || !/^[a-f0-9]{40}$/u.test(input.baseSha) || !/^[a-f0-9]{64}$/u.test(input.candidateDigest)
    || typeof input.complete !== 'boolean' || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 24
    || !Array.isArray(input.repositoryPaths) || input.repositoryPaths.length > 4096
    || Array.from(input.repositoryPaths).some(path => !validPath(path))) invalid();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of input.files) {
    if (!file || !validPath(file.path) || paths.has(file.path) || !file.base && !file.candidate) invalid();
    paths.add(file.path);
    for (const side of ['base', 'candidate'] as const) {
      const value = file[side];
      if (value === null) continue;
      if (!value || !validText(value.content) || !/^[a-f0-9]{40}$/u.test(value.blobSha)) invalid();
      const content = encoder.encode(value.content);
      totalBytes += content.byteLength;
      if (totalBytes > 262_144 || sha(content) !== value.blobSha) invalid();
    }
  }
  const files = [...input.files].sort((a, b) => compare(a.path, b.path));
  const graph: ImpactGraph = { revision: { baseSha: input.baseSha, headSha: null, candidateDigest: input.candidateDigest }, nodes: [], edges: [], changed: [], unsupportedLanguages: [] };
  const imports: ImportReference[] = [];
  const moduleTargets = new Map<string, string>();
  const gapMap = new Map<string, Gap>();
  function gap(kind: string, path: string, revision: Side | null, detail: string) {
    gapMap.set(JSON.stringify([kind, path, revision]), { kind, path, revision, detail });
  }
  if (!input.complete) gap('repository_coverage_incomplete', '', null, 'Repository path listing is incomplete.');
  const repositoryPaths = new Set([...input.repositoryPaths, ...paths]);
  const unloaded = [...repositoryPaths].filter(path => !paths.has(path));
  if (unloaded.length) gap('source_coverage_incomplete', '', null, `${unloaded.length} repository files have no supplied source; unknown callers may be omitted.`);
  for (const file of files) {
    const changed = file.base?.blobSha !== file.candidate?.blobSha;
    for (const side of ['base', 'candidate'] as const) {
      const value = file[side];
      if (!value) continue;
      const supported = extensions.includes(posix.extname(file.path).toLowerCase());
      graph.nodes.push({ id: nodeId(side, file.path), kind: 'file', extraction: supported ? `typescript@${ts.version}:static_file_imports` : 'file-level', language: language(file.path), source: { revision: side, path: file.path, blobSha: value.blobSha, start: 0, end: encoder.encode(value.content).byteLength, byteLength: encoder.encode(value.content).byteLength } });
      if (changed) graph.changed.push(nodeId(side, file.path));
      gap('non_import_dependencies_unanalyzed', file.path, side, 'Only covered lexical calls and file imports are resolved; dynamic dispatch, configuration and shared-resource effects remain unknown.');
      if (!supported) {
        graph.unsupportedLanguages!.push(language(file.path));
        gap('unsupported_language', file.path, side, 'Only JS/TS static import syntax is extracted.');
      }
    }
  }
  let visited = 0;
  function extract(file: ImpactFile, side: Side) {
    const value = file[side];
    if (!value || !extensions.includes(posix.extname(file.path).toLowerCase())) return;
    const source = ts.createSourceFile(file.path, value.content, ts.ScriptTarget.Latest, false);
    if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) {
      gap('parse_error', file.path, side, 'Import extraction is unavailable for syntactically invalid source.'); return;
    }
    const universe = new Set(repositoryPaths);
    for (const selected of files) if (selected[side] === null) universe.delete(selected.path);
    const loaded = new Set(files.filter(selected => selected[side] !== null).map(selected => selected.path));
    const queue: ts.Node[] = [source];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor];
      if (++visited > 50_000) invalid();
      ts.forEachChild(node, child => { queue.push(child); });
      let module: ts.Node | undefined;
      let dynamic = false;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) module = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) { module = node.arguments[0] ?? node; dynamic = true; }
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) { module = node.moduleReference.expression ?? node; dynamic = true; }
      else if (ts.isImportTypeNode(node)) { module = node.argument; dynamic = true; }
      if (!module) continue;
      if (imports.length >= 1024) invalid();
      const start = encoder.encode(value.content.slice(0, module.getStart(source))).byteLength;
      const end = encoder.encode(value.content.slice(0, module.end)).byteLength;
      const reference: ImpactSource = { revision: side, path: file.path, blobSha: value.blobSha, start, end, byteLength: encoder.encode(value.content).byteLength };
      const specifier = ts.isStringLiteral(module) && encoder.encode(module.text).byteLength <= 1024 ? module.text : null;
      let reason = dynamic ? 'dynamic_module' : specifier === null ? 'unsupported_module_syntax' : !specifier.startsWith('./') && !specifier.startsWith('../') ? 'non_relative_module' : 'resolved_relative';
      let target: string | null = null;
      if (reason === 'resolved_relative') {
        const resolved = posix.normalize(posix.join(posix.dirname(file.path), specifier!));
        if (!validPath(resolved) || /[?#]/u.test(specifier!)) reason = 'missing_module';
        else {
          const extension = posix.extname(resolved);
          const candidates = new Set([resolved]);
          if (!extension) for (const suffix of extensions) { candidates.add(resolved + suffix); candidates.add(`${resolved}/index${suffix}`); }
          if (extension === '.js' || extension === '.jsx') for (const suffix of ['.ts', '.tsx']) candidates.add(resolved.slice(0, -extension.length) + suffix);
          if (extension === '.mjs') candidates.add(resolved.slice(0, -4) + '.mts');
          if (extension === '.cjs') candidates.add(resolved.slice(0, -4) + '.cts');
          const matches = [...candidates].filter(path => universe.has(path));
          if (matches.length !== 1) reason = matches.length ? 'ambiguous_module' : 'missing_module';
          else if (!loaded.has(matches[0])) reason = 'module_source_unavailable';
          else { target = nodeId(side, matches[0]); moduleTargets.set(`${side}:${file.path}:${specifier}`, matches[0]); }
        }
      }
      const edgeId = `${nodeId(side, file.path)}:${start}:${end}`;
      imports.push({ edgeId, source: reference, specifier, reason });
      graph.edges.push({ id: edgeId, from: nodeId(side, file.path), to: target, relationship: ts.isExportDeclaration(node) ? 'reexports_file' : 'imports_file', resolution: target ? 'observed' : 'unresolved', provenance: `typescript@${ts.version}:module_specifier` });
      if (reason !== 'resolved_relative') gap(reason, file.path, side, 'Module target is unresolved; no semantic relationship or executable evidence is established.');
    }
  }
  try { for (const file of files) for (const side of ['base', 'candidate'] as const) extract(file, side); }
  catch { invalid(); }
  extractSymbols();
  function extractSymbols() {
    const declarations: Array<{ side: Side; key: string; text: string; id: string }> = [];
    for (const side of ['base', 'candidate'] as const) {
      const selected = files.filter(file => file[side] && extensions.includes(posix.extname(file.path).toLowerCase()));
      const sources = new Map(selected.map(file => [`/${file.path}`, ts.createSourceFile(`/${file.path}`, file[side]!.content, ts.ScriptTarget.Latest, true)]));
      const options: ts.CompilerOptions = { noLib: true, allowJs: true, checkJs: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest };
      const host: ts.CompilerHost = {
        getSourceFile: name => sources.get(name), getDefaultLibFileName: () => '', writeFile: () => {},
        getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: name => sources.has(name),
        readFile: name => sources.get(name)?.text, getCanonicalFileName: name => name,
        useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
        resolveModuleNames: (names, containing) => names.map(name => {
          const path = moduleTargets.get(`${side}:${containing.slice(1)}:${name}`);
          return path ? { resolvedFileName: `/${path}`, extension: posix.extname(path) as ts.Extension } : undefined;
        })
      };
      // No default host: repository code, tsconfig plugins, libraries and package resolution never touch the filesystem.
      const checker = ts.createProgram([...sources.keys()], options, host).getTypeChecker();
      const symbols = new Map<ts.Symbol, { id: string; declaration: ts.Node }>();
      const callableNodes = new Map<ts.Node, string>();
      const calls: Array<{ expression: ts.CallExpression | ts.NewExpression; source: ts.SourceFile; path: string }> = [];
      for (const file of selected) {
        const source = sources.get(`/${file.path}`)!;
        if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) continue;
        const queue: ts.Node[] = [source];
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const node = queue[cursor];
          ts.forEachChild(node, child => { queue.push(child); });
          const declaration = ts.isFunctionDeclaration(node) && node.name && node.body ? node
            : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
              && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
              && ts.isVariableDeclarationList(node.parent) && !!(node.parent.flags & ts.NodeFlags.Const) ? node : null;
          if (declaration) {
            const name = declaration.name!;
            const symbol = checker.getSymbolAtLocation(name);
            if (symbol && symbol.declarations?.length === 1) {
              const start = encoder.encode(source.text.slice(0, declaration.getStart(source))).byteLength;
              const end = encoder.encode(source.text.slice(0, declaration.end)).byteLength;
              const id = `${side}:symbol:${createHash('sha256').update(`${file.path}:${start}:${end}`).digest('hex')}`;
              graph.nodes.push({ id, kind: 'symbol', extraction: `typescript@${ts.version}:callable_declaration`, language: language(file.path),
                source: { revision: side, path: file.path, blobSha: file[side]!.blobSha, start, end, byteLength: encoder.encode(source.text).byteLength } });
              symbols.set(symbol, { id, declaration });
              callableNodes.set(ts.isVariableDeclaration(declaration) ? declaration.initializer! : declaration, id);
              const parents: string[] = [];
              for (let parent = declaration.parent; parent; parent = parent.parent) {
                if (ts.isFunctionDeclaration(parent)) parents.push(parent.name?.text ?? '?');
                else if (ts.isClassDeclaration(parent)) parents.push(parent.name?.text ?? '?');
              }
              declarations.push({ side, id, key: `${file.path}:${parents.reverse().join('.')}:${name.getText(source)}`, text: declaration.getText(source) });
            } else gap('ambiguous_symbol', file.path, side, 'Overloaded or ambiguous declarations are not resolved to a unique callable.');
          }
          if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body) {
            gap('unsupported_callable', file.path, side, 'Method, accessor and constructor dispatch requires inspection.');
          }
          if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push({ expression: node, source, path: file.path });
          if (graph.nodes.length > 2000) invalid();
        }
      }
      for (const { expression, source, path } of calls) {
        if (expression.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(expression.expression) && expression.expression.text === 'require') continue;
        let symbol = ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && !expression.questionDotToken ? checker.getSymbolAtLocation(expression.expression) : undefined;
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const target = symbol && symbols.get(symbol);
        if (!target || ts.isNewExpression(expression)) {
          gap('unresolved_call', path, side, 'Call target is dynamic, external, shadowed, overloaded or outside supplied callable coverage.'); continue;
        }
        let from = nodeId(side, path);
        for (let parent = expression.parent; parent; parent = parent.parent) {
          const callable = callableNodes.get(parent);
          if (callable) { from = callable; break; }
          if (ts.isFunctionLike(parent)) break;
        }
        const start = encoder.encode(source.text.slice(0, expression.getStart(source))).byteLength;
        graph.edges.push({ id: `${nodeId(side, path)}:call:${start}`, from, to: target.id, relationship: 'calls_symbol_lexical',
          resolution: 'observed', provenance: `typescript@${ts.version}:lexical_binding_not_runtime_dispatch` });
        if (graph.edges.length > 8000) invalid();
      }
    }
    for (const declaration of declarations) {
      const matching = declarations.filter(other => other.key === declaration.key && other.side !== declaration.side);
      if (matching.length !== 1 || matching[0].text !== declaration.text) graph.changed.push(declaration.id);
    }
  }
  graph.unsupportedLanguages = [...new Set(graph.unsupportedLanguages)].sort(compare);
  if (!graph.changed.length) gap('no_observed_changes', '', null, 'Supplied base and candidate files have identical blob identities.');
  imports.sort((a, b) => compare(a.edgeId, b.edgeId));
  return { graph, impact: analyzeImpact(graph), imports,
    gaps: [...gapMap.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.path, b.path) || compare(a.revision ?? '', b.revision ?? '')),
    coverage: { extraction: 'js_ts_static_file_imports' as const, semanticResolution: 'not_performed' as const, executableChecks: 'not_run' as const, complete: input.complete && unloaded.length === 0, typescriptVersion: ts.version,
      ...({ languages: ['javascript', 'typescript', 'python', 'cpp', 'csharp', 'rust'].map(language => ({ language,
        extraction: ['javascript', 'typescript'].includes(language) ? 'static_imports_and_callable_declarations' : 'file_only',
        resolution: ['javascript', 'typescript'].includes(language) ? 'lexical_direct_calls_only' : 'unavailable', executableChecks: 'not_run' })) } as { languages?: Array<{ language: string; extraction: string; resolution: string; executableChecks: string }> }) }
  };
}
