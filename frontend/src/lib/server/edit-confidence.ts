import { diffLines } from 'diff';
import { nodeIds, type ChangeGraph } from './change-graph.ts';
import type { FileEdit } from './pi-agent.ts';
import { analyzeSymbols } from './source-analysis.ts';
import type { ConfidenceMetric, NodeConfidence, RunConfidence } from '../edit-confidence.ts';

// Scores each changed graph node from the tokens the model wrote it with. The Modal service keeps those tokens per
// run (token_capture.py); the agent records every edit and write (pi-agent.ts). Replaying the edits over the base
// files gives each character of the final file the token that wrote it. See specs/EDIT_CONFIDENCE_PLAN.md.

export type CapturedToken = {
  start: number; end: number; logprob: number; negentropy: number | null; text: string;
  alternatives: { text: string; probability: number }[] | null;
};
export type CapturedValue = { path: (string | number)[]; tokens: CapturedToken[] };
export type CapturedCall = { id: string; name: 'edit' | 'write'; values: CapturedValue[] };
export type ConfidenceFile = { path: string; before: string | null; after: string | null };

export class CaptureError extends Error {}

const MAX_CALLS = 2_000, MAX_TOKENS = 60_000;
// The length adjustment needs enough tokens in the run to say what is unusual.
const MIN_POOL = 20;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const round = (value: number) => Math.round(value * 10_000) / 10_000;

// Validates the Modal service's token records: { requests: [{ calls: [{ id, name, values: [{ path, tokens }] }] }] }.
export function parseCapture(value: unknown): CapturedCall[] {
  const fail = (): never => { throw new CaptureError('The model service returned invalid edit tokens.'); };
  const object = (item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : fail();
  const list = (item: unknown, limit: number) => Array.isArray(item) && item.length <= limit ? item : fail();
  const calls: CapturedCall[] = [];
  let total = 0;
  for (const request of list(object(value).requests, MAX_CALLS)) {
    for (const rawCall of list(object(request).calls, MAX_CALLS)) {
      const call = object(rawCall);
      if (typeof call.id !== 'string' || call.id.length > 200 || (call.name !== 'edit' && call.name !== 'write')) fail();
      const values = list(call.values, 1_000).map(rawValue => {
        const entry = object(rawValue);
        const path = list(entry.path, 10).map(key => typeof key === 'string' || (Number.isSafeInteger(key) && (key as number) >= 0) ? key as string | number : fail());
        const tokens = list(entry.tokens, MAX_TOKENS).map(rawToken => {
          const [start, end, logprob, negentropy, text, alternatives] = list(rawToken, 6);
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) < (start as number)
            || !finite(logprob) || logprob > 1e-6 || typeof text !== 'string'
            || (negentropy !== null && (!finite(negentropy) || negentropy < -1e-6 || negentropy > 1 + 1e-6))) fail();
          const options = alternatives === null ? null : list(alternatives, 5).map(option => {
            const [optionText, optionLogprob] = list(option, 2);
            return typeof optionText === 'string' && finite(optionLogprob) && optionLogprob <= 1e-6
              ? { text: optionText, probability: Math.min(1, Math.exp(optionLogprob)) } : fail();
          });
          return { start: start as number, end: end as number, logprob: Math.min(0, logprob as number), negentropy: negentropy as number | null, text: text as string, alternatives: options };
        });
        total += tokens.length;
        if (total > MAX_TOKENS) fail();
        return { path, tokens };
      });
      calls.push({ id: call.id as string, name: call.name as CapturedCall['name'], values });
    }
  }
  return calls;
}

type TokenInfo = CapturedToken & { scored: boolean };
type FileState = { text: string; owner: Int32Array };

