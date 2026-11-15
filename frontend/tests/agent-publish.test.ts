import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGitHub } from '../src/lib/server/github.ts';
import { collectChanges, commitBase, publishableFiles } from '../src/lib/server/repository-workspace.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const base = 'a'.repeat(40);
const sha = (character: string) => character.repeat(40);

function github(options: { push?: boolean; writeAllowed?: boolean } = {}) {
  const calls: { method: string; path: string; token: string; body: Record<string, unknown> | null }[] = [];
  let blobs = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path, token: new Headers(init?.headers).get('Authorization') ?? '', body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === '/user') return json({ id: 42 });
    if (path === '/repos/team/repo') return json({ id: 5, full_name: 'team/repo', private: true, default_branch: 'main', permissions: { push: options.push ?? true } });
    if (path === '/repos/team/repo/installation') return json({ id: 7, app_id: 9, suspended_at: null });
    if (path === '/app/installations/7/access_tokens') {
      const write = (body?.permissions as Record<string, string>)?.contents === 'write';
      if (write && options.writeAllowed === false) return json({ message: 'The permissions requested are not granted to this installation.' }, 422);
      return json({ token: write ? 'write-token' : 'read-token' });
    }
    if (path === '/repos/team/repo/commits/main') return json({ sha: base });
    if (path === `/repos/team/repo/git/commits/${base}`) return json({ sha: base, tree: { sha: sha('b') } });
    if (path === '/repos/team/repo/git/blobs') return json({ sha: sha(String(++blobs)) }, 201);
    if (path === '/repos/team/repo/git/trees') return json({ sha: sha('c') }, 201);
    if (path === '/repos/team/repo/git/commits') return json({ sha: sha('d') }, 201);
    if (path === '/repos/team/repo/git/refs') return json({ ref: body?.ref }, 201);
    if (path === '/repos/team/repo/pulls') return json({ number: 12, html_url: 'https://github.com/team/repo/pull/12' }, 201);
    if (path === '/repos/team/repo/issues/12/comments') return json({ id: 99 }, 201);
    return json({ message: 'Not Found' }, 404);
  };
  return { calls, client: createGitHub({ appId: '9', privateKey, accountId: '42', userToken: 'user-token', fetcher }) };
}

