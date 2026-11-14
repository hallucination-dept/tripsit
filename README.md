# tripsit.dev

tripsit.dev is a code review tool powered by Gemma 4 31B running on Modal.

## Configure the web app

tripsit.dev uses Better Auth with PostgreSQL. It supports GitHub OAuth and
email/password accounts. The review API requires a signed-in user.

```bash
cd frontend
cp .env.example .env
npx auth@latest secret
```

Copy the generated value into `BETTER_AUTH_SECRET` in `frontend/.env`, then set
these values there:

- `MODAL_API_URL` and `MODAL_PROXY_TOKEN` for the deployed Gemma API.
- `DATABASE_URL` for the managed PostgreSQL database.
- `BETTER_AUTH_URL`, which is `http://localhost:5173` during local development.
- `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` from a GitHub App.

Register this GitHub OAuth callback URL locally:

```text
http://localhost:5173/api/auth/callback/github
```

For production, change `BETTER_AUTH_URL` and use the matching production
callback URL. Once the database variables are set, create the Better Auth
tables and start the app:

```bash
npm run auth:migrate
npm run dev
```

Open the URL printed by Vite, create an account or sign in with GitHub, then
paste code for review. The response is rendered token-by-token: darker blue
highlight means a higher conditional probability for that token. Hover a token
to see its exact percentage.

## Deploy the web app on Aiven Runtime

The root `Dockerfile` produces a standalone SvelteKit Node server from the
`frontend/` source. It is at the repository root so Aiven Runtime can discover
it. The image listens on port `8080` and does not copy `.env` files into it.

First, verify the container locally from the repository root:

```bash
docker build --tag tripsitter-web .
docker run --rm --env-file frontend/.env --publish 8080:8080 tripsitter-web
```

Open `http://localhost:8080` to test it.

### Aiven console setup

1. Push this repository to GitHub.
2. In the target Aiven project, open **Runtime** and choose **Deploy
   application**.
3. Connect GitHub, select this repository and its `main` branch.
4. Select the root `Dockerfile` as the manifest. Aiven detects `EXPOSE 8080`;
   configure that as the public HTTP port.
5. Set the application variables and secrets below, then deploy.
6. Create or connect an Aiven PostgreSQL service from the application's
   **Connected services** section. Expose its connection string as
   `DATABASE_URL`.
7. Copy the application's public HTTPS URL from **Connection information** and
   finish the authentication configuration below.

| Key | Aiven type | Value |
| --- | --- | --- |
| `BETTER_AUTH_URL` | Variable | The exact public HTTPS app URL, without a trailing slash |
| `ORIGIN` | Variable | The same public HTTPS app URL |
| `MODAL_API_URL` | Variable | Deployed Modal Gemma endpoint |
| `MODEL_ID` | Variable | `google/gemma-4-31B-it` |
| `DATABASE_URL` | Connected-service value | PostgreSQL connection URL supplied by the Aiven integration |
| `BETTER_AUTH_SECRET` | Secret | A long random secret, e.g. `npx auth@latest secret` |
| `MODAL_PROXY_TOKEN` | Secret | Modal web/proxy token |
| `GITHUB_APP_CLIENT_ID` | Variable | GitHub App client ID |
| `GITHUB_APP_CLIENT_SECRET` | Secret | GitHub App client secret |

The Aiven PostgreSQL integration can inject its connection string directly as
`DATABASE_URL`; do not commit that URL to the repository. If PostgreSQL is not
hosted by Aiven, enter its connection string as an Aiven secret instead.
For an Aiven URL using `sslmode=require`, the app enables
`uselibpqcompat=true` automatically for Node's `pg` client.

### First deployment checklist

Once the public Aiven URL is known:

1. Set both `BETTER_AUTH_URL` and `ORIGIN` to that URL in Aiven Runtime.
2. In the GitHub App settings, add this exact callback URL:

   ```text
   https://YOUR-AIVEN-DOMAIN/api/auth/callback/github
   ```

