# Project Context

Mapped from repository source on 2026-11-14, starting at commit `7878265`. This is an observed architecture map, not a runtime or dependency compatibility assessment.

## Stack

| Area | Repository configuration |
| --- | --- |
| Web | TypeScript, Svelte `^5.57.2`, SvelteKit `^3.0.0`, Vite `^8.3.0` |
| Web runtime | Node 22 Alpine in the Dockerfile; `@sveltejs/adapter-node` `^6.0.2` |
| Authentication | Better Auth `^1.7.23`; email/password and GitHub OAuth |
| Database | PostgreSQL through `pg` `^8.23.1`; Better Auth owns database integration |
| Diagnostics | TypeScript `^6.0.3`, svelte-check `^4.6.0`; strict TypeScript enabled |
| Model service | Python 3.12, Modal, FastAPI, httpx, vLLM |
| Inference | `vllm/vllm-openai:gemma4`, default model `google/gemma-4-31B-it`, one `RTX-PRO-6000` GPU |
| Delivery | Web Docker image intended for Aiven Runtime; GitHub Actions deploys Modal on pushes to `main` or manual dispatch |

Versions above are package manifest constraints. The frontend has a package lock; Python deployment dependencies are installed without version pins, and the model image uses a mutable tag. No Python dependency manifest was found. Deprecation status and external platform compatibility were not checked.

## Architecture

Small route-oriented web application plus a separate model service. There is no application service/repository layer, shared API schema package, component library, or client state dependency beyond Svelte and Better Auth.

### Entry points and responsibilities

| Source | Responsibility |
| --- | --- |
| `frontend/src/routes/+page.svelte` | Sign-in/sign-up UI, review submission, loading/error state, probability shading; component-local styles |
| `frontend/src/hooks.server.ts` | Runtime auth configuration guard, session lookup, request locals, Better Auth request handler |
| `frontend/src/lib/auth.ts` | PostgreSQL pool, Better Auth configuration, required auth environment names |
| `frontend/src/lib/auth-client.ts` | Browser Better Auth client |
| `frontend/src/routes/+layout.server.ts` | Exposes the current user from request locals |
| `frontend/src/routes/+layout.svelte` | Favicon and child rendering; page authentication state comes from the auth client's session store |
| `frontend/src/routes/api/review/+server.ts` | Authenticated review boundary, prompt construction, upstream HTTP call, result shaping |
| `frontend/src/env.ts` | SvelteKit private environment declarations that allow absent values during image build |
| `modal_gemma.py` | Modal lifecycle, vLLM subprocess, FastAPI routes, conversion of log probabilities |

### Authentication flow

The browser uses Better Auth for email/password registration, sign-in, sign-out, and GitHub OAuth. The server hook checks configuration outside build mode, retrieves the session from request headers, and sets `locals.user` and `locals.session`. It delegates auth routes to `svelteKitHandler`; there is no separate checked-in auth API route. PostgreSQL stores Better Auth data. Schema setup uses `npm run auth:migrate`, which invokes `npx auth@latest` against the auth configuration; no migration files are checked in.

### Review flow

1. A signed-in user submits `{ code }` to `POST /api/review` on the same origin.
2. The SvelteKit route checks the session and nonblank code, then sends a system/user prompt to Modal's `/v1/chat/completions`. Generation uses temperature `0` and `max_tokens: 700`.
3. The Modal endpoint requires proxy authentication. Its FastAPI handler rejects streaming and forces `logprobs: true`, `top_logprobs: 0` before forwarding to local vLLM on port 8001.
4. Python converts each selected token's log probability using `exp(logprob) * 100`, removes the original choice-level `logprobs`, and adds `token_probabilities`.
5. SvelteKit returns the first choice as `{ review, tokens }`. Each token contains `{ token, probability_percent }`.
6. The page renders all returned tokens with blue shading and percentage tooltips, falling back to review text when tokens are absent. It renders plain text through Svelte interpolation.

The response is buffered through both services. Token-by-token display describes rendering, not transport streaming. These values are conditional token probabilities, not measured correctness of a review. No application code persists submitted code or review history; upstream logging/retention was not assessed.

## Conventions (Observed)

### API shapes and errors

- The web review route is a single JSON POST operation. Its successful shape uses `review` and `tokens`; model payloads retain OpenAI-style snake_case fields.
- SvelteKit HTTP errors use `error(status, message)`: 401 for missing session, 400 for blank code, 500 for missing Modal configuration, and 502 for fetch failures. Upstream unsuccessful responses propagate their status and `detail` when present.
- The page reads `message` or `detail` for errors and resets loading state in `finally` for review requests.
- FastAPI uses `HTTPException` for streaming and transport errors and forwards unsuccessful vLLM response bodies/statuses. Its upstream request timeout is 900 seconds.
- There is no custom global error handler or shared error schema. JSON decoding and unexpected payload shapes are not explicitly handled at the service boundaries.

