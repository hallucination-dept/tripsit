import type { ElkNode } from 'elkjs/lib/elk-api';
import type { Edge, Node, NodeHandle } from '@xyflow/svelte';
import type { ChangeGraph, GraphNode } from '#lib/server/change-graph.ts';

// Card geometry. GraphCard.svelte renders with the same numbers so the layout and the DOM agree.
export const geometry = { fileWidth: 280, folderWidth: 220, head: 50, row: 24, listPadding: 4 };

// A top-level outline item of a file; classes hold their methods as children.
export type SymbolEntry = { node: GraphNode; children: GraphNode[]; primary: boolean };
export type Card = { id: string; node: GraphNode; breadcrumb: string; entries: SymbolEntry[]; extras: number };
export type CardRow =
	| { type: 'symbol'; id: string; node: GraphNode; depth: number; toggle: string | null; open: boolean }
	| { type: 'more'; id: string; count: number; open: boolean };
export type CardModel = {
	graph: ChangeGraph; cards: Map<string, Card>;
	owner: Map<string, string>; // symbol id → card id
	host: Map<string, string>; // method id → class id
	defaults: Set<string>; // ids open on first render
};
export type CardData = { card: Card; rows: CardRow[]; open: boolean };
export type CardFlowNode = Node<CardData, 'card'>;
export type CardEdgeData = { changed: boolean; count: number; members: string[] };
// Shared with the card components through Svelte context.
export type GraphUi = { readonly selected: string | null; select: (id: string) => void; toggle: (id: string) => void };
type Anchor = { card: string; handle: string };
type Box = { x: number; y: number; width: number; height: number };

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const colors = { changed: '#fb923c', plain: '#6b6b6b' };

// Files become cards holding their symbol outline; untouched folders and the "other files" buckets become small cards.
// Folders that contain focus files are not drawn; each file card names its folder instead.
export function buildCardModel(graph: ChangeGraph): CardModel {
	const cards = new Map<string, Card>(), owner = new Map<string, string>(), host = new Map<string, string>(), defaults = new Set<string>();
	for (const node of graph.nodes) {
		if (node.kind === 'symbol' || (node.kind === 'directory' && node.group)) continue;
		const breadcrumb = node.kind === 'others' ? node.path || '/' : dirOf(node.path) || '/';
		cards.set(node.id, { id: node.id, node, breadcrumb, entries: [], extras: 0 });
	}
	for (const card of cards.values()) {
		const symbols = graph.nodes.filter(node => node.kind === 'symbol' && node.parent === card.id);
		const classes = new Map<string, SymbolEntry>();
		for (const symbol of symbols) {
			owner.set(symbol.id, card.id);
			const dot = symbol.symbolKind === 'method' ? symbol.label.indexOf('.') : -1;
			const owningClass = dot > 0 ? classes.get(symbol.label.slice(0, dot)) : undefined;
			if (owningClass) { owningClass.children.push(symbol); host.set(symbol.id, owningClass.node.id); continue; }
			const entry: SymbolEntry = { node: symbol, children: [], primary: false };
			card.entries.push(entry);
			if (symbol.symbolKind === 'class') classes.set(symbol.label, entry);
		}
		for (const entry of card.entries) {
			entry.primary = entry.node.focus || entry.children.some(child => child.focus);
			if (entry.children.some(child => child.focus)) defaults.add(entry.node.id);
		}
		card.extras = card.entries.filter(entry => !entry.primary).length;
		if (card.entries.length) defaults.add(card.id);
	}
	return { graph, cards, owner, host, defaults };
}

// Rows a card shows for the current open state: edited symbols and their neighbours, then "N more" for the rest.
export function visibleRows(card: Card, open: Set<string>): CardRow[] {
	if (!card.entries.length || !open.has(card.id)) return [];
	const everything = open.has(`more:${card.id}`);
	const rows: CardRow[] = [];
	for (const entry of card.entries) {
		if (!entry.primary && !everything) continue;
		const expandable = entry.children.length > 0, expanded = expandable && open.has(entry.node.id);
		rows.push({ type: 'symbol', id: entry.node.id, node: entry.node, depth: 0, toggle: expandable ? entry.node.id : null, open: expanded });
		if (expanded) for (const child of entry.children) rows.push({ type: 'symbol', id: child.id, node: child, depth: 1, toggle: null, open: false });
	}
	if (card.extras) rows.push({ type: 'more', id: `more:${card.id}`, count: card.extras, open: everything });
	return rows;
}

