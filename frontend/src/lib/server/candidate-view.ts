import type { StoredCandidate } from './generation.ts';

export function candidateView({ id, candidate }: StoredCandidate) {
  return { id, candidate: {
    baseSha: candidate.baseSha,
    expiresAt: candidate.expiresAt,
    outputDigest: candidate.outputDigest,
    model: candidate.model,
    settings: candidate.settings,
    mapping: candidate.mapping,
    files: candidate.files.map(file => ({ path: file.path, originalBlob: file.originalBlob,
      blobSha: file.blobSha, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.content) })),
    observations: { status: candidate.observations?.status ?? 'unavailable', count: candidate.observations?.tokens.length ?? 0 }
  } };
}
