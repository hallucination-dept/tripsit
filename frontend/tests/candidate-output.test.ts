import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCandidateOutput, mapCandidateTokenBytes } from '../src/lib/server/candidate-output.ts';

const blob = 'a'.repeat(40);
const expected = new Map<string, string | null>([['src/main.ts', blob], ['new.txt', null]]);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const file = (changes: Record<string, unknown> = {}) => ({ path: 'src/main.ts', originalBlob: blob, content: 'hello', ...changes });
const decode = (files: unknown[]) => decodeCandidateOutput(encode({ files }), expected);

test('maps escaped, Unicode and framed output against exact token bytes', () => {
  const raw = new TextEncoder().encode(' ```json\r\n{"files":[{"path":"src/main.ts","content":"é\\r\\n\\ud83d\\ude00","originalBlob":"forged"}]}\r\n``` ');
  const tokens = Array.from(raw, byte => ({ bytes: [byte], logprob: -1 }));
  const result = mapCandidateTokenBytes(raw, expected, tokens, 'model', 'a'.repeat(64), 'agent');
  assert.equal(result.status, 'exact'); if (result.status !== 'exact') return;
  assert.equal(result.files[0].path, 'src/main.ts');
  const segments = result.files[0].segments;
  assert.deepEqual(segments.map(segment => segment.fileEnd - segment.fileStart), [2, 1, 1, 4]);
  for (const segment of segments) {
    assert.equal(segment.firstToken, segment.outputStart);
    assert.equal(segment.lastToken, segment.outputEnd - 1);
  }
  assert.equal(new TextDecoder().decode(raw.slice(segments[3].outputStart, segments[3].outputEnd)), '\\ud83d\\ude00');
});

test('mapping remains unavailable on token mismatch, malformed identity, duplicate keys and segment limits', () => {
  const raw = encode({ files: [file()] });
  const token = { bytes: Array.from(raw), logprob: -0.1 };
  const map = (bytes: Uint8Array, tokens: Array<{ bytes: number[] | null; logprob: number }>, settings = 'a'.repeat(64)) =>
    mapCandidateTokenBytes(bytes, expected, tokens, 'model', settings);
  assert.equal(map(raw, [token]).status, 'exact');
  for (const tokens of [[], [{ ...token, bytes: null }], [{ ...token, bytes: [0] }], [{ ...token, logprob: 1 }], [{ ...token, bytes: Array.from(raw).slice(0, -1) }]])
    assert.equal(map(raw, tokens).status, 'unavailable');
  assert.equal(map(raw, [token], 'invalid').status, 'unavailable');
  const duplicate = new TextEncoder().encode('{"files":[{"path":"src/main.ts","originalBlob":"' + blob + '","content":"a","content":"b"}]}');
  assert.equal(map(duplicate, [{ bytes: Array.from(duplicate), logprob: 0 }]).status, 'unavailable');
  const large = encode({ files: [file({ content: 'x'.repeat(65537) })] });
  const chunks = Array.from({ length: Math.ceil(large.length / 16000) }, (_, i) => ({ bytes: Array.from(large.slice(i * 16000, (i + 1) * 16000)), logprob: -1 }));
  assert.equal(map(large, chunks).status, 'unavailable');
});

test('maps multiple files when token boundaries cross UTF-8 and escape boundaries', () => {
  const raw = encode({ files: [file({ content: '雪\n' }), file({ path: 'new.txt', originalBlob: null, content: 'é😀' })] });
  const tokens = Array.from({ length: Math.ceil(raw.length / 3) }, (_, i) => ({ bytes: Array.from(raw.slice(i * 3, i * 3 + 3)), logprob: -0.5 }));
  const result = mapCandidateTokenBytes(raw, expected, tokens, 'model', 'b'.repeat(64));
  assert.equal(result.status, 'exact'); if (result.status !== 'exact') return;
  assert.deepEqual(result.files.map(row => row.path), ['src/main.ts', 'new.txt']);
  for (const file of result.files) for (const segment of file.segments) {
    assert.equal(segment.firstToken, Math.floor(segment.outputStart / 3));
    assert.equal(segment.lastToken, Math.floor((segment.outputEnd - 1) / 3));
  }
});

test('decodes exact replacement bytes and explicit additions without inventing mapping', () => {
  const content = 'é😀\r\n"quoted"\\path\u0000';
  const raw = encode({ files: [file({ content }), file({ path: 'new.txt', originalBlob: null, content: '' })] });
  const original = raw.slice();
  const result = decodeCandidateOutput(raw, expected);
  assert.deepEqual(result.rawOutput, original);
  assert.deepEqual(result.files, [
    { path: 'src/main.ts', originalBlob: blob, content: new TextEncoder().encode(content) },
    { path: 'new.txt', originalBlob: null, content: new Uint8Array() }
  ]);
  assert.deepEqual(result.mapping, { status: 'unavailable', reason: 'Exact output-to-content span mapping is not implemented.' });
  raw.fill(0);
  assert.deepEqual(result.rawOutput, original);
});

