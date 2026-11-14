# Local repeated retention verification

type: feat
context: domain
Status: local verification implemented and passed; production retention is unverified.

Plan (ADR 0003, e01s01 task7): add one disposable-local verifier that creates an isolated temporary schema, seeds expired and active source snapshots, invokes the existing purge implementation in two timed subprocesses, verifies physical payload/reference deletion and source-free retained metadata, and cleans its schema. Output includes source/configuration digests and actual cycle outcomes without credentials or raw source. Reject absent/nonlocal/non-test database targets; bound connection/query/subprocess work. No private-admission enablement or deployment/schedule changes.

Verification: `cd frontend && node --experimental-strip-types --test tests/intake-retention.test.ts`; actual database checks require explicitly configured `TRIPSIT_TEST_DATABASE_URL` for the disposable local `tripsit_e01s01_test` database. Missing configuration must fail, not skip.

## Actual results

- RED `ac803ca`: direct test execution exited1, missing script and absent explicit database prevented success. Separate GREEN implementation follows this test-only commit. Upstream TDD helper script is absent; actual RED execution was observed.
- `npm ci`: exit0, locked dependencies installed in this worktree without package changes.
- Direct `node --experimental-strip-types tests/intake-retention.test.ts` with the disposable loopback database: 2 tests passed, no skip/cancellation. Invalid-target cases include missing/nonlocal/wrong database and query/fragment overrides; diagnostics do not print credentials. Child process capture/local connections required sandbox escalation; the approved rerun passed.
- `node --experimental-strip-types scripts/intake-retention.ts` with the disposable local database: exit0. Two actual subprocesses each purged one expired fixture, with a 25ms interval; another active snapshot remained. Three metadata rows remained, two marked expired, without repository/source references. Temporary schema dropped on normal completion.
- The second fixture crosses an expiry boundary through fixture-only SQL; the application seven-day policy is unchanged. This verifies repeated local execution, not wall-clock seven-day or deployed scheduling behavior.
- Source-free report: code digest `7f886dd9eec5ff410516053abf8675c5d73f9c0a582a840e55e4c039e7dbce55`; configuration digest `d9297e29098d2fc633ba4ec43d0d0e29a1097c98ccfb00973370ef3bad444b23`; purged counts `[1,1]`, raw remaining1, metadata retained3, productionScheduleVerified false. Code digest covers this script, records implementation and migration; configuration digest covers local target identity (excluding password), interval and timeout controls.
- `npm run check && npm run build`: exit0, Svelte0 errors/0 warnings, adapter-node output built. Existing missing runtime-auth baseURL build warning remains; no runtime auth claim.
- `git diff --check`: exit0.

## Boundaries and self-review

The verifier accepts only the explicit disposable loopback database and forbids URI query/fragment overrides. It never falls back to DATABASE_URL. Isolated random schema names and a fixed validated worker argument are the only interpolated SQL identifiers; all fixture values use bound parameters through existing records. Each worker calls the actual `createRecords(...).purge()` implementation. Connection/query/server statement deadlines are1s, worker process limit6s, overall CLI limit25s; unexpected failures emit a generic message without upstream output. Tests bound their subprocess to30s.

Normal and query-failure paths drop only the isolated schema in finally. A forced overall process kill can interrupt cleanup; removing the disposable test container clears any leftover fixtures. No new dependency, app route, scheduler service, production mutation or private-admission enable flag was added. Actual deployed recurring deletion and private intake remain blocked; `passed_local_only` cannot be used as a full admission receipt.
