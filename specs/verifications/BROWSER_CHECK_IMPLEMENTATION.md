# e01s01 browser UAT harness

type: feat
context: domain
Status: implemented harness; authenticated application UAT NOT RUN.
Scope: task8 operational verification, no application/auth changes.

## Runtime and verification plan

No Playwright/Puppeteer dependency or browser MCP runtime was found. `/usr/bin/google-chrome` exists. The cloud-desktop skill was read; shared desktop JavaScript tools are unavailable in this session. Native Node child_process plus Chrome DevTools Protocol pipes provide the smallest runnable installed browser path. No new package, wrapper service, application route or authentication bypass is added.

Files: `frontend/scripts/intake-browser.mjs`, `frontend/tests/intake-browser.test.mjs`. Existing owner UI selectors are repository/issue inputs, Snapshot issue/Reload my snapshots/detail controls, escaped title/body, provenance and expiry text, and Sign out. The harness preserves production code and uses legitimate existing session cookies supplied only through the process environment. Isolated browser profiles are removed after shutdown; cookie/source output is suppressed.

## Run against an authorized local development application

Configure these environment names securely without committing values:

- `TRIPSIT_LIVE_ORIGIN`: exact local HTTP origin, e.g. `http://127.0.0.1:5173`.
- `TRIPSIT_LIVE_OWNER_COOKIE`: legitimate first owner's Cookie header from the existing auth flow.
- `TRIPSIT_LIVE_OTHER_COOKIE`: a different authenticated owner who must be denied the first owner's work item.
- `TRIPSIT_LIVE_REPOSITORY`, `TRIPSIT_LIVE_ISSUE_NUMBER`: authorized public development fixture. Its title/body must contain an inert `<script`, `<img` or `<svg` text fixture to establish hostile text rendering. The harness does not modify GitHub issues.

From repository root:

`node frontend/scripts/intake-browser.mjs`

The browser performs real UI create, reload and detail actions; compares displayed source to the authenticated API snapshot inside the browser; checks exact SHA shape, future expiry, supplied/unconfirmed labels and empty inferred/confirmed counts; rejects child elements in source text; signs out and verifies source disappears; opens a separately authenticated owner context and checks work-item denial and no prior source after reload. It emits only booleans and a fixture digest. An ordinary fixture without hostile marker exits1 with incomplete status; this is not a security pass. Failure messages do not export cookies, user text, raw upstream errors or DOM.

Actual authorized UAT creates development work-item records and signs the first owner out. It does not change GitHub or production data. Use disposable development sessions; no cookie file/profile is imported. Chrome runs with its normal sandbox, no `--no-sandbox` flag.

## Actual local checks

RED `173c6e9`: configuration/cookie test committed separately and failed for missing harness module.

- `node frontend/tests/intake-browser.test.mjs`: 2 tests pass, no skip/cancel/failure. Covers required inputs, explicit local origin, distinct sessions, fixture identifiers, cookie controls/attributes/duplicate rejection and local cookie scope.
- `node --test frontend/tests/intake-browser.test.mjs`: exit0 (this sandbox reports file-level count; direct execution confirms both actual cases).
- `node --check frontend/scripts/intake-browser.mjs`: exit0.
- Unconfigured `node frontend/scripts/intake-browser.mjs`: exit1, generic BLOCKED, no credential/source output.
- Initial sandbox Chrome smoke failed (transport unavailable). Approved escalated `node frontend/scripts/intake-browser.mjs --browser-smoke`: exit0; actual isolated headless Chrome, browser context/tab attachment and page expression evaluation. No application/authentication tested.
- `git diff --check`: exit0.

No frontend application code or dependencies changed; application check/build is not rerun for this standalone operational script. Its real UI assertions remain unrun until legitimate sessions and the local app are configured. No actual session cookie values or secret files were read during implementation.

## Self-audit and limits

PASS local config security: strict loopback origin, no origin credentials/path/query/hash, no CLI cookies, no external target acceptance, duplicate/attribute/control cookie rejection. PASS transport bounds: 45s per CDP command, 35s owner workflow/10s second owner workflow, bounded2MiB message buffer and subprocess termination/temporary-profile cleanup. PASS output: static failure messages, source comparison occurs within browser, source-free check report. PASS scope: no auth bypass, no production changes or new dependencies.

The harness does not simulate delayed in-flight owner switching, actual revoked installation state or seven-day clock advance. Those remain separate mandatory fixtures/manual checks; sign-out and separate owner-context behavior are exercised when configured. It does not verify private admission or recurring deletion and must not mark the full story accepted.

Manual follow-up after automated configured run: while a reload is pending, sign out using the existing UI and sign in as another owner; confirm the old response cannot restore source. With an operator-provided revoked-access fixture, reload and confirm selection clears; with an expired development fixture, confirm source is absent. Record exact revision, fixture digests, observed results and actual command exits in story evidence. Do not mark these checks passing from the browser smoke or configuration tests.
