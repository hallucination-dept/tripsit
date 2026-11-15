import type { ElkNode } from 'elkjs/lib/elk-api';
import type { Edge, Node, NodeHandle } from '@xyflow/svelte';
import type { ChangeGraph, ChangeKind, GraphNode } from '#lib/server/change-graph.ts';
import { flagLabels, type AgentFlag } from '#lib/flag-levels.ts';
import { metricLabels, percent, ringBelow, type ConfidenceMetric, type NodeConfidence, type RunConfidence } from '#lib/edit-confidence.ts';

// Card geometry. GraphCard.svelte renders with the same numbers so the layout and the DOM agree.
export const geometry = { fileWidth: 280, folderWidth: 220, head: 50, row: 24, listPadding: 4 };
// Review flags are comment bubbles right of the card. A right-triangle notch at the bubble's top-left corner points at
// the row they are about. Their text is pre-wrapped into fixed-height lines, so bubble sizes are known before rendering.
export const bubbleGeometry = { width: 270, gutter: 12, notch: 7, pad: 6, line: 15, icon: 12, iconGap: 6, text: 11, charWidth: 6.8, closedLines: 2,
	// Below this zoom, closed bubbles shrink to their kind icon and an expand chevron.
	iconBelowZoom: 0.8 };
export type BubbleMode = 'icon' | 'preview' | 'open';
// Open bubbles always show everything; closed ones show a two-line preview, or only an icon when zoomed out.
export const bubbleMode = (open: boolean, zoom: number): BubbleMode => open ? 'open' : zoom < bubbleGeometry.iconBelowZoom ? 'icon' : 'preview';

// A top-level outline item of a file; classes hold their methods as children.
export type SymbolEntry = { node: GraphNode; children: GraphNode[]; primary: boolean };
// `lows`: edits on this card below the confidence threshold, shown as "Low confidence" bubbles.
export type Card = { id: string; node: GraphNode; breadcrumb: string; entries: SymbolEntry[]; extras: number; flags: AgentFlag[]; lows: NodeConfidence[] };
export type CardRow =
	| { type: 'symbol'; id: string; node: GraphNode; depth: number; toggle: string | null; open: boolean }
	| { type: 'more'; id: string; count: number; open: boolean };
// `top` is relative to the node; `anchor` is the y of the row (or header) the tail points at.
// `restHeight` is the closed height: the layout reserves only that, so opening a bubble never moves cards; an open
// bubble overlays its neighbours instead.
type BubbleBase = { id: string; open: boolean; lines: string[]; top: number; height: number; restHeight: number; anchor: number };
export type FlagBubble = BubbleBase & { kind: 'flag'; flag: AgentFlag };
export type ConfidenceBubble = BubbleBase & { kind: 'confidence'; score: NodeConfidence };
export type Bubble = FlagBubble | ConfidenceBubble;
export type CardModel = {
	graph: ChangeGraph; cards: Map<string, Card>; metric: ConfidenceMetric | null;
	owner: Map<string, string>; // symbol id → card id
	host: Map<string, string>; // method id → class id
	defaults: Set<string>; // ids open on first render
};
export type CardData = { card: Card; rows: CardRow[]; open: boolean; bubbles: Bubble[]; cardHeight: number };
export type CardFlowNode = Node<CardData, 'card'>;
// `change` is 'modified' when a merged connection both gained and lost (or kept) references.
// `labelT` places the badge along the curve, staggered so parallel connections do not stack their badges.
export type CardEdgeData = { changed: boolean; change: ChangeKind; count: number; members: string[]; labelT: number };
// Shared with the card components through Svelte context.
export type GraphUi = {
	readonly selected: string | null; select: (id: string) => void; toggle: (id: string) => void;
	// Review flags on a node, and on a card including its symbols.
	flags: (id: string) => AgentFlag[]; cardFlags: (id: string) => AgentFlag[];
	// Edit confidence of a node, when the run scored it, and the scorer behind it.
	confidence: (id: string) => NodeConfidence | null; readonly confidenceMetric: ConfidenceMetric | null;
};
type Anchor = { card: string; handle: string };
type Box = { x: number; y: number; width: number; height: number };

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
// Edges stay neutral: colour is reserved for confidence. Change status is shown as badges.
const edgeColor = '#6b6b6b';
export const changeLabels: Record<ChangeKind, string> = { added: 'added', modified: 'modified', deleted: 'removed', unchanged: '' };

