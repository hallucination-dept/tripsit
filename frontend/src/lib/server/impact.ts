export type ImpactSource = { revision: 'base' | 'candidate'; path: string; blobSha: string; start: number; end: number; byteLength: number };
export type ImpactNode = {
  id: string;
  kind: 'file' | 'symbol' | 'check' | 'resource' | 'configuration';
  source?: ImpactSource;
  checkId?: string;
  extraction: string;
  language?: string;
};
export type ImpactEdge = { id: string; from: string; to: string | null; relationship: string; resolution: 'observed' | 'inferred' | 'unresolved'; provenance: string };
export type ImpactGraph = { revision: { baseSha: string; headSha: string }; nodes: ImpactNode[]; edges: ImpactEdge[]; changed: string[]; unsupportedLanguages?: string[] };
export type ImpactLimits = { maxNodes: number; maxEdges: number; maxDepth: number };
export type ImpactGap = { kind: 'graph_completeness_unverified' | 'file_fallback' | 'unsupported_language' | 'inferred_relationship' | 'unresolved_relationship' | 'missing_node' | 'missing_changed_node' | 'depth_limit'; reference: string };

const encoder = new TextEncoder();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function invalid(): never { throw new Error('Invalid impact graph'); }
function text(value: unknown, max = 128): value is string {
  return typeof value === 'string' && value.length > 0 && encoder.encode(value).byteLength <= max
    && new TextDecoder('utf-8', { ignoreBOM: true }).decode(encoder.encode(value)) === value;
}
const digest = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);

