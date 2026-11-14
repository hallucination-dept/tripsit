# Dependency audit observation

type: chore
context: domain
Status: deferred investigation; audit observation, not a reproduced application exploit.

`npm ci` installed the locked frontend dependencies. `npm audit --json` exited 1 with five low-severity entries: deepmerge and its affected dependency chain through @sveltejs/vite-plugin-svelte, @sveltejs/kit, @sveltejs/adapter-node and better-auth. Underlying advisory: GHSA-gcqx-w48m-w2h4, deepmerge prototype poisoning, reported affected version range 4.2.0–4.3.1.

Impact: tooling dependency reports unsafe merging behavior; application exploitability has not been assessed. No moderate/high/critical audit entries reported. Baseline check/build both pass; audit is not a configured required preflight gate. This observation does not certify security readiness.

Next action: reproduce reachable merge behavior with hostile keys, inspect tooling callers and assess a compatible upstream update or targeted resolution in a separate fix-bug investigation. npm proposed major/downgrade changes; no force-fix or dependency change was applied.

Initial sandboxed `npm ci` failed with an npm exit-handler error and unwritable cache/log location. An approved escalated retry succeeded. The missing-tool preflight failure is resolved; no application defect was inferred from absent installed dependencies.
