# TripSit frontend

SvelteKit frontend for TripSit. It uses Better Auth with PostgreSQL and proxies
authenticated review requests to the Modal-hosted Gemma API.

## Setup

Create `frontend/.env` from `.env.example`, provide the Modal, PostgreSQL,
Better Auth, and GitHub OAuth values, then run:

```sh
npm run auth:migrate
npm run dev
```

Register `http://localhost:5173/api/auth/callback/github` as the GitHub OAuth
callback URL for local development. See the repository README for the full
environment-variable list and production callback URL.

## Commands

```sh
npm run check        # Svelte and TypeScript diagnostics
npm run build        # production build
npm run auth:check   # validate Better Auth setup after credentials are set
```

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
