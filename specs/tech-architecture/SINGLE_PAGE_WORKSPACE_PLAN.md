# Single-page agent workspace

Status: implemented 2026-11-15 (interactive request).

## Goal

The frontend becomes one page. Signed-out visitors see the existing sign-in card at `/`.
Signed-in users see the agent workspace (formerly `/agent`, "Agent runs") at `/`.
The Issues and Code review sections are removed from the UI.

## Changes

1. `src/routes/+page.svelte` — keeps the sign-in card; the signed-in view is the agent workspace.
   The repository picker moves into the header as a dropdown; the form no longer has one.
   Hero copy: "Let's ship some features in <repo>" with a line saying to pick an issue or
   describe the feature and the TripSit agent will make the PR.
2. `src/routes/+page.ts` — `ssr = false` (the workspace needs the client session and the
   browser-only graph layout, as `/agent` did).
3. `src/routes/agent/` — replaced by a redirect to `/` that keeps the query string, so
   `?run=<id>` links already posted in pull request comments keep working.
4. `src/lib/server/graph-comment.ts` — new comments link to `/?run=<id>`; test updated.
5. Header nav tabs removed (one page). Sign out stays in the header.

6. Onboarding (client only): after sign-in the page checks `authClient.listAccounts()`.
   No linked GitHub → "Connect your GitHub account" step (`authClient.linkSocial`, which
   better-auth only allows when the GitHub email matches the account email; a failed link
   returns to `/?github=link-failed` and shows an explanation). Linked but no repositories
   discovered → "Add the Tripsit agent to your GitHub" step linking to `/api/github/connect`,
   plus "check again". The header gets an "Add repos" link to the same install page.

Out of scope: server API routes for work items, review, and candidates stay in place, as do
the now-unused client components (`CandidateInspection`, `OutcomeFeedback`, etc.) and the
live intake browser probe in `scripts/intake-browser.mjs`, which targets the removed UI.

## Verification

- `cd frontend && npm run check && npm run build`
- `cd frontend && node --test tests/graph-comment.test.ts`
- Browser: `/` shows the sign-in card when signed out; `/agent?run=x` redirects to `/?run=x`.