export function cardSize(card: Card, rows: CardRow[]) {
	const width = card.node.kind === 'file' ? geometry.fileWidth : geometry.folderWidth;
	return { width, height: 2 + geometry.head + (rows.length ? 1 + geometry.listPadding * 2 + rows.length * geometry.row : 0) };
}

// An edge end attaches to its symbol's row when visible, else to the class row that folds it, else to the card header.
function anchorFor(model: CardModel, id: string, visible: Map<string, Set<string>>): Anchor | null {
	if (model.cards.has(id)) return { card: id, handle: 'head' };
	const card = model.owner.get(id);
	if (!card) return null;
	const rows = visible.get(card);
	if (rows?.has(id)) return { card, handle: id };
	const owningClass = model.host.get(id);
	return { card, handle: owningClass && rows?.has(owningClass) ? owningClass : 'head' };
}

// Edges between cards, merged per anchor pair. References inside one file are left to the details panel.
export function cardLinks(model: CardModel, open: Set<string>) {
	const visible = new Map([...model.cards.values()].map(card =>
		[card.id, new Set(visibleRows(card, open).flatMap(row => row.type === 'symbol' ? [row.id] : []))]));
	const merged = new Map<string, { source: Anchor; target: Anchor; count: number; changed: boolean; members: Set<string> }>();
	for (const edge of model.graph.edges) {
		const source = anchorFor(model, edge.source, visible), target = anchorFor(model, edge.target, visible);
		if (!source || !target || source.card === target.card) continue;
		const key = `${source.card}:${source.handle}->${target.card}:${target.handle}`;
		const link = merged.get(key) ?? { source, target, count: 0, changed: false, members: new Set<string>() };
		link.count += edge.count;
		link.changed ||= edge.changed;
		for (const id of [edge.source, edge.target, source.card, target.card, source.handle, target.handle]) if (id !== 'head') link.members.add(id);
		merged.set(key, link);
	}
	return [...merged.entries()].map(([id, link]) => ({ id, ...link }));
}

// `focus` is true or false while something is selected (its own edges stand out) and null otherwise.
export function edgeStyle(changed: boolean, count: number, focus: boolean | null) {
	const width = Math.min(changed ? 4 : 3, (changed ? 1.8 : 1) + Math.log2(count) * 0.6) + (focus ? 1 : 0);
	const opacity = focus === false ? 0.12 : changed || focus ? 1 : 0.55;
	return `stroke:${changed ? colors.changed : colors.plain};stroke-width:${width}px;opacity:${opacity};`;
}

// Edges leave and enter rows from the side facing the other card; between stacked cards they loop on the right.
function sides(from: Box, to: Box): ['l' | 'r', 'l' | 'r'] {
	if (to.x >= from.x + from.width) return ['r', 'l'];
	if (to.x + to.width <= from.x) return ['l', 'r'];
	return ['r', 'r'];
}

// Handle anchors come from the fixed card geometry rather than DOM measurement: Svelte Flow forgets measured
// handles whenever the node objects are replaced, which happens on every re-layout.
const left = 'left' as NodeHandle['position'], right = 'right' as NodeHandle['position'];
export function cardHandles(rows: CardRow[], width: number): NodeHandle[] {
	const anchors = [{ key: 'head', y: 1 + geometry.head / 2 }];
	rows.forEach((row, index) => {
		if (row.type === 'symbol') anchors.push({ key: row.id, y: 2 + geometry.head + geometry.listPadding + index * geometry.row + geometry.row / 2 });
	});
	return anchors.flatMap(({ key, y }): NodeHandle[] => [
		{ id: `in-l:${key}`, type: 'target', position: left, x: 0, y: y - 0.5, width: 1, height: 1 },
		{ id: `out-l:${key}`, type: 'source', position: left, x: 0, y: y - 0.5, width: 1, height: 1 },
		{ id: `in-r:${key}`, type: 'target', position: right, x: width - 1, y: y - 0.5, width: 1, height: 1 },
		{ id: `out-r:${key}`, type: 'source', position: right, x: width - 1, y: y - 0.5, width: 1, height: 1 }
	]);
}

