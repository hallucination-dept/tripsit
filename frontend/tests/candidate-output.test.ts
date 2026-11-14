import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCandidateOutput } from '../src/lib/server/candidate-output.ts';

const blob = 'a'.repeat(40);
const expected = new Map<string, string | null>([['src/main.ts', blob], ['new.txt', null]]);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const file = (changes: Record<string, unknown> = {}) => ({ path: 'src/main.ts', originalBlob: blob, content: 'hello', ...changes });
const decode = (files: unknown[]) => decodeCandidateOutput(encode({ files }), expected);

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
