# Change-impact graph — point 2

Status: design proposal; extraction accuracy and runtime cost remain unverified.

## Purpose

For a candidate change, identify potentially affected behavior, explain the dependency paths, and find checks or human inspection needed along those paths. Uncertainty directs attention within this graph; graph impact prevents high-confidence generated code from escaping downstream verification.

## What to represent

Start with files, symbols, external interfaces, shared resources, expectations, and checks. Add finer statement-level nodes only if the first experiments demonstrate a need. Store the graph as revision-bound node and edge records; no graph database is required for the pilot.

Relationships include defines, imports, calls, reads, writes, exercises, and addresses-expectation. Each carries its source location, extraction method, and resolution status. Analyst/model suggestions are inferred links; missing or ambiguous targets are explicit gaps. Test execution coverage means exercised, not proven correct.

Source-to-source edges and evidence-to-expectation links have different meanings. Do not treat a test association or model-suggested requirement link as an established runtime dependency.

## From diff to affected behavior

1. Compare base and candidate graphs. Map edits, additions, deletions, and renames to their enclosing symbols or files; removed symbols still have callers in the base graph.
2. Follow reverse calls and imports toward consumers. Follow writes through shared resources toward readers; explore relevant callees and external interfaces for changed data flow.
3. Link affected behavior to existing checks and task expectations. Ask the critic to propose missing relationships and counterexamples, preserving their inferred status.
4. Attach available generation uncertainty to changed code spans. Unchanged affected consumers have no new generation signal; never assign them fabricated certainty.
5. Explain every prioritized check with its dependency path, consequences, uncertainty, and evidence gaps. Policy-mandated checks remain mandatory.

Cycles require visited-node tracking. Traversal has explicit node/time/context budgets; reaching a limit creates a visible incomplete-analysis gap rather than an all-clear. Report both visited and unexplored boundaries.

## Resolution strategy

Use parser/compiler-derived relationships where supported. Tree-sitter is a candidate for common-language syntax; semantic tooling can resolve symbols more precisely for particular languages. No parser choice is locked before feasibility experiments.

Proposed first validation cases use Python and TypeScript. Other languages may receive file/import-level analysis or an explicit unsupported result. Never imply symbol-level support merely because a grammar can parse the file.

Dynamic dispatch, reflection, dependency injection, events, SQL, framework routing, generated code, and external consumers may escape static resolution. Record potential effects and unresolved boundaries. Runtime traces can add observed paths, but absence from a trace does not establish absence of a dependency.

## Example

`changed discount calculation → checkout caller → persisted order total → refund reader → refund regression check`

An imports/calls graph alone may miss the order-total connection. If persistence linkage cannot be resolved, show it as an inferred shared-resource path or an unresolved side-effect boundary. Low uncertainty at the discount function cannot close that gap.

## Evidence reuse within a PR

Reuse requires more than a check being outside the textual diff. Its source inputs, dependency closure, expectations, check/oracle definition, environment, and policy must remain applicable. Changes to manifests, lockfiles, shared configuration, or unresolved dependencies can invalidate broad regions.

Keep the original execution immutable and record the reuse assessment separately. Do not reuse across new PRs in the pilot. Required checks rerun in full if impact cannot be bounded; unresolved boundaries still require scrutiny after a passing run.

## Feasibility acceptance scenarios

- An edited function reaches a caller in another file and its relevant regression check.
- A deleted or renamed function exposes callers from the base graph.
- A shared-resource write identifies a downstream reader or reports the unresolved boundary.
- Ambiguous same-name calls remain ambiguous rather than producing a falsely resolved edge.
- A cyclic dependency terminates traversal; budget exhaustion is visible.
- Unsupported syntax and dynamic calls create coverage gaps, never a clean result.
- Unchanged downstream code remains inspectable without invented token probabilities.
- A dependency/configuration change prevents unsafe reuse of an earlier passing check.

Planning must provide runnable fixtures for these scenarios. Point 3 will specify token alignment and uncertainty aggregation; no correctness probability is defined here.