test('a run on a writable repository opens a pull request on top of the real base commit', async () => {
  const { calls, client } = github();
  const archive = await client.archive('team/repo', AbortSignal.timeout(5000));
  assert.equal(archive.sha, base);
  assert.equal(archive.publish.available, true);
  if (!archive.publish.available) return;
  const pull = await archive.publish.create({
    branch: 'tripsit/0123abcd', title: 'Add a helper', body: 'Instruction\n\nSummary', message: 'Add a helper\n\nOpened by TripSit.',
    files: [
      { path: 'src/new.ts', mode: '100644', content: Buffer.from('export const added = 1;\n') },
      { path: 'bin/run.sh', mode: '100755', content: Buffer.from('#!/bin/sh\n') },
      { path: 'src/old.ts', mode: '100644', content: null }
    ]
  }, AbortSignal.timeout(5000));
  assert.deepEqual(pull, { number: 12, url: 'https://github.com/team/repo/pull/12', branch: 'tripsit/0123abcd' });
  const write = calls.filter(call => call.token === 'Bearer write-token');
  assert.deepEqual(write.map(call => `${call.method} ${call.path}`), [
    `GET /repos/team/repo/git/commits/${base}`, 'POST /repos/team/repo/git/blobs', 'POST /repos/team/repo/git/blobs',
    'POST /repos/team/repo/git/trees', 'POST /repos/team/repo/git/commits', 'POST /repos/team/repo/git/refs', 'POST /repos/team/repo/pulls']);
  assert.equal(write[1].body?.content, Buffer.from('export const added = 1;\n').toString('base64'));
  assert.deepEqual(write[3].body, { base_tree: sha('b'), tree: [
    { path: 'src/new.ts', mode: '100644', type: 'blob', sha: sha('1') },
    { path: 'bin/run.sh', mode: '100755', type: 'blob', sha: sha('2') },
    { path: 'src/old.ts', mode: '100644', type: 'blob', sha: null }] });
  assert.deepEqual(write[4].body, { message: 'Add a helper\n\nOpened by TripSit.', tree: sha('c'), parents: [base] });
  assert.deepEqual(write[5].body, { ref: 'refs/heads/tripsit/0123abcd', sha: sha('d') });
  assert.deepEqual(write[6].body, { title: 'Add a helper', head: 'tripsit/0123abcd', base: 'main', body: 'Instruction\n\nSummary' });
  await archive.publish.comment(12, '### Change graph', AbortSignal.timeout(5000));
  const comment = calls.at(-1)!;
  assert.deepEqual([comment.method, comment.path, comment.token, comment.body], ['POST', '/repos/team/repo/issues/12/comments', 'Bearer write-token', { body: '### Change graph' }]);
  await assert.rejects(archive.publish.comment(0, 'x', AbortSignal.timeout(5000)), /comment is invalid/);
  const tokenRequests = calls.filter(call => call.path === '/app/installations/7/access_tokens').map(call => call.body);
  assert.deepEqual(tokenRequests.map(body => body?.permissions), [{ contents: 'read', issues: 'read' }, { contents: 'write', pull_requests: 'write' }]);
  assert.deepEqual(tokenRequests.map(body => body?.repository_ids), [[5], [5]], 'tokens are scoped to the one repository');
  await assert.rejects(archive.publish.create({ branch: 'main', title: 't', body: '', message: 'm', files: [{ path: 'a', mode: '100644', content: null }] },
    AbortSignal.timeout(5000)), (error: Error & { status?: number }) => error.status === 400, 'only tripsit/ branches are created');
});

test('without write permission on the App, or without push access for the user, runs work but open no pull request', async () => {
  const denied = await github({ writeAllowed: false }).client.archive('team/repo', AbortSignal.timeout(5000));
  assert.deepEqual(denied.publish, { available: false, reason: 'the TripSit GitHub App needs read and write access to Contents and Pull requests' });
  const reader = github({ push: false });
  const readOnly = await reader.client.archive('team/repo', AbortSignal.timeout(5000));
  assert.deepEqual(readOnly.publish, { available: false, reason: 'you do not have write access to this repository' });
  assert.equal(reader.calls.filter(call => (call.body?.permissions as Record<string, string>)?.contents === 'write').length, 0, 'no write token is requested');
});

test('publishable files carry exact bytes and git modes, and links are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-publish-test-'));
  const repo = join(root, 'repo'), home = join(root, 'home');
  try {
    await Promise.all([mkdir(repo), mkdir(home)]);
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 1;\n');
    await writeFile(join(repo, 'src/gone.ts'), 'export const gone = 1;\n');
    const base = await commitBase(repo, home);
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2;\n');
    await unlink(join(repo, 'src/gone.ts'));
    await writeFile(join(repo, 'run.sh'), '#!/bin/sh\necho hi\n');
    await chmod(join(repo, 'run.sh'), 0o755);
    await writeFile(join(repo, ':(glob)*.ts'), 'odd name\n');
    const { changes } = await collectChanges(repo, home, base);
    const files = await publishableFiles(repo, home, changes);
    assert.deepEqual(files.map(file => [file.path, file.mode, file.content?.toString() ?? null]), [
      [':(glob)*.ts', '100644', 'odd name\n'], ['run.sh', '100755', '#!/bin/sh\necho hi\n'],
      ['src/a.ts', '100644', 'export const a = 2;\n'], ['src/gone.ts', '100644', null]]);
    await symlink('/etc/hosts', join(repo, 'link'));
    const linked = await collectChanges(repo, home, base);
    await assert.rejects(publishableFiles(repo, home, linked.changes), /link is not a regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
