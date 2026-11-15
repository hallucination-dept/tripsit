# Revision-bound immutable review packet

An authenticated owner can freeze the existing server-built assessment against an owner-scoped, exact staged commit. The immutable packet retains the original evidence identities and explicit gaps, and never grants acceptance. Older evidence remains limited to its actual recorded dependencies; staging does not imply checks were run on a full repository.

- Read the staged commit and full candidate payload/snapshot before assessment. Build the packet only from the existing authorized assessment. On insert, lock and compare the entire candidate payload and snapshot with the captured version, the staged commit/base/candidate identity, owner and expiry; concurrent review or verification changes must fail with a conflict. Store the exact bounded packet bytes and digest in an expiring owner-scoped immutable table. Verify: `cd frontend && node --experimental-strip-types tests/revision-packet.test.ts` and `cd frontend && node --experimental-strip-types tests/revision-packet-db.test.ts` with a disposable `TRIPSIT_TEST_DATABASE_URL`.
- Expose an authenticated, origin-checked, rate-limited POST snapshot route with no client-supplied packet or evidence, and an owner-scoped historical GET with post-read access recheck. Verify: `cd frontend && node --experimental-strip-types tests/revision-packet-route.test.ts`.
- Exercise correct commit, stale stage/payload, cross-owner denial, and concurrent evidence append; run `cd frontend && npm run check && npm run build`.

No production migration, live provider call, human decision, merge operation, or acceptance-ready claim is included. Existing unstaged assessments remain unchanged.