test('autonomous decoding preserves original framed bytes while binding server-owned blob identity', () => {
  const raw = new TextEncoder().encode('  ```json\r\n{"files":[{"content":"\\u00e9\\r\\n","path":"src/main.ts","originalBlob":"forged"}]}\r\n```  ');
  const result = decodeCandidateOutput(raw, expected, 'agent');
  assert.deepEqual(result.rawOutput, raw);
  assert.deepEqual(result.files, [{ path: 'src/main.ts', originalBlob: blob, content: new TextEncoder().encode('é\r\n') }]);
  assert.equal(result.mapping.status, 'unavailable');
  for (const text of ['prefix\n```json\n{"files":[]}\n```', '```json\n{"files":[]}\n```\n```', '{"files":[{"path":"unknown.txt","content":"x"}]}']) {
    assert.throws(() => decodeCandidateOutput(new TextEncoder().encode(text), expected, 'agent'), /Invalid candidate output/);
  }
});

test('rejects unsafe paths, duplicates and untrusted or stale originals', () => {
  for (const path of ['', '/etc/passwd', '../main.ts', 'a/../b', './a', 'a//b', 'a/', 'C:/file', 'a\\b', '.git/config', 'a/.GIT/config', 'a\u0000b', 'a\nb', 'a./b', 'a /b', 'a/'.repeat(513)]) {
    assert.throws(() => decode([file({ path })]), /Invalid candidate output/);
  }
  assert.throws(() => decode([file(), file()]), /Invalid candidate output/);
  for (const changes of [{ originalBlob: 'b'.repeat(40) }, { originalBlob: null }, { path: 'unknown.txt', originalBlob: null }, { originalBlob: 1 }]) {
    assert.throws(() => decode([file(changes)]), /Invalid candidate output/);
  }
  assert.throws(() => decodeCandidateOutput(encode({ files: [file()] }), new Map([['src/main.ts', 'not-a-blob'] ])), /Invalid candidate output/);
});

test('rejects malformed schema, UTF-8, unpaired surrogates and truncated JSON', () => {
  for (const value of [null, [], {}, { files: [] }, { files: 'x' }, { files: [null] }, { files: [file({ content: 1 })] }, { files: [file({ extra: true })] }, { files: [file()], extra: true }]) {
    assert.throws(() => decodeCandidateOutput(encode(value), expected), /Invalid candidate output/);
  }
  for (const raw of [new Uint8Array([0xff]), new Uint8Array([0xc0, 0xaf]), new TextEncoder().encode('{"files":['), new TextEncoder().encode('\ufeff{}')]) {
    assert.throws(() => decodeCandidateOutput(raw, expected), /Invalid candidate output/);
  }
  for (const content of ['\ud800', '\udfff', 'x\ud800y']) {
    assert.throws(() => decode([file({ content })]), /Invalid candidate output/);
  }
  assert.throws(() => decode([file({ path: '\ud800' })]), /Invalid candidate output/);
});

test('enforces byte and file-count limits including their accepted boundaries', () => {
  const empty = encode({ files: [file({ content: '' })] }).byteLength;
  const atLimit = encode({ files: [file({ content: 'x'.repeat(1_048_576 - empty) })] });
  assert.equal(atLimit.byteLength, 1_048_576);
  assert.equal(decodeCandidateOutput(atLimit, expected).rawOutput.byteLength, 1_048_576);
  assert.throws(() => decodeCandidateOutput(new Uint8Array(1_048_577), expected), /Invalid candidate output/);
  const originals = new Map(Array.from({ length: 33 }, (_, i) => [`f${i}`, null] as const));
  const files = Array.from(originals.keys(), (path) => file({ path, originalBlob: null }));
  assert.equal(decodeCandidateOutput(encode({ files: files.slice(0, 32) }), originals).files.length, 32);
  assert.throws(() => decodeCandidateOutput(encode({ files }), originals), /Invalid candidate output/);
});

test('rejects portable path collisions and file-directory conflicts', () => {
  for (const paths of [['a', 'a/b'], ['a/b', 'a'], ['A', 'a'], ['é', 'e\u0301']]) {
    const originals = new Map(paths.map((path) => [path, null] as const));
    const files = paths.map((path) => file({ path, originalBlob: null }));
    assert.throws(() => decodeCandidateOutput(encode({ files }), originals), /Invalid candidate output/);
  }
});
