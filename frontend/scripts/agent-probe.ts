/** Live provider capability probe with synthetic public source; never executes generated code. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createGeneration, type GeneratedCandidate, type StoredCandidate } from '../src/lib/server/generation.ts';
import { createModelGeneration } from '../src/lib/server/model-generation.ts';
import type { WorkItem } from '../src/lib/server/records.ts';

function addRepair(content: string) {
  const source = ts.createSourceFile('math.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((source as ts.SourceFile & { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length) return false;
  const addition = source.statements.filter(ts.isFunctionDeclaration).find(statement => statement.name?.text === 'add');
  if (!addition?.body || addition.parameters.length !== 2 || addition.body.statements.length !== 1) return false;
  const names = addition.parameters.map(parameter => ts.isIdentifier(parameter.name) ? parameter.name.text : null);
  return addition.body.statements.some(statement => ts.isReturnStatement(statement) && statement.expression
    && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    && ts.isIdentifier(statement.expression.left) && statement.expression.left.text === names[0]
    && ts.isIdentifier(statement.expression.right) && statement.expression.right.text === names[1]);
}

if (process.argv.includes('--self-test')) {
  assert(addRepair('export function add(a: number, b: number) { return a + b; }'));
  assert(!addRepair('export function add(a: number, b: number) { return a - b; }'));
  assert(!addRepair('export function subtract(a: number, b: number) { return a + b; }'));
  assert(!addRepair('export function add(a: number, b: number) { return a + ; }'));
  console.log(JSON.stringify({ status: 'passed_static_fixture_self_test', liveProvider: false }));
} else {
  const counts = { modelCalls: 0, readCalls: 0, inspectedFiles: 0, writes: 0 };
  let stage = 'configuration';
  const actions: Array<{ format: string; kind: string; files: number; knownBlobs: boolean }> = [];
  try {
    assert(process.env.MODAL_API_URL && process.env.MODAL_PROXY_TOKEN && process.env.MODEL_ID);
    const blob = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
    const files = new Map([
      ['math.ts', 'export function add(a: number, b: number) { return a - b; }\n'],
      ['caller.ts', "import { add } from './math.ts';\nexport function total() { return add(2, 3); }\n"]
    ]);
    const item: WorkItem = { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(), snapshot: { repositoryId: 1, repository: 'fixture/public-agent-probe',
        private: false, issueNumber: 1, issueId: 1, baseSha: 'a'.repeat(40), supplied: { provenance: 'supplied',
          title: 'Repair addition used by the unchanged caller', body: 'The public add(a, b) function subtracts instead of adding. The unchanged downstream caller total() should produce 5 for add(2, 3), not -1. Inspect the source and its caller yourself, then fix addition. Preserve the caller file and public names. Return the implementation through the action protocol.' },
        inferred: [], ownerConfirmed: [] } };
    const adapter = createModelGeneration({ url: process.env.MODAL_API_URL, token: process.env.MODAL_PROXY_TOKEN, model: process.env.MODEL_ID });
    let stored: StoredCandidate | null = null;
    const generation = createGeneration({
      intake: { async get(owner, id) { assert.equal(owner, 'synthetic-probe-owner'); assert.equal(id, item.id); return structuredClone(item); } },
      github: {
        async files() { stage = 'file_listing'; return [...files].map(([path, content]) => ({ path, blobSha: blob(content) })); },
        async context(_snapshot, paths) {
          stage = 'repository_read'; counts.readCalls++; counts.inspectedFiles += paths.length;
          return paths.map(path => { const content = files.get(path); assert.notEqual(content, undefined); return { path, content: content!, originalBlob: blob(content!) }; });
        }
      },
      model: { async generate(prompt, signal) {
        stage = 'model_transport'; counts.modelCalls++;
        const result = await adapter.generate(prompt, signal);
        stage = 'model_protocol';
        const text = new TextDecoder().decode(result.rawOutput).trim();
        let format = text.startsWith('```') ? 'fenced' : 'prose';
        let kind = 'unknown'; let changed = 0; let knownBlobs = false;
        try {
          const value = JSON.parse(text); format = 'json';
          if (Array.isArray(value?.read)) kind = 'read';
          if (Array.isArray(value?.files)) {
            kind = 'files'; changed = value.files.length;
            knownBlobs = value.files.every((file: { path: string; originalBlob: string | null }) => files.has(file.path) ? file.originalBlob === blob(files.get(file.path)!) : file.originalBlob === null);
          }
        } catch { /* Keep only a fixed diagnostic category, never raw response text. */ }
        actions.push({ format, kind, files: changed, knownBlobs });
        return result;
      } },
      store: {
        async create(owner, id, candidate: GeneratedCandidate) { stage = 'candidate_collection'; assert.equal(owner, 'synthetic-probe-owner'); assert.equal(id, item.id); counts.writes++; stored = { id: '22222222-2222-4222-8222-222222222222', candidate }; return stored; },
        async get() { return stored; }
      }
    });
    const result = await generation.create('synthetic-probe-owner', item.id, undefined, AbortSignal.timeout(300_000));
    stage = 'static_candidate_inspection';
    assert(counts.modelCalls >= 2 && counts.modelCalls <= 6 && counts.readCalls >= 1 && counts.inspectedFiles >= 2);
    assert.equal(counts.writes, 1);
    assert.equal(result.candidate.files.length, 1);
    const repair = result.candidate.files[0];
    assert.equal(repair.path, 'math.ts');
    assert.equal(repair.originalBlob, blob(files.get('math.ts')!));
    assert(addRepair(new TextDecoder('utf-8', { fatal: true }).decode(repair.content)));
    console.log(JSON.stringify({ status: 'passed_configured_agent_provider_probe', ...counts,
      candidateDigest: result.candidate.outputDigest, changedBlob: repair.blobSha,
      verification: 'Static fixture shape only; generated code was not executed.', githubWrites: 0, databaseWrites: 0 }));
  } catch {
    console.log(JSON.stringify({ status: 'failed_configured_agent_provider_probe', stage, ...counts, actions, githubWrites: 0, databaseWrites: 0 }));
    process.exitCode = 1;
  }
}
