---
bug_id: BUG-001
status: fixed
severity: medium
scope: development-database
title: PostgreSQL query parameters bypass local test target validation
---

## Reproduce and isolate

The development database guard accepts a loopback URL with `?host=remote.example`, but installed pg-connection-string parses its actual host as remote.example. Reproduced without network access using the public guard and driver parser: guardAccepted true, actualHost remote.example. No nonlocal database was contacted. This is novel; registry previously empty.

## Hypothesis and verified root cause

The guard checks WHATWG URL hostname/path while the driver additionally honors query overrides. Falsification: parsing the same URL without query preserves localhost; adding the host parameter changes the driver's host while the guard still accepts. Confirmed parser-semantic mismatch. Security impact MEDIUM: an operator-supplied test URL can direct migration/purge outside the explicitly disposable target; no browser-controlled input reaches this environment value.

## Plan and scope

1. RED: add a guard regression for query overrides and fragments. Verify `cd frontend && node --experimental-strip-types --test tests/local-database-url.test.ts` fails before changing the guard.
2. GREEN: reject query strings/fragments before handing the URL to pg. Same command must pass; preserve accepted explicit loopback target.
3. Verify existing focused and actual disposable PostgreSQL tests plus check/build. Sweep callers: development work-items CLI and database test fixture use the shared guard; retention verifier has its own stricter guard. No production access or dependency changes.

## Acceptance

Local target accepted; host/options/port query overrides and fragments rejected. Existing consumers inherit the denial. The fix does not claim protection against an operator forwarding a local socket to another server.

## Resolution

Fixed with RED d6dc91f and GREEN 1018f50. Guard now rejects query/fragment overrides before pg sees the URL. The explicit regression passes (1), all 19 intake cases pass, actual disposable PostgreSQL suite passes (2), and check/build passes with Svelte 0 errors/warnings. Manual driver/guard demonstration now rejects host/options/fragment variants without making a connection. Caller sweep found the shared guard used by development migration/purge and database fixtures; the new retention verifier also invokes it and independently rejects overrides. No other test database URL guard remains permissive. Upstream generalize-sweep helper is absent; direct rg caller sweep and behavior assertions recorded here. No lint/npm test command exists.
