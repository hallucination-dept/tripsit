import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('login selects the App OAuth pair and requires it even when legacy credentials exist', async () => {
  const environment: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost/fixture',
    BETTER_AUTH_SECRET: 'fixture-auth-secret',
    BETTER_AUTH_URL: 'http://localhost:5173',
    GITHUB_CLIENT_ID: 'legacy-client',
    GITHUB_CLIENT_SECRET: 'legacy-secret',
    GITHUB_APP_CLIENT_ID: 'app-client',
    GITHUB_APP_CLIENT_SECRET: 'app-secret'
  };
  for (const configured of [true, false]) {
    const values = { ...environment,
      GITHUB_APP_CLIENT_ID: configured ? environment.GITHUB_APP_CLIENT_ID : undefined,
      GITHUB_APP_CLIENT_SECRET: configured ? environment.GITHUB_APP_CLIENT_SECRET : undefined };
    const modules: Record<string, string> = {
      '$app/env/private': Object.entries(values).map(([key, value]) => `export const ${key}=${JSON.stringify(value)};`).join('\n'),
      '$app/server': 'export const getRequestEvent=()=>null;',
      'better-auth': 'export const betterAuth=options=>options;',
      'better-auth/svelte-kit': 'export const sveltekitCookies=()=>null;',
      'pg': 'export class Pool {}'
    };
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      return Object.hasOwn(modules, specifier)
        ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true }
        : nextResolve(specifier, context);
    } });
    try {
      const url = new URL('../src/lib/auth.ts', import.meta.url);
      url.searchParams.set('app-configured', String(configured));
      const { auth, missingAuthEnvironment } = await import(url.href);
      if (configured) {
        assert.equal(auth.socialProviders.github.clientId, 'app-client');
        assert.equal(auth.socialProviders.github.clientSecret, 'app-secret');
        assert.equal(auth.socialProviders.github.disableDefaultScope, true);
        assert.deepEqual(missingAuthEnvironment, []);
      } else {
        assert.deepEqual(auth.socialProviders, {});
        assert.deepEqual(missingAuthEnvironment, ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']);
      }
    } finally { hooks.deregister(); }
  }
});
