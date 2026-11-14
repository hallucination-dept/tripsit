export type DiscoveredRepository = { id: number; fullName: string; private: boolean };
export type DiscoveredIssue = { id: number; number: number; title: string; updatedAt: string };
export type DiscoveryState = {
  owner: string; repositories: DiscoveredRepository[]; issues: DiscoveredIssue[];
  repository: string; issueNumber: number; loading: boolean; error: string;
  repositoriesComplete: boolean; issuesComplete: boolean;
};
type Options = {
  fetcher?: typeof fetch;
  onChange?: (state: DiscoveryState) => void;
  schedule?: (run: () => void, delay: number) => () => void;
};
const empty = (): DiscoveryState => ({ owner: '', repositories: [], issues: [], repository: '', issueNumber: 0,
  loading: false, error: '', repositoriesComplete: true, issuesComplete: true });

export function createIssueDiscovery(options: Options = {}) {
  let state = empty();
  let generation = 0;
  let busy = false;
  let active: AbortController | undefined;
  let cancelTimer: (() => void) | undefined;
  const schedule = options.schedule ?? ((run, delay) => { const timer = setTimeout(run, delay); return () => clearTimeout(timer); });
  const publish = (update: Partial<DiscoveryState>) => { state = { ...state, ...update }; options.onChange?.(state); };
  function invalidate() { generation++; active?.abort(); cancelTimer?.(); cancelTimer = undefined; busy = false; }
  async function request(path: string, signal: AbortSignal) {
    const response = await (options.fetcher ?? fetch)(path, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'GitHub discovery is unavailable.');
    if (!data || typeof data !== 'object' || typeof data.complete !== 'boolean') throw new Error('GitHub discovery returned an invalid response.');
    return data;
  }
  async function load(refreshRepositories: boolean) {
    if (!state.owner || busy) return;
    busy = true;
    cancelTimer?.(); cancelTimer = undefined;
    const current = generation;
    active = new AbortController();
    const signal = AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]);
    const valid = () => current === generation && !signal.aborted;
    publish({ loading: true, error: '' });
    let stage: 'repositories' | 'issues' = refreshRepositories ? 'repositories' : 'issues';
    try {
      if (refreshRepositories) {
        const data = await request('/api/github/repositories', signal);
        if (!valid()) return;
        if (!Array.isArray(data.repositories) || data.repositories.some((row: DiscoveredRepository) => !row || !Number.isSafeInteger(row.id) || typeof row.fullName !== 'string' || typeof row.private !== 'boolean')) throw new Error('GitHub returned an invalid repository list.');
        const repositories: DiscoveredRepository[] = data.repositories;
        const repository = repositories.find(row => row.fullName === state.repository)?.fullName ?? repositories[0]?.fullName ?? '';
        publish({ repositories, repository, repositoriesComplete: data.complete,
          ...(repository !== state.repository ? { issues: [], issueNumber: 0 } : {}) });
      }
      stage = 'issues';
      if (state.repository) {
        const data = await request(`/api/github/issues?repository=${encodeURIComponent(state.repository)}`, signal);
        if (!valid()) return;
        if (!Array.isArray(data.issues) || data.issues.some((row: DiscoveredIssue) => !row || !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.number) || row.number < 1 || typeof row.title !== 'string' || typeof row.updatedAt !== 'string')) throw new Error('GitHub returned an invalid issue list.');
        const issues: DiscoveredIssue[] = data.issues;
        publish({ issues, issueNumber: issues.find(row => row.number === state.issueNumber)?.number ?? issues[0]?.number ?? 0, issuesComplete: data.complete });
      } else publish({ issues: [], issueNumber: 0, issuesComplete: true });
    } catch (cause) {
      if (current !== generation) return;
      publish({ error: cause instanceof Error ? cause.message : 'GitHub discovery is unavailable.', issues: [], issueNumber: 0,
        ...(stage === 'repositories' ? { repositories: [], repository: '' } : {}) });
    } finally {
      if (current === generation) {
        busy = false;
        publish({ loading: false });
        cancelTimer = schedule(() => load(true), 60_000);
      }
    }
  }
  return {
    get state() { return state; },
    start(owner: string) { invalidate(); state = empty(); publish({ owner }); return load(true); },
    stop() { invalidate(); state = empty(); publish({}); },
    refresh: () => load(true),
    selectRepository(repository: string) {
      if (repository === state.repository) return Promise.resolve();
      invalidate();
      publish({ repository: state.repositories.some(row => row.fullName === repository) ? repository : '', issues: [], issueNumber: 0, loading: false, error: '' });
      return load(false);
    },
    selectIssue(number: number) { publish({ issueNumber: state.issues.some(row => row.number === number) ? number : 0 }); }
  };
}
