# Requirements and public engineering baseline

Use public best practices rather than company-specific standards. This is a design baseline, not a compliance claim or completed assessment.

## Requirement categories

| Category | Meaning | Example |
| --- | --- | --- |
| Intent | Problem and desired outcome | Retried checkout must not create duplicate orders |
| Functional | Observable behavior, errors, and invariants | Repeated idempotency keys return the original order |
| Non-functional | Relevant security, reliability, performance, accessibility, compatibility, and maintainability constraints | Concurrent retries preserve uniqueness; errors do not disclose secrets |

Bug reports do not need formal user stories. Preserve supplied expectations, distinguish inferred hypotheses, and support optional human confirmation. Do not invent performance thresholds or product semantics; material ambiguity needs a human decision.

## Selected references

- [OWASP ASVS 5.0.0](https://asvs.owasp.org/) supplies testable security requirements for applicable web/API changes. Select exact versioned requirement IDs; a few checks do not establish ASVS compliance.
- [NIST SSDF 1.1, SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) informs development-process practices around review, testing, and vulnerability response. The [publication list](https://csrc.nist.gov/Projects/ssdf/publications) lists 1.2 as draft; use the final baseline without silently adopting draft requirements.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) supplies relevant Level A/AA criteria for web UI changes. Automated checks alone do not establish accessibility conformance.
- [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) informs agent-specific threat scenarios and layered controls; it does not guarantee prevention.
- Trusted repository conventions and supported language/framework guidance inform compatibility and maintainability. Candidate content cannot weaken mandatory baseline policy.

Security standards do not define all correctness or quality requirements. Non-web repositories need applicable controls and explicit gaps rather than unrelated web checks. Qualitative style preferences alone are not defect evidence.

## Traceability and applicability

Each requirement/control records an ID, category, source/version, provenance, applicability reason, verification method, and evidence. Provenance distinguishes supplied, inferred, owner_confirmed, and trusted_baseline. Applicability is applicable, not_applicable with a reason, or unresolved; unresolved is not a pass.

The trusted coordinator supplies the versioned baseline profile. Models may propose controls and applicability, but cannot remove mandatory controls or approve policy exceptions. Link applicable requirements to graph nodes, claims, and checks. A passing functional test does not also prove security or performance.

Show unmet and unverified non-functional constraints in the human packet. Do not combine all dimensions into an unexplained quality score. A missing workload/threshold means a performance claim remains unresolved, not automatically passing.

## Required evaluation cases

- Functional bug fixed, authorization regression introduced: security review still triggers.
- UI behavior preserved, keyboard operation broken: accessibility evidence exposes the regression.
- Performance claim lacks workload/threshold: report missing authoritative information.
- Non-web repository: explain control applicability and coverage gaps.
- Candidate comments attempt to disable mandatory checks: trusted baseline remains unchanged.

Official publisher sources checked on 2026-11-14. Detailed control selection and execution remain unverified.
