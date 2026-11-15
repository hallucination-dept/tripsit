import { configuredChecks, verificationDigest, type VerificationContext } from './verification.ts';
import type { Requirement } from './policy.ts';

type Control = { id: string; applicability: 'applicable' | 'not_applicable'; reason: string; checks: Array<{ id: string; digest: string }> };
export type TrustedRequiredManifest = { status: 'unavailable' } | {
  status: 'operator_asserted'; version: string; manifestDigest: string; repositoryId: number; baseSha: string; policyVersion: string; controls: Control[];
};
const unavailable = (): TrustedRequiredManifest => ({ status: 'unavailable' });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const text = (v: unknown, limit: number): v is string => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= limit && Buffer.from(v).toString('utf8') === v;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** A trusted operator asserts completeness; this is not proof or an execution result. */
export function trustedRequiredManifest(raw: string | undefined, checksRaw: string | undefined, context: VerificationContext, requirements: Requirement[]): TrustedRequiredManifest {
 try {
  if (!raw || !checksRaw || Buffer.byteLength(raw) > 131_072 || !Array.isArray(requirements)) return unavailable();
  const manifests: unknown = JSON.parse(raw);
  if (!Array.isArray(manifests) || manifests.length > 32) return unavailable();
  const matching = manifests.filter(entry => object(entry) && entry.repositoryId === context.repositoryId && entry.baseSha === context.identity.baseSha && entry.policyVersion === context.identity.policyVersion);
  if (matching.length !== 1 || !object(matching[0])) return unavailable();
  const manifest = matching[0];
  if (!exact(manifest,['schemaVersion','version','repositoryId','baseSha','policyVersion','complete','controls'])
    || manifest.schemaVersion !== 1 || !text(manifest.version,128) || manifest.complete !== true || !Array.isArray(manifest.controls) || manifest.controls.length > 128) return unavailable();
  const required = requirements.filter(requirement => requirement.mandatory);
  if (!required.length || new Set(required.map(r => r.id)).size !== required.length || manifest.controls.length !== required.length) return unavailable();
  const configured = configuredChecks(checksRaw, context);
  if (!configured.length) return unavailable();
  const checks = configured.filter(check => check.mandatory);
  const requiredChecks = new Map(checks.map(check => {
    const {nodeIds: _nodes, ...definition} = check;
    return [check.id, { digest: verificationDigest(definition), requirements: check.requirementIds }];
  }));
  const seen = new Set<string>(), used = new Set<string>(), controls: Control[] = [];
  for (const value of manifest.controls) {
   if (!object(value) || !exact(value,['id','applicability','reason','checks']) || !text(value.id,128) || seen.has(value.id)
    || !['applicable','not_applicable'].includes(String(value.applicability)) || !text(value.reason,1024) || !Array.isArray(value.checks) || value.checks.length > 16) return unavailable();
   const requirement = required.find(row => row.id === value.id);
   if (!requirement || requirement.applicability !== 'unresolved' && requirement.applicability !== value.applicability
     || value.applicability === 'applicable' && !value.checks.length || value.applicability === 'not_applicable' && value.checks.length) return unavailable();
   seen.add(value.id);
   const ids = new Set<string>(), linked: Control['checks'] = [];
   for (const check of value.checks) {
    if (!object(check) || !exact(check,['id','digest']) || !text(check.id,128) || !hash(check.digest) || ids.has(check.id)) return unavailable();
    const definition = requiredChecks.get(check.id);
    if (!definition || definition.digest !== check.digest || !definition.requirements.includes(value.id)) return unavailable();
    ids.add(check.id); used.add(check.id); linked.push({id:check.id,digest:check.digest as string});
   }
   controls.push({id:value.id,applicability:value.applicability as Control['applicability'],reason:value.reason,checks:linked.sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0)});
  }
  if (used.size !== requiredChecks.size) return unavailable();
  controls.sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { status:'operator_asserted', version:manifest.version, manifestDigest:verificationDigest(manifest), repositoryId:context.repositoryId,
    baseSha:context.identity.baseSha, policyVersion:context.identity.policyVersion, controls };
 } catch { return unavailable(); }
}
