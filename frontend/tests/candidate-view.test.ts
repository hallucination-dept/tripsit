import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateView } from '../src/lib/server/candidate-view.ts';
import type { StoredCandidate } from '../src/lib/server/generation.ts';

export const stored: StoredCandidate = { id: '22222222-2222-4222-8222-222222222222', candidate: {
  baseSha: 'a'.repeat(40), expiresAt: new Date(Date.now() + 60_000).toISOString(), outputDigest: 'b'.repeat(64), model: 'gemma', settings: { temperature: 0 }, rawOutput: new TextEncoder().encode('secret raw output'), mapping: { status: 'unavailable', reason: 'No exact mapping.' }, files: [{ path: 'a.ts', originalBlob: 'c'.repeat(40), blobSha: 'd'.repeat(40), content: new TextEncoder().encode('é😀\r\n') }], observations: { status: 'observed', tokens: [{ token: 'secret token', bytes: [1], logprob: -1 }] }
} };

test('view preserves decoded bytes and provenance while omitting raw artifacts', () => {
  const result = candidateView(stored);
  assert.equal(result.id, stored.id);
  assert.equal(result.candidate.files[0].content, 'é😀\r\n');
  assert.equal(result.candidate.baseSha, stored.candidate.baseSha);
  assert.deepEqual(result.candidate.observations, { status: 'observed', count: 1 });
  assert(!JSON.stringify(result).includes('secret'));
  assert(!('rawOutput' in result.candidate));
  assert.deepEqual(candidateView({ ...stored, candidate: { ...stored.candidate, observations: undefined } }).candidate.observations, { status: 'unavailable', count: 0 });
});

test('view rejects invalid persisted UTF-8 instead of silently replacing content', () => {
  assert.throws(() => candidateView({ ...stored, candidate: { ...stored.candidate, files: [{ ...stored.candidate.files[0], content: new Uint8Array([255]) }] } }));
});