// Files become cards holding their symbol outline; untouched folders and the "other files" buckets become small cards.
// Folders that contain focus files are not drawn; each file card names its folder instead.
export function buildCardModel(graph: ChangeGraph, flags: AgentFlag[] = [], confidence: RunConfidence | null = null): CardModel {
	const cards = new Map<string, Card>(), owner = new Map<string, string>(), host = new Map<string, string>(), defaults = new Set<string>();
	for (const node of graph.nodes) {
		if (node.kind === 'symbol' || (node.kind === 'directory' && node.group)) continue;
		const breadcrumb = node.kind === 'others' ? node.path || '/' : dirOf(node.path) || '/';
		cards.set(node.id, { id: node.id, node, breadcrumb, entries: [], extras: 0, flags: [], lows: [] });
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
	for (const flag of flags) {
		const card = flag.nodeId ? cards.get(flag.nodeId) ?? cards.get(owner.get(flag.nodeId) ?? '') : undefined;
		card?.flags.push(flag);
	}
	// Low-confidence edits get "Low confidence" bubbles. A file or class carries the low spot of the edits inside it,
	// so for each least-sure token only the most specific node (method or function, then class, then file) gets one.
	const kinds = new Map(graph.nodes.map(node => [node.id, node.symbolKind]));
	const depth = (score: NodeConfidence) => cards.has(score.nodeId) ? 0 : kinds.get(score.nodeId) === 'class' ? 1 : 2;
	const lowest = new Map<string, NodeConfidence>();
	for (const score of confidence?.status === 'scored' ? confidence.nodes : []) {
		const card = cards.has(score.nodeId) ? score.nodeId : owner.get(score.nodeId);
		if (!card || score.confidence >= ringBelow) continue;
		const spot = `${card}\u0000${score.weakest.line}\u0000${score.weakest.text}`, seen = lowest.get(spot);
		if (!seen || depth(score) > depth(seen)) lowest.set(spot, score);
	}
	for (const score of lowest.values()) cards.get(cards.has(score.nodeId) ? score.nodeId : owner.get(score.nodeId)!)!.lows.push(score);
	return { graph, cards, owner, host, defaults, metric: confidence?.status === 'scored' ? confidence.metric : null };
}

export const cardWidth = (card: Card) => card.node.kind === 'file' ? geometry.fileWidth : geometry.folderWidth;
// Greedy word wrap to a fixed number of characters; words longer than a line are split.
export function wrapText(text: string, width: number): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		let rest = word;
		while (rest.length > width) {
			if (current) { lines.push(current); current = ''; }
			lines.push(rest.slice(0, width)); rest = rest.slice(width);
		}
		if (!rest) continue;
		if (!current) current = rest;
		else if (current.length + 1 + rest.length <= width) current += ` ${rest}`;
		else { lines.push(current); current = rest; }
	}
	if (current) lines.push(current);
	return lines;
}

