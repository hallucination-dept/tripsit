# e01 threat model

type: feat
context: domain
Status: Build admission assessment; controls below are requirements, not verified implementation.
Risk: HIGH. Git context: main at 94d8a6eddf228531d6aa9343c6b1228ad688c340.

## Surface and boundaries

Authenticated browser → SvelteKit owner route → GitHub installation API and app-owned PostgreSQL records. Later e01 stories add Gemma candidate decoding and trusted publication. Existing callers are the page, Better Auth server hook and review endpoint; preserve their session and review/tokens contracts. User-supplied repository/issue identifiers, GitHub content and model output are untrusted. OAuth identity alone grants no repository authority. Repository instructions cannot change trusted policy.

## Threats and required denial fixtures

| Category | Attack path | Mitigation and verification |
| --- | --- | --- |
| IDOR / authorization | Owner B guesses owner A's work-item or installation ID | Bind installation to authenticated GitHub identity, recheck repository access on every operation, owner-filter reads/writes; two-owner and revoked-installation fixtures, then configured GitHub gate. |
| SQL injection | Issue title/body or identifiers reach SQL | Constant SQL with bound parameters, finite shape/size validation; malicious strings stay data in disposable-database tests. |
| SSRF / credential exposure | Browser chooses API URL or redirect target | Fixed GitHub API origin, server-configured credentials, reject unexpected redirects; timeout and cancellation tests, no token or upstream body in errors. |
| XSS / prompt injection | Issue text contains markup or model instructions | Escaped Svelte text, retain supplied/inferred provenance, no HTML rendering or instruction-based authority; hostile-content fixture. |
| Private-source disclosure | Raw issue/source persists beyond authorization or expiry | Seven-day raw-artifact expiry with reference deletion, owner isolation, no raw content logs; real disposable PostgreSQL checks before private persistence. Destination-specific consent before later reviewer dispatch. |
| Stale provenance / races | Base moves or concurrent request overwrites frozen snapshot | Store repository ID, immutable base SHA and snapshot digest; atomic revision checks and safe operation reconciliation; concurrency/base-change fixtures. |
| Candidate path escape | Later generation overwrites outside repository or wrong blob | Bounded replacements, original blob validation, reject duplicate/traversal/invalid encoding/truncation; exact-byte decoder cases before signal use. |
| Credential-bearing execution / publication | Candidate reaches production secrets or write token | No execution in intake; later isolated runner admission has no local fallback. Only trusted publication receives scoped short-lived write authority; no merge/approve endpoint. |

## Controls and false-positive rules

Parameterized developer-authored SQL is not SQL injection. Escaped text is not HTML execution. A missing implementation is a planned control gap, not a reproduced exploitable vulnerability. No application diff was introduced for this assessment; no vulnerability findings are asserted. Threat severity reflects prospective data exposure and authority, not calibrated likelihood.

## Admission and next action

e01s01 must demonstrate authenticated intake, immutable provenance, two-owner isolation, revoked repository access and clock-controlled artifact/reference deletion. Local mocks do not certify live GitHub access or PostgreSQL behavior. Missing development configuration blocks the relevant gate and dependent live features. Production schema/data/infrastructure changes require explicit authorization. Continue plan-work for this story, then clean baseline/kickoff, TDD and verify-work; all implementation tasks remain unrun.

Verification: `test -s specs/security/epics/e01/THREAT_MODEL.md` and `python3 specs/experiments/plan_selfcheck.py` for planning structure only. Upstream security helper scripts are absent; no automated vulnerability scan or live integration is claimed.
