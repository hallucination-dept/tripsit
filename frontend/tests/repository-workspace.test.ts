import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { collectChanges, commitBase, extractArchive, isolatedEnvironment } from '../src/lib/server/repository-workspace.ts';

type Entry = { path: string; type?: 'File' | 'Directory' | 'SymbolicLink'; body?: string; linkpath?: string };
function tarball(entries: Entry[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const type = entry.type ?? 'File';
    const header = new Header({ path: entry.path, type, size: type === 'File' ? body.length : 0, mode: type === 'Directory' ? 0o755 : 0o644,
      mtime: new Date(0), uid: 0, gid: 0, ...(entry.linkpath ? { linkpath: entry.linkpath } : {}) });
    header.encode();
    blocks.push(header.block!);
    if (type === 'File' && body.length) blocks.push(body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Blob([gzipSync(Buffer.concat(blocks))]).stream();
}

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'tripsit-workspace-test-'));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await Promise.all([mkdir(repo), mkdir(home)]);
  return { root, repo, home };
}

test('extraction writes regular files only and never escapes the workspace', async () => {
  const { root, repo } = await scratch();
  try {
    const stats = await extractArchive(tarball([
      { path: 'team-app-abc/', type: 'Directory' },
      { path: 'team-app-abc/src/', type: 'Directory' },
      { path: 'team-app-abc/src/main.ts', body: 'export const main = 1;\n' },
      { path: 'team-app-abc/link', type: 'SymbolicLink', linkpath: '/etc/hosts' },
      { path: 'team-app-abc/../../escape.txt', body: 'escaped' }
    ]), repo, AbortSignal.timeout(5000));
    assert.equal(await readFile(join(repo, 'src/main.ts'), 'utf8'), 'export const main = 1;\n');
    await assert.rejects(lstat(join(repo, 'link')));
    assert.equal(existsSync(join(root, 'escape.txt')), false);
    assert.equal(existsSync(join(repo, '..', 'escape.txt')), false);
    // The caps count every file or directory entry, including the traversal entry that is refused.
    assert.equal(stats.entries, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('extraction stops oversized archives', async () => {
  const { root, repo } = await scratch();
  try {
    await assert.rejects(extractArchive(tarball([{ path: 'top/big.txt', body: 'x'.repeat(4096) }]), repo, AbortSignal.timeout(5000),
      { maxArchiveBytes: 1_000_000, maxBytes: 1024, maxEntries: 10 }), (error: Error & { status?: number }) => error.status === 413);
    await assert.rejects(extractArchive(tarball([{ path: 'top/a.txt', body: 'a' }, { path: 'top/b.txt', body: 'b' }]), repo, AbortSignal.timeout(5000),
      { maxArchiveBytes: 1_000_000, maxBytes: 1024, maxEntries: 1 }), /too large/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('change tracking compares the agent result with the base commit and respects .gitignore', async () => {
  const { root, repo, home } = await scratch();
  try {
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 1;\n');
    await writeFile(join(repo, 'src/b.ts'), 'export const b = 2;\n');
    await writeFile(join(repo, 'logo.bin'), Buffer.from([0, 1, 2]));
    const base = await commitBase(repo, home);
    assert.match(base, /^[a-f0-9]{40}$/);
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 10;\n');
    await unlink(join(repo, 'src/b.ts'));
    await writeFile(join(repo, 'src/c.ts'), 'export const c = 3;\n');
    await writeFile(join(repo, 'logo.bin'), Buffer.from([0, 9, 9]));
    await mkdir(join(repo, 'node_modules'));
    await writeFile(join(repo, 'node_modules/dep.js'), 'module.exports = 1;\n');
    const { changes, files, truncated } = await collectChanges(repo, home, base);
    assert.equal(truncated, false);
    assert.deepEqual(changes.map(change => `${change.change}:${change.path}`), ['modified:logo.bin', 'modified:src/a.ts', 'deleted:src/b.ts', 'added:src/c.ts']);
    const [logo, a, b, c] = changes;
    assert.equal(logo.binary, true);
    assert.equal(logo.before, null);
    assert.equal(a.before, 'export const a = 1;\n');
    assert.equal(a.after, 'export const a = 10;\n');
    assert.match(a.diff, /^-export const a = 1;$/m);
    assert.equal(b.after, null);
    assert.equal(c.before, null);
    assert.deepEqual(files, ['.gitignore', 'logo.bin', 'src/a.ts', 'src/c.ts']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('shell and git environments carry no server secrets', () => {
  process.env.TRIPSIT_TEST_SECRET = 'do-not-leak';
  const env = isolatedEnvironment('/tmp/home');
  assert.equal(env.TRIPSIT_TEST_SECRET, undefined);
  assert.equal(Object.values(env).includes('do-not-leak'), false);
  assert.equal(env.HOME, '/tmp/home');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  delete process.env.TRIPSIT_TEST_SECRET;
});
