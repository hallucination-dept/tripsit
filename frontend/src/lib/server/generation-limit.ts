import { IntakeError } from './intake.ts';

// shortcut: limits are per process; use shared counters before running multiple server instances.
export function createGenerationLimit(clock = () => Date.now()) {
  const owners = new Map<string, { started: number; count: number; active: boolean }>();
  return {
    async run<T>(owner: string, action: () => Promise<T>): Promise<T> {
      const now = clock();
      for (const [key, value] of owners) {
        if (!value.active && now - value.started >= 15 * 60_000) owners.delete(key);
      }
      let entry = owners.get(owner);
      if (entry?.active || (entry && entry.count >= 3)) throw new IntakeError(429, 'Generation is limited to one active request and three requests per 15 minutes.');
      if (!entry) {
        if (owners.size >= 1000) throw new IntakeError(503, 'Generation is at capacity. Try again later.');
        entry = { started: now, count: 0, active: false };
        owners.set(owner, entry);
      }
      entry.count++; entry.active = true;
      try { return await action(); }
      finally { entry.active = false; }
    }
  };
}