/** Edges point from dependent to dependency; input provenance comes from a separate extractor. */
export function analyzeImpact(input: ImpactGraph, limits: ImpactLimits = { maxNodes: 2000, maxEdges: 8000, maxDepth: 32 }) {
  if (!input || !input.revision || !digest(input.revision.baseSha) || !digest(input.revision.headSha)
    || !limits || !Number.isInteger(limits.maxNodes) || limits.maxNodes < 1 || limits.maxNodes > 2000
    || !Number.isInteger(limits.maxEdges) || limits.maxEdges < 1 || limits.maxEdges > 8000
    || !Number.isInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 64
    || !Array.isArray(input.nodes) || input.nodes.length > limits.maxNodes
    || !Array.isArray(input.edges) || input.edges.length > limits.maxEdges
    || !Array.isArray(input.changed) || input.changed.length === 0 || input.changed.length > limits.maxNodes
    || Array.from(input.changed).some(id => !text(id))) invalid();
  const nodes = new Map<string, ImpactNode>();
  const sources = new Map<string, { blobSha: string; byteLength: number }>();
  const blobLengths = new Map<string, number>();
  for (const node of input.nodes) {
    if (!node || !text(node.id) || nodes.has(node.id) || !text(node.extraction, 256)
      || !['file', 'symbol', 'check', 'resource', 'configuration'].includes(node.kind)
      || node.language !== undefined && !text(node.language, 64)
      || node.checkId !== undefined && !text(node.checkId)
      || !node.source && !(node.kind === 'check' && text(node.checkId))) invalid();
    let source: ImpactSource | undefined;
    if (node.source) {
      const value = node.source;
      if (!['base', 'candidate'].includes(value.revision) || !text(value.path, 1024)
        || /[\\\u0000-\u001f\u007f]/u.test(value.path)
        || value.path.split('/').some(part => !part || part === '.' || part === '..') || !digest(value.blobSha)
        || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || !Number.isSafeInteger(value.byteLength)
        || value.start < 0 || value.end < value.start || value.end > value.byteLength || value.byteLength > 10_485_760) invalid();
      const identity = `${value.revision}:${value.path}`;
      const existing = sources.get(identity);
      const blobLength = blobLengths.get(value.blobSha);
      if (existing && (existing.blobSha !== value.blobSha || existing.byteLength !== value.byteLength)
        || blobLength !== undefined && blobLength !== value.byteLength) invalid();
      sources.set(identity, { blobSha: value.blobSha, byteLength: value.byteLength });
      blobLengths.set(value.blobSha, value.byteLength);
      source = { revision: value.revision, path: value.path, blobSha: value.blobSha, start: value.start, end: value.end, byteLength: value.byteLength };
    }
    nodes.set(node.id, { id: node.id, kind: node.kind, extraction: node.extraction, ...(source ? { source } : {}), ...(node.checkId ? { checkId: node.checkId } : {}), ...(node.language ? { language: node.language } : {}) });
  }
  const gaps = new Map<string, ImpactGap>();
  function gap(kind: ImpactGap['kind'], reference: string) { gaps.set(`${kind}:${reference}`, { kind, reference }); }
  gap('graph_completeness_unverified', 'supplied_graph');
  for (const node of nodes.values()) if (node.kind === 'file') gap('file_fallback', node.id);
  if (input.unsupportedLanguages !== undefined && (!Array.isArray(input.unsupportedLanguages)
    || input.unsupportedLanguages.length > 64 || Array.from(input.unsupportedLanguages).some(language => !text(language, 64)))) invalid();
  const unsupportedLanguages = [...new Set(input.unsupportedLanguages ?? [])].sort(compare);
  for (const language of unsupportedLanguages) gap('unsupported_language', language);
  const reverse = new Map<string, ImpactEdge[]>();
  const edgeIds = new Set<string>();
  for (const edge of input.edges) {
    if (!edge || !text(edge.id) || edgeIds.has(edge.id) || !text(edge.from) || edge.to !== null && !text(edge.to)
      || !text(edge.relationship) || !text(edge.provenance, 256) || !['observed', 'inferred', 'unresolved'].includes(edge.resolution)) invalid();
    edgeIds.add(edge.id);
    if (edge.resolution === 'inferred') gap('inferred_relationship', edge.id);
    if (edge.resolution === 'unresolved' || edge.to === null) gap('unresolved_relationship', edge.id);
    if (!nodes.has(edge.from) || edge.to !== null && !nodes.has(edge.to)) gap('missing_node', edge.id);
    if (edge.to === null || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const clean = { id: edge.id, from: edge.from, to: edge.to, relationship: edge.relationship, resolution: edge.resolution, provenance: edge.provenance };
    const incoming = reverse.get(edge.to) ?? [];
    incoming.push(clean); reverse.set(edge.to, incoming);
  }
  for (const incoming of reverse.values()) incoming.sort((a, b) => compare(a.from, b.from) || compare(a.id, b.id));
  const affected = new Map<string, { node: ImpactNode; distance: number; viaEdge: string | null; dependency: string | null }>();
  const queue: string[] = [];
  for (const id of [...new Set(input.changed)].sort(compare)) {
    const node = nodes.get(id);
    if (!node) { gap('missing_changed_node', id); continue; }
    affected.set(id, { node, distance: 0, viaEdge: null, dependency: null }); queue.push(id);
  }
  const traversed = new Map<string, ImpactEdge>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const dependency = queue[cursor];
    const distance = affected.get(dependency)!.distance;
    for (const edge of reverse.get(dependency) ?? []) {
      if (!affected.has(edge.from) && distance >= limits.maxDepth) { gap('depth_limit', edge.id); continue; }
      traversed.set(edge.id, edge);
      if (affected.has(edge.from)) continue;
      affected.set(edge.from, { node: nodes.get(edge.from)!, distance: distance + 1, viaEdge: edge.id, dependency });
      queue.push(edge.from);
    }
  }
  return {
    revision: { baseSha: input.revision.baseSha, headSha: input.revision.headSha },
    affected: [...affected.values()].sort((a, b) => a.distance - b.distance || compare(a.node.id, b.node.id)),
    edges: [...traversed.values()].sort((a, b) => compare(a.id, b.id)),
    gaps: [...gaps.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.reference, b.reference)),
    requiresInspection: true as const,
    coverage: { extraction: 'not_run' as const, semanticResolution: 'not_verified' as const, executableChecks: 'not_run' as const, suppliedNodes: nodes.size, suppliedEdges: edgeIds.size, unsupportedLanguages }
  };
}
