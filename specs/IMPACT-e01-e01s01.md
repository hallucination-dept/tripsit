# e01s01 impact assessment

type: feat
context: domain
Risk: High — new private-source storage and external authorization have no existing regression coverage.

## Purpose, dependents and reach

`auth.ts` owns Better Auth and its pg pool. Callers: hooks.server.ts; new server-only records/intake boundary will reuse the pool and session APIs. Exporting the pool must not change auth schema, settings, Aiven TLS normalizer or session behavior. The page calls auth-client and `/api/review`; preserve those contracts while adding intake controls. env.ts and .env.example/README serve build/runtime/operator configuration. New callers: authenticated work-item create/list/detail routes, disposable-database tests, retention purge command and live-gate script. Future e01s02 and all downstream evidence stories consume immutable snapshot IDs; no candidate/evidence schema is needed now.

## Lightweight risk score

Fan-in 2/4: two existing auth/page consumer paths plus proposed intake callers. Fan-out 2/3: auth framework, PostgreSQL and new GitHub boundary; page continues same-origin requests. Recent churn 3/3: three commits in the inspected auth/page history. Total 7/10; additional >7 grill gate is not triggered. Security severity remains High independently of this lightweight change-coupling score. Add denial and real database tests before acceptance; no tests currently cover the target.

## Verification and limits

Plan-work Explore inspected installed auth signatures and current callers independently. Contract findings are incorporated in e01s01-implementation.md. Authenticated API/records tests, real disposable database tests and frontend check/build are planned per task; live user/installation intersection and retention admission remain mandatory. Existing baseline preflight passed during Build entry, not proof of this future behavior. Run `python3 specs/experiments/plan_selfcheck.py` for artifact consistency only.

No current data is migrated or deleted; no production infrastructure is authorized. The primary failure consequences are cross-owner source disclosure, stale repository authority and retained private data. Keep app-owned migrations separate and fail closed until the matching actual development gates pass.
