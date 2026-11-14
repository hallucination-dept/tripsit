# tripsit.dev frontend

SvelteKit frontend for tripsit.dev. It uses Better Auth with PostgreSQL and proxies
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
environment-variable list, production callback URL, and Aiven deployment steps.

## Commands

```sh
npm run check        # Svelte and TypeScript diagnostics
npm run build        # production build
npm run auth:check   # validate Better Auth setup after credentials are set
npm run projects:migrate # create the connected-GitHub-project table
```

The production image uses `@sveltejs/adapter-node` and starts with
`node build` on port `8080`. The Dockerfile is in the repository root so that
Aiven Runtime can discover it. Test the image from the repository root:

```sh
docker build --tag tripsitter-web .
docker run --rm --env-file frontend/.env --publish 8080:8080 tripsitter-web
```