// Vertical layered layout: code that uses something sits above what it uses.
export async function layoutCards(model: CardModel, open: Set<string>): Promise<{ nodes: CardFlowNode[]; edges: Edge[] }> {
	const cards = [...model.cards.values()];
	const rows = new Map(cards.map(card => [card.id, visibleRows(card, open)]));
	const sizes = new Map(cards.map(card => [card.id, cardSize(card, rows.get(card.id)!)]));
	const links = cardLinks(model, open);
	const pairs = new Map<string, { id: string; sources: string[]; targets: string[] }>();
	for (const link of links) {
		const id = `${link.source.card}->${link.target.card}`;
		if (!pairs.has(id)) pairs.set(id, { id, sources: [link.source.card], targets: [link.target.card] });
	}
	// ELK is large (~1.5 MB); load it only when a graph is shown.
	const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
	const layout: ElkNode = await new ELK().layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered', 'elk.direction': 'DOWN',
			'elk.layered.spacing.nodeNodeBetweenLayers': '56', 'elk.spacing.nodeNode': '32', 'elk.spacing.componentComponent': '48'
		},
		children: cards.map(card => ({ id: card.id, ...sizes.get(card.id)! })),
		edges: [...pairs.values()]
	});
	const boxes = new Map<string, Box>();
	for (const child of layout.children ?? []) {
		const size = sizes.get(child.id)!;
		boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, ...size });
	}
	const nodes = cards.map((card): CardFlowNode => {
		const box = boxes.get(card.id)!;
		return {
			id: card.id, type: 'card', position: { x: box.x, y: box.y }, width: box.width, height: box.height,
			style: `width:${box.width}px;height:${box.height}px;`, connectable: false,
			handles: cardHandles(rows.get(card.id)!, box.width),
			data: { card, rows: rows.get(card.id)!, open: open.has(card.id) }
		};
	});
	const edges = links.map((link): Edge => {
		const [out, into] = sides(boxes.get(link.source.card)!, boxes.get(link.target.card)!);
		const color = link.changed ? colors.changed : colors.plain;
		return {
			id: link.id, source: link.source.card, target: link.target.card,
			sourceHandle: `out-${out}:${link.source.handle}`, targetHandle: `in-${into}:${link.target.handle}`, type: 'default',
			markerEnd: { type: 'arrowclosed', width: 14, height: 14, color }, style: edgeStyle(link.changed, link.count, null),
			label: link.count > 1 ? String(link.count) : undefined,
			data: { changed: link.changed, count: link.count, members: [...link.members] } satisfies CardEdgeData
		};
	});
	return { nodes, edges };
}

// Short code-style marks for function-like symbols; other kinds get an icon in the card.
export function symbolGlyph(node: GraphNode): string | null {
	if (node.symbolKind !== 'function' && node.symbolKind !== 'method') return null;
	return node.symbolForm === 'arrow' ? '()=>' : node.symbolForm === 'constructor' ? 'new'
		: node.symbolForm === 'getter' ? 'get' : node.symbolForm === 'setter' ? 'set' : 'fn';
}

export function symbolLabel(node: GraphNode, nested: boolean) {
	if (node.symbolKind === 'module') return 'module scope';
	if (node.symbolKind === 'markup') return 'template';
	return nested && node.label.includes('.') ? node.label.slice(node.label.indexOf('.') + 1) : node.label;
}

export function describeSymbol(node: GraphNode) {
	const forms = { arrow: 'arrow function', constructor: 'constructor', getter: 'getter', setter: 'setter' };
	if (node.symbolForm && (node.symbolKind === 'function' || node.symbolKind === 'method')) return forms[node.symbolForm];
	return { function: 'function', method: 'method', class: 'class', variable: 'variable', type: 'type', module: 'module scope', markup: 'template' }[node.symbolKind ?? 'variable'];
}

// What a card or symbol uses and what uses it, including references inside the same file.
export function relations(model: CardModel, id: string) {
	const byId = new Map(model.graph.nodes.map(node => [node.id, node]));
	const cardOf = (nodeId: string) => model.cards.has(nodeId) ? nodeId : model.owner.get(nodeId) ?? nodeId;
	const home = cardOf(id);
	const inScope = (nodeId: string) => model.cards.has(id) ? cardOf(nodeId) === id : nodeId === id;
	const name = (nodeId: string) => {
		const node = byId.get(nodeId);
		if (!node) return nodeId;
		const label = node.kind === 'symbol' ? symbolLabel(node, false) : node.kind === 'others' ? `${node.files} other files in ${node.path || '/'}` : node.label;
		return node.kind === 'symbol' && cardOf(nodeId) !== home ? `${label} · ${byId.get(cardOf(nodeId))?.label}` : label;
	};
	const collect = (edges: typeof model.graph.edges, end: 'source' | 'target') =>
		[...new Set(edges.map(edge => edge[end]).filter(other => !(model.cards.has(id) && cardOf(other) === id)).map(name))];
	return {
		uses: collect(model.graph.edges.filter(edge => inScope(edge.source)), 'target'),
		usedBy: collect(model.graph.edges.filter(edge => inScope(edge.target)), 'source')
	};
}
