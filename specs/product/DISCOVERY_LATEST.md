# Discover: combined generation and evidence-driven review

## Problem and users

Named engineers need to assess AI-generated changes without reading every line. They need requirement-linked evidence, visible side effects, and explicit residual risk to support an accountable merge decision.

## Agreed product boundary

TripSit reads GitHub issues, records owner-confirmed acceptance criteria, generates implementations with Gemma on Modal, and opens PRs linked to the originating issues. It combines model uncertainty, a change-impact graph, an independent critic, and controlled executable verification. Both graph impact and uncertainty must influence verification priorities.

The graph connects changes to affected behavior, requirements, and checks. Missing relationships remain visible. Model signals guide investigation; they do not certify correctness or waive policy.

A named engineer decides whether to accept, revise, or escalate. The decision identifies the revision, evidence, human inspection, unchecked scope, and accepted residual risks. Spot-checks and escaped defects inform scrutiny per code area.

## Current versus intended behavior

The existing application offers authenticated code review and token-probability highlighting. Ticket implementation, impact analysis, independent review, controlled execution, and accountable sign-off are planned capabilities, not demonstrated functionality.

## First-release outcomes

SCOPE_LATEST.yaml defines eleven future stories and observable acceptance criteria. The pilot must demonstrate real GitHub issue intake and a linked implementation PR, a downstream regression, uncertainty-directed verification, revision-bound evidence, risk-based human inspection, and outcome recording. Resolving an issue requires implementation and verification; AI review alone does not fulfill the ticket.

Evaluation compares graph-only, uncertainty-only, and combined prioritization under equal verification budgets. Record misses and costs even if the combined approach does not outperform the alternatives. Do not claim statistical superiority from a small demonstration.

## Decisions for Elaborate

- Select concrete GitHub evaluation repositories, common languages, and independently established expected outcomes. Universal language coverage is not promised.
- Establish access permissions and whether the initial pilot supports private repositories.
- Select the independent reviewer through an OpenAI-compatible API. Hosted models are a proposed option; Gemma retains the internal-signal role.
- Choose graph extraction, safe execution boundaries, evidence integrity, and treatment of unsupported dependencies.
- Define uncertainty aggregation, prioritization rules, baseline budgets, and reproducible evaluation cases.

## Resource assumptions

The team has two people at a hackathon. No deadline or spending limit was supplied. These omissions do not block problem discovery; planning must report estimates, and any paid infrastructure change still requires authorization.

## Phase evidence and checkpoint

Vision, bounded scope, risk examples, success criteria, and the observed architecture map exist. No implementation feasibility, calibration, security effectiveness, or product acceptance result is claimed by this phase.

Discover artifacts are complete. Standard-mode confirmation is required before entering Elaborate; no later phase has begun.
