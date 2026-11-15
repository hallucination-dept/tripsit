import { posix } from 'node:path';
import type { ChangeGraph } from './change-graph.ts';
import { byAttention, flagConfidences, flagKinds, flagLabels, type AgentFlag, type FlagConfidence, type FlagInput, type FlagKind } from '../flag-levels.ts';

// Review flags the agent attaches to its own edits. See specs/tech-architecture/AGENT_FLAGS_LATEST.md.
// Types and attention levels live in flag-levels.ts so the browser can use them too.
export { attention, flagConfidences, flagKinds, flagLabels } from '../flag-levels.ts';
export type { AgentFlag, FlagInput } from '../flag-levels.ts';

export const maxFlags = 25;

export class FlagInputError extends Error {}

const line = (value: unknown, name: string, limit: number, required: boolean) => {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim() && !required)) return null;
  if (typeof value !== 'string' || !value.trim()) throw new FlagInputError(`${name} must be a non-empty string.`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length > limit) throw new FlagInputError(`${name} must be at most ${limit} characters.`);
  return text;
};

// Validates a flag tool call. Paths are repository-relative and may not leave the repository.
export function parseFlag(value: unknown): FlagInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FlagInputError('The flag must be an object.');
  const input = value as Record<string, unknown>;
  const raw = line(input.path, 'path', 500, true)!;
  const path = posix.normalize(raw.replace(/^\.\/+/, ''));
  if (path.startsWith('/') || path === '.' || path === '..' || path.startsWith('../')) throw new FlagInputError('path must be a file path inside the repository.');
  if (!flagKinds.includes(input.kind as FlagKind)) throw new FlagInputError(`kind must be one of ${flagKinds.join(', ')}.`);
  if (!flagConfidences.includes(input.confidence as FlagConfidence)) throw new FlagInputError(`confidence must be one of ${flagConfidences.join(', ')}.`);
  return {
    path, symbol: line(input.symbol, 'symbol', 200, false), kind: input.kind as FlagKind, confidence: input.confidence as FlagConfidence,
    reason: line(input.reason, 'reason', 600, true)!, alternatives: line(input.alternatives, 'alternatives', 400, false)
  };
}

// Each flag points at the named symbol in its file (`name` or `Class.method`), else the file, else nothing.
export function attachFlags(flags: FlagInput[], graph: ChangeGraph): AgentFlag[] {
  return flags.map((flag, index) => {
    const inFile = graph.nodes.filter(node => node.kind === 'symbol' && node.path === flag.path);
    const symbol = flag.symbol?.replace(/\(.*$/, '').trim();
    const exact = symbol ? inFile.filter(node => node.label === symbol) : [];
    const member = symbol && !exact.length ? inFile.filter(node => node.label.endsWith(`.${symbol}`)) : [];
    const hit = exact.length === 1 ? exact[0] : member.length === 1 ? member[0] : null;
    const file = graph.nodes.find(node => node.kind === 'file' && node.path === flag.path);
    return { ...flag, id: `flag-${index + 1}`, nodeId: hit?.id ?? file?.id ?? null };
  });
}

const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;
const code = (value: string) => `\`${value.replaceAll('`', "'")}\``;

// Markdown list for the pull request body, most important first.
export function flagsMarkdown(flags: FlagInput[]) {
  if (!flags.length) return '';
  const rows = byAttention(flags).map(flag => {
    const where = flag.symbol ? `${code(flag.path)} › ${code(flag.symbol)}` : code(flag.path);
    const alternatives = flag.alternatives ? ` _Alternatives:_ ${flag.alternatives}` : '';
    return `- **${flagLabels[flag.kind]}** (${flag.confidence} confidence) · ${where}: ${flag.reason}${alternatives}`;
  });
  return clip(['**Review flags**', '', 'The agent marked these spots for a closer look:', '', ...rows].join('\n'), 12_000);
}
