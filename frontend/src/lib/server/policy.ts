export type PolicySurface = 'web_ui' | 'web_api' | 'non_web' | 'unknown';

export type Requirement = {
  id: string;
  category: 'intent' | 'functional' | 'non_functional';
  criterion: string;
  source: { name: string; version: string; url: string };
  provenance: 'trusted_baseline' | 'supplied' | 'inferred';
  mandatory: boolean;
  applicability: 'applicable' | 'not_applicable' | 'unresolved';
  reason: string;
  verification: string;
  evidence: 'unverified';
};

export type Expectation = Pick<Requirement, 'id' | 'category' | 'criterion' | 'source'> & {
  provenance: 'supplied' | 'inferred';
};

const boundedText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

// A small policy selection, not an ASVS or WCAG compliance assessment.
export function baselinePolicy(trustedSurface: PolicySurface, expectations: readonly Expectation[] = []) {
  if (!['web_ui', 'web_api', 'non_web', 'unknown'].includes(trustedSurface)) throw new Error('Invalid trusted surface.');
  if (!Array.isArray(expectations) || expectations.length > 100) throw new Error('Invalid expectations.');
  const requirements: Requirement[] = [
    {
      id: 'ASVS-v5.0.0-8.2.2', category: 'non_functional',
      criterion: 'Restrict access to each data item to explicitly authorized consumers.',
      source: { name: 'OWASP ASVS', version: '5.0.0',
        url: 'https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x17-V8-Authorization.md' },
      provenance: 'trusted_baseline', mandatory: true, applicability: 'applicable',
      reason: 'Web changes require inspection of data authorization boundaries.',
      verification: 'Exercise authorized and unauthorized access to each affected data item.',
      evidence: 'unverified'
    },
    {
      id: 'WCAG-2.2-2.1.1', category: 'non_functional',
      criterion: 'Provide keyboard operation for functionality, subject to the criterion’s path-dependent input exception.',
      source: { name: 'WCAG', version: '2.2',
        url: 'https://www.w3.org/TR/2023/REC-WCAG22-20231005/#keyboard' },
      provenance: 'trusted_baseline', mandatory: true, applicability: 'applicable',
      reason: 'Web UI functionality needs keyboard verification.',
      verification: 'Exercise affected UI functionality with a keyboard and inspect any claimed exception.',
      evidence: 'unverified'
    }
  ];
  const gaps = [
    { id: 'performance-workload', reason: 'Performance workload is unspecified; no performance result can be assessed.' },
    { id: 'performance-threshold', reason: 'Performance threshold is unspecified; do not invent a passing target.' }
  ];
  if (trustedSurface === 'unknown') {
    for (const requirement of requirements) {
      requirement.applicability = 'unresolved';
      requirement.reason = 'Trusted applicability assessment is missing.';
      gaps.push({ id: requirement.id, reason: requirement.reason });
    }
  } else if (trustedSurface === 'non_web') {
    for (const requirement of requirements) {
      requirement.applicability = 'not_applicable';
      requirement.reason = 'This selected web profile does not assess non-web software.';
    }
    gaps.push({ id: 'non-web-coverage', reason: 'Non-web security and accessibility need a separately selected applicable baseline.' });
  } else if (trustedSurface === 'web_api') {
    requirements[1].applicability = 'not_applicable';
    requirements[1].reason = 'Trusted scope has no web UI; keyboard functionality is outside this API assessment.';
  }
  const ids = new Set(requirements.map(item => item.id));
  for (const expectation of expectations) {
    if (!expectation || !boundedText(expectation.id, 128) || ids.has(expectation.id)
        || !boundedText(expectation.criterion, 8192)
        || !['intent', 'functional', 'non_functional'].includes(expectation.category)
        || !['supplied', 'inferred'].includes(expectation.provenance)
        || !expectation.source || !boundedText(expectation.source.name, 256)
        || !boundedText(expectation.source.version, 128) || !boundedText(expectation.source.url, 2048)) {
      throw new Error('Invalid expectation.');
    }
    ids.add(expectation.id);
    requirements.push({ id: expectation.id, category: expectation.category,
      criterion: expectation.criterion, provenance: expectation.provenance,
      source: { name: expectation.source.name, version: expectation.source.version, url: expectation.source.url },
      mandatory: false, applicability: 'unresolved', reason: 'Imported expectation needs trusted applicability review.',
      verification: 'Define a check against the original expectation; inferred text remains a hypothesis.',
      evidence: 'unverified' });
    gaps.push({ id: expectation.id, reason: 'Imported expectation needs trusted applicability review.' });
  }
  return { version: 'tripsit-baseline-1', assessment: 'unverified' as const, requirements, gaps };
}
