# e01s01 implementation contract

type: feat
context: domain
Status: planned; all implementation verification remains unrun.
Decisions: ADR 0003, existing GitHub OAuth retained.

## Existing authentication and repository authority

Keep `auth.ts`, hooks, email/password login and `signIn.social({provider:'github'})`. There is already GitHub OAuth; do not add another login service or replace it with an App OAuth flow. Use the installed Better Auth APIs with the request's session headers:

```ts
const accounts = await auth.api.listUserAccounts({ headers });
// Select exactly one providerId === 'github' owned by locals.user.id.
const result = await auth.api.getAccessToken({
  headers,
  body: { accountId: github.id }
});
```

The local record `id` selects the token; external `accountId` identifies the GitHub user. Verify `/user` with the token and compare IDs. Never accept these IDs or tokens from browser input. Missing/expired token, absent account or ambiguous accounts yield an actionable unavailable/denied response. No automatic scope expansion, account linking or silent OAuth migration. Private repositories unavailable to the existing token remain unavailable until the owner grants suitable access through the existing provider.

For a selected `owner/repository`, read repository metadata with the user token to establish current user access. Separately use the configured App's JWT to resolve `/repos/{owner}/{repo}/installation`; verify App identity and suspended status. Create an installation token for that repository ID with only contents/issues read permissions needed by intake, then retrieve repository, issue and default-branch commit using installation authority. Compare canonical repository IDs from both access paths. Never equate organization membership or installation ownership with user access. Do not use `/user/installations` with the existing OAuth App token: this plan does not assume that token is a GitHub App user token.

Reject issue responses containing `pull_request`. Freeze the actual base commit SHA and bounded issue payload; do not execute repository content or infer acceptance criteria during intake. Store the issue body as supplied problem/expectations, label it unconfirmed, and leave inferred and owner-confirmed collections empty. An absent body is valid; absent formal acceptance criteria does not block intake.

Use native fetch/crypto: App JWT RS256, `iat` 60 seconds in past and expiry no more than ten minutes ahead. Scope installation token to one repository via `repository_ids`; never inherit all installed repositories by omission. No token returned through new routes, stored in work items, logged or sent to inference. Current user access and installation access are rechecked before each create/source read. No write or publication token exists in this story.

## Routes, records and callers

POST `/api/work-items` takes only `{repository: 'owner/name', issueNumber: positiveInteger}`. GET collection/detail returns only owner-accessible records after current repository authorization; ownership lookup precedes external requests. Browser installation IDs, owner IDs, endpoint URLs and SHAs are not authority. Use opaque UUIDs; return bounded safe 400/401/403-or-404/410/413/502/503 errors without raw upstream bodies. Require same-origin mutation protection and JSON content type. Enforce finite limits before parsing: request 4 KiB, individual upstream response 1 MiB, issue body 128 KiB UTF-8, 10-second individual request and 30-second operation deadline. Combine request abort and deadline, reject redirects and unexpected response shapes. No retry in this read-only intake slice; user can safely resubmit as a new immutable snapshot.

Export the existing pg pool for server-only records rather than duplicate connection configuration. Use an app-owned SQL migration separate from Better Auth. Minimal tables: owner-scoped work-item UUID/status/snapshot digest/creation/expiry metadata, and raw snapshot payload/references keyed to the item. Raw payload contains repository and issue references, supplied text, frozen SHA and provenance collections. No mutable candidate/review/evidence schema yet. New intake creates a new immutable snapshot rather than overwriting an earlier one. Use constant parameterized SQL; transactionally insert metadata/payload and purge expired payload/references. At expiry refuse source reads even before purge; retain only owner-scoped source-free digest/status metadata. Collection listing must not expose raw content or references before authorization.

Provide a bounded purge command and real clock-controlled deletion test. A periodic invocation must be verified before claiming seven-day retention compliance; read-time hiding alone is insufficient. No cleanup schedule or production migration is deployed by writing code. Fail closed for private persistence until actual owner-isolation, retention and admission evidence matches deployed code/configuration. Evidence cannot be supplied by browser/repository input or enabled by a bare unchecked success flag.

Thin SvelteKit routes call testable helpers in server-only modules. Reason for depth: GitHub adapter hides identity/installation intersection and bounded transport; records hides parameterization, ownership and expiry; intake composes them without duplicating rules across routes. No generic repository/service framework. Existing `#lib` imports, Svelte runes, escaped text and `/api/review` contract remain intact. New environment values are server-only App ID/private key and a trusted development/admission configuration; absent values disable intake while existing review remains available. Document actual names selected during implementation in env.ts, .env.example and README.

The signed-in page adds bounded repository/issue inputs and create/reload/detail controls, not a new dashboard. Selecting a repository name is a request to validate access, not proof. Show frozen SHA, supplied/inferred/confirmed provenance, expiry and unavailable states. Use native labels, keyboard controls, alerts/live regions and `finally` to restore loading state. No generation or publication UI in this slice.

## Verification contract

`tests/e01s01.test.ts` uses native node:test with injected transport/records and no Svelte runtime imports. It must cover positive and denial paths from the task ledger, token/account identity confusion, permission revocation on reads, cancellation and bounds. Local mocks prove local branching only.

`tests/e01s01-db.test.ts` requires an explicitly disposable development database, refuses a production target, runs app migration and two-owner/parameter-binding/concurrent-snapshot/expiry/reference-purge cases, and fails when configuration is absent. Never run against DATABASE_URL implicitly or mutate Better Auth tables. No production data access is authorized.

Configured live gate needs a real authorized development issue and separately identifiable accounts/revocation fixture, plus actual disposable PostgreSQL assertions and verified retention invocation. Save source-free evidence bound to code/config/migration identities. Missing resources fail rather than skip. UAT inspects authenticated browser behavior, actual commands/exits and identifiers; `test -s` only establishes report presence. Every task remains failing until its intended checks actually pass.

## Contract sources

- Installed `better-auth/dist/api/routes/account.d.mts` and account.mjs establish `listUserAccounts` and explicit local account selection in `getAccessToken`; inspected during Plan step 2.
- [GitHub installation token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) defines `POST /app/installations/{installation_id}/access_tokens`, optional `repository_ids` and permissions. Omitting repository scope broadens access; always specify it here.
- [GitHub App REST endpoints](https://docs.github.com/en/rest/apps/apps) document repository-installation discovery and App authentication. Validate exact live response fields during TDD/live admission.
- [GitHub repositories](https://docs.github.com/en/rest/repos/repos#get-a-repository) documents authenticated repository metadata; use it independently under each credential.
- [GitHub JWT documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app) specifies RS256 and bounded claims.

Slopcheck: [OK] reuse installed pg/Better Auth/SvelteKit and native Node APIs; no dependency change. Existing low audit advisory stays tracked separately; this is no vulnerability certification. Caught rationalization: a successful login cannot stand in for repository authorization, and a stubbed database cannot establish actual isolation/expiry.
