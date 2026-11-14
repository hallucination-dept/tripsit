type Requirement = {
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

type Expectation = Pick<Requirement, 'id' | 'category' | 'criterion' | 'source'> & {
  provenance: 'supplied' | 'inferred';
};

const boundedText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

// A small policy selection, not an ASVS or WCAG compliance assessment.
export function baselinePolicy(trustedSurface: 'web_ui', expectations: readonly Expectation[] = []) {
  if (trustedSurface !== 'web_ui') throw new Error('Invalid trusted surface.');
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
  }
  return { version: 'tripsit-baseline-1', assessment: 'unverified' as const, requirements };
}
