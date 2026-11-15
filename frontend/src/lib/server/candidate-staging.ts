import { createHash } from 'node:crypto';
import { IntakeError } from './intake.ts';
import type { GeneratedCandidate } from './generation.ts';

export type TreeEntry = { path: string; sha: string; mode: string };
type ObjectRecord = { type: 'blob' | 'tree' | 'commit'; sha: string; content: string };
const fail = (): never => { throw new IntakeError(409, 'Candidate staging input is invalid or stale.'); };
const hash = (value: string) => /^[a-f0-9]{40}$/.test(value);
const pathValid = (value: string) => typeof value === 'string' && Buffer.byteLength(value) <= 1024
  && Buffer.from(value).toString('utf8') === value && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
function object(type: ObjectRecord['type'], bytes: Buffer): ObjectRecord {
  return { type, sha: createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex'), content: bytes.toString('base64') };
}

/** Construct Git objects in memory; the caller must authenticate and verify base-to-tree mapping. */
export function stageCandidate(baseSha: string, rootSha: string, entries: TreeEntry[], candidate: GeneratedCandidate, timestamp: string) {
  if (!hash(baseSha) || !hash(rootSha) || candidate.baseSha !== baseSha || !Array.isArray(entries) || entries.length > 4096
      || !Number.isFinite(Date.parse(timestamp)) || !Array.isArray(candidate.files) || !candidate.files.length || candidate.files.length > 24) fail();
  const paths = new Map<string, TreeEntry>();
  for (const entry of entries) {
    if (!entry || !pathValid(entry.path) || !hash(entry.sha) || !['040000', '100644', '100755', '120000', '160000'].includes(entry.mode) || paths.has(entry.path)) fail();
    paths.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
  }
  for (const entry of paths.values()) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join('/'))?.mode !== '040000') fail();
  }
  function trees(source: Map<string, TreeEntry>, verify: boolean): ObjectRecord[] {
    const dirs = ['', ...[...source.values()].filter(e => e.mode === '040000').map(e => e.path)]
      .sort((a, b) => b.split('/').length - a.split('/').length || b.length - a.length);
    const built: ObjectRecord[] = [];
    const childrenByDir = new Map<string, TreeEntry[]>();
    for (const entry of source.values()) {
      const separator = entry.path.lastIndexOf('/');
      const parent = separator < 0 ? '' : entry.path.slice(0, separator);
      const children = childrenByDir.get(parent) ?? []; children.push(entry); childrenByDir.set(parent, children);
    }
    for (const dir of dirs) {
      const prefix = dir ? dir + '/' : '';
      const children = childrenByDir.get(dir) ?? [];
      children.sort((a, b) => Buffer.compare(Buffer.from(a.path.slice(prefix.length) + (a.mode === '040000' ? '/' : '')), Buffer.from(b.path.slice(prefix.length) + (b.mode === '040000' ? '/' : ''))));
      const data = Buffer.concat(children.map(e => Buffer.concat([Buffer.from(`${e.mode === '040000' ? '40000' : e.mode} ${e.path.slice(prefix.length)}\0`), Buffer.from(e.sha, 'hex')])));
      const result = object('tree', data); built.push(result);
      if (dir) {
        const entry = source.get(dir)!;
        if (verify && entry.sha !== result.sha) fail();
        entry.sha = result.sha;
      } else if (verify && rootSha !== result.sha) fail();
    }
    return built;
  }
  trees(paths, true);
  const objects: ObjectRecord[] = [];
  const changed = new Set<string>();
  let total = 0;
  for (const file of candidate.files) {
    if (!file || !pathValid(file.path) || changed.has(file.path) || !(file.content instanceof Uint8Array) || file.content.byteLength > 262144) fail();
    total += file.content.byteLength;
    if (total > 262144) fail();
    const portable = file.path.normalize('NFC').toLowerCase();
    for (const existing of paths.keys()) {
      const normalized = existing.normalize('NFC').toLowerCase();
      if (existing !== file.path && (normalized === portable || normalized.startsWith(portable + '/') || portable.startsWith(normalized + '/') && paths.get(existing)?.mode !== '040000')) fail();
    }
    changed.add(file.path);
    const old = paths.get(file.path);
    if (old ? !['100644', '100755'].includes(old.mode) || old.sha !== file.originalBlob : file.originalBlob !== null) fail();
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i).join('/'), parent = paths.get(path);
      if (parent && parent.mode !== '040000') fail();
      if (!parent) paths.set(path, { path, sha: '0'.repeat(40), mode: '040000' });
    }
    const blob = object('blob', Buffer.from(file.content));
    if (blob.sha !== file.blobSha) fail();
    objects.push(blob);
    paths.set(file.path, { path: file.path, sha: blob.sha, mode: old?.mode ?? '100644' });
  }
  const built = trees(paths, false); objects.push(...built);
  const root = built[built.length - 1].sha;
  const seconds = Math.floor(Date.parse(timestamp) / 1000);
  const commit = object('commit', Buffer.from(`tree ${root}\nparent ${baseSha}\nauthor TripSit <tripsit@localhost> ${seconds} +0000\ncommitter TripSit <tripsit@localhost> ${seconds} +0000\n\nStage candidate\n`));
  objects.push(commit);
  return { baseSha, rootSha: root, commitSha: commit.sha, objects };
}
