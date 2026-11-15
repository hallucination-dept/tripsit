import {
	badgeColors, bezier, bubbleGeometry, buildCardModel, cardWidth, changeLabels, edgeLabel, geometry, layoutCards, symbolGlyph, symbolLabel,
	type Bubble, type CardEdgeData
} from '#lib/graph-layout.ts';
import type { ChangeGraph, ChangeKind, GraphNode } from '#lib/server/change-graph.ts';
import { attention, attentionAlpha, flagIndex, flagLabels, flagRgb, strongest, type AgentFlag, type FlagKind } from '#lib/flag-levels.ts';

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

// Review flags: a tint with a left accent whose strength is the attention level, and a small flag mark.
function flagTint(flags: AgentFlag[], x: number, y: number, width: number, height: number) {
	const level = strongest(flags);
	if (!level) return '';
	const { tint, accent } = attentionAlpha[level];
	return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" fill="rgb(${flagRgb})" fill-opacity="${tint}"/>` +
		`<rect x="${round(x)}" y="${round(y)}" width="2" height="${round(height)}" fill="rgb(${flagRgb})" fill-opacity="${accent}"/>`;
}
function flagMark(flags: AgentFlag[], left: number, middle: number, count: boolean) {
	const level = strongest(flags);
	if (!level) return { svg: '', width: 0 };
	const opacity = Math.max(attentionAlpha[level].accent, 0.75);
	const mark = `<path d="M${round(left + 1)},${round(middle + 5.5)} V${round(middle - 5.5)} L${round(left + 9)},${round(middle - 3)} L${round(left + 1)},${round(middle)}" ` +
		`fill="rgb(${flagRgb})" fill-opacity="${opacity}" stroke="rgb(${flagRgb})" stroke-opacity="${opacity}" stroke-width="1.2" stroke-linejoin="round"/>`;
	const text = count ? `<text x="${round(left + 12)}" y="${round(middle + 3.5)}" fill="rgb(${flagRgb})" fill-opacity="${opacity}" font-size="10" font-weight="600">${flags.length}</text>` : '';
	return { svg: mark + text, width: count ? 14 + String(flags.length).length * charWidth(10) : 11 };
}

// Lucide icon shapes (ISC licence) for the flag kinds, drawn on a 24-unit grid like the interactive graph's icons.
const flagIconPaths: Record<FlagKind, string[]> = {
	assumption: ['M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
		'M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5', 'M12 17h.01'],
	judgement_call: ['M12 3v18', 'm19 8 3 8a5 5 0 0 1-6 0zV7', 'M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1', 'm5 8 3 8a5 5 0 0 1-6 0zV7', 'M7 21h10'],
	high_impact: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01']
};
function flagIcon(kind: FlagKind, left: number, top: number) {
	const scale = bubbleGeometry.icon / 24;
	return `<g transform="translate(${round(left)} ${round(top)}) scale(${scale})" fill="none" stroke="rgb(${flagRgb})" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
		flagIconPaths[kind].map(d => `<path d="${d}"/>`).join('') + '</g>';
}

// A flag bubble beside the card: an opaque comment box (page colour mixed with the flag hue) whose right-triangle notch
// continues its top edge to the left, with the tip at the row it is about.
function flagBubble(bubble: Bubble, nodeX: number, nodeY: number, cardRight: number, theme: GraphTheme) {
	const { tint, accent } = attentionAlpha[attention(bubble.flag)];
	const page = theme === 'dark' ? [13, 17, 23] : [255, 255, 255], hue = flagRgb.split(',').map(Number);
	const mix = Math.min(1, tint + 0.1);
	const fill = `rgb(${page.map((value, index) => Math.round(value * (1 - mix) + hue[index] * mix)).join(', ')})`;
	const left = cardRight + bubbleGeometry.gutter, top = nodeY + bubble.top, notch = 11;
	const stroke = `stroke="rgb(${flagRgb})" stroke-opacity="${accent}"`;
	const parts = [`<rect x="${round(left + 0.5)}" y="${round(top + 0.5)}" width="${bubbleGeometry.width - 1}" height="${round(bubble.height - 1)}" fill="${fill}" ${stroke}/>`,
		`<polygon points="${round(left - notch)},${round(top + 0.5)} ${round(left + 1)},${round(top + 0.5)} ${round(left + 1)},${round(top + notch + 0.5)}" fill="${fill}"/>`,
		`<path d="M${round(left + 1)},${round(top + 0.5)} H${round(left - notch)} L${round(left + 0.5)},${round(top + notch + 1)}" fill="none" ${stroke}/>`,
		flagIcon(bubble.flag.kind, left + 8, top + bubbleGeometry.pad + 1.5)];
	const textLeft = left + 8 + bubbleGeometry.icon + bubbleGeometry.iconGap;
	const label = `${flagLabels[bubble.flag.kind]}:`;
	bubble.lines.forEach((line, index) => {
		const y = top + bubbleGeometry.pad + index * bubbleGeometry.line + 11.5, text = line.replaceAll('`', '');
		const head = bubble.open && index === 0, closedLabel = !bubble.open && index === 0 && text.startsWith(label);
		parts.push(`<text x="${round(textLeft)}" y="${round(y)}" font-size="${bubbleGeometry.text}"${head ? ` font-weight="600" fill="rgb(${flagRgb})"` : ' class="strong"'}>` +
			(closedLabel ? `<tspan font-weight="600" fill="rgb(${flagRgb})">${escape(label)}</tspan>${escape(text.slice(label.length))}` : escape(text)) + '</text>');
	});
	return parts.join('');
}