const bubbleChars = () => {
	const { width, pad, icon, iconGap, charWidth } = bubbleGeometry;
	return Math.max(12, Math.floor((width - 2 * pad - 2 - icon - iconGap) / charWidth));
};
// Closed bubbles keep two lines, the last one ending in an ellipsis when the text is longer.
function preview(text: string): string[] {
	const chars = bubbleChars(), { closedLines } = bubbleGeometry;
	const lines = wrapText(text, chars);
	if (lines.length <= closedLines) return lines;
	const kept = lines.slice(0, closedLines), last = kept[closedLines - 1];
	kept[closedLines - 1] = `${last.length >= chars ? last.slice(0, chars - 1) : last}…`;
	return kept;
}
// A closed bubble shows the kind and the start of the reason in two lines; an open one adds the confidence, the
// whole reason and the alternatives.
export function bubbleLines(flag: AgentFlag, open: boolean): string[] {
	const chars = bubbleChars();
	if (open) {
		return [...wrapText(`${flagLabels[flag.kind]} · ${flag.confidence} confidence`, chars), ...wrapText(flag.reason, chars),
			...(flag.alternatives ? wrapText(`Alternatives: ${flag.alternatives}`, chars) : [])];
	}
	return preview(`${flagLabels[flag.kind]}: ${flag.reason}`);
}
// Token text as `code`: whitespace is shown escaped and backticks cannot end the span.
const tokenCode = (text: string) => `\`${(text.trim() ? text : JSON.stringify(text)).replaceAll('`', "'")}\``;
export const lowConfidenceLabel = 'Low confidence';
// A low-confidence bubble: closed, the score and the least sure token; open, the scorer values and the alternatives.
export function confidenceLines(score: NodeConfidence, metric: ConfidenceMetric | null, open: boolean): string[] {
	const weakest = `${tokenCode(score.weakest.text)} at ${percent(score.weakest.probability)}`;
	if (!open) return preview(`${lowConfidenceLabel}: ${percent(score.confidence)} · least sure ${weakest}`);
	// Short lines that fit the bubble: the scorer values, then the least sure token and what the model weighed instead.
	const chars = bubbleChars(), others = score.weakest.alternatives.filter(option => option.text !== score.weakest.text);
	return [
		`${lowConfidenceLabel} · ${percent(score.confidence)}`,
		`${metricLabels[metric ?? 'negentropy']} ${score.confidence.toFixed(3)}`,
		...(metric === 'probability' ? [] : [`Min. token probability ${percent(score.minProbability)}`]),
		`Tokens scored ${score.tokens}`,
		...(score.adjusted === null ? [] : [`Length-adjusted ${score.adjusted.toFixed(2)} · ${score.adjusted < 0.1 ? 'unusual' : 'typical'}`]),
		...wrapText(`Least sure, line ${score.weakest.line}: ${tokenCode(score.weakest.text)} ${percent(score.weakest.probability)}`, chars),
		...others.flatMap(option => wrapText(`or ${tokenCode(option.text)} ${percent(option.probability)}`, chars))
	];
}
export const bubbleHeight = (lines: string[]) => 2 * bubbleGeometry.pad + lines.length * bubbleGeometry.line;

export const headCenter = 1 + geometry.head / 2;
export const rowCenter = (index: number) => 2 + geometry.head + geometry.listPadding + index * geometry.row + geometry.row / 2;

// Each bubble's top edge (and the notch's tip) sits at the middle of its row; bubbles may overlap. Flags and low
// confidence on the file, or on rows that are not shown, point at the card header.
export const confidenceBubbleId = (nodeId: string) => `confidence:${nodeId}`;
export function cardBubbles(card: Card, rows: CardRow[], open: Set<string>, metric: ConfidenceMetric | null = null): Bubble[] {
	if (!card.flags.length && !card.lows.length) return [];
	const index = new Map(rows.map((row, position) => [row.id, position]));
	const at = (nodeId: string | null) => {
		const position = nodeId ? index.get(nodeId) : undefined;
		return position === undefined ? headCenter : rowCenter(position);
	};
	const items = [
		...card.flags.map(flag => ({ id: `flag:${flag.id}`, anchor: at(flag.nodeId), flag, score: null })),
		...card.lows.map(score => ({ id: confidenceBubbleId(score.nodeId), anchor: at(score.nodeId), flag: null, score }))
	].sort((a, b) => a.anchor - b.anchor);
	return items.map(({ id, anchor, flag, score }): Bubble => {
		const isOpen = open.has(id);
		const linesFor = (expanded: boolean) => flag ? bubbleLines(flag, expanded) : confidenceLines(score!, metric, expanded);
		const lines = linesFor(isOpen);
		const base = { id, open: isOpen, lines, top: anchor, height: bubbleHeight(lines), restHeight: bubbleHeight(isOpen ? linesFor(false) : lines), anchor };
		return flag ? { ...base, kind: 'flag', flag } : { ...base, kind: 'confidence', score: score! };
	});
}

