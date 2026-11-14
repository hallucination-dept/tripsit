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

// A small policy selection, not an ASVS or WCAG compliance assessment.
export function baselinePolicy(trustedSurface: 'web_ui') {
  if (trustedSurface !== 'web_ui') throw new Error('Invalid trusted surface.');
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
  return { version: 'tripsit-baseline-1', assessment: 'unverified' as const, requirements };
}
