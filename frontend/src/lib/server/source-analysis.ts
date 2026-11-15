import ts from 'typescript';

export type SourceLanguage = 'script' | 'component' | 'python';
export type SymbolKind = 'function' | 'class' | 'method' | 'variable' | 'type' | 'module' | 'markup';
// How a function-like symbol is written, so the graph can mark arrows, constructors and accessors.
export type SymbolForm = 'arrow' | 'constructor' | 'getter' | 'setter' | null;
export type SourceSymbol = { name: string; kind: SymbolKind; form: SymbolForm; start: number; end: number; text: string; references: string[]; isDefault: boolean };
export type ImportBinding = { local: string; imported: string };
export type SourceImport = { specifier: string; bindings: ImportBinding[] };

export function sourceLanguage(path: string): SourceLanguage | null {
  const lower = path.toLowerCase();
  if (/\.(?:[mc]?[jt]sx?)$/.test(lower)) return 'script';
  if (lower.endsWith('.svelte') || lower.endsWith('.vue')) return 'component';
  if (lower.endsWith('.py') || lower.endsWith('.pyi')) return 'python';
  return null;
}

// Fast import scan used for every source file in the repository; comments are not stripped,
// so a commented-out import may add an edge when its target exists.
const importFrom = /(?:^|[;\n\r}])[ \t]*(?:import|export)\s+(?:type\s+)?([^'";]*?)\s+from\s*['"]([^'"\n]+)['"]/g;
const importBare = /(?:^|[;\n\r])[ \t]*import\s*['"]([^'"\n]+)['"]/g;
const importCall = /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const pythonImport = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm;
const pythonFrom = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)/gm;

function scriptBindings(clause: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const rest = clause.trim().replace(/^type\s+/, '');
  const braces = rest.match(/\{([^}]*)\}/);
  for (const part of braces ? braces[1].split(',') : []) {
    const match = part.trim().replace(/^type\s+/, '').match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (match) bindings.push({ local: match[2] ?? match[1], imported: match[1] });
  }
  const namespace = rest.match(/\*\s*as\s+([\w$]+)/);
  if (namespace) bindings.push({ local: namespace[1], imported: '*' });
  const fallback = rest.match(/^([\w$]+)\s*(?:,|$)/);
  if (fallback) bindings.push({ local: fallback[1], imported: 'default' });
  return bindings;
}

export function scanImports(text: string, language: SourceLanguage): SourceImport[] {
  const imports: SourceImport[] = [];
  if (language === 'python') {
    for (const match of text.matchAll(pythonImport)) {
      for (const part of match[1].split(',')) {
        const [module, alias] = part.trim().split(/[ \t]+as[ \t]+/);
        if (module) imports.push({ specifier: module, bindings: [{ local: alias ?? module.split('.')[0], imported: '*' }] });
      }
    }
    for (const match of text.matchAll(pythonFrom)) {
      const names = match[2].replace(/[()\\]/g, ' ').split(',').map(name => name.trim()).filter(name => name && name !== '*');
      imports.push({ specifier: match[1], bindings: names.map(name => {
        const [imported, alias] = name.split(/\s+as\s+/);
        return { local: alias ?? imported, imported };
      }).filter(binding => /^\w+$/.test(binding.imported) && /^\w+$/.test(binding.local)) });
    }
    return imports;
  }
  for (const match of text.matchAll(importFrom)) imports.push({ specifier: match[2], bindings: scriptBindings(match[1]) });
  for (const match of text.matchAll(importBare)) imports.push({ specifier: match[1], bindings: [] });
  for (const match of text.matchAll(importCall)) imports.push({ specifier: match[1], bindings: [] });
  return imports;
}

const pythonKeywords = new Set(('False None True and as assert async await break class continue def del elif else except finally for from ' +
  'global if import in is lambda nonlocal not or pass raise return try while with yield self cls print len str int list dict set').split(' '));

function identifiers(text: string, exclude: Set<string>): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) if (!exclude.has(match[0])) found.add(match[0]);
  return [...found];
}

function scriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(lower)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const isFunctionLike = (node: ts.Node | undefined) => !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const memberForm = (member: ts.ClassElement): SymbolForm => ts.isConstructorDeclaration(member) ? 'constructor'
  : ts.isGetAccessor(member) ? 'getter' : ts.isSetAccessor(member) ? 'setter'
  : ts.isPropertyDeclaration(member) && member.initializer && ts.isArrowFunction(member.initializer) ? 'arrow' : null;
const isDefaultExport = (node: ts.Node) => ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);

function scriptSymbols(path: string, code: string): SourceSymbol[] {
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, scriptKind(path));
  const line = (position: number) => file.getLineAndCharacterOfPosition(position).line + 1;
  const symbols = new Map<string, SourceSymbol>();
  const references = (node: ts.Node, own: string, skip = new Set<ts.Node>()) => {
    const names = new Set<string>();
    const visit = (current: ts.Node) => {
      if (skip.has(current)) return;
      if (ts.isIdentifier(current)) {
        const parent = current.parent;
        const property = (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
          (ts.isQualifiedName(parent) && parent.right === current) ||
          ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
            ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) ||
            ts.isSetAccessor(parent) || ts.isJsxAttribute(parent)) && parent.name === current);
        if (!property && current.text !== own) names.add(current.text);
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return [...names];
  };
  const add = (name: string, kind: SymbolKind, node: ts.Node, text = node.getText(file), refs = references(node, name), isDefault = false, form: SymbolForm = null) => {
    const existing = symbols.get(name);
    if (existing) {
      existing.text += `\n${text}`;
      existing.end = line(node.getEnd());
      existing.references = [...new Set([...existing.references, ...refs])];
      return;
    }
    symbols.set(name, { name, kind, form, start: line(node.getStart(file)), end: line(node.getEnd()), text, references: refs, isDefault });
  };
  const moduleText: string[] = [];
  let moduleStart = 0, moduleEnd = 0;
  const moduleRefs = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      add(statement.name?.text ?? 'default', 'function', statement, undefined, undefined, isDefaultExport(statement));
    } else if (ts.isClassDeclaration(statement)) {
      const className = statement.name?.text ?? 'default';
      const methods = statement.members.filter(member => ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) ||
        ts.isGetAccessor(member) || ts.isSetAccessor(member) || (ts.isPropertyDeclaration(member) && isFunctionLike(member.initializer)));
      let text = '', cursor = statement.getStart(file);
      for (const method of methods) { text += code.slice(cursor, method.getStart(file)); cursor = method.getEnd(); }
      text += code.slice(cursor, statement.getEnd());
      add(className, 'class', statement, text, references(statement, className, new Set(methods)), isDefaultExport(statement));
      for (const method of methods) {
        const member = method.name ? method.name.getText(file) : 'constructor';
        add(`${className}.${member}`, 'method', method, undefined, references(method, member), false, memberForm(method));
      }
    } else if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations;
      for (const declaration of declarations) {
        const target = declarations.length === 1 ? statement : declaration;
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name.text, isFunctionLike(declaration.initializer) ? 'function' : 'variable', target, undefined, undefined, false,
            declaration.initializer && ts.isArrowFunction(declaration.initializer) ? 'arrow' : null);
        } else {
          const names: string[] = [];
          const collect = (node: ts.Node) => { if (ts.isIdentifier(node) && ts.isBindingElement(node.parent) && node.parent.name === node) names.push(node.text); ts.forEachChild(node, collect); };
          collect(declaration.name);
          for (const name of names) add(name, 'variable', target);
        }
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) ||
      (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name))) {
      add(statement.name.text, 'type', statement);
    } else if (ts.isExportAssignment(statement)) {
      add('default', 'variable', statement, undefined, undefined, true);
    } else {
      moduleText.push(statement.getText(file));
      if (!moduleStart) moduleStart = line(statement.getStart(file));
      moduleEnd = line(statement.getEnd());
      for (const name of references(statement, '')) moduleRefs.add(name);
    }
  }
  const result = [...symbols.values()];
  if (moduleText.length) result.push({ name: '(module)', kind: 'module', form: null, start: moduleStart, end: moduleEnd, text: moduleText.join('\n'), references: [...moduleRefs], isDefault: false });
  return result;
}

