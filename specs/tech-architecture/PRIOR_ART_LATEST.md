# Prior Art: combined implementation and verification

Elaborate research started on 2026-11-14. These are candidates and design recommendations, not deployed integrations or validated performance claims.

## Existing code and workflow

Reuse `modal_gemma.py` for Gemma inference and token probability conversion. It currently removes choice-level logprobs and returns token strings with percentages, without source offsets. Generation needs exact output-to-code mapping before uncertainty can annotate graph nodes reliably. Selected-token probabilities do not supply full-distribution entropy or hidden activations.

Reuse the SvelteKit authentication boundary and server-side fetch pattern. No checked-in issue implementation runner, impact graph, evidence runner, or decision store exists. The existing route's review-only prompt and output limit cannot simply be treated as a ticket implementation workflow.

Skill search ranked research-first for prior-art decisions, spike-prototype for feasibility experiments, and security-audit for execution-boundary review. No local opensrc executable, cache, skill-index builder, or project scripts directory was found; use official documentation without installing research tooling.

## Candidate decisions

| Candidate | Fit | Proposed use and limits |
| --- | --- | --- |
| Existing Gemma/vLLM service | Extend | Retain generation metadata and selected-token log probabilities; preserve code offsets and transformation provenance. Validate deployed image capabilities before depending on additional fields. |
| Tree-sitter | Compose | Common-language syntax extraction. Build only the supported relationship analysis; syntax parsing alone is not semantic caller resolution. |
| TypeScript compiler API | Adopt where applicable | Resolve symbols in TypeScript repositories; compare cost and coverage against syntax-only extraction. Already a frontend development dependency, not necessarily available in a production runner. |
| Modal Sandbox | Compose | Candidate separate execution environment. Explicitly restrict egress and resources; never expose authoring, repository-write, or production credentials. |
| OpenAI-compatible reviewer endpoint | Adopt protocol | Use server-side HTTP and validated responses; start with one configured endpoint/model rather than a provider framework. Gemini is one documented compatible option, not an open-weight model. |
| GitHub REST API | Adopt | Read issues and publish a branch/linked PR under explicit repository authorization. Keep publishing credentials outside execution workers. |
| Requirement/evidence graph and prioritization | Build | Product-specific linkage and decisions are not supplied by a parser or inference API. Begin with revision-bound records rather than introducing a graph database without demonstrated need. |

## Source evidence

- [Tree-sitter introduction](https://tree-sitter.github.io/tree-sitter/) documents concrete syntax trees, bindings, and language grammars. npm and PyPI list bindings: [npm](https://www.npmjs.com/package/tree-sitter), [PyPI](https://pypi.org/project/tree-sitter/). No version or installation choice is locked.
- [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) demonstrates symbol and type inspection. Inference: useful for stronger resolution in supported TypeScript projects; it does not establish universal runtime dependency coverage.
- [vLLM engine arguments](https://docs.vllm.ai/en/v0.10.2/configuration/engine_args.html) document raw and processed logprob modes in that release. This supports investigating the existing setting, not a claim about the mutable deployed image.
- [Modal networking and security](https://modal.com/docs/guide/sandbox-networking) documents sandbox isolation and outbound restrictions. Outbound public access is enabled by default, so merely choosing Sandbox does not meet the proposed network boundary.
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) documents compatible requests. Validate the selected model's actual fields, errors, and structured outputs before integration.
- [GitHub PR endpoints](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request) and [App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps) provide the publication primitives. Reading issues, writing content, and opening PRs require distinct permission considerations.

## Next design work and feasibility gates

1. Define node, claim, evidence, and decision identities tied to repository revisions; distinguish observed, inferred, and unknown graph edges.
2. Prove byte/token alignment on Unicode and multi-file generated output. Missing signals must remain missing, not become high confidence.
3. Compare syntax extraction and semantic resolution on controlled Python and TypeScript cases, including a downstream regression and unresolved dynamic calls. These are proposed initial evaluation languages, not a universal-support claim.
4. Define transparent priority ordering with mandatory security checks first; compare graph-only, uncertainty-only, and combined policies under equal budgets. Do not invent a calibrated correctness percentage.
5. Specify trusted check configuration and test oracles outside candidate control. Separate trusted runner status from untrusted stdout, which is not proof of a passing test.
6. Validate sandbox secret exclusion, egress controls, time/resource limits, dependency preparation, artifact collection, and credential separation before running candidate code.
7. Select evaluation repos and reviewer credentials; record model, prompt, tools, revision, and costs. Define stale-evidence invalidation and a human-owned merge boundary.

Elaborate remains in progress. No quality score, execution effectiveness, or phase gate is claimed.