3. Run the Better Auth migration once against the production database. From a
   machine that can reach the database, use the production values for
   `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `GITHUB_APP_CLIENT_ID`, and `GITHUB_APP_CLIENT_SECRET`, then run:

   ```bash
   cd frontend
   npm run auth:migrate
   ```

4. Redeploy the Runtime application after changing its environment variables.

Aiven Runtime builds the selected Git commit, but Git pushes do not themselves
trigger redeployments. Use **Redeploy** in the Aiven Runtime UI for later
commits, or add a separate CI deployment step with an Aiven API token.

## GitHub issue intake (development slice)

Better Auth GitHub sign-in uses `GITHUB_APP_CLIENT_ID` and
`GITHUB_APP_CLIENT_SECRET`; the legacy `GITHUB_CLIENT_*` pair is not used for login.
Issue intake separately
requires `GITHUB_APP_ID` and a PEM `GITHUB_APP_PRIVATE_KEY`, server-side only, for a
GitHub App installed on the selected repository with Contents/Issues read access.
The logged-in user's OAuth token must independently access the repository; the
app installation does not grant that user access. Missing configuration disables
intake without changing the existing code review flow. The installation link uses
`GITHUB_APP_SLUG`; the setup callback returns to the workspace, where accessible
repositories and open issues are discovered automatically. No merge/publish
operation is added by this slice.

For an explicitly disposable **local** PostgreSQL database named
`tripsit_e01s01_test`, set `TRIPSIT_TEST_DATABASE_URL` and run from `frontend/`:

```bash
node --experimental-strip-types scripts/work-items.ts migrate
node --experimental-strip-types --test tests/e01s01.test.ts
node --experimental-strip-types --test tests/e01s01-db.test.ts
node --experimental-strip-types scripts/work-items.ts purge
npm run check && npm run build
```

The app-owned SQL is `frontend/migrations/001_work_items.sql` and
`frontend/migrations/002_candidates.sql`; the local migrate command applies both.
Neither alters Better Auth tables. The development script refuses non-local or differently named
databases and never falls back to `DATABASE_URL`. Applying a production migration
or configuring a production purge schedule requires explicit authorization.

The signed-in page discovers repositories and open issues and refreshes every minute. It snapshots
supplied issue text and an immutable base SHA; it does not infer or confirm
acceptance criteria. Reads recheck owner and repository access. The latest 20
retained snapshots can be reloaded. Seven-day expiry blocks reads, and the purge
command physically removes raw snapshots and their repository/issue references,
retaining source-free digest/status metadata.

**Incomplete live gates:** private snapshot creation/read remains refused. Real
GitHub integration, authenticated browser UAT, and a periodic purge invocation
have not been certified. A manual purge test is not a verified retention schedule.
The following verification tools keep those gaps explicit:

- `python3 specs/experiments/live_gates.py e01s01 --require-configured` executes
  configured local API checks. Set `TRIPSIT_LIVE_ORIGIN`, legitimate owner and
  second-owner Cookie headers in `TRIPSIT_LIVE_OWNER_COOKIE` and
  `TRIPSIT_LIVE_OTHER_COOKIE`, and the fixture values `TRIPSIT_LIVE_REPOSITORY`,
  `TRIPSIT_LIVE_ISSUE_NUMBER`, `TRIPSIT_LIVE_REPOSITORY_ID`,
  `TRIPSIT_LIVE_BASE_SHA`, and `TRIPSIT_LIVE_REVOKED_ITEM_ID`. The last must identify
  an existing owner snapshot whose repository access is now denied; a nonexistent
  item cannot establish permission revocation. The full gate stays nonzero until
  all admission controls are verified, even when public API checks pass.
- From `frontend/`, `node scripts/intake-browser.mjs` uses installed Google Chrome
  to check the real signed-in UI with the same origin, session and repository/issue
  variables. Use a development issue containing hostile markup to check escaped
  rendering. It signs the first owner out, so run API probes before browser UAT
  and use disposable development sessions. `--browser-smoke` checks Chrome only.
- From `frontend/`, with the explicit disposable local database configured,
  `node --experimental-strip-types scripts/intake-retention.ts` executes two timed
  purge subprocesses against an isolated temporary schema. Its source-free report
  certifies local repeated execution only, never a deployed periodic schedule.

Do not paste session cookies or credentials into reports or commit environment
files. These tools do not enable private intake or authorize production changes.

Public snapshot candidates can now be generated explicitly from selected files at
the frozen revision. The workspace shows versioned baseline requirements, unresolved
quality gaps and inert replacement previews. Candidate artifacts require migration
`002_candidates.sql`, retain exact output/file bytes and raw token observations when
available, and expire with their parent snapshot. The existing snapshot purge cascades
their raw-data deletion. Candidate generation is limited to three requests per owner
per 15 minutes and one active request per server process.

Candidate code is not executed, committed or published by this increment. Exact
output-to-code token mapping remains unavailable. Applying migration 002 to a
configured production database requires explicit authorization; the runtime refuses
generation before its storage tables exist.
