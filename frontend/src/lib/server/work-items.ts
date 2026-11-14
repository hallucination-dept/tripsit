import { IntakeError, parseIntake } from './intake.ts';
import type { IssueSnapshot } from './intake.ts';
import type { WorkItem } from './records.ts';

type Dependencies = {
  store: { create(owner: string, snapshot: IssueSnapshot): Promise<WorkItem>; get(owner: string, id: string): Promise<WorkItem | null>; list(owner: string): Promise<WorkItem[]> };
  github: { snapshot(repository: string, issue: number, signal: AbortSignal): Promise<IssueSnapshot>; authorize(repository: string, id: number, signal: AbortSignal): Promise<void> };
};
function signedIn(owner: string) { if (!owner) throw new IntakeError(401, 'Sign in before selecting a GitHub issue.'); }
export function createIntake({ store, github }: Dependencies, clock = () => Date.now()) {
  function retained(item: WorkItem) {
    const expires = Date.parse(item.expiresAt);
    return Number.isFinite(expires) && expires > clock();
  }
  async function permitted(item: WorkItem, signal: AbortSignal, checked = new Set<string>()) {
    signal.throwIfAborted();
    if (item.snapshot.private) throw new IntakeError(503, 'Private issue storage awaits verified isolation and retention controls.');
    const key = JSON.stringify([item.snapshot.repository, item.snapshot.repositoryId]);
    if (!checked.has(key)) {
      await github.authorize(item.snapshot.repository, item.snapshot.repositoryId, signal);
      checked.add(key);
    }
    signal.throwIfAborted();
    if (!retained(item)) throw new IntakeError(404, 'Issue snapshot is unavailable or expired.');
    return item;
  }
  return {
    async create(owner: string, input: unknown, signal: AbortSignal): Promise<WorkItem> {
      signedIn(owner);
      const selected = parseIntake(input);
      const snapshot = await github.snapshot(selected.repository, selected.issueNumber, signal);
      if (snapshot.private) throw new IntakeError(503, 'Private issue storage awaits verified isolation and retention controls.');
      signal.throwIfAborted();
      return store.create(owner, snapshot);
    },
    async get(owner: string, id: string, signal: AbortSignal): Promise<WorkItem> {
      signedIn(owner);
      const item = await store.get(owner, id);
      signal.throwIfAborted();
      if (!item) throw new IntakeError(404, 'Issue snapshot is unavailable or expired.');
      return permitted(item, signal);
    },
    async list(owner: string, signal: AbortSignal): Promise<WorkItem[]> {
      signedIn(owner);
      const items = await store.list(owner);
      signal.throwIfAborted();
      const authorized: WorkItem[] = [];
      const checked = new Set<string>();
      for (const item of items) {
        try { authorized.push(await permitted(item, signal, checked)); }
        catch (cause) { if (!(cause instanceof IntakeError) || ![403,404].includes(cause.status)) throw cause; }
      }
      signal.throwIfAborted();
      return authorized.filter(retained);
    }
  };
}
