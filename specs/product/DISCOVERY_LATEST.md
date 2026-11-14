# Discover: combined generation and evidence-driven review

## Problem and users

Named engineers need to assess AI-generated changes without reading every line. They need requirement-linked evidence, visible side effects, and explicit residual risk to support an accountable merge decision.

## Agreed product boundary

TripSit reads GitHub issues, including reported bugs without formal acceptance criteria, generates implementations with Gemma on Modal, and opens linked PRs. It preserves supplied expectations, inferred hypotheses, and optional owner-confirmed criteria. It combines model uncertainty, a change-impact graph, an independent critic, and controlled executable verification. Both impact and uncertainty influence verification priorities.

The graph connects changes to affected behavior, requirements, and checks. Missing relationships remain visible. Model signals guide investigation; they do not certify correctness or waive policy.

A named engineer decides whether to accept, revise, or escalate. The decision identifies the revision, evidence, human inspection, unchecked scope, and accepted residual risks. Spot-checks and escaped defects inform scrutiny per code area.

## Current versus intended behavior

The existing application offers authenticated code review and token-probability highlighting. Ticket implementation, impact analysis, independent review, controlled execution, and accountable sign-off are planned capabilities, not demonstrated functionality.

## First-release outcomes

SCOPE_LATEST.yaml defines twelve future stories and observable acceptance criteria. The pilot must demonstrate real GitHub issue intake and a linked implementation PR, a downstream regression, uncertainty-directed verification, revision-bound evidence, risk-based human inspection, and outcome recording. Resolving an issue requires implementation and verification; AI review alone does not fulfill the ticket.

Evaluation compares graph-only, uncertainty-only, and combined prioritization under equal verification budgets. Record misses and costs even if the combined approach does not outperform the alternatives. Do not claim statistical superiority from a small demonstration.

## Decisions for Elaborate

- Users select any repository accessible through their GitHub login, including private repositories where permissions permit. Common languages include JavaScript/Node.js, Python, C++, C#, and Rust; the list is illustrative. Evaluation fixtures do not restrict repository selection.
- Establish operation-specific repository permissions and independently expected evaluation outcomes. Publish measured language coverage and unresolved analysis boundaries; authentication does not itself grant repository access.
- Use a configurable OpenAI-compatible API for the independent reviewer; provider/model selection is deferred by user decision. Gemma retains the internal-signal role.
- Choose graph extraction, safe execution boundaries, evidence integrity, and treatment of unsupported dependencies.
- Define uncertainty aggregation, prioritization rules, baseline budgets, and reproducible evaluation cases.

## Resource assumptions

The team has two people at a hackathon, targeting roughly 24 hours of agent build work with the already supplied stack and resources. No separate resource inventory, budget, or exact deadline is required to finish Elaborate. Provider/model selection for the OpenAI-compatible reviewer is explicitly deferred. Paid production infrastructure changes still require explicit authorization.

## Phase evidence and checkpoint

Vision, bounded scope, risk examples, success criteria, and the observed architecture map exist. No implementation feasibility, calibration, security effectiveness, or product acceptance result is claimed by this phase.

Discover artifacts are complete. Standard-mode confirmation is required before entering Elaborate; no later phase has begun.
