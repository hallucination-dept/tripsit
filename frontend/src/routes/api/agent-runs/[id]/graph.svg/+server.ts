import { renderGraphSvg } from '#lib/graph-image.ts';
import { agentRuns, graphImageAllowed } from '#lib/server/agent-runtime.ts';

// Public, key-signed picture of a finished run's change graph, embedded in its pull request comment.
export async function GET({ params, url }) {
  const missing = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!graphImageAllowed(params.id, url.searchParams.get('key'))) return missing();
  const graph = await agentRuns.graph(params.id).catch(() => null);
  if (!graph) return missing();
  return new Response(await renderGraphSvg(graph, url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff'
    }
  });
}