### Types, UI, and organization

- TypeScript strict mode is enabled. SvelteKit supplies route/hook context; `App.Locals` declares a small optional user/session shape.
- Svelte 5 runes are forced for project files in `vite.config.ts`. The page uses `$state`, async/await, native forms, labels, alert roles, and an `aria-live` review section.
- Imports use the package `#lib` alias, often with `.js` suffixes referring to TypeScript sources. `src/lib/index.ts` is an unused placeholder barrel.
- Review request typing is a TypeScript assertion, not runtime schema validation. Upstream/browser response JSON is trusted without a shared typed contract. Python functions have no type annotations or request models.
- UI and its local state are concentrated in one page. HTTP integration and prompt policy live in the route; inference orchestration and response conversion live in one Python module.

### Observability and checks

- No application structured logging, tracing, metrics, test files, test runner, coverage configuration, formatter, or linter configuration was found.
- FastAPI exposes `/health` with model/status and `/v1/models`. Its health route does not query vLLM after startup. SvelteKit has no custom health route.
- Model startup polls vLLM `/health` for up to 840 seconds and detects early subprocess exit. Shutdown terminates the process, then kills it if a 15-second wait expires.
- `cd frontend && npm run check` runs Svelte/TypeScript diagnostics; `npm run build` creates the Node server. `auth:check` and `auth:migrate` require configured services and invoke the unpinned latest auth CLI.
- `.github/workflows/modal-deploy.yml` serializes deployments on a `craci` runner with an explicit network allowlist. It installs Modal/httpx and deploys directly, without tests, type checking, frontend build, or post-deploy smoke checks.

## Configuration and Deployment

The root multi-stage Dockerfile installs locked npm dependencies, builds the frontend, installs production dependencies, copies the build, and runs `node build` as the `node` user on port 8080. `.dockerignore` excludes local environment secrets, dependencies, and generated frontend output.

Private app variables are `MODAL_API_URL`, `MODAL_PROXY_TOKEN`, `MODEL_ID`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`. `ORIGIN` is also documented for the adapter's canonical origin. Runtime auth checks require all five auth/database values, including GitHub credentials, even though provider registration is conditional. The fallback auth secret in source is guarded against absent configuration at request time; configuration quality beyond presence is not validated here.

The model service uses a named Modal secret, `huggingface-secret`, and environment defaults for `MODEL_ID` and `MAX_MODEL_LEN` (8192). Modal config sets one minimum container, a 300-second scale-down window, and 900-second startup/request timeouts. Web and model deployments must agree on the model ID.

The README documents Aiven Runtime setup, production OAuth callback/origin configuration, manual database migration, and explicit web redeployment. The checked-in workflow deploys the model only; no Aiven deployment workflow or provisioned infrastructure definition was found.

## Signals / Active Considerations

- **Boundary validation:** `code` is asserted as an optional string then `.trim()` is called. Non-string values, malformed/null JSON, and unexpected upstream JSON can become unhandled errors. No explicit application-level input size limit or rate limit appears in the review handler.
- **Long requests:** Python permits a 900-second upstream wait; the web fetch has no explicit application timeout or cancellation forwarding. End-to-end host/proxy limits need verification before changing generation behavior.
- **Authentication configuration:** Missing GitHub credentials block runtime requests even for email/password use. Browser auth operations have no `try/finally`, so thrown failures can leave the busy state set.
- **Contract coupling:** Probability shape is independently encoded in Python, the web route, and the page. A response change must reach all three; currently no contract or regression tests cover it.
- **Operational reproducibility:** The model image, Python packages, auth CLI, and deployment setup action use mutable versions/tags. The frontend declares Node types `^26.6.6` while its image runs Node 22; compatibility was not tested.
- **Cost and readiness:** The model service explicitly keeps a GPU container warm. Its public health result reports wrapper availability, whereas actual vLLM readiness is checked only during startup.
- **Project memory:** No existing `CONVENTIONS.md`, `CLAUDE.md`, release plan, session state, or epic specifications were present during mapping. These observed conventions are descriptive, not newly adopted rules.

## Validation Scope

Read application source, manifests, TypeScript/Vite configuration, environment example, Docker configuration, READMEs, and the deployment workflow. No application code or configuration was changed. Builds, type checks, tests, database migrations, container execution, remote APIs, live deployments, and dependency audits were not run for this documentation task.
