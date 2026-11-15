import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { normalizePem } from '../src/lib/server/pem.ts';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const signs = (key: string | undefined) => createSign('RSA-SHA256').update('x').sign(key ?? '').length > 0;
const escaped = pem.trimEnd().split('\n').join('\\n');

test('normalizePem repairs the formats hosted env var fields produce', () => {
  const formats = {
    'real newlines': pem,
    'literal \\n': escaped,
    'double-quoted literal \\n': `"${escaped}"`,
    'single-quoted literal \\n': `'${escaped}'`,
    'literal \\r\\n': pem.trimEnd().split('\n').join('\\r\\n'),
    'spaces instead of newlines': pem.trimEnd().split('\n').join(' '),
    'CRLF line breaks': pem.replace(/\n/g, '\r\n'),
    'surrounding whitespace': `\n  ${pem}  \n`
  };
  for (const [name, value] of Object.entries(formats)) {
    assert.equal(normalizePem(value), pem, name);
    assert.ok(signs(normalizePem(value)), name);
  }
});

test('normalizePem leaves absent and non-PEM values usable', () => {
  assert.equal(normalizePem(undefined), undefined);
  assert.equal(normalizePem(''), '');
  assert.equal(normalizePem('not a key'), 'not a key');
});
