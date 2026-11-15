import { createHash } from 'node:crypto';

export interface CandidateFile {
  path: string;
  originalBlob: string | null;
  content: Uint8Array;
}

export interface CandidateOutput {
  rawOutput: Uint8Array;
  files: CandidateFile[];
  mapping: { status: 'unavailable'; reason: string };
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function invalid(): never {
  throw new Error('Invalid candidate output');
}

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && utf8.decode(encoder.encode(value)) === value;
}

/** Offline validation only: callers must separately admit access, staging and execution. */
export function decodeCandidateOutput(
  raw: Uint8Array,
  expectedBlobs: ReadonlyMap<string, string | null>,
  mode: 'direct' | 'agent' = 'direct'
): CandidateOutput {
  if (raw.byteLength === 0 || raw.byteLength > 1_048_576) invalid();
  const rawOutput = Uint8Array.from(raw);
  let parsed: unknown;
  try {
    const text = utf8.decode(rawOutput);
    const frame = mode === 'agent' ? /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(text.trim()) : null;
    parsed = JSON.parse(frame ? frame[1] : mode === 'agent' ? text.trim() : text);
  } catch {
    invalid();
  }
  if (!record(parsed, ['files']) || !Array.isArray(parsed.files)
    || parsed.files.length === 0 || parsed.files.length > 32) invalid();
  const paths: string[] = [];
  const files: CandidateFile[] = [];
  for (const replacement of parsed.files) {
    if (mode === 'direct' ? !record(replacement, ['path', 'originalBlob', 'content'])
      : !replacement || typeof replacement !== 'object' || Array.isArray(replacement)
        || Object.keys(replacement).some(key => !['path', 'content', 'originalBlob'].includes(key))) invalid();
    const { path, content } = replacement as Record<string, unknown>;
    if (!validText(path) || encoder.encode(path).byteLength > 1024
      || /[\\:*?"<>|\u0000-\u001f\u007f]/u.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..'
        || part.toLowerCase() === '.git' || /[. ]$/u.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) invalid();
    const portablePath = path.normalize('NFC').toLowerCase();
    if (paths.some((existing) => existing === portablePath
      || existing.startsWith(portablePath + '/') || portablePath.startsWith(existing + '/'))) invalid();
    paths.push(portablePath);
    const originalBlob = mode === 'agent' ? expectedBlobs.get(path) : (replacement as Record<string, unknown>).originalBlob;
    if (!expectedBlobs.has(path) || expectedBlobs.get(path) !== originalBlob
      || (originalBlob !== null && (typeof originalBlob !== 'string'
        || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(originalBlob)))) invalid();
    if (!validText(content)) invalid();
    files.push({ path, originalBlob, content: encoder.encode(content) });
  }
  return {
    rawOutput,
    files,
    mapping: { status: 'unavailable', reason: 'Exact output-to-content span mapping is not implemented.' }
  };
}

export type TokenByteMapping = { status: 'unavailable'; reason: string } | {
  status: 'exact'; outputDigest: string; model: string; settingsDigest: string;
  files: Array<{ path: string; blobSha: string; segments: Array<{ outputStart: number; outputEnd: number; fileStart: number; fileEnd: number; firstToken: number; lastToken: number }> }>;
};

/** Map only reconstructed provider bytes; callers must separately bind and persist revision identity. */
export function mapCandidateTokenBytes(raw: Uint8Array, expected: ReadonlyMap<string, string | null>,
  tokens: Array<{ bytes: number[] | null; logprob: number }>, model: string, settingsDigest: string,
  mode: 'direct' | 'agent' = 'direct'): TokenByteMapping {
  const unavailable = { status: 'unavailable' as const, reason: 'Exact token mapping could not be verified.' };
  try {
    const candidate = decodeCandidateOutput(raw, expected, mode);
    if (!Array.isArray(tokens) || !tokens.length || tokens.length > 8192 || typeof model !== 'string' || !model.trim()
      || encoder.encode(model).length > 128 || !/^[a-f0-9]{64}$/.test(settingsDigest)) return unavailable;
    const ends: number[] = [];
    let total = 0;
    for (const token of tokens) {
      if (!token || !Array.isArray(token.bytes) || !token.bytes.length || token.bytes.length > 16384
        || !Number.isFinite(token.logprob) || token.logprob > 0) return unavailable;
      for (const byte of token.bytes) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255 || total >= raw.length || raw[total++] !== byte) return unavailable;
      }
      ends.push(total);
    }
    if (total !== raw.length) return unavailable;
    const text = utf8.decode(raw);
    const trimmed = mode === 'agent' ? text.trim() : text;
    const frame = mode === 'agent' ? /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed) : null;
    const body = frame ? frame[1] : trimmed;
    const bodyCharStart = frame ? text.indexOf(trimmed) + trimmed.indexOf('\n') + 1 : mode === 'agent' ? text.indexOf(trimmed) : 0;
    const start = encoder.encode(text.slice(0, bodyCharStart)).length;
    const limit = start + encoder.encode(body).length;
    let pos = start, segmentCount = 0;
    type Segment = { outputStart: number; outputEnd: number; fileStart: number; fileEnd: number; firstToken: number; lastToken: number };
    const found = new Map<number, Segment[]>();
    const whitespace = () => { while (pos < limit && [9, 10, 13, 32].includes(raw[pos])) pos++; };
    const tokenAt = (byte: number) => { let lo = 0, hi = ends.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (ends[mid] <= byte) lo = mid + 1; else hi = mid; } return lo; };
    function string(capture: boolean, content?: Uint8Array): { value: string; segments: Segment[] } {
      if (raw[pos++] !== 34) throw Error();
      const begin = pos - 1, segments: Segment[] = [];
      let fileOffset = 0;
      while (pos < limit && raw[pos] !== 34) {
        const beginScalar = pos;
        if (raw[pos] === 92) {
          pos++;
          if (raw[pos] === 117) {
            pos += 5;
            const first = Number.parseInt(utf8.decode(raw.slice(beginScalar + 2, beginScalar + 6)), 16);
            if (first >= 0xd800 && first <= 0xdbff && raw[pos] === 92 && raw[pos + 1] === 117) pos += 6;
          } else pos++;
        } else {
          const first = raw[pos];
          pos += first < 128 ? 1 : first < 224 ? 2 : first < 240 ? 3 : 4;
        }
        if (pos > limit) throw Error();
        if (capture) {
          const decoded = JSON.parse('"' + utf8.decode(raw.slice(beginScalar, pos)) + '"');
          const bytes = encoder.encode(decoded), length = bytes.length;
          if (!content || bytes.some((byte, index) => content[fileOffset + index] !== byte)) throw Error();
          // shortcut: responses over 65536 content scalars are unmapped, upgrade when larger mappings are required.
          if (++segmentCount > 65536) throw Error();
          segments.push({ outputStart: beginScalar, outputEnd: pos, fileStart: fileOffset, fileEnd: fileOffset + length,
            firstToken: tokenAt(beginScalar), lastToken: tokenAt(pos - 1) });
          fileOffset += length;
        }
      }
      if (raw[pos++] !== 34) throw Error();
      return { value: JSON.parse(utf8.decode(raw.slice(begin, pos))), segments };
    }
    function value(path: Array<string | number>, depth: number): void {
      if (depth > 64) throw Error();
      whitespace();
      if (raw[pos] === 34) {
        const capture = path.length === 3 && path[0] === 'files' && typeof path[1] === 'number' && path[2] === 'content';
        const parsed = string(capture, capture ? candidate.files[path[1] as number]?.content : undefined);
        if (capture) found.set(path[1] as number, parsed.segments);
      } else if (raw[pos] === 123) {
        pos++; whitespace(); const keys = new Set<string>();
        if (raw[pos] !== 125) for (;;) {
          whitespace(); const key = string(false).value;
          if (keys.has(key)) throw Error(); keys.add(key);
          whitespace(); if (raw[pos++] !== 58) throw Error(); value([...path, key], depth + 1); whitespace();
          if (raw[pos] !== 44) break; pos++;
        }
        if (raw[pos++] !== 125) throw Error();
      } else if (raw[pos] === 91) {
        pos++; whitespace(); let index = 0;
        if (raw[pos] !== 93) for (;;) {
          value([...path, index++], depth + 1); whitespace(); if (raw[pos] !== 44) break; pos++;
        }
        if (raw[pos++] !== 93) throw Error();
      } else {
        const begin = pos; while (pos < limit && ![9, 10, 13, 32, 44, 93, 125].includes(raw[pos])) pos++;
        if (begin === pos) throw Error(); JSON.parse(utf8.decode(raw.slice(begin, pos)));
      }
    }
    value([], 0); whitespace(); if (pos !== limit || found.size !== candidate.files.length) return unavailable;
    const files = candidate.files.map((file, index) => {
      const segments = found.get(index); if (!segments || (segments.at(-1)?.fileEnd ?? 0) !== file.content.length) throw Error();
      return { path: file.path, blobSha: createHash('sha1').update(`blob ${file.content.length}\0`).update(file.content).digest('hex'), segments };
    });
    return { status: 'exact', outputDigest: createHash('sha256').update(raw).digest('hex'), model, settingsDigest, files };
  } catch { return unavailable; }
}
