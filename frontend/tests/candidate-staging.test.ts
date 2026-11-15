import assert from 'node:assert/strict';
import test from 'node:test';
import { stageCandidate } from '../src/lib/server/candidate-staging.ts';
import type { GeneratedCandidate } from '../src/lib/server/generation.ts';

// These blob and tree IDs were independently generated with git hash-object and git mktree.
const base = 'a'.repeat(40), root = '6f6d0696ce3b2708e69364cead1ab7982542e5ef';
const entries = [{ path: 'src', mode: '040000', sha: 'f7f98d34b9abece2631187537855171b5347921d' },
 { path: 'src/a.ts', mode: '100755', sha: '9cca7e3e36146dc4800a363b5540521c0369a6ac' },
 { path: 'untouched', mode: '100644', sha: '99b85622199d17f1dd60838404869be4bc3e0867' }];
const candidate = { baseSha: base, files: [{ path: 'src/a.ts', originalBlob: entries[1].sha,
 blobSha: '1dfb9fa96b90a64561cf419df51978edc3065e10', content: Buffer.from('雪\r\n') }] } as GeneratedCandidate;
const timestamp = '2026-01-01T00:00:00.000Z';
test('stages deterministic Git objects preserving parent, untouched entries and exact candidate bytes', () => {
 const staged = stageCandidate(base, root, entries, candidate, timestamp);
 assert.deepEqual(stageCandidate(base, root, entries, candidate, timestamp), staged);
 assert.equal(staged.rootSha, '29ac21426fcd4514eac72658b478857595dfa915');
 assert.equal(staged.commitSha, '3af0fa6a4cf71bf69cebc102ad7e8ca7f95603eb');
 const commit = staged.objects.find(row => row.type === 'commit')!;
 assert.match(Buffer.from(commit.content, 'base64').toString(), new RegExp(`^tree ${staged.rootSha}\\nparent ${base}\\n`));
 assert.equal(Buffer.from(staged.objects[0].content, 'base64').toString(), '雪\r\n');
 for (const bad of [{ ...candidate, baseSha: '0'.repeat(40) }, { ...candidate, files: [{ ...candidate.files[0], originalBlob: '0'.repeat(40) }] }, { ...candidate, files: [{ ...candidate.files[0], path: '../escape' }] }]) assert.throws(() => stageCandidate(base, root, entries, bad, timestamp));
 assert.throws(() => stageCandidate(base, '0'.repeat(40), entries, candidate, timestamp));
});
