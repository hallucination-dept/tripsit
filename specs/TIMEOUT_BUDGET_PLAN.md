# Local trial timeout diagnostics

The cause of the observed real 504 responses is not established from status alone. Preserve cancellation and finite bounds while fixing independently reproduced deadline handling defects; do not call live GitHub, model endpoints or configured databases.

- Give repository and issue discovery independent bounded browser deadlines so a successful slow repository listing does not consume the issue request's entire allowance. Align repository and issue route budgets with their bounded sequential GitHub calls (six and ten calls, each capped at ten seconds), with finite browser deadlines just above server deadlines. Verify `cd frontend && node --experimental-strip-types tests/issue-discovery.test.ts` with synthetic scaled deadlines.
- Preserve a fixed safe model-deadline message through candidate orchestration without exposing arbitrary dependency errors, and distinguish the overall coordinator deadline. Verify `cd frontend && node --experimental-strip-types tests/generation.test.ts && node --experimental-strip-types tests/model-generation.test.ts`.
- Run `cd frontend && npm run check && npm run build`; never describe mock timing or error handling as the cause of the real 504 without matching runtime evidence.