// The flow node holds the card and, when it has bubbles, the bubble column sized for closed bubbles.
export function nodeSize(card: Card, rows: CardRow[], bubbles: Bubble[]) {
	const size = cardSize(card, rows);
	if (!bubbles.length) return { ...size, cardHeight: size.height };
	const bottom = Math.max(...bubbles.map(bubble => bubble.top + bubble.restHeight));
	return { width: size.width + bubbleGeometry.gutter + bubbleGeometry.width, height: Math.max(size.height, bottom), cardHeight: size.height };
}

// Rows a card shows for the current open state: edited symbols and their neighbours, then "N more" for the rest.
export function visibleRows(card: Card, open: Set<string>): CardRow[] {
	return outlineRows(card, open);
}

function outlineRows(card: Card, open: Set<string>): CardRow[] {
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
	return { width: cardWidth(card), height: 2 + geometry.head + (rows.length ? 1 + geometry.listPadding * 2 + rows.length * geometry.row : 0) };
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
	const merged = new Map<string, { source: Anchor; target: Anchor; count: number; changed: boolean; kinds: Set<ChangeKind>; members: Set<string> }>();
	for (const edge of model.graph.edges) {
		const source = anchorFor(model, edge.source, visible), target = anchorFor(model, edge.target, visible);
		if (!source || !target || source.card === target.card) continue;
		const key = `${source.card}:${source.handle}->${target.card}:${target.handle}`;
		const link = merged.get(key) ?? { source, target, count: 0, changed: false, kinds: new Set<ChangeKind>(), members: new Set<string>() };
		link.count += edge.count;
		link.changed ||= edge.changed;
		link.kinds.add(edge.change ?? 'unchanged'); // runs saved before connection status existed
		for (const id of [edge.source, edge.target, source.card, target.card, source.handle, target.handle]) if (id !== 'head') link.members.add(id);
		merged.set(key, link);
	}
	return [...merged.entries()].map(([id, { kinds, ...link }]) =>
		({ id, ...link, change: (kinds.size === 1 ? [...kinds][0] : 'modified') as ChangeKind }));
}

// `focus` is true or false while something is selected (its own edges stand out) and null otherwise.
export function edgeStyle(changed: boolean, count: number, focus: boolean | null, change: ChangeKind = 'unchanged') {
	const width = Math.min(changed ? 4 : 3, (changed ? 1.8 : 1) + Math.log2(count) * 0.6) + (focus ? 1 : 0);
	const opacity = focus === false ? 0.12 : changed || focus ? 1 : 0.55;
	return `stroke:${edgeColor};stroke-width:${width}px;opacity:${opacity};${change === 'deleted' ? 'stroke-dasharray:6 4;' : ''}`;
}

// A changed connection carries a small badge like the cards; otherwise the label only counts merged references.
export function edgeLabel(change: ChangeKind, count: number) {
	const times = count > 1 ? `×${count}` : '';
	return change === 'unchanged' ? times || undefined : [changeLabels[change], times].filter(Boolean).join(' ');
}
// Badge colours match the app's --added/--modified/--deleted tokens; the edge line itself stays grey.
export const badgeColors: Record<ChangeKind, string> = { added: '#4ade80', modified: '#fb923c', deleted: '#f87171', unchanged: '#8c8c8c' };
const badgeLabelStyle = (change: ChangeKind) =>
	`padding:1px 5px;border:1px solid ${badgeColors[change]};color:${badgeColors[change]};font:600 9px/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.06em;`;

// Svelte Flow's default bezier between left/right handles, with a point at `t` for placing labels.
export function bezier(sx: number, sy: number, sourceSide: 'l' | 'r', tx: number, ty: number, targetSide: 'l' | 'r') {
	const offset = (distance: number) => distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
	const c1 = sourceSide === 'r' ? sx + offset(tx - sx) : sx - offset(sx - tx);
	const c2 = targetSide === 'l' ? tx - offset(tx - sx) : tx + offset(sx - tx);
	const at = (t: number) => {
		const u = 1 - t;
		return { x: u ** 3 * sx + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t ** 3 * tx, y: (u ** 3 + 3 * u * u * t) * sy + (3 * u * t * t + t ** 3) * ty };
	};
	return { path: `M${sx},${sy} C${c1},${sy} ${c2},${ty} ${tx},${ty}`, at };
}
const labelPositions = [0.5, 0.32, 0.68, 0.2, 0.8, 0.42, 0.58];

