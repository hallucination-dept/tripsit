export class IntakeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function parseIntake(value: unknown): { repository: string; issueNumber: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError(400, 'Select a repository and issue number.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['repository', 'issueNumber'].includes(key)) ||
    typeof input.repository !== 'string' || input.repository.length > 201 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(input.repository) ||
    ['.', '..'].includes(input.repository.split('/')[1]) ||
    !Number.isSafeInteger(input.issueNumber) || Number(input.issueNumber) < 1) {
    throw new IntakeError(400, 'Select a valid owner/repository and positive issue number.');
  }
  return { repository: input.repository, issueNumber: Number(input.issueNumber) };
}

export async function readJson(response: Response | Request, limit: number, signal?: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new IntakeError(400, 'Expected JSON content.');
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal?.aborted) throw new IntakeError(502, 'Request cancelled or timed out.');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new IntakeError(413, 'Content exceeds the intake limit.');
      chunks.push(value);
    }
    if (signal?.aborted) throw new IntakeError(502, 'Request cancelled or timed out.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new IntakeError(400, 'Expected valid UTF-8 JSON content.'); }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}

export type IssueSnapshot = {
  repositoryId: number;
  repository: string;
  private: boolean;
  issueNumber: number;
  issueId: number;
  baseSha: string;
  supplied: { title: string; body: string; provenance: 'supplied' };
  inferred: string[];
  ownerConfirmed: string[];
};
