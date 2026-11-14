# TripSit

TripSit is a code review tool powered by Gemma 4 31B running on Modal.

## Configure the web app

TripSit uses Better Auth with PostgreSQL. It supports GitHub OAuth and
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
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from a GitHub OAuth App.

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
| `GITHUB_CLIENT_ID` | Variable | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Secret | GitHub OAuth App client secret |

The Aiven PostgreSQL integration can inject its connection string directly as
`DATABASE_URL`; do not commit that URL to the repository. If PostgreSQL is not
hosted by Aiven, enter its connection string as an Aiven secret instead.

### First deployment checklist

Once the public Aiven URL is known:

1. Set both `BETTER_AUTH_URL` and `ORIGIN` to that URL in Aiven Runtime.
2. In the GitHub OAuth App settings, add this exact callback URL:

   ```text
   https://YOUR-AIVEN-DOMAIN/api/auth/callback/github
   ```

3. Run the Better Auth migration once against the production database. From a
   machine that can reach the database, use the production values for
   `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`, then run:

   ```bash
   cd frontend
   npm run auth:migrate
   ```

4. Redeploy the Runtime application after changing its environment variables.

Aiven Runtime builds the selected Git commit, but Git pushes do not themselves
trigger redeployments. Use **Redeploy** in the Aiven Runtime UI for later
commits, or add a separate CI deployment step with an Aiven API token.
