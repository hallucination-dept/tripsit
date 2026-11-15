import { badgeColors, bezier, buildCardModel, changeLabels, edgeLabel, geometry, layoutCards, symbolGlyph, symbolLabel, type CardEdgeData } from '#lib/graph-layout.ts';
import type { ChangeGraph, ChangeKind, GraphNode } from '#lib/server/change-graph.ts';

// A static picture of the change graph for pull request comments: the same ELK layout and cards as the interactive
// view on a transparent background. The comment picks the light or dark rendering to match the GitHub theme.
export type GraphTheme = 'light' | 'dark';
const palettes: Record<GraphTheme, string> = {
	light: '.card,.divider,.glyph-box{stroke:#d1d9e0}.folder{fill:#818b98;fill-opacity:.06}.edge{stroke:#8c959f}#arrow path{fill:#8c959f}.strong{fill:#1f2328}.subtle,.muted{fill:#59636e}.glyph{fill:#0969da}.label-back{fill:#ffffff}',
	dark: '.card,.divider,.glyph-box{stroke:#3d444d}.folder{fill:#818b98;fill-opacity:.08}.edge{stroke:#6e7681}#arrow path{fill:#6e7681}.strong{fill:#f0f6fc}.subtle,.muted{fill:#9198a1}.glyph{fill:#93c5fd}.label-back{fill:#0d1117}'
};
const font = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const charWidth = (size: number) => size * 0.61;
const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
const fit = (value: string, width: number, size: number) => {
	const max = Math.max(1, Math.floor(width / charWidth(size)));
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const kindTags: Partial<Record<NonNullable<GraphNode['symbolKind']>, string>> = { class: 'class', variable: 'var', type: 'type', module: 'mod', markup: '</>' };
const round = (value: number) => Math.round(value * 10) / 10;

const badgeWidth = (text: string) => text.length * charWidth(9) + 9;
function badge(change: ChangeKind, label: string, right: number, middle: number, backed = false) {
	const text = label.toUpperCase();
	const width = badgeWidth(text), x = right - width;
	// Badges on connections get a backing in the page colour so the line does not run through their text.
	return (backed ? `<rect class="label-back" x="${round(x)}" y="${round(middle - 7)}" width="${round(width)}" height="14"/>` : '') + `<rect x="${round(x)}" y="${round(middle - 7)}" width="${round(width)}" height="14" fill="${badgeColors[change]}" fill-opacity="0.12" stroke="${badgeColors[change]}"/>` +
		`<text x="${round(x + width / 2)}" y="${round(middle + 3.2)}" text-anchor="middle" fill="${badgeColors[change]}" font-size="9" font-weight="600">${escape(text)}</text>`;
}

export async function renderGraphSvg(graph: ChangeGraph, theme: GraphTheme = 'light'): Promise<string> {
	const model = buildCardModel(graph);
	const { nodes, edges } = await layoutCards(model, model.defaults);
	if (!nodes.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
	const pad = 24;
	const minX = Math.min(...nodes.map(node => node.position.x)) - pad, minY = Math.min(...nodes.map(node => node.position.y)) - pad;
	const maxX = Math.max(...nodes.map(node => node.position.x + node.width!)) + pad, maxY = Math.max(...nodes.map(node => node.position.y + node.height!)) + pad;
	const anchor = (nodeId: string, handleId: string | null | undefined) => {
		const node = nodes.find(candidate => candidate.id === nodeId)!;
		const handle = node.handles?.find(candidate => candidate.id === handleId);
		return { x: node.position.x + (handle?.x ?? 0) + 0.5, y: node.position.y + (handle?.y ?? node.height! / 2) + 0.5 };
	};

	const edgeParts = edges.map(edge => {
		const data = edge.data as CardEdgeData;
		const from = anchor(edge.source, edge.sourceHandle), to = anchor(edge.target, edge.targetHandle);
		const sourceSide = edge.sourceHandle?.startsWith('out-l') ? 'l' : 'r', targetSide = edge.targetHandle?.startsWith('in-l') ? 'l' : 'r';
		// Leave room for the arrowhead, as the marker sits at the path's end.
		const line = bezier(round(from.x), round(from.y), sourceSide, round(to.x + (targetSide === 'l' ? -8 : 8)), round(to.y), targetSide);
		const d = line.path.replace(/\d+\.\d{2,}/g, value => String(round(Number(value)))), middle = line.at(data.labelT ?? 0.5);
		const width = Math.min(data.changed ? 3 : 2, (data.changed ? 1.6 : 1) + Math.log2(data.count) * 0.5);
		let label = '';
		const text = edgeLabel(data.change, data.count);
		if (text && data.change !== 'unchanged') label = badge(data.change, text, middle.x + badgeWidth(text) / 2, middle.y, true);
		else if (text) label = `<text class="muted" x="${round(middle.x)}" y="${round(middle.y + 3.5)}" text-anchor="middle" font-size="10">${escape(text)}</text>`;
		return { path: `<path class="edge" d="${d}" stroke-width="${round(width)}"${data.change === 'deleted' ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"/>`, label };
	});

	const cards = nodes.map(flow => {
		const { card, rows } = flow.data;
		const node = card.node, x = flow.position.x, y = flow.position.y, width = flow.width!, height = flow.height!;
		const parts = [`<rect class="card${node.kind === 'file' ? '' : ' folder'}" x="${round(x + 0.5)}" y="${round(y + 0.5)}" width="${width - 1}" height="${height - 1}"${node.change === 'deleted' ? ' stroke-dasharray="5 3"' : ''}/>`];
		const title = node.kind === 'others' ? `${node.files} other file${node.files === 1 ? '' : 's'}` : node.label;
		const crumb = node.kind === 'file' ? card.breadcrumb : `${card.breadcrumb} · ${node.files} file${node.files === 1 ? '' : 's'}`;
		const badgeRoom = node.change === 'unchanged' ? 0 : changeLabels[node.change].length * charWidth(9) + 15;
		parts.push(`<text class="strong" x="${x + 10}" y="${y + 22}" font-size="12.5" font-weight="600">${escape(fit(title, width - 20 - badgeRoom, 12.5))}</text>`);
		if (node.change !== 'unchanged') parts.push(badge(node.change, changeLabels[node.change], x + width - 10, y + 18));
		parts.push(`<text class="subtle" x="${x + 10}" y="${y + 38}" font-size="10.5">${escape(fit(crumb, width - 20, 10.5))}</text>`);
		if (rows.length) parts.push(`<line class="divider" x1="${x}" y1="${y + 1 + geometry.head + 0.5}" x2="${x + width}" y2="${y + 1 + geometry.head + 0.5}"/>`);
		rows.forEach((row, index) => {
			const middle = y + 2 + geometry.head + geometry.listPadding + index * geometry.row + geometry.row / 2;
			if (row.type === 'more') {
				parts.push(`<text class="subtle" x="${x + 26}" y="${middle + 3.5}" font-size="11">${row.open ? `Hide ${row.count} unrelated` : `${row.count} more symbol${row.count === 1 ? '' : 's'}`}</text>`);
				return;
			}
			const left = x + 8 + row.depth * 16 + 18;
			const tag = symbolGlyph(row.node) ?? kindTags[row.node.symbolKind ?? 'variable'] ?? '';
			parts.push(`<rect class="glyph-box" x="${round(left + 0.5)}" y="${round(middle - 7.5)}" width="30" height="15"/>`,
				`<text class="glyph" x="${round(left + 15.5)}" y="${round(middle + 3)}" text-anchor="middle" font-size="9" font-weight="500">${escape(tag)}</text>`);
			const room = row.node.change === 'unchanged' ? 0 : changeLabels[row.node.change].length * charWidth(9) + 15;
			const dim = !row.node.focus && row.node.change === 'unchanged';
			parts.push(`<text class="${dim ? 'subtle' : 'strong'}" x="${round(left + 36)}" y="${round(middle + 4)}" font-size="12"${row.node.change === 'deleted' ? ' text-decoration="line-through"' : ''}>${escape(fit(symbolLabel(row.node, row.depth > 0), x + width - left - 46 - room, 12))}</text>`);
			if (row.node.change !== 'unchanged') parts.push(badge(row.node.change, changeLabels[row.node.change], x + width - 10, middle));
		});
		return parts.join('');
	});

	const width = Math.ceil(maxX - minX), height = Math.ceil(maxY - minY);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${Math.floor(minX)} ${Math.floor(minY)} ${width} ${height}" font-family="${font}">` +
		`<style>.card,.edge,.glyph-box{fill:none}${palettes[theme]}</style>` +
		'<defs><marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
		edgeParts.map(part => part.path).join('') + cards.join('') + edgeParts.map(part => part.label).join('') +
		'</svg>';
}
