# Human revision and escalation records

The current packet explicitly has `acceptanceReady: false`; acceptance remains unavailable until mandatory evidence and inspection enforcement are implemented. Authenticated owners may record a request for revision or escalation against a current, staged, immutable packet, with completed inspection, unchecked scope, residual risk, and server timestamp. These records do not approve or merge anything.

- Add owner-scoped expiring decision records with atomic row-lock and full payload/snapshot/packet/staged revision checks, including policy and packet digest; reject stale, cross-owner, missing fields and all accept attempts. Verify `cd frontend && node --experimental-strip-types tests/human-decision.test.ts` and `cd frontend && node --experimental-strip-types tests/human-decision-db.test.ts` using only a disposable local database.
- Add authenticated origin-checked, rate-limited decision route and an accessible owner form that freezes a packet, shows its exact commit and submits revise/escalate only. Verify `cd frontend && node --experimental-strip-types tests/human-decision-route.test.ts` and `cd frontend && npm run check && npm run build`.
- Exercise a concurrent evidence append versus decision recording, changed policy/commit, owner isolation and acceptance denial. Do not create production data or claim full e04s02 completion.
