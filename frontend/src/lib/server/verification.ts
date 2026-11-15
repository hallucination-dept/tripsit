import { createHash } from 'node:crypto';
import { IntakeError, readJson, whileActive } from './intake.ts';
import { prioritizeChecks, type PriorityComparison, type SelectedTokenSignal } from './priorities.ts';
import type { PacketIdentity, TrustedCheck, TrustedExecution } from './packet.ts';
import type { GeneratedCandidate, GenerationObservations } from './generation.ts';
import type { ImpactSource } from './impact.ts';
import type { ExactFile, ExactRevision } from './exact-revision.ts';

export type OracleCheck = { id: string; language: 'python' | 'javascript' | 'typescript'; path: string; export: string;
  cases: Array<{ args: unknown[]; expected: unknown }>; requirementIds: string[]; nodeIds: string[];
  mandatory: boolean; impact: 'unknown' | 'critical' | 'high' | 'medium' | 'low'; timeoutMs: number };
export type VerificationContext = { identity: PacketIdentity; repositoryId: number;
  files: Array<{ path: string; original: string | null; replacement: string }>;
  nodes: Array<{ id: string; path: string; kind?: string; source?: ImpactSource }>; requirements: Array<{ id: string; mandatory: boolean }>;
  tokenSignal?: { mapping: NonNullable<GeneratedCandidate['tokenByteMapping']>; observations: GenerationObservations };
  comparison: PriorityComparison; impactUnknown?: boolean; disagreements: string[]; exact?: { revision: ExactRevision; files: ExactFile[] } };
export type VerificationEvidence = { checks: TrustedCheck[]; executions: TrustedExecution[];
  dispatchPlan?: ReturnType<typeof prioritizeChecks>;
  exactRevision?: ExactRevision; expectedCases?: Record<string, number>;
  admission: { status: 'passed'; configurationDigest: string; codeDigest: string; environmentDigest: string } };
type Configuration = { url?: string; token?: string; manifest?: string; fetcher?: typeof fetch };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const path = (v: unknown): v is string => text(v, 1024) && !/^[/.]|[\\:\x00-\x1f\x7f]/.test(v)
  && !v.split('/').some(p => !p || ['.', '..', '.git'].includes(p.toLowerCase()));
function fail(status = 503): never { throw new IntakeError(status, 'Controlled verification is unavailable or its revision is invalid.'); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const encoded = JSON.stringify(value); if (encoded === undefined) fail(); return encoded;
}
function jsonOracle(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value === 'string') return Buffer.byteLength(value) <= 8192 && new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
  if (Array.isArray(value)) return value.length <= 256 && value.every(row => jsonOracle(row, depth + 1));
  return object(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([key, row]) => text(key) && !/[\x00-\x1f]/.test(key) && jsonOracle(key) && jsonOracle(row, depth + 1));
}
export const verificationDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const blob = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');

/** A check names a file, so use only the exact full-file candidate node; no symbol coverage is inferred. */
export function fileTokenSignal(check: OracleCheck, context: VerificationContext): SelectedTokenSignal | undefined {
  const data = context.tokenSignal, file = context.files.find(row => row.path === check.path);
  if (!data || !file || data.observations.status !== 'observed' || data.mapping.status !== 'exact'
    || data.mapping.outputDigest !== context.identity.candidateDigest || data.mapping.model !== context.comparison.model
    || data.mapping.settingsDigest !== context.comparison.settingsDigest || context.comparison.revision !== context.identity.candidateDigest
    || data.mapping.observationsDigest !== createHash('sha256').update(JSON.stringify(data.observations)).digest('hex')) return;
  const size = Buffer.byteLength(file.replacement), fileBlob = blob(file.replacement);
  const nodes = context.nodes.filter(node => node.kind === 'file' && node.path === check.path && node.source?.revision === 'candidate'
    && node.source.path === check.path && node.source.blobSha === fileBlob && node.source.start === 0
    && node.source.end === size && node.source.byteLength === size);
  const rows = data.mapping.files.filter(row => row.path === check.path && row.blobSha === fileBlob);
  if (nodes.length !== 1 || rows.length !== 1 || !check.nodeIds.includes(nodes[0].id) || !rows[0].segments.length) return;
  const segments = rows[0].segments;
  if (segments[0].fileStart !== 0 || segments.at(-1)!.fileEnd !== size
    || segments.some((segment, index) => index > 0 && (segments[index - 1].fileEnd !== segment.fileStart || segments[index - 1].outputEnd !== segment.outputStart))) return;
  const start = segments[0].outputStart, end = segments.at(-1)!.outputEnd;
  let offset = 0, covered = start; const logprobs: number[] = [];
  for (const token of data.observations.tokens) {
    if (!token.bytes || !token.bytes.length || !Number.isFinite(token.logprob) || token.logprob > 0) return;
    const next = offset + token.bytes.length;
    if (offset >= start && next <= end) {
      if (offset !== covered) return;
      logprobs.push(token.logprob); covered = next;
    }
    offset = next;
  }
  if (!logprobs.length || covered !== end) return;
  return { ...context.comparison, mapping: 'exact', span: { start: 0, end: size }, logprobs };
}

