# Agent runs and change graph — plan

Status: implementation plan for an exploratory slice ("let's try stuff out"). No review flags or confidence levels in this slice.

## Decisions (user, 2026-11-15)

- Model: Gemma 4 31B on the existing Modal app. Update `modal_gemma.py` for tool calling, a larger context and streaming pass-through, and deploy it (explicitly authorized).
- Repository source: repositories reachable through the linked GitHub account and the installed TripSit GitHub App, with the existing intake access checks. The default branch is downloaded at its current commit.
- Agent tools: pi's default coding tools (read, bash, edit, write). Shell access runs repository code on the server; mitigations below reduce, not remove, that risk.
- Task input: free-form instruction; open issues of the selected repository act as shortcuts that pre-fill it.
- Persistence (added later the same day): runs are stored in PostgreSQL by migration `003_agent_runs.sql`, which the user applies.
- Pull requests (added later the same day): each run with changes opens a pull request from a `tripsit/<run>` branch; nothing is merged.

## Flow

1. `POST /api/agent-runs` (signed-in owner, same-origin JSON): authorize the repository through the GitHub App, resolve the default-branch commit, start a background run, return its id.
2. Background run: download the tarball for that commit (installation token, redirect only to `codeload.github.com`), extract regular files and directories only (no links, no traversal, size and count caps), `git init` and commit a base snapshot.
3. Run the pi SDK in-process: `createAgentSession` with an in-memory session, settings, auth and model registry; no extensions, skills, prompt templates or themes; per-run empty agent directory; model `openai-completions` at the Modal endpoint. Bash children get a scrubbed environment (no server secrets) and bounded timeouts; file tools refuse paths outside the workspace.
4. After the agent stops (or 20-minute deadline / cancel): `git add -A`, diff the index against the base commit, collect before/after text and unified diffs (bounded), delete the workspace.
5. Build the change graph and keep the run in memory (per process, bounded count and age).
6. If there are changes, the user can push and the App holds Contents and Pull requests write permission (a separate write token
   requested at start), build a commit on the base commit with the Git Data API (blobs, tree, commit, `tripsit/<run>` branch) and open a
   pull request. Otherwise record why no pull request was opened; a failed pull request does not discard the run's results.
7. `GET /api/agent-runs[/id]` returns status, bounded event log, final agent message, graph, diffs and pull request.
   `POST /api/agent-runs/[id]/cancel` cancels.
8. Runs are written to `tripsit_agent_runs` (source-free metadata) and `tripsit_agent_run_payloads` (summary and detail), debounced
   while running and immediately when finished. A stored run still marked active but not running in this process is reported as
   interrupted. Payloads expire after seven days and the purge deletes them.

## Change graph

- File-level import graph for the whole repository: TS/JS/Svelte (static, dynamic, `require`, re-exports; relative, `$lib`, tsconfig `paths`, package `imports`), Python (absolute and relative imports). Other files take part as plain nodes without edges.
- Focus files: changed files plus their direct importers and imports. Directories containing focus files are expanded as groups; other directories collapse into one node with a file count; remaining files of an expanded directory become one "other files" node.
- Changed TS/JS/Svelte/Python files expand into symbols (functions, classes, methods, variables, types, plus module-level and template pseudo-symbols). Symbol status (added, modified, deleted, unchanged) comes from comparing the symbol's source text before and after. Edges: in-file references, references to imported bindings, and importers' named imports of changed symbols.
- Client: each file is a card with a collapsible symbol outline (classes fold their methods; unrelated symbols sit behind "N more");
  untouched folders and "other files" buckets are small cards; folders holding focus files are not drawn. Edges attach to the visible
  row of the symbol they concern, else its class row, else the card header, with anchors computed from fixed card geometry. ELK lays
  the cards out top to bottom; Svelte Flow renders them without a minimap. References inside one file appear in the details panel.

## Limits and failure handling

One active run per owner, at most two per process, six starts per owner per hour (per-process counters). Repository archive at most 250 MB unpacked and 40,000 entries; files over 512 KiB are analyzed at file level only. Missing configuration or GitHub failures return bounded non-sensitive errors. Runs, workspaces and results are not persisted across restarts.

## Tasks and verification

1. Modal: `--enable-auto-tool-choice --tool-call-parser gemma4 --reasoning-parser gemma4` (+ tool chat template when present), `MAX_MODEL_LEN` 65536, streaming relay. → `python3 -m unittest discover -s tests` then `uv run --with modal modal deploy modal_gemma.py`, then a direct streamed tool-call request.
2. Workspace, pi runner, run store. → `cd frontend && node --experimental-strip-types --test tests/agent-runs.test.ts tests/repository-workspace.test.ts tests/pi-agent.test.ts`
3. Change graph and layout. → `cd frontend && node --experimental-strip-types --test tests/change-graph.test.ts tests/graph-layout.test.ts`
4. API routes and `/agent` page. → `cd frontend && npm run check && npm run build`
5. Live trial against Gemma on a small repository; record actual outcome in this file.

## Verification results (2026-11-15)

- Python service tests: 12 passed. Frontend: `npm run check` 0 errors, `npm run build` succeeded; 101 of 104 tests passed. The 3 failures are the existing database integration tests, which refuse to run without a disposable `TRIPSIT_TEST_DATABASE_URL`.
- New tests: change graph (5), layout (1), run store (4), workspace extraction and change tracking (4), pi against a scripted OpenAI-compatible streaming server (2: confined tools, secret-free shell, `max_tokens`/system-role compat, cancellation).
- Modal: deployed from a local checkout with `--enable-auto-tool-choice --tool-call-parser gemma4 --reasoning-parser gemma4`, the image's `/vllm-workspace/examples/tool_chat_template_gemma4.jinja`, and a 65,536-token context (KV cache 29,696 tokens; vLLM reports 2.26× concurrency at full length). A streamed request with a tool returned a `read` call and `finish_reason: tool_calls`. The repository change is not on `main`, so every deploy from `main` (GitHub Action) reverts it until merged.
- Live trial (pipeline without the HTTP layer) on `sindresorhus/ky`: in 29 s pi + Gemma ran `ls -R`, read and edited `source/errors/TimeoutError.ts` and `source/utils/timeout.ts`, and produced a correct diff. Graph: 115 files, 2 changed, 9 focus files, 27 nodes, 51 edges; symbols `TimeoutError`, `TimeoutError.constructor`, `timeout` marked modified, with importers `Ky.ts`, `index.ts`, `type-guards.ts` pointing at the edited class.
- Browser: the change graph renders with nested groups, fits on load, shows symbol and file diffs, and highlights a selected node's edges. Not verified: a signed-in run through `/agent` (needs a GitHub-linked session), and the Docker image with the added `git bash ripgrep` packages.
