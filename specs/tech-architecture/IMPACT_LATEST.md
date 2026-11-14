# Implementation impact and contracts

type: feat
context: domain
Status: planning assessment; no application behavior changed.

## Targets, callers and contracts

| Module/purpose | Known callers and affected stories | Contract and required reach |
| --- | --- | --- |
| `modal_gemma.py`: inference lifecycle/conversion | review route; e01s02 | Add raw selected logprobs/token bytes; retain existing percentages and nonstreaming proxy-auth API. Test decoder and Python response conversion together. |
| `frontend/src/routes/api/review/+server.ts`: authenticated review boundary | page; e01s02 | Preserve `{code}` → `{review,tokens}` and text fallback; new generation routes do not bypass auth or leak upstream errors. |
| `frontend/src/routes/+page.svelte`: owner interaction | browser; all stories | Preserve Svelte runes, escaped content, labels, keyboard access, alert/live regions and loading cleanup; add issue/review flows incrementally. |
| `frontend/src/lib/auth.ts`: auth/database integration | server hook; e01s01 | Pool currently private; reuse installed pg with a server-only app-record pool or intentional export without changing Better Auth tables. Session identity is not repository permission. |
| hooks, locals and layout | every protected request | Preserve authenticated owner identity; authorize each record and GitHub installation operation separately. |
| env declarations, `.env.example`, README | server/build/operator; e01s01/e01s02/e02s02/e03s02/e01s03 | Document server-only configuration, missing-service states, provider disclosure, migration/retention and actual live gates; examples contain no credentials. |
| New records/graph/policy/reviewer/runner/publication paths in capsules | new owner routes and page | Revision/source/expectation/policy/check identity is immutable. Parameterized SQL, optimistic concurrency and owner filters; avoid generalized framework. |

## Coverage and risk

Risk: High — new private-source storage, external requests, execution and publication cross trust boundaries with no application regression suite. Existing tests do not exist; `specs/experiments/elaborate_selfcheck.py` is synthetic design evidence only. New local tests must precede each slice; native node:test and Python unittest avoid introducing a runner dependency. No test or lint npm command currently exists. Check/build remain mandatory on frontend changes.

Cross-owner access, expired raw artifact references, disclosure without destination consent, credential-bearing execution, stale acceptance and retry duplicates could expose data or mislead owners. Live admission checks in ADR 0003 block the associated behavior; mocks alone cannot establish isolation, real token alignment or GitHub protection.

No production migration, infrastructure change, publication or API call is authorized merely by writing this plan. Minimal app-owned versioned SQL migrations are planned separately from auth migration. A development database reset must never point at production.

## Scope and prior art

Reuse Better Auth, pg, SvelteKit routes and Python inference conversion. Native fetch/crypto handle GitHub App JWT/requests; no new GitHub SDK or schema package. Modules named in capsules are proposed responsibilities, not a mandate to create one file per concept; combine adjacent small records functions until a meaningful boundary justifies separation. No graph database or coordinator service.

Scope covers every stable ID in SCOPE_LATEST.yaml. The weighted epic index is not an execution order: `story_queue` is dependency-respecting, while WSJF selects only ready work. e01s03 publication waits for e04s02 and its complete evidence chain. A blocked live integration does not authorize dependent live behavior or a false completion; independent fixture work can continue.