/** Only server-owned, exact repository/base-pinned manifests define behavioral oracles. */
export function configuredChecks(manifest: string | undefined, context: VerificationContext): OracleCheck[] {
  if (!manifest) return [];
  try {
    if (Buffer.byteLength(manifest) > 131_072) fail();
    const entries: unknown = JSON.parse(manifest);
    if (!Array.isArray(entries) || entries.length > 32) fail();
    const matches = entries.filter(entry => object(entry) && entry.repositoryId === context.repositoryId && entry.baseSha === context.identity.baseSha);
    if (!matches.length) return [];
    if (matches.length !== 1 || !Array.isArray(matches[0].checks) || !matches[0].checks.length || matches[0].checks.length > 16) fail();
    const ids = new Set<string>();
    return matches[0].checks.map((value: unknown) => {
      if (!object(value) || !text(value.id) || ids.has(value.id) || !['python', 'javascript', 'typescript'].includes(String(value.language))
        || !path(value.path) || !text(value.export) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value.export)
        || ['constructor', 'prototype', '__proto__'].includes(value.export)
        || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > 16
        || !value.cases.every(row => object(row) && Object.keys(row).length === 2 && Array.isArray(row.args) && row.args.length <= 16 && Object.hasOwn(row, 'expected') && jsonOracle(row.args) && jsonOracle(row.expected) && Buffer.byteLength(canonical(row.args)) <= 16_384)
        || !Array.isArray(value.requirementIds) || !value.requirementIds.length || value.requirementIds.length > 100
        || !value.requirementIds.every(id => text(id) && context.requirements.some(row => row.id === id))
        || new Set(value.requirementIds).size !== value.requirementIds.length || typeof value.mandatory !== 'boolean'
        || !['unknown', 'critical', 'high', 'medium', 'low'].includes(String(value.impact))
        || !Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > 60_000
        || !context.files.some(file => file.path === value.path)) fail();
      ids.add(value.id);
      return { id: value.id, language: value.language, path: value.path, export: value.export, cases: value.cases,
        requirementIds: value.requirementIds, nodeIds: context.nodes.filter(node => node.path === value.path).map(node => node.id),
        mandatory: value.mandatory || context.requirements.some(row => row.mandatory && (value.requirementIds as string[]).includes(row.id)),
        impact: value.impact, timeoutMs: value.timeoutMs } as OracleCheck;
    });
  } catch { return fail(); }
}
function endpoint(configuration: Configuration) {
  try {
    const url = new URL(configuration.url ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !text(configuration.token, 8192)) fail();
    url.pathname = url.pathname.replace(/\/$/, ''); return url;
  } catch { return fail(); }
}
export function verificationConfigured(configuration: Configuration, context: VerificationContext) {
  try { endpoint(configuration); return configuredChecks(configuration.manifest, context).length > 0; } catch { return false; }
}

