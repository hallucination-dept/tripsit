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
