import type { ImpactGraph, ImpactNode } from './server/impact.ts';
export type GraphFilter = { revision?: 'base' | 'candidate' | 'all'; affectedOnly?: boolean; query?: string; selectedId?: string | null };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Layout only: all relationships and traversal distances come from the supplied assessment. */
export function projectImpactGraph(graph: ImpactGraph, affected: Array<{ node: ImpactNode; distance: number }>, filter: GraphFilter = {}) {
  const distances = new Map(affected.map(row => [row.node.id, row.distance]));
  for (const id of graph.changed) distances.set(id, 0);
  const neighbors = new Set(graph.edges.filter(edge => edge.from === filter.selectedId || edge.to === filter.selectedId).flatMap(edge => [edge.from, edge.to]));
  const priority = (id: string) => id === filter.selectedId ? 0 : neighbors.has(id) ? 1 : 2;
  const lane = (id: string) => distances.get(id) === 0 ? 0 : distances.get(id) === 1 ? 1 : distances.has(id) ? 2 : 3;
  const query = (filter.query ?? '').trim().toLowerCase();
  const matching = graph.nodes.filter(node => (!filter.revision || filter.revision === 'all' || node.source?.revision === filter.revision)
    && (!filter.affectedOnly || distances.has(node.id))
    && (!query || `${node.source?.path ?? ''} ${node.kind} ${node.source?.start ?? ''} ${node.id}`.toLowerCase().includes(query)))
    .sort((a, b) => priority(a.id) - priority(b.id) || lane(a.id) - lane(b.id) || (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity)
      || compare(a.source?.path ?? a.id, b.source?.path ?? b.id) || (a.source?.start ?? 0) - (b.source?.start ?? 0) || compare(a.id, b.id));
  const visible = matching.slice(0, 60);
  const occupied = [...new Set(visible.map(node => lane(node.id)))].sort((a, b) => a - b);
  const rows = new Map<number, number>();
  const nodes = visible.map(node => {
    const column = lane(node.id), row = rows.get(column) ?? 0; rows.set(column, row + 1);
    return { node, x: 24 + occupied.indexOf(column) * 220, y: 42 + row * 88,
      distance: distances.get(node.id) ?? null, status: column === 0 ? 'changed' as const : column === 3 ? 'context' as const : 'downstream' as const };
  });
  const positions = new Map(nodes.map(node => [node.node.id, node]));
  const edges = graph.edges.filter(edge => positions.has(edge.from) && edge.to !== null && positions.has(edge.to))
    .sort((a, b) => Number(!(a.from === filter.selectedId || a.to === filter.selectedId)) - Number(!(b.from === filter.selectedId || b.to === filter.selectedId)) || compare(a.id, b.id))
    .slice(0, 120).map(edge => {
      const from = positions.get(edge.from)!, to = positions.get(edge.to!)!;
      const sy = from.y + 32, ty = to.y + 32;
      let path: string;
      if (from.x === to.x) {
        const x = from.x + 188;
        path = from.node.id === to.node.id ? `M ${x} ${sy - 16} C ${x + 48} ${sy - 40}, ${x + 48} ${sy + 40}, ${x} ${sy + 16}`
          : `M ${x} ${sy} C ${x + 48} ${sy}, ${x + 48} ${ty}, ${x} ${ty}`;
      } else {
        const sx = from.x < to.x ? from.x + 188 : from.x, tx = from.x < to.x ? to.x : to.x + 188, middle = (sx + tx) / 2;
        path = `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${tx} ${ty}`;
      }
      return { edge, path };
    });
  const labels = ['Changed', 'Direct dependents', 'Further downstream', 'Other context'];
  return { nodes, edges, columns: occupied.map((value, index) => ({ label: labels[value], x: 24 + index * 220 })),
    width: Math.max(480, occupied.length * 220 + 48), height: Math.max(180, Math.max(0, ...rows.values()) * 88 + 50),
    totalNodes: graph.nodes.length, matchingNodes: matching.length, hiddenNodes: graph.nodes.length - matching.length, omittedNodes: matching.length - nodes.length,
    totalEdges: graph.edges.length, omittedEdges: graph.edges.length - edges.length, unresolvedEdges: graph.edges.filter(edge => edge.to === null || edge.resolution === 'unresolved').length };
}

/** Literal source mentions are navigation hints, never a semantic verdict about a node. */
export function mentionsNode(text: string, node: ImpactNode): boolean {
  return [node.id, node.source?.path].some(reference => {
    if (!reference) return false;
    let offset = text.indexOf(reference);
    while (offset >= 0) {
      if (!/[\p{L}\p{N}_./\\-]$/u.test(text.slice(Math.max(0, offset - 2), offset))
        && !/^[\p{L}\p{N}_./\\-]/u.test(text.slice(offset + reference.length, offset + reference.length + 2))) return true;
      offset = text.indexOf(reference, offset + 1);
    }
    return false;
  });
}