/** Server-configured checks are an inventory, not evidence or a completeness guarantee. */
export function mandatoryInventory(configuration: Configuration, context: VerificationContext,
  requirements: Array<{ id: string; mandatory: boolean; applicability: 'applicable' | 'not_applicable' | 'unresolved' }>) {
  let checks: OracleCheck[] = [];
  let configurationStatus: 'available' | 'unavailable' = 'unavailable';
  try {
    checks = configuredChecks(configuration.manifest, context);
    if (checks.length) configurationStatus = 'available';
  } catch { /* Invalid configuration is reported as unavailable. */ }
  const mandatory = checks.filter(check => check.mandatory).map(check => ({ id: check.id, requirementIds: check.requirementIds }));
  const required = requirements.filter(requirement => requirement.mandatory);
  return { configurationStatus, runnerAvailable: verificationConfigured(configuration, context), checks: mandatory,
    missingRequirements: required.filter(requirement => requirement.applicability !== 'not_applicable'
      && !mandatory.some(check => check.requirementIds.includes(requirement.id))).map(requirement => requirement.id),
    unresolvedRequirements: required.filter(requirement => requirement.applicability === 'unresolved').map(requirement => requirement.id) };
}
export function createVerification(configuration: Configuration) {
  return {
    async run(context: VerificationContext, signal: AbortSignal, authorize: () => Promise<void>): Promise<VerificationEvidence> {
      const url = endpoint(configuration), checks = configuredChecks(configuration.manifest, context);
      if (!checks.length || !sha(context.identity.baseSha) || !hash(context.identity.candidateDigest)) fail();
      const active = AbortSignal.any([signal, AbortSignal.timeout(1_200_000)]);
      const headers = { Authorization: `Bearer ${configuration.token}`, 'Content-Type': 'application/json' };
      async function call(suffix: string, body?: unknown) {
        return whileActive(async () => {
          const response = await (configuration.fetcher ?? fetch)(url.toString().replace(/\/$/, '') + suffix, {
            method: body === undefined ? 'GET' : 'POST', headers, redirect: 'error', signal: active,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          if (!response.ok) { await response.body?.cancel(); fail(); }
          return readJson(response, 262_144, active);
        }, active);
      }
      try {
        // Admission is checked before any repository bytes leave the app.
        const admission = await call('/admission');
        if (!object(admission) || admission.status !== 'passed' || !hash(admission.configurationDigest)
          || !hash(admission.codeDigest) || !hash(admission.environmentDigest)) fail();
        const plan = prioritizeChecks(checks.map(check => ({ ...check, impact: context.impactUnknown ? 'unknown' : check.impact, missingEvidence: true,
          signal: fileTokenSignal(check, context),
          reviewerDisagreement: check.requirementIds.some(id => context.disagreements.includes(id)) })), context.comparison);
        const ordered = [...plan.mandatory, ...plan.selected].map(row => checks.find(check => check.id === row.id)!);
        const files = context.exact?.files ?? context.files.map(file => ({ path: file.path, content: file.replacement, blobSha: blob(file.replacement) }));
        if (files.length > 24 || Buffer.byteLength(JSON.stringify(files)) > 1_048_576
          || files.reduce((size, file) => size + Buffer.byteLength(file.content), 0) > 262_144) fail(413);
        await whileActive(authorize, active);
        const result = await call('/execute', { identity: context.identity, files, checks: ordered, prId: null, ...(context.exact ? { revision: context.exact.revision } : {}) });
        if (!object(result) || canonical(result.identity) !== canonical(context.identity) || !object(result.admission)
          || canonical(result.admission) !== canonical(admission) || (context.exact ? canonical(result.revision) !== canonical(context.exact.revision) : result.revision !== undefined) || !Array.isArray(result.checks) || !Array.isArray(result.executions)
          || result.checks.length !== ordered.length || result.executions.length !== ordered.length) fail();
        const dependencyDigest = verificationDigest(files.map(({ path, blobSha }) => ({ path, blobSha })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const definitions = checks.map(check => {
          const { cases, ...definition } = check;
          return { ...definition, provenance: 'trusted_repository' as const, definitionDigest: verificationDigest(definition),
            oracleDigest: verificationDigest(cases), environmentDigest: admission.environmentDigest as string, dependencyDigest };
        });
        const executionIds = new Set<string>();
        for (const check of ordered) {
          const returned = result.checks.find(row => object(row) && row.id === check.id);
          const execution = result.executions.find(row => object(row) && row.checkId === check.id);
          const definition = definitions.find(row => row.id === check.id)!;
          if (!object(returned) || !object(execution) || !text(execution.id) || executionIds.has(execution.id)
            || execution.collector !== 'trusted_runner' || !text(execution.runnerId) || execution.prId !== null
            || !['completed', 'timed_out', 'cancelled', 'infrastructure_error'].includes(String(execution.status))
            || !['passed', 'failed', 'inconclusive'].includes(String(execution.result))
            || !Number.isSafeInteger(execution.executedTests) || Number(execution.executedTests) < 0 || Number(execution.executedTests) > check.cases.length
            || execution.exitCode !== null && (!Number.isSafeInteger(execution.exitCode) || Math.abs(Number(execution.exitCode)) > 255)
            || ['definitionDigest', 'oracleDigest', 'dependencyDigest', 'environmentDigest'].some(key =>
              returned[key] !== definition[key as keyof typeof definition] || execution[key] !== returned[key])
            || execution.result === 'passed' && (execution.status !== 'completed' || execution.executedTests !== check.cases.length || execution.exitCode !== 0)
            || execution.status !== 'completed' && execution.result !== 'inconclusive') fail();
          executionIds.add(execution.id);
        }
        return { checks: definitions.map(({ language: _language, path: _path, export: _export, ...definition }) => definition),
          dispatchPlan: plan, ...(context.exact ? { exactRevision: context.exact.revision, expectedCases: Object.fromEntries(ordered.map(check => [check.id, check.cases.length])) } : {}), executions: result.executions as TrustedExecution[], admission: admission as VerificationEvidence['admission'] };
      } catch (error) { if (error instanceof IntakeError) throw error; fail(active.aborted ? 504 : 503); }
    }
  };
}
