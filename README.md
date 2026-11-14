# TripSit

TripSit is a code review tool powered by Gemma 4 31B running on Modal.

## Run the review UI

Set the deployed Modal URL and its proxy token. Keep the proxy token in the
server environment; the browser never receives it.

```bash
cd frontend
cp .env.example .env
npm run dev
```

Set the real Modal URL and proxy token in `frontend/.env` before starting the
app. Open the URL printed by Vite, paste code, and submit it for review. The response
is rendered token-by-token: darker blue highlight means a higher conditional
probability for that token. Hover a token to see its exact percentage.
