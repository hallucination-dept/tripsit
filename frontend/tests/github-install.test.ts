import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('installation entrypoint requires sign-in and redirects using only the configured slug', async () => {
  for (const slug of ['tripsit-dev-agent', undefined]) {
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      return specifier === '$app/env/private'
        ? { url: `data:text/javascript,${encodeURIComponent(`export const GITHUB_APP_SLUG=${JSON.stringify(slug)};`)}`, shortCircuit: true }
        : nextResolve(specifier, context);
    } });
    try {
      const route = new URL('../src/routes/api/github/connect/+server.ts', import.meta.url);
      route.searchParams.set('slug', String(slug));
      const { GET } = await import(route.href);
      await assert.rejects(() => GET({ locals: {} }), { status: 401 });
      if (slug) {
        const response = await GET({ locals: { user: { id: 'owner' } } });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), 'https://github.com/apps/tripsit-dev-agent/installations/new');
      } else {
        await assert.rejects(() => GET({ locals: { user: { id: 'owner' } } }), { status: 500 });
      }
    } finally { hooks.deregister(); }
  }
});

test('legacy setup callback requires sign-in and returns home without linking or OAuth exchange', async () => {
  const { GET } = await import('../src/routes/api/github/app/callback/+server.ts');
  await assert.rejects(() => GET({ locals: {} }), { status: 401 });
  await assert.rejects(() => GET({ locals: { user: { id: 'owner' } } }), { status: 303, location: '/' });
});
