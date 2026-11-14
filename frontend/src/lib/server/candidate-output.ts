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
  expectedBlobs: ReadonlyMap<string, string | null>
): CandidateOutput {
  if (raw.byteLength === 0 || raw.byteLength > 1_048_576) invalid();
  const rawOutput = Uint8Array.from(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8.decode(rawOutput));
  } catch {
    invalid();
  }
  if (!record(parsed, ['files']) || !Array.isArray(parsed.files)
    || parsed.files.length === 0 || parsed.files.length > 32) invalid();
  const paths: string[] = [];
  const files: CandidateFile[] = [];
  for (const replacement of parsed.files) {
    if (!record(replacement, ['path', 'originalBlob', 'content'])) invalid();
    const { path, originalBlob, content } = replacement;
    if (!validText(path) || encoder.encode(path).byteLength > 1024
      || /[\\:*?"<>|\u0000-\u001f\u007f]/u.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..'
        || part.toLowerCase() === '.git' || /[. ]$/u.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) invalid();
    const portablePath = path.normalize('NFC').toLowerCase();
    if (paths.some((existing) => existing === portablePath
      || existing.startsWith(portablePath + '/') || portablePath.startsWith(existing + '/'))) invalid();
    paths.push(portablePath);
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
