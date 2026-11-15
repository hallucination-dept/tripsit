import type { baselinePolicy } from './server/policy.ts';
import type { candidateView } from './server/candidate-view.ts';

export type PolicyReport = ReturnType<typeof baselinePolicy>;
export type CandidateView = ReturnType<typeof candidateView>;
export type CandidateWorkspaceState = {
  owner: string; itemId: string; baseSha: string; loading: boolean; generating: boolean;
  files: Array<{ path: string; blobSha: string }>; policy: PolicyReport | null; candidate: CandidateView | null;
  policyError: string; filesError: string; generationError: string;
};
type Options = { onChange?: (state: CandidateWorkspaceState) => void; fetcher?: typeof fetch };
const empty = (): CandidateWorkspaceState => ({ owner: '', itemId: '', baseSha: '', loading: false, generating: false,
  files: [], policy: null, candidate: null, policyError: '', filesError: '', generationError: '' });
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sha = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
class WorkspaceError extends Error {}
function validPolicy(value: unknown): value is PolicyReport {
  return object(value) && typeof value.version === 'string' && value.assessment === 'unverified'
    && Array.isArray(value.requirements) && value.requirements.length <= 256 && value.requirements.every(control => object(control)
      && ['id', 'criterion', 'reason', 'verification'].every(key => typeof control[key] === 'string')
      && ['intent', 'functional', 'non_functional'].includes(String(control.category))
      && ['trusted_baseline', 'supplied', 'inferred', 'owner_confirmed'].includes(String(control.provenance))
      && ['applicable', 'not_applicable', 'unresolved'].includes(String(control.applicability))
      && typeof control.mandatory === 'boolean' && control.evidence === 'unverified' && object(control.source)
      && ['name', 'version', 'url'].every(key => typeof (control.source as Record<string, unknown>)[key] === 'string'))
    && Array.isArray(value.gaps) && value.gaps.length <= 512
    && value.gaps.every(gap => object(gap) && typeof gap.id === 'string' && typeof gap.reason === 'string');
}
function validCandidate(value: unknown, baseSha: string): value is CandidateView {
  if (!object(value) || typeof value.id !== 'string' || !uuid(value.id) || !object(value.candidate)) return false;
  const candidate = value.candidate;
  return candidate.baseSha === baseSha && typeof candidate.expiresAt === 'string' && Date.parse(candidate.expiresAt) > Date.now()
    && typeof candidate.outputDigest === 'string' && /^[a-f0-9]{64}$/.test(candidate.outputDigest)
    && typeof candidate.model === 'string' && object(candidate.settings)
    && object(candidate.mapping) && candidate.mapping.status === 'unavailable' && typeof candidate.mapping.reason === 'string'
    && object(candidate.observations) && ['observed', 'unavailable'].includes(String(candidate.observations.status))
    && Number.isSafeInteger(candidate.observations.count) && Number(candidate.observations.count) >= 0
    && Array.isArray(candidate.files) && candidate.files.length > 0 && candidate.files.length <= 32
    && candidate.files.every(file => object(file) && typeof file.path === 'string' && typeof file.content === 'string'
      && sha(file.blobSha) && (file.originalBlob === null || sha(file.originalBlob)));
}

export function createCandidateWorkspace(options: Options = {}) {
  let state = empty();
  let version = 0;
  let selection: AbortController | undefined;
  let generation: AbortController | undefined;
  const publish = (update: Partial<CandidateWorkspaceState>) => { state = { ...state, ...update }; options.onChange?.(state); };
  function invalidate() { version++; selection?.abort(); generation?.abort(); }
  function request(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new WorkspaceError('Workspace request was cancelled or timed out.'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      const work = async () => {
        const response = await (options.fetcher ?? fetch)(path, { ...init, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
        const data: unknown = await response.json();
        if (!response.ok) throw new WorkspaceError(object(data) && typeof data.message === 'string' && data.message.length > 0 && data.message.length <= 512
          ? data.message : 'Workspace request is unavailable.');
        if (signal.aborted) throw new WorkspaceError('Workspace request was cancelled or timed out.');
        return data;
      };
      void work().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  return {
    get state() { return state; },
    async select(owner: string, itemId: string, baseSha: string): Promise<void> {
      invalidate();
      state = empty();
      if (!owner || !itemId) { publish({}); return; }
      if (!uuid(itemId) || !sha(baseSha)) { publish({ policyError: 'Select a valid frozen snapshot.', filesError: 'Select a valid frozen snapshot.' }); return; }
      selection = new AbortController();
      const active = selection;
      const current = version;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]);
      const valid = () => current === version && !active.signal.aborted && state.owner === owner && state.itemId === itemId && state.baseSha === baseSha;
      publish({ owner, itemId, baseSha, loading: true });
      await Promise.all((['policy', 'files'] as const).map(async kind => {
        try {
          const data = await request(`/api/work-items/${encodeURIComponent(itemId)}/${kind}`, signal);
          if (!valid()) return;
          if (!object(data) || data.itemId !== itemId || data.baseSha !== baseSha) throw new WorkspaceError('Snapshot response does not match the selection.');
          if (kind === 'policy') {
            if (!sha(data.snapshotDigest) || !validPolicy(data.policy)) throw new WorkspaceError('Policy response is invalid.');
            publish({ policy: data.policy });
          } else {
            if (!Array.isArray(data.files) || data.files.length > 4096 || data.files.some(file => !object(file)
              || typeof file.path !== 'string' || !file.path || file.path.length > 1024 || !sha(file.blobSha))
              || new Set(data.files.map(file => file.path)).size !== data.files.length) throw new WorkspaceError('File response is invalid.');
            publish({ files: data.files as CandidateWorkspaceState['files'] });
          }
        } catch (cause) {
          if (valid()) publish({ [kind === 'policy' ? 'policyError' : 'filesError']: cause instanceof WorkspaceError ? cause.message : `${kind === 'policy' ? 'Policy' : 'Files'} are unavailable.` });
        }
      }));
      if (valid()) publish({ loading: false });
    },
    async generate(paths: string[]): Promise<void> {
      if (state.generating) return;
      if (!state.owner || !state.itemId || !Array.isArray(paths) || paths.length < 1 || paths.length > 8
        || new Set(paths).size !== paths.length || paths.some(path => !state.files.some(file => file.path === path))) {
        publish({ generationError: 'Select one to eight available files.' }); return;
      }
      const current = version;
      const { owner, itemId, baseSha } = state;
      generation = new AbortController();
      const active = generation;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(90_000)]);
      const valid = () => current === version && !active.signal.aborted && state.owner === owner && state.itemId === itemId && state.baseSha === baseSha;
      publish({ generating: true, generationError: '', candidate: null });
      try {
        const data = await request(`/api/work-items/${encodeURIComponent(itemId)}/candidates`, signal,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [...paths] }) });
        if (!valid()) return;
        if (!validCandidate(data, baseSha)) throw new WorkspaceError('Candidate response does not match the selection.');
        publish({ candidate: data });
      } catch (cause) {
        if (valid()) publish({ generationError: cause instanceof WorkspaceError ? cause.message : 'Candidate generation is unavailable.' });
      } finally { if (valid()) publish({ generating: false }); }
    },
    stop() { invalidate(); state = empty(); publish({}); }
  };
}
