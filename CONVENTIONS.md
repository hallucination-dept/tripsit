# TripSit Conventions

## Scope and Structure

- MUST keep changes focused on the requested outcome.
- MUST reuse existing code before introducing dependencies or abstractions.
- MUST preserve the SvelteKit route structure and `#lib` imports.
- MUST use strict TypeScript and Svelte runes in frontend code.
- MUST keep inference lifecycle and model response conversion in the Python service.
- MUST update affected callers, fixtures, configuration, and documentation when changing a contract.
- MUST keep planning and investigation output under `specs/`.
- MUST preserve existing specifications when creating new project scaffolding.

## Commits and Integration

- MUST format commit subjects as `type(component): explanation`.
- MUST use a type matching the change, such as `fix`, `feat`, `docs`, or `chore`.
- MUST describe the concrete change in the explanation.
- MUST keep unrelated discovered fixes in separate commits.
- MUST open a PR when working hands-free.
- MUST obtain human approval before merging hands-free work.
- MUST follow user authorization for integration during interactive work.

Example: `fix(review): reject non-string code input`.

## Security and Hard Stops

- NEVER commit secrets, tokens, database credentials, or populated environment files.
- MUST obtain explicit authorization before modifying production data or infrastructure.
- NEVER bypass authentication or remove access checks to make a feature work.
- MUST validate external input at trust boundaries.
- MUST keep Modal credentials and database access on the server.
- MUST avoid exposing submitted code, credentials, or sensitive upstream details in logs and errors.

## Defensive Code

These categories guide relevant changes; they do not require unsolicited infrastructure or features.

- MUST bound external calls with timeouts when implementing or changing their request lifecycle.
- MUST consider cancellation across the browser, web server, and model service.
- MUST apply rate limits when implementing protection for costly inference endpoints.
- MUST report external failures clearly and restore UI loading states.
- MUST preserve review text fallback when token probabilities are unavailable.
- MUST retry only transient failures when repeating the operation is safe.
- MUST bound retries and account for duplicate inference costs.
- DO NOT add circuit breakers without a demonstrated need.

## Tests and Verification

- MUST add a focused test or assert-based self-check for new nontrivial logic.
- MUST test behavior and relevant failure cases rather than mirror implementation details.
- MUST keep tests fast, isolated, repeatable, self-checking, and timely.
- DO NOT add tests solely for trivial documentation or data-only changes.
- MUST run `npm run check && npm run build` from `frontend/` for frontend implementation changes.
- MUST run relevant regression tests when a test suite exists.
- MUST report missing test or lint commands as unavailable.
- NEVER describe an unrun check as passing.

## Always Green / Shift Left

Early checks reduce repair costs; the 1–10–100 principle expresses increasing costs as defects move downstream.
It is a workflow rationale, not a measured cost ratio for this project.

- MUST verify relevant changes before integration.
- MUST treat Preflight as green only when both configured commands succeed.
- MUST inspect actual CI results when a PR has checks.
- MUST distinguish deployment success from application verification.
- MUST resolve or log reproducible gate failures before continuing dependent work.
- NEVER merge with unresolved failing required checks.

## Discovered Defects

- MUST reproduce a suspected defect before classifying it.
- MUST use `quick-fix` for qualifying trivial data-only defects.
- MUST use `fix-bug` when a defect needs behavioral investigation or code changes.
- MUST log deferred defects under `specs/bugs/` with evidence, impact, and a next action.
- MUST stop dependent work when an unresolved defect invalidates its verification.
- MUST keep discovered fixes separate from the requested change when practicable.

DO NOT use these phrases to dismiss a red gate:

| Phrase | Required response |
| --- | --- |
| “Pre-existing” | MUST reproduce and fix or log the failure. |
| “Unrelated to this session” | MUST record the impact and next action. |
| “Not introduced by my changes” | MUST verify whether the failure blocks the current work. |
| “Out of scope” | MUST log the defect and stop work that depends on the failing gate. |

## Managed Instructions

- MUST preserve handwritten text outside bigpowers fenced markers.
- MUST replace only the matching managed section when updating agent instructions.
- MUST record workflow and handoff state in `specs/state.yaml`.
