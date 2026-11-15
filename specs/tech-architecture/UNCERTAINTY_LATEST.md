# Generation uncertainty — point 3

Status: proposed design; mapping and prioritization require experiments before implementation choices are locked.

## Available signal

The current Gemma service requests selected-token raw log probabilities and returns token text with percentages. It does not currently expose source offsets, a full next-token distribution, hidden activations, or correctness probabilities. Preserve raw selected-token log probabilities and generation settings in the future record rather than retaining percentages alone.

Token probability describes the generated token under its preceding context and model configuration. Low probability can reflect an unusual identifier or literal rather than a defect. High probability can accompany a familiar but wrong implementation. Treat it as an experimental investigation signal.

## Mapping to candidate code

Retain the exact generated output and ordered token observations. Establish byte spans against the original output using provider token bytes when available; decoded token strings are acceptable only when exact reconstruction succeeds. Never silently normalize whitespace, Unicode, or line endings.

Generation must return file contents or edits in a defined format. Its decoder records mappings from output spans to resulting file spans, including escaping and patch application. Syntax delimiters, explanations, and removed patch lines do not become candidate-code signals. Untouched source receives no new generation score.

Validate the reconstructed file contents against the committed blobs. Intersect mapped spans with graph symbols. A token crossing a symbol boundary may contribute to both symbols with explicit overlap; never assume one token equals one code character. If mapping is incomplete or reconstruction fails, record unavailable/partial signal coverage and exclude that region from numerical ranking.

Source transformations and subsequent human edits invalidate affected mappings unless exact provenance is maintained. Later generations append new observations for their own output; do not attribute an earlier token score to newly written text. Deleted code has impact through the base graph but has no generated candidate token signal.

## Initial aggregation experiment

For mapped generated tokens in a symbol, compute mean negative selected-token log probability as a simple reproducible ranking feature. Retain token count, generated-byte coverage, mapping quality, model identity, and the underlying observations. Inspect token-level peaks separately rather than treating the minimum probability as a verdict.

Compare ranking only under comparable model/settings and report length/tokenization sensitivity. Do not pool different models into a supposedly universal scale. Missing values remain missing. Full-distribution entropy requires additional distribution data and is not computed from selected-token probabilities alone.

This is a candidate baseline, not a chosen predictor of defects. Evaluate whether it improves check selection compared with impact-only prioritization. Do not train or tune on held-out evaluation cases.

## Combined verification policy

1. Run policy-mandated checks irrespective of model signals.
2. Address known failures and high-consequence affected behavior first. Unknown impact or unavailable signals cannot lower scrutiny.
3. Within comparable impact groups, use generation uncertainty, reviewer disagreement, and missing behavioral evidence to select additional checks. Explain which input changed the order.
4. Follow graph paths to affected consumers, including unchanged code without generation signals. A shared low-confidence origin can motivate a downstream check without assigning its probability to the consumer.
5. Record checks omitted because the budget was exhausted and the affected behavior left unverified. Escalate where policy requires it.

Prefer explicit priority groups to an opaque weighted score. Do not multiply token, edge, or reviewer probabilities into a PR correctness percentage. A model-proposed defect can trigger a check at any uncertainty level.

## Evidence feedback

After execution, attach supported, contradicted, or unresolved claim assessments with the evidence references and scope. Passing a check resolves its exercised claim only; it does not change the original token probabilities or eliminate unrelated risks.

A failing downstream check can increase investigation of neighboring graph paths. A passing check may reduce the remaining verification workload for that claim if mandatory policy is satisfied. Keep original generation observations separate from updated evidence assessments.

## Required feasibility scenarios

- Exact mapping of multiple files, Unicode identifiers, emoji, escaped strings, and differing line endings.
- Patch additions, removals, overlapping token spans, and untouched downstream code.
- Truncated generation, absent logprobs, partial mappings, and reconstruction mismatch produce explicit gaps.
- Subsequent edits cannot inherit incompatible token mappings.
- A high-confidence seeded defect is still checked due to impact or mandatory policy.
- A low-confidence harmless identifier does not become a defect finding without evidence.
- With equal optional-check budgets, report graph-only, uncertainty-only, and combined selection outcomes, including misses, cost, and false alarms.

The evaluation budget and reproducible ordering rules must be fixed before held-out runs. Predictive correctness claims require independently labeled examples and calibration evidence beyond this pilot.

## Prototype: per-node functional agreement (UQLM)

Status: experiment only. Not wired into the app, the Modal service, or check prioritization.

Selected-token probabilities under-report decisions the model already made in its reasoning or plan. Sample agreement judged by behavior is the best-supported code signal (Sharma & David 2025; Functional Entropy, EMNLP 2026). UQLM `CodeGenUQ` implements it per whole response, so the prototype localizes it per graph node:

1. Generate one greedy candidate (temperature 0) and N samples (temperature 1) of the complete edited file through the existing Modal OpenAI-compatible endpoint.
2. Split base, candidate and samples into nodes with Python `ast`: top-level functions, class methods, and one `<module>` node for remaining top-level statements. Normalize each node with `ast.unparse` so formatting and comments do not count as disagreement.
3. A sample that leaves a node unchanged contributes the base version; a sample that removes it contributes an explicit removal marker.
4. For each node the candidate changed, call `CodeGenUQ.score(..., scorers=["functional_equivalence_rate"])` with the candidate node as the response and the sample nodes as sampled responses. Gemma is the equivalence judge. AST-identical versions skip the judge.
5. Report nodes the candidate left unchanged but some samples edited as possible missed edits, with the edit rate.

Limits: Python only (UQLM's judge prompt supports Python, Java and SQL); each node is judged in isolation, so cross-function effects are ignored; the judge does not execute code; one hand-made fixture demonstrates behavior and does not validate predictive value.

Verification: `python3 -m unittest discover -s specs/experiments/tests -p 'test_node_uncertainty.py'` (offline, fake judge) and `uv run --python 3.12 --with uqlm --with langchain-openai python specs/experiments/node_uncertainty.py specs/experiments/fixtures/node_uncertainty --env-file frontend/.env` (live Modal endpoint; `fixtures/node_uncertainty_vague` is the second fixture).

### Results (2026-11-15, uqlm 0.6.8, gemma-4-31B-it, 1 greedy + 5 samples at temperature 1)

- Offline tests: 11 passed. Live pipeline ran end to end in about 2 minutes per fixture.
- `node_uncertainty`: all six replies were byte-identical; every one of 219 candidate tokens had raw probability ≥ 0.991. All edited nodes scored 1.00 agreement and nothing was flagged. The model resolved "members for a year" as `membership_days(...) >= 365` with no variation, although calendar years and leap days make it a reviewer decision.
- `node_uncertainty_vague`: five of six versions were identical; one sample also caught `TypeError`. Gemma judged it equivalent, as UQLM's default judge prompt counts minor edge-case differences as equivalent. "Handled gracefully" became a silent quantity of 0 in every version, which is a judgment call a reviewer may reject, and it was not flagged.
- The endpoint does sample: three direct requests at temperature 1.0 returned three different sentences, so identical edits reflect a near-deterministic model on these tasks, not a configuration fault.

Conclusion: on small, plausible edits, sample agreement and selected-token probability both report confidence for confidently made assumptions. They cannot cover the "assumption or judgment call" category; that needs explicit assumption flags or a ticket-versus-edit review pass. Sample agreement remains a candidate signal for larger or genuinely underdetermined edits, and its judge prompt would need to treat edge-case differences as disagreement for review use.
