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
For an Aiven URL using `sslmode=require`, the app enables
`uselibpqcompat=true` automatically for Node's `pg` client.

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
trigger redeployments by default. This repository includes a GitHub Action that
redeploys the Aiven Runtime application after each push to `main`. Add these
GitHub repository secrets before relying on it:

| Secret | Value |
| --- | --- |
| `AIVEN_TOKEN` | Aiven API token with permission to deploy the Runtime app |
| `AIVEN_PROJECT` | Aiven project name |
| `AIVEN_APP_NAME` | Aiven Runtime application service name |

The workflow triggers Aiven's **Deploy latest commit** operation, so Aiven
builds the newest commit from the Runtime app's configured branch.

## Connect GitHub repositories

tripsit.dev uses a **GitHub App** for repositories, issues, and pull requests. This
is intentionally separate from the GitHub OAuth App used to sign users in: each
person chooses the exact repositories to install the app on, and tripsit.dev uses a
short-lived installation token rather than a personal access token.

Create a GitHub App at **GitHub → Settings → Developer settings → GitHub Apps
→ New GitHub App** with these production settings:

| GitHub App field | Value |
| --- | --- |
| Homepage URL | `https://tripsit.dev` |
| Callback URL | `https://tripsit.dev/api/github/app/callback` |
| Setup URL | `https://tripsit.dev/api/github/app/callback` |
| Request user authorization (OAuth) during installation | Disabled |
| Webhook | Disabled (not used yet) |
| Where can this GitHub App be installed? | Any account, unless it is only for your own account |
| Repository metadata | Read-only |
| Repository contents | Read-only |
| Issues | Read-only |
| Pull requests | Read and write |

Do not grant Administration, Actions, or organization permissions. Generate a
private key for the App and save the downloaded PEM file; GitHub only shows the
private key at creation time.

Set these in Aiven Runtime after creating the App:

| Key | Aiven type | Source |
| --- | --- | --- |
| `GITHUB_APP_ID` | Variable | The numeric App ID |
| `GITHUB_APP_CLIENT_ID` | Variable | GitHub App client ID |
| `GITHUB_APP_SLUG` | Variable | The app's URL slug (`github.com/apps/<slug>`) |
| `GITHUB_APP_CLIENT_SECRET` | Secret | Generated GitHub App client secret |
| `GITHUB_APP_PRIVATE_KEY` | Secret | Full PEM private key, including BEGIN/END lines |

tripsit.dev uses the setup callback to start GitHub's normal user-authorization
flow, then verifies the user can access the selected installation. These values
are different from `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, which remain
the credentials for the existing sign-in OAuth App. For local development,
create a second GitHub App with callback and setup URL
`http://localhost:5173/api/github/app/callback` and put its distinct values in
`frontend/.env`.

Create the project table once against the production database (using a local
`frontend/.env` that contains the production `DATABASE_URL`):

```bash
cd frontend
npm run projects:migrate
```

After deployment, a signed-in user can choose **Add project**, select the
allowed repositories on GitHub, and return to tripsit.dev. The project switcher
lists the connected repositories; the selected project shows open issues and
can create a pull request from an existing branch.
