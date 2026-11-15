/** Read-only diagnostic: real authorized source/model calls, candidate storage stays in memory. */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { readJson } from '../src/lib/server/intake.ts';
import { createRecords } from '../src/lib/server/records.ts';
import { createIntake } from '../src/lib/server/work-items.ts';
import { createGitHub } from '../src/lib/server/github.ts';
import { createGeneration, type StoredCandidate } from '../src/lib/server/generation.ts';
import { createModelGeneration } from '../src/lib/server/model-generation.ts';

const id = process.argv[2];
const trace: Array<Record<string, string | number | boolean>> = [];
let stage = 'configuration';
let database: Pool | undefined;
let stored: StoredCandidate | null = null;
try {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id ?? '')) throw new Error();
  const connection = new URL(process.env.DATABASE_URL!);
  if (connection.searchParams.get('sslmode') === 'require' && !connection.searchParams.has('uselibpqcompat')) connection.searchParams.set('uselibpqcompat', 'true');
  database = new Pool({ connectionString: connection.toString(), connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  stage = 'record_owner';
  const owner = (await database.query('SELECT owner_id FROM tripsit_work_items WHERE id=$1', [id])).rows[0]?.owner_id;
  if (typeof owner !== 'string') throw new Error();
  stage = 'linked_account';
  const accounts = await database.query('SELECT "accessToken","accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2', [owner, 'github']);
  if (accounts.rows.length !== 1 || !accounts.rows[0].accessToken || !accounts.rows[0].accountId) throw new Error();
  const github = createGitHub({ appId: process.env.GITHUB_APP_ID!, privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    userToken: accounts.rows[0].accessToken, accountId: accounts.rows[0].accountId });
  const records = createRecords(database);
  const intake = createIntake({ store: records, github });
  const known = new Map<string, string>();
  const loaded = new Set<string>();
  const model = createModelGeneration({ url: process.env.MODAL_API_URL, token: process.env.MODAL_PROXY_TOKEN, model: process.env.MODEL_ID,
    fetcher: async (url, options) => {
      const current = trace[trace.length - 1];
      const started = Date.now();
      let response: Response;
      try { response = await fetch(url, options); }
      catch (cause) {
        current.elapsedMs = Date.now() - started;
        current.signalAborted = options?.signal?.aborted === true;
        current.transportFailure = options?.signal?.reason?.name === 'TimeoutError' ? 'timeout' : options?.signal?.aborted ? 'cancelled' : 'network';
        throw cause;
      }
      current.elapsedMs = Date.now() - started;
      current.httpStatus = response.status;
      if (!response.ok) {
        const failure = JSON.stringify(await readJson(response.clone(), 65536, options?.signal ?? new AbortController().signal));
        current.providerFailure = /context.{0,30}(length|window)|max_model_len|maximum.{0,40}tokens|prompt.{0,30}tokens|input.{0,40}too long/iu.test(failure) ? 'context_limit' : 'request_failure';
      }
      if (response.ok) {
        const payload = await readJson(response.clone(), 2097152, options?.signal ?? new AbortController().signal) as { choices?: Array<{ finish_reason?: unknown }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
        current.finishReason = ['stop','length'].includes(String(payload.choices?.[0]?.finish_reason)) ? String(payload.choices![0].finish_reason) : 'other';
        if (Number.isSafeInteger(payload.usage?.prompt_tokens)) current.promptTokens = Number(payload.usage!.prompt_tokens);
        if (Number.isSafeInteger(payload.usage?.completion_tokens)) current.completionTokens = Number(payload.usage!.completion_tokens);
      }
      return response;
    } });
  const generation = createGeneration({ intake,
    github: {
      async files(snapshot, signal) {
        stage = 'repository_listing';
        const result = await github.files(snapshot, signal);
        for (const file of result) known.set(file.path, file.blobSha);
        trace.push({ tool: 'listing', files: result.length, listingBytes: Buffer.byteLength(JSON.stringify(result)) });
        return result;
      },
      async context(snapshot, paths, signal) {
        stage = 'repository_context';
        trace.push({ tool: 'read', files: paths.length, cached: paths.every(path => loaded.has(path)), known: paths.every(path => known.has(path)) });
        const result = await github.context(snapshot, paths, signal);
        trace[trace.length - 1].sourceBytes = result.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
        for (const file of result) loaded.add(file.path);
        return result;
      }
    },
    model: { async generate(prompt, signal) {
      stage = 'model_transport';
      const event: Record<string, string | number | boolean> = { tool: 'model', promptBytes: Buffer.byteLength(prompt.instruction) + Buffer.byteLength(prompt.data) };
      trace.push(event);
      const result = await model.generate(prompt, signal);
      stage = 'model_action';
      const text = new TextDecoder().decode(result.rawOutput).trim();
      event.outputBytes = result.rawOutput.byteLength;
      event.format = text.startsWith('```') ? 'fenced' : 'prose';
      try {
        const action = JSON.parse(text); event.format = 'json';
        event.rootKeys = Object.keys(action ?? {}).length;
        event.action = Array.isArray(action?.read) ? 'read' : Array.isArray(action?.files) ? 'files' : 'unknown';
        if (Array.isArray(action?.read)) {
          event.reads = action.read.length;
          event.knownReads = action.read.every((path: unknown) => typeof path === 'string' && known.has(path));
          event.cachedReads = action.read.every((path: unknown) => typeof path === 'string' && loaded.has(path));
        }
        if (Array.isArray(action?.files)) {
          event.files = action.files.length;
          event.modelProvidedBlobsMatch = action.files.every((file: { path?: unknown; originalBlob?: unknown }) => typeof file?.path === 'string' && (known.has(file.path) ? file.originalBlob === known.get(file.path) : file.originalBlob === null));
          event.inspectedEdits = action.files.every((file: { path?: unknown }) => typeof file?.path === 'string' && (!known.has(file.path) || loaded.has(file.path)));
          event.fileKeysValid = action.files.every((file: unknown) => file && typeof file === 'object' && ['content,path','content,originalBlob,path'].includes(Object.keys(file).sort().join(',')));
        }
      } catch { /* Fixed categories only; never emit raw model or source text. */ }
      return result;
    } },
    store: {
      async create(_owner, _itemId, candidate) { stage = 'candidate_collection'; stored = { id: '22222222-2222-4222-8222-222222222222', candidate }; return stored; },
      async get() { return stored; }
    }
  });
  const result = await generation.create(owner, id, undefined, AbortSignal.timeout(300000));
  console.log(JSON.stringify({ status: 'passed_actual_candidate_dry_run', trace, changedFiles: result.candidate.files.length,
    candidateDigest: result.candidate.outputDigest, itemDigest: createHash('sha256').update(id).digest('hex'), databaseWrites: 0, repositoryWrites: 0 }));
} catch (cause) {
  console.log(JSON.stringify({ status: 'failed_actual_candidate_dry_run', stage, errorStatus: cause && typeof cause === 'object' && 'status' in cause ? cause.status : null,
    trace, databaseWrites: 0, repositoryWrites: 0 }));
  process.exitCode = 1;
} finally { await database?.end(); }
