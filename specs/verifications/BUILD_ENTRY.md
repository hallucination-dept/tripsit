# Build entry and e01s01 survey

type: chore
context: domain

User authorized entry to Build. Selected e01s01 from the dependency queue, recorded start time, and completed threat modeling plus context survey. Application implementation has not started. Current build-epic resume step is 2 (plan-work).

Affected contracts: authenticated owner from Better Auth hooks; private pg pool in auth.ts; page as owner UI; new owner-scoped records and installation-authorized GitHub intake routes; env/setup documentation and tests. Preserve existing /api/review review/tokens behavior. Explicit owner binding, repository permission checks, bounded input/errors, expiry and source provenance are required before private intake can be accepted.

Actual verification:

- Node v22.23.4, npm 10.9.9.
- Initial `npm run check && npm run build`: exit 127, missing svelte-kit. Build did not run.
- Initial sandboxed `npm ci`: exit 1, npm exit-handler/cache error. Approved escalated `npm ci`: exit 0, 93 packages installed; lockfile unchanged.
- Repeated `npm run check && npm run build`: exit 0; Svelte check 0 errors/0 warnings; adapter-node build complete.
- `npm audit --json`: exit 1; five low entries, recorded in bugs/BUILD_SETUP_ADVISORY.md. Not an application exploit reproduction.
- Planning validator updated to accept valid Build progress statuses and check nested timestamp ledger status consistency; all original structural assertions retained. `python3 specs/experiments/plan_selfcheck.py`: passed with active e01s01.

No npm test or lint command is configured. Application tests, authenticated browser UAT, disposable PostgreSQL, live GitHub, production data and infrastructure checks remain unrun. No new product capability is claimed. Upstream timing/YAML helper scripts are absent; state and evidence were recorded directly.

Build-epic default resume instruction: “Run only the current step (resume mode) unless user asked for full auto-run.” This invocation completes context survey and leaves the next step recorded; no new phase authorization is needed to resume within Build.