// Edges leave and enter rows from the side facing the other card; between stacked cards they loop on the right.
// A card with flag bubbles on its right uses its left side instead, so edges never run through the bubbles.
function sides(from: Box, to: Box, fromBubbles: boolean, toBubbles: boolean): ['l' | 'r', 'l' | 'r'] {
	const [out, into]: ['l' | 'r', 'l' | 'r'] = to.x >= from.x + from.width ? ['r', 'l'] : to.x + to.width <= from.x ? ['l', 'r'] : ['r', 'r'];
	return [fromBubbles && out === 'r' ? 'l' : out, toBubbles && into === 'r' ? 'l' : into];
}

// Handle anchors come from the fixed card geometry rather than DOM measurement: Svelte Flow forgets measured
// handles whenever the node objects are replaced, which happens on every re-layout.
const left = 'left' as NodeHandle['position'], right = 'right' as NodeHandle['position'];
export function cardHandles(rows: CardRow[], width: number): NodeHandle[] {
	const anchors = [{ key: 'head', y: headCenter }];
	rows.forEach((row, index) => { if (row.type === 'symbol') anchors.push({ key: row.id, y: rowCenter(index) }); });
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
	const bubbles = new Map(cards.map(card => [card.id, cardBubbles(card, rows.get(card.id)!, open, model.metric)]));
	const sizes = new Map(cards.map(card => [card.id, nodeSize(card, rows.get(card.id)!, bubbles.get(card.id)!)]));
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
		children: cards.map(card => ({ id: card.id, width: sizes.get(card.id)!.width, height: sizes.get(card.id)!.height })),
		edges: [...pairs.values()]
	});
	const boxes = new Map<string, Box>();
	for (const child of layout.children ?? []) {
		const size = sizes.get(child.id)!;
		boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: size.width, height: size.height });
	}
	const nodes = cards.map((card): CardFlowNode => {
		const box = boxes.get(card.id)!;
		return {
			id: card.id, type: 'card', position: { x: box.x, y: box.y }, width: box.width, height: box.height,
			style: `width:${box.width}px;height:${box.height}px;`, connectable: false,
			// Bubbles keep their screen size when zoomed out, so cards with bubbles are drawn above the others.
			zIndex: bubbles.get(card.id)!.length ? 1 : 0,
			handles: cardHandles(rows.get(card.id)!, cardWidth(card)),
			data: { card, rows: rows.get(card.id)!, open: open.has(card.id), bubbles: bubbles.get(card.id)!, cardHeight: sizes.get(card.id)!.cardHeight }
		};
	});
	const badges = new Map<string, number>();
	const edges = links.map((link): Edge => {
		const pair = [link.source.card, link.target.card].sort().join('|');
		const slot = link.change === 'unchanged' ? 0 : badges.get(pair) ?? 0;
		if (link.change !== 'unchanged') badges.set(pair, slot + 1);
		const [out, into] = sides(boxes.get(link.source.card)!, boxes.get(link.target.card)!,
			bubbles.get(link.source.card)!.length > 0, bubbles.get(link.target.card)!.length > 0);
		return {
			id: link.id, source: link.source.card, target: link.target.card,
			sourceHandle: `out-${out}:${link.source.handle}`, targetHandle: `in-${into}:${link.target.handle}`, type: 'change',
			markerEnd: { type: 'arrowclosed', width: 14, height: 14, color: edgeColor }, style: edgeStyle(link.changed, link.count, null, link.change),
			label: edgeLabel(link.change, link.count), labelStyle: link.change === 'unchanged' ? undefined : badgeLabelStyle(link.change),
			data: { changed: link.changed, change: link.change, count: link.count, members: [...link.members],
				labelT: labelPositions[slot % labelPositions.length] } satisfies CardEdgeData
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
