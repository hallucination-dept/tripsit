# Pull request validation plan

Add a GitHub Actions pull-request workflow with read-only repository permissions.
Install the locked frontend dependencies on Node 22, run the existing Svelte
type check and build, the offline TypeScript tests, and the Python model tests.
Do not run deployments or publish artifacts. No lint command is configured.

Verification:

- `cd frontend && npm run check && npm run build`
- `cd frontend && node --experimental-strip-types --test $(find tests -maxdepth 1 -name '*.test.ts' ! -name '*-db.test.ts' ! -name 'intake-retention.test.ts' | sort)`
- `python3 -m unittest discover -s tests`
- `python3 -m unittest discover -s specs/experiments/tests`
- Validate workflow YAML and inspect `git diff --check`.

Database tests require a disposable PostgreSQL instance; browser tests require
Chrome. Those checks remain outside this workflow's coverage. Admission-gate
tests use local sockets and run on the GitHub runner.