export async function renderGraphSvg(graph: ChangeGraph, theme: GraphTheme = 'light', flags: AgentFlag[] = []): Promise<string> {
	const model = buildCardModel(graph, flags);
	const flagged = flagIndex(flags, model.owner, new Set(model.cards.keys()));
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
		const { card, rows, bubbles } = flow.data;
		// The flow node also holds the bubble column; the card itself has its own width and height.
		const node = card.node, x = flow.position.x, y = flow.position.y, width = cardWidth(card), height = flow.data.cardHeight;
		const parts = [`<rect class="card${node.kind === 'file' ? '' : ' folder'}" x="${round(x + 0.5)}" y="${round(y + 0.5)}" width="${width - 1}" height="${height - 1}"${node.change === 'deleted' ? ' stroke-dasharray="5 3"' : ''}/>`];
		const title = node.kind === 'others' ? `${node.files} other file${node.files === 1 ? '' : 's'}` : node.label;
		const crumb = node.kind === 'file' ? card.breadcrumb : `${card.breadcrumb} · ${node.files} file${node.files === 1 ? '' : 's'}`;
		const badgeRoom = node.change === 'unchanged' ? 0 : changeLabels[node.change].length * charWidth(9) + 15;
		parts.push(flagTint(flagged.byNode.get(card.id) ?? [], x + 1, y + 1, width - 2, geometry.head));
		const headMark = flagMark(flagged.byCard.get(card.id) ?? [], 0, y + 18, true);
		if (headMark.width) parts.push(flagMark(flagged.byCard.get(card.id)!, x + width - 10 - badgeRoom - headMark.width, y + 18, true).svg);
		parts.push(`<text class="strong" x="${x + 10}" y="${y + 22}" font-size="12.5" font-weight="600">${escape(fit(title, width - 20 - badgeRoom - headMark.width, 12.5))}</text>`);
		if (node.change !== 'unchanged') parts.push(badge(node.change, changeLabels[node.change], x + width - 10, y + 18));
		parts.push(`<text class="subtle" x="${x + 10}" y="${y + 38}" font-size="10.5">${escape(fit(crumb, width - 20, 10.5))}</text>`);
		if (rows.length) parts.push(`<line class="divider" x1="${x}" y1="${y + 1 + geometry.head + 0.5}" x2="${x + width}" y2="${y + 1 + geometry.head + 0.5}"/>`);
		rows.forEach((row, index) => {
			const middle = y + 2 + geometry.head + geometry.listPadding + index * geometry.row + geometry.row / 2;
			if (row.type === 'more') {
				parts.push(`<text class="subtle" x="${x + 26}" y="${middle + 3.5}" font-size="11">${row.open ? `Hide ${row.count} unrelated` : `${row.count} more symbol${row.count === 1 ? '' : 's'}`}</text>`);
				return;
			}
			const rowFlags = flagged.byNode.get(row.id) ?? [];
			parts.push(flagTint(rowFlags, x + 1, middle - geometry.row / 2, width - 2, geometry.row));
			const left = x + 8 + row.depth * 16 + 18;
			const tag = symbolGlyph(row.node) ?? kindTags[row.node.symbolKind ?? 'variable'] ?? '';
			parts.push(`<rect class="glyph-box" x="${round(left + 0.5)}" y="${round(middle - 7.5)}" width="30" height="15"/>`,
				`<text class="glyph" x="${round(left + 15.5)}" y="${round(middle + 3)}" text-anchor="middle" font-size="9" font-weight="500">${escape(tag)}</text>`);
			const badgeSpace = row.node.change === 'unchanged' ? 0 : changeLabels[row.node.change].length * charWidth(9) + 15;
			const rowMark = flagMark(rowFlags, x + width - 10 - badgeSpace - 14, middle, false);
			if (rowMark.svg) parts.push(rowMark.svg);
			const room = badgeSpace + (rowMark.width ? 16 : 0);
			const dim = !row.node.focus && row.node.change === 'unchanged';
			parts.push(`<text class="${dim ? 'subtle' : 'strong'}" x="${round(left + 36)}" y="${round(middle + 4)}" font-size="12"${row.node.change === 'deleted' ? ' text-decoration="line-through"' : ''}>${escape(fit(symbolLabel(row.node, row.depth > 0), x + width - left - 46 - room, 12))}</text>`);
			if (row.node.change !== 'unchanged') parts.push(badge(row.node.change, changeLabels[row.node.change], x + width - 10, middle));
		});
		for (const bubble of bubbles) parts.push(flagBubble(bubble, x, y, x + width, theme));
		return parts.join('');
	});

	const width = Math.ceil(maxX - minX), height = Math.ceil(maxY - minY);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${Math.floor(minX)} ${Math.floor(minY)} ${width} ${height}" font-family="${font}">` +
		`<style>.card,.edge,.glyph-box{fill:none}${palettes[theme]}</style>` +
		'<defs><marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
		edgeParts.map(part => part.path).join('') + cards.join('') + edgeParts.map(part => part.label).join('') +
		'</svg>';
}
