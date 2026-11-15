import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { x as extract, type ReadEntry } from 'tar';
import { IntakeError } from './intake.ts';

export type ArchiveLimits = { maxArchiveBytes: number; maxBytes: number; maxEntries: number };
export const archiveLimits: ArchiveLimits = { maxArchiveBytes: 200 * 1024 * 1024, maxBytes: 250 * 1024 * 1024, maxEntries: 40_000 };
export const textLimit = 512 * 1024;

const extractable = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);

// Unpacks a GitHub tarball (one top-level folder) into `directory`. Links, devices and paths that
// escape the directory are never written; size and entry caps bound disk use.
export async function extractArchive(archive: ReadableStream<Uint8Array>, directory: string, signal: AbortSignal, limits = archiveLimits) {
  let entries = 0, bytes = 0, compressed = 0, exceeded = false;
  const tooLarge = () => new IntakeError(413, 'The repository is too large for an agent run.');
  const unpack = extract({
    cwd: directory, strip: 1, preservePaths: false, preserveOwner: false,
    filter: (_path, entry) => {
      const item = entry as ReadEntry;
      if (!extractable.has(item.type)) return false;
      entries++;
      bytes += item.size ?? 0;
      if (entries > limits.maxEntries || bytes > limits.maxBytes) { exceeded = true; return false; }
      return true;
    },
    onwarn: () => {}
  });
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      compressed += chunk.length;
      if (compressed > limits.maxArchiveBytes) done(tooLarge()); else done(null, chunk);
    }
  });
  const source = Readable.fromWeb(archive as import('node:stream/web').ReadableStream<Uint8Array>);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      source.destroy();
      counter.destroy();
      reject(error instanceof IntakeError ? error : new IntakeError(502, 'The repository archive could not be unpacked.'));
    };
    const abort = () => fail(new IntakeError(504, 'The agent run was cancelled or timed out.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    source.on('error', fail);
    counter.on('error', fail);
    unpack.on('error', fail);
    unpack.on('close', () => {
      signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; resolve(); }
    });
    source.pipe(counter).pipe(unpack);
  });
  if (exceeded) throw tooLarge();
  return { entries, bytes };
}

const identity = { GIT_AUTHOR_NAME: 'TripSit agent', GIT_AUTHOR_EMAIL: 'agent@tripsit.invalid',
  GIT_COMMITTER_NAME: 'TripSit agent', GIT_COMMITTER_EMAIL: 'agent@tripsit.invalid' };

// Git and agent shell commands get no server secrets: only a path, an isolated home and git identity.
export function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: home, TMPDIR: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    TERM: 'dumb', NO_COLOR: '1', CI: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...identity };
}

function git(directory: string, home: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<Buffer> {
  const options = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', 'core.quotePath=false'];
  return new Promise((resolve, reject) => {
    execFile('git', [...options, ...args], { cwd: directory, env: isolatedEnvironment(home), maxBuffer, encoding: 'buffer', timeout: 120_000 },
      (error, stdout) => error ? reject(new IntakeError(500, 'Repository change tracking failed.')) : resolve(stdout));
  });
}

export async function commitBase(directory: string, home: string): Promise<string> {
  await git(directory, home, ['init', '-q']);
  await git(directory, home, ['add', '-A']);
  await git(directory, home, ['commit', '-q', '--no-verify', '--allow-empty', '-m', 'TripSit base snapshot']);
  return (await git(directory, home, ['rev-parse', 'HEAD'])).toString('utf8').trim();
}

export function decodeText(bytes: Buffer): string | null {
  if (bytes.length > textLimit || bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return null; }
}

export async function readWorkspaceText(directory: string, path: string): Promise<string | null> {
  try {
    const target = join(directory, path);
    const info = await stat(target);
    if (!info.isFile() || info.size > textLimit) return null;
    return decodeText(await readFile(target));
  } catch { return null; }
}

// Exact bytes and git modes of the changed files, for a pull request. Run after collectChanges staged everything.
export async function publishableFiles(directory: string, home: string, changes: { path: string; change: WorkspaceChange['change'] }[]) {
  const kept = changes.filter(change => change.change !== 'deleted').map(change => change.path);
  const listed = kept.length ? (await git(directory, home, ['--literal-pathspecs', 'ls-files', '-s', '-z', '--', ...kept])).toString('utf8').split('\0') : [];
  const modes = new Map(listed.filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    return [line.slice(tab + 1), line.slice(0, tab).split(' ')[0]];
  }));
  let total = 0;
  const files: { path: string; mode: '100644' | '100755'; content: Buffer | null }[] = [];
  for (const { path, change } of changes) {
    if (change === 'deleted') { files.push({ path, mode: '100644', content: null }); continue; }
    const mode = modes.get(path);
    if (mode !== '100644' && mode !== '100755') throw new IntakeError(422, `${path} is not a regular file, so the change cannot be published.`);
    const content = await readFile(join(directory, path));
    total += content.length;
    if (content.length > 10 * 1024 * 1024 || total > 50 * 1024 * 1024) throw new IntakeError(413, 'The change is too large to publish as a pull request.');
    files.push({ path, mode, content });
  }
  return files;
}

export type WorkspaceChange = {
  path: string; change: 'added' | 'modified' | 'deleted';
  before: string | null; after: string | null; binary: boolean; diff: string;
};

const diffLimit = 100_000, totalDiffLimit = 1_500_000, changeLimit = 400;

// Stages everything the agent left behind (respecting .gitignore) and compares it with the base commit.
export async function collectChanges(directory: string, home: string, base: string) {
  await git(directory, home, ['add', '-A']);
  const fields = (await git(directory, home, ['diff', '--cached', '--no-renames', '--name-status', '-z', base])).toString('utf8').split('\0');
  const rows: { path: string; change: WorkspaceChange['change'] }[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index], path = fields[index + 1];
    if (!status || !path) continue;
    rows.push({ path, change: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified' });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  const files = (await git(directory, home, ['ls-files', '-z'])).toString('utf8').split('\0').filter(Boolean);
  const changes: WorkspaceChange[] = [];
  let diffBytes = 0;
  for (const { path, change } of rows.slice(0, changeLimit)) {
    const beforeBytes = change === 'added' ? null : await git(directory, home, ['show', `${base}:${path}`]);
    const afterBytes = change === 'deleted' ? null : await readFile(join(directory, path)).catch(() => null);
    const before = beforeBytes && decodeText(beforeBytes);
    const after = afterBytes && decodeText(afterBytes);
    const binary = (beforeBytes !== null && before === null) || (afterBytes !== null && after === null);
    let diff = '';
    if (diffBytes < totalDiffLimit) {
      diff = (await git(directory, home, ['diff', '--cached', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', base, '--', path])).toString('utf8');
      if (diff.length > diffLimit) diff = diff.slice(0, diffLimit) + '\n… diff truncated …\n';
      diffBytes += diff.length;
    }
    changes.push({ path, change, before: before ?? null, after: after ?? null, binary, diff });
  }
  return { changes, files, truncated: rows.length > changeLimit || diffBytes >= totalDiffLimit };
}
