# TripSit — AI Agents

<!-- BEGIN bigpowers:project -->
## Project

TripSit is a coding ticket implementation agent powered by Gemma on Modal.
It uses per-token probabilities and further uncertainty estimates to support confident, human-led PR merges.

Stack: TypeScript, Svelte 5, SvelteKit 3, Node 22, Better Auth, PostgreSQL, Python 3.12, Modal, FastAPI, and vLLM.

## Commands

Frontend commands run from `frontend/`.

| Action | Command |
| --- | --- |
| Run | `npm run dev` |
| Check | `npm run check` |
| Test | No test command configured |
| Lint | No lint command configured |
| Build | `npm run build` |
| Preflight | `npm run check && npm run build` |
| Auth configuration check | `npm run auth:check` (requires configured services) |
| Auth migration | `npm run auth:migrate` (changes the configured database) |
| App migration | `npm run projects:migrate` (changes the configured database) |
| PR checks | `gh pr checks` (when a PR exists) |

## Architecture

Aiven hosts the SvelteKit frontend/server and PostgreSQL auth database.
SvelteKit calls a separate Modal/FastAPI service running Gemma through vLLM.
The current app reviews code with token probabilities.
Ticket implementation and further uncertainty features are planned.

## Conventions

- MUST read `CONVENTIONS.md` before changing files or running Git operations.
- MUST read relevant `specs/` documents before writing code.
- MUST preserve SvelteKit routes, strict TypeScript, Svelte runes, and `#lib` imports.
- MUST use commit subjects in `type(component): explanation` form, such as `fix(review): validate code input`.
- MUST write plans, specifications, and investigation results under `specs/`.
- MUST use the smallest complete change and reuse existing patterns.

## Never

- NEVER commit secrets.
- MUST obtain explicit authorization before modifying production data or infrastructure.
- NEVER bypass authentication.
- MUST open a PR for hands-free work.
- MUST obtain human approval before merging a PR produced during hands-free work.

## Agent Rules

- MUST use applicable bigpowers skills for planning, implementation, and verification.
- MUST record nontrivial implementation plans under `specs/` before writing code.
- MUST include a runnable verification command for each implementation task.
- MUST run checks appropriate to the change and report actual results.
- MUST follow the fix-or-log process for reproducible gate failures.
- MUST distinguish implemented behavior from intended product capabilities.
- MUST follow explicit user instructions over these defaults.
<!-- END bigpowers:project -->

<!-- BEGIN bigpowers:context-routing -->
## Context Routing

| Area | Reference |
| --- | --- |
| All changes | `CONVENTIONS.md` |
| Architecture and integration boundaries | `specs/tech-architecture/tech-stack.md` |
| Setup and deployment | `README.md` |
| Workflow and handoff | `specs/state.yaml` |
<!-- END bigpowers:context-routing -->

<!-- BEGIN bigpowers:learned-preferences -->
## Learned User Preferences

- Team: two people at a hackathon.
- Human approval before merging is mandatory for hands-free work.
- Other work has no blanket human-approval gate for merges.

## Workspace Facts

- The current UI provides code review, while the intended product implements coding tickets.
- Aiven hosts the frontend/server and PostgreSQL; Modal hosts inference.
<!-- END bigpowers:learned-preferences -->
