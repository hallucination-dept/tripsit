import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baselinePolicy } from '../src/lib/server/policy.ts';

test('versioned web UI baseline requires independent authorization and keyboard evidence', () => {
  const policy = baselinePolicy('web_ui');
  assert.equal(policy.version, 'tripsit-baseline-1');
  assert.equal(policy.assessment, 'unverified');
  const authorization = policy.requirements.find(control => control.id === 'ASVS-v5.0.0-8.2.2')!;
  assert.equal(authorization.source.version, '5.0.0');
  assert.equal(authorization.source.url, 'https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x17-V8-Authorization.md');
  assert.equal(authorization.provenance, 'trusted_baseline');
  assert.equal(authorization.category, 'non_functional');
  assert.equal(authorization.mandatory, true);
  assert.equal(authorization.applicability, 'applicable');
  assert.match(authorization.verification, /unauthorized/i);
  const keyboard = policy.requirements.find(control => control.id === 'WCAG-2.2-2.1.1')!;
  assert.equal(keyboard.source.version, '2.2');
  assert.equal(keyboard.source.url, 'https://www.w3.org/TR/2023/REC-WCAG22-20231005/#keyboard');
  assert.equal(keyboard.applicability, 'applicable');
  for (const control of policy.requirements) {
    assert(control.reason.length > 0);
    assert.equal(control.evidence, 'unverified');
  }
});
