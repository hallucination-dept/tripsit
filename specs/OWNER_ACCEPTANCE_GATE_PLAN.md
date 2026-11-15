# Owner acceptance gate

Allow only a named, authenticated owner to accept an immutable staged packet when current server-owned requirements and exact staged revision evidence establish all applicable mandatory checks passed. Any absent, stale, ambiguous, failed or partial evidence must deny acceptance; revision and escalation remain available.

- Validate the frozen packet against the current server-owned manifest, exact revision evidence, and owner inspection; compare source, packet, policy and stage under the existing database locks. Verify: `cd frontend && node --experimental-strip-types --test tests/human-decision.test.ts`.
- Add explicit owner acceptance UI and compatible decision storage; never claim GitHub merge protection. Verify: `cd frontend && node --experimental-strip-types --test tests/human-decision-route.test.ts && npm run check && npm run build`.
- Exercise allow and adversarial denial cases including missing exact execution, changed manifest/revision, failed or zero checks, cross-owner and retry; `git diff --check`. Live acceptance requires independently admitted runner evidence.