// Keeps the token owners of the unchanged start and end; text in between came from elsewhere and has no owner.
function sync(state: FileState, text: string): FileState {
  if (state.text === text) return state;
  const max = Math.min(state.text.length, text.length);
  let prefix = 0;
  while (prefix < max && state.text.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && state.text.charCodeAt(state.text.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
  const owner = new Int32Array(text.length).fill(-1);
  owner.set(state.owner.subarray(0, prefix), 0);
  owner.set(state.owner.subarray(state.text.length - suffix), text.length - suffix);
  return { text, owner };
}

const valueKey = (callId: string, path: (string | number)[]) => `${callId}\u0000${JSON.stringify(path)}`;

// Applies one recorded edit. Replacements are located as pi applies them (exact, unique, against the file before
// the call); when that does not reproduce the recorded result, the change is kept without token owners.
function apply(state: FileState, edit: FileEdit, owners: Map<string, { text: string; owner: Int32Array }>): FileState {
  const current = sync(state, edit.before ?? '');
  const owned = (path: (string | number)[], text: string) => {
    const value = owners.get(valueKey(edit.toolCallId, path));
    return value && value.text === text ? value.owner : new Int32Array(text.length).fill(-1);
  };
  if (edit.tool === 'write') {
    const content = edit.parts[0]?.newText;
    return content === edit.after ? { text: content, owner: owned(['content'], content) } : sync(current, edit.after);
  }
  const before = current.text;
  const located = edit.parts.map((part, index) => ({ part, index, at: part.oldText ? before.indexOf(part.oldText) : -1 }))
    .sort((a, b) => a.at - b.at);
  const unique = located.every(({ part, at }) => at >= 0 && before.indexOf(part.oldText!, at + 1) < 0);
  const separate = located.every((item, position) => position === 0 || located[position - 1].at + located[position - 1].part.oldText!.length <= item.at);
  if (!located.length || !unique || !separate) return sync(current, edit.after);
  let text = '', cursor = 0;
  const pieces: Int32Array[] = [];
  for (const { part, index, at } of located) {
    text += before.slice(cursor, at) + part.newText;
    pieces.push(current.owner.subarray(cursor, at), owned(['edits', index, 'newText'], part.newText));
    cursor = at + part.oldText!.length;
  }
  text += before.slice(cursor);
  pieces.push(current.owner.subarray(cursor));
  if (text !== edit.after) return sync(current, edit.after);
  const owner = new Int32Array(text.length);
  let offset = 0;
  for (const piece of pieces) { owner.set(piece, offset); offset += piece.length; }
  return { text, owner };
}

// 1-based line numbers of `after` that are new or changed compared with `before`.
function changedLines(before: string | null, after: string): Set<number> {
  const lines = new Set<number>();
  const count = (text: string) => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  if (before === null) { for (let line = 1; line <= count(after); line++) lines.add(line); return lines; }
  let line = 1;
  for (const part of diffLines(before, after)) {
    if (part.removed) continue;
    const size = part.count ?? count(part.value);
    if (part.added) for (let offset = 0; offset < size; offset++) lines.add(line + offset);
    line += size;
  }
  return lines;
}

export function scoreEdits(input: { edits: FileEdit[]; calls: CapturedCall[]; files: ConfidenceFile[]; graph: ChangeGraph }): RunConfidence {
  if (!input.calls.length) return { status: 'unavailable', reason: 'The model service kept no edit tokens for this run.' };
  // Every captured token gets an id; each captured value gets an owner array over its text.
  const tokens: TokenInfo[] = [];
  const owners = new Map<string, { text: string; owner: Int32Array }>();
  for (const call of input.calls) {
    for (const value of call.values) {
      const text = value.tokens.map(token => token.text).join('');
      const owner = new Int32Array(text.length).fill(-1);
      let cursor = 0, exact = true;
      for (const token of value.tokens) {
        if (token.start !== cursor || token.end - token.start !== token.text.length) { exact = false; break; }
        // Whitespace-only tokens are formatting, not decisions, and are not scored.
        owner.fill(tokens.push({ ...token, scored: /\S/.test(token.text) }) - 1, token.start, token.end);
        cursor = token.end;
      }
      if (exact) owners.set(valueKey(call.id, value.path), { text, owner });
    }
  }

  const present = new Set(input.graph.nodes.map(node => node.id));
  const buckets = new Map<string, Set<number>>();
  const lineOf = new Map<number, number>();
  const pool = new Set<number>();
  let scoredFiles = 0;
  const files = input.files.filter((file): file is ConfidenceFile & { after: string } => file.after !== null);
  for (const file of files) {
    let state: FileState = { text: file.before ?? '', owner: new Int32Array((file.before ?? '').length).fill(-1) };
    for (const edit of input.edits) if (edit.path === file.path) state = apply(state, edit, owners);
    state = sync(state, file.after);
    const symbols = (analyzeSymbols(file.path, file.after) ?? []).map(symbol => ({ ...symbol, id: nodeIds.symbol(file.path, symbol.name) }))
      .filter(symbol => present.has(symbol.id)).sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const fileId = nodeIds.file(file.path);
    let lineStart = 0, scored = false;
    const lines = file.after.split('\n');
    const changed = changedLines(file.before, file.after);
    for (let index = 0; index < lines.length; index++) {
      const line = index + 1, start = lineStart;
      lineStart += lines[index].length + 1;
      if (!changed.has(line)) continue;
      // A token counts for its file and every symbol around it (a method and its class), so containers carry the
      // lowest score of their edits. The module bucket only takes top-level code that no other symbol contains.
      const containing = symbols.filter(item => item.start <= line && line <= item.end);
      const members = containing.filter(item => item.kind !== 'module');
      const targets = [fileId, ...(members.length ? members : containing.slice(0, 1)).map(item => item.id)];
      for (let position = start; position < start + lines[index].length + (index < lines.length - 1 ? 1 : 0); position++) {
        const id = state.owner[position];
        if (id === undefined || id < 0 || !tokens[id].scored) continue;
        for (const nodeId of targets) {
          if (!nodeId || !present.has(nodeId)) continue;
          const bucket = buckets.get(nodeId) ?? new Set<number>();
          bucket.add(id);
          buckets.set(nodeId, bucket);
        }
        if (!lineOf.has(id)) lineOf.set(id, line);
        pool.add(id);
        scored = true;
      }
    }
    if (scored) scoredFiles++;
  }
  if (!pool.size) {
    return { status: 'unavailable', reason: input.edits.length
      ? 'The recorded edits could not be matched to the model’s tokens.' : 'The agent changed files without the edit and write tools.' };
  }

  // uqlm's negentropy needs top-k data at every position; otherwise every node uses the selected-token probability.
  const metric: ConfidenceMetric = [...pool].every(id => tokens[id].negentropy !== null) ? 'negentropy' : 'probability';
  const score = (id: number) => metric === 'negentropy' ? tokens[id].negentropy! : Math.exp(tokens[id].logprob);
  const sorted = [...pool].map(score).sort((a, b) => a - b);
  const share = (value: number) => {
    let low = 0, high = sorted.length;
    while (low < high) { const middle = (low + high) >> 1; if (sorted[middle] <= value) low = middle + 1; else high = middle; }
    return low / sorted.length;
  };
  const nodes: NodeConfidence[] = [...buckets].map(([nodeId, bucket]) => {
    const ids = [...bucket];
    const weakest = ids.reduce((best, id) => score(id) < score(best) ? id : best);
    const token = tokens[weakest];
    const confidence = score(weakest);
    return {
      nodeId, tokens: ids.length, confidence: round(confidence),
      minProbability: round(Math.min(...ids.map(id => Math.exp(tokens[id].logprob)))),
      adjusted: sorted.length >= MIN_POOL ? round(1 - (1 - share(confidence)) ** ids.length) : null,
      weakest: { text: token.text, probability: round(Math.exp(token.logprob)), negentropy: token.negentropy === null ? null : round(token.negentropy),
        line: lineOf.get(weakest) ?? 0, alternatives: (token.alternatives ?? []).map(option => ({ text: option.text, probability: round(option.probability) })) }
    };
  }).sort((a, b) => a.confidence - b.confidence || a.nodeId.localeCompare(b.nodeId));
  return { status: 'scored', metric, tokens: pool.size, files: files.length, scoredFiles, nodes };
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });

// Whether the model service keeps edit tokens for runs (an older deployment has no /runs routes).
export async function editTokensAvailable(base: string, token: string, signal: AbortSignal, fetcher: Fetcher = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${base}/tokens`, { headers: authorization(token), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    await response.body?.cancel().catch(() => {});
    return response.ok;
  } catch {
    return false;
  }
}

// Reads a run's edit tokens from the model service, then asks it to forget them.
export async function collectEditTokens(base: string, token: string, signal: AbortSignal, fetcher: Fetcher = fetch): Promise<CapturedCall[]> {
  let response: Response;
  try {
    response = await fetcher(`${base}/tokens`, { headers: authorization(token), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  } catch {
    throw new CaptureError('The model service did not answer with the edit tokens.');
  }
  if (!response.ok) throw new CaptureError(`The model service did not return the edit tokens (status ${response.status}).`);
  const calls = parseCapture(await response.json().catch(() => null));
  await forgetEditTokens(base, token, fetcher);
  return calls;
}

// Asks the model service to drop a run's edit tokens; best effort.
export function forgetEditTokens(base: string, token: string, fetcher: Fetcher = fetch): Promise<void> {
  return fetcher(`${base}/tokens`, { method: 'DELETE', headers: authorization(token), signal: AbortSignal.timeout(15_000) })
    .then(reply => { void reply.body?.cancel().catch(() => {}); }, () => {});
}
