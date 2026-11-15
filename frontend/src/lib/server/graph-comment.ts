import { createHmac, timingSafeEqual } from 'node:crypto';

// The pull request comment embeds the run's graph image. GitHub fetches images anonymously (through its camo
// proxy), so the image URL carries a key signed with the server secret instead of requiring a session; the key
// only unlocks that run's graph picture, which shows file and symbol names but no source code.
export function graphImageKey(secret: string, runId: string) {
  return createHmac('sha256', secret).update(`tripsit-agent-run-graph:${runId}`).digest('base64url').slice(0, 32);
}

export function validGraphImageKey(secret: string, runId: string, key: string | null) {
  if (!secret || !key) return false;
  const expected = Buffer.from(graphImageKey(secret, runId)), given = Buffer.from(key);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// GitHub cannot fetch images from a local development server, so comments need the app's public HTTPS origin.
export function publicOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
    return url.protocol === 'https:' && !local ? url.origin : null;
  } catch { return null; }
}

export function graphComment(origin: string, runId: string, key: string) {
  const id = encodeURIComponent(runId);
  const runUrl = `${origin}/?run=${id}`;
  const imageUrl = (theme: 'light' | 'dark') => `${origin}/api/agent-runs/${id}/graph.svg?key=${encodeURIComponent(key)}&amp;theme=${theme}`;
  // <picture> follows the reader's GitHub theme; the whole image links to the interactive graph.
  return [
    '### Change graph',
    '',
    `<a href="${runUrl}"><picture><source media="(prefers-color-scheme: dark)" srcset="${imageUrl('dark')}">` +
    `<img alt="Dependency graph of this change" src="${imageUrl('light')}"></picture></a>`,
    '',
    `Badges mark the files, functions and connections this change added, modified or removed. ` +
    `[Open the interactive graph](${runUrl}) of TripSit agent run \`${runId.slice(0, 8)}\`.`
  ].join('\n');
}