// Keeps line numbers by blanking everything outside (or inside) <script> blocks.
function splitComponent(text: string) {
  const blank = (value: string) => value.replace(/[^\n]/g, ' ');
  let code = '', markup = '', cursor = 0;
  for (const match of text.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)) {
    const start = match.index!, contentStart = start + match[1].length, contentEnd = contentStart + match[2].length;
    code += blank(text.slice(cursor, contentStart)) + match[2] + blank(text.slice(contentEnd, start + match[0].length));
    markup += text.slice(cursor, start) + blank(text.slice(start, start + match[0].length));
    cursor = start + match[0].length;
  }
  code += blank(text.slice(cursor));
  markup += text.slice(cursor);
  return { code, markup };
}

function pythonSymbols(text: string): SourceSymbol[] {
  const lines = text.split('\n');
  const indent = (value: string) => (value.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
  const significant = (value: string) => value.trim() !== '' && !value.trim().startsWith('#');
  const blockEnd = (start: number, level: number) => {
    let end = start;
    for (let index = start + 1; index < lines.length; index++) {
      if (!significant(lines[index])) continue;
      if (indent(lines[index]) <= level) break;
      end = index;
    }
    return end;
  };
  const decorated = (index: number, level: number) => {
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith('@') && indent(lines[start - 1]) === level) start--;
    return start;
  };
  const definition = /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)|^[ \t]*class[ \t]+([A-Za-z_]\w*)/;
  const symbols: SourceSymbol[] = [];
  const covered = new Array<boolean>(lines.length).fill(false);
  const make = (name: string, kind: SymbolKind, start: number, end: number, body: string[]): SourceSymbol =>
    ({ name, kind, form: name.endsWith('.__init__') ? 'constructor' : null, start: start + 1, end: end + 1, text: body.join('\n'),
      references: identifiers(body.join('\n'), new Set([...pythonKeywords, name.split('.').pop()!])), isDefault: false });
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(definition);
    if (!match || indent(lines[index]) !== 0) continue;
    const start = decorated(index, 0), end = blockEnd(index, 0);
    for (let line = start; line <= end; line++) covered[line] = true;
    if (match[2]) {
      const className = match[2];
      const memberLevel = lines.slice(index + 1, end + 1).find(significant);
      const level = memberLevel === undefined ? -1 : indent(memberLevel);
      const methodLines = new Set<number>();
      for (let line = index + 1; line <= end; line++) {
        const member = lines[line].match(definition);
        if (!member?.[1] || indent(lines[line]) !== level) continue;
        const memberStart = decorated(line, level), memberEnd = blockEnd(line, level);
        for (let methodLine = memberStart; methodLine <= memberEnd; methodLine++) methodLines.add(methodLine);
        symbols.push(make(`${className}.${member[1]}`, 'method', memberStart, memberEnd, lines.slice(memberStart, memberEnd + 1)));
        line = memberEnd;
      }
      const classBody = lines.slice(start, end + 1).filter((_, offset) => !methodLines.has(start + offset));
      symbols.push(make(className, 'class', start, end, classBody));
    } else {
      symbols.push(make(match[1], 'function', start, end, lines.slice(start, end + 1)));
    }
    index = end;
  }
  const rest = lines.map((value, index) => ({ value, index })).filter(row => !covered[row.index] && significant(row.value));
  if (rest.length) symbols.push(make('(module)', 'module', rest[0].index, rest.at(-1)!.index, rest.map(row => row.value)));
  return symbols;
}

// Returns null when the file cannot be analyzed at symbol level.
export function analyzeSymbols(path: string, text: string): SourceSymbol[] | null {
  const language = sourceLanguage(path);
  try {
    if (language === 'script') return scriptSymbols(path, text);
    if (language === 'python') return pythonSymbols(text);
    if (language === 'component') {
      const { code, markup } = splitComponent(text);
      const symbols = scriptSymbols(`${path}.ts`, code);
      const template = markup.trim();
      if (template) {
        const lines = text.split('\n').length;
        symbols.push({ name: '(template)', kind: 'markup', form: null, start: 1, end: lines, text: template, references: identifiers(template, new Set()), isDefault: true });
      }
      return symbols;
    }
  } catch { return null; }
  return null;
}
