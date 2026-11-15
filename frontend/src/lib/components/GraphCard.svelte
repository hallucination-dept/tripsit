<script lang="ts">
	import { getContext, type Component } from 'svelte';
	import { Handle, Position, useViewport, type NodeProps } from '@xyflow/svelte';
	import Box from '@lucide/svelte/icons/box';
	import Braces from '@lucide/svelte/icons/braces';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CodeXml from '@lucide/svelte/icons/code-xml';
	import File from '@lucide/svelte/icons/file';
	import FileBraces from '@lucide/svelte/icons/file-braces';
	import FileCode from '@lucide/svelte/icons/file-code';
	import FileText from '@lucide/svelte/icons/file-text';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import MessageCircleQuestionMark from '@lucide/svelte/icons/message-circle-question-mark';
	import Scale from '@lucide/svelte/icons/scale';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Files from '@lucide/svelte/icons/files';
	import Folder from '@lucide/svelte/icons/folder';
	import Type from '@lucide/svelte/icons/type';
	import Variable from '@lucide/svelte/icons/variable';
	import { bubbleGeometry, bubbleMode, cardWidth, changeLabels, symbolGlyph, symbolLabel, type Bubble, type CardFlowNode, type GraphUi } from '#lib/graph-layout.ts';
	import type { GraphNode } from '#lib/server/change-graph.ts';
	import { attention, flagLabels, strongest, type AgentFlag, type FlagKind } from '#lib/flag-levels.ts';

	let { id, data }: NodeProps<CardFlowNode> = $props();
	const ui = getContext<GraphUi>('change-graph');
	const node = $derived(data.card.node);

	const sourcePattern = /\.(?:[mc]?[jt]sx?|svelte|vue|py|pyi|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|css|scss|html)$/i;
	function cardIcon(): Component {
		if (node.kind === 'directory') return Folder;
		if (node.kind === 'others') return Files;
		if (/\.json$/i.test(node.path)) return FileBraces;
		if (/\.(?:md|mdx|txt|rst)$/i.test(node.path)) return FileText;
		return sourcePattern.test(node.path) ? FileCode : File;
	}
	const symbolIcons: Partial<Record<NonNullable<GraphNode['symbolKind']>, Component>> =
		{ class: Box, variable: Variable, type: Type, module: Braces, markup: CodeXml };
	const title = $derived(node.kind === 'others' ? `${node.files} other file${node.files === 1 ? '' : 's'}` : node.label);
	const detail = $derived(node.kind === 'file' ? data.card.breadcrumb : `${data.card.breadcrumb} · ${node.files} file${node.files === 1 ? '' : 's'}`);
	const CardIcon = $derived(cardIcon());
	const ownFlags = $derived(ui.flags(id));
	const allFlags = $derived(ui.cardFlags(id));
	const level = (flags: AgentFlag[]) => strongest(flags) ?? 'none';
	const flagIcons: Record<FlagKind, Component> = { assumption: MessageCircleQuestionMark, judgement_call: Scale, high_impact: TriangleAlert };
	// `code` spans in flag text; whether a line starts inside one carries across wrapped lines.
	function codeParts(lines: string[]) {
		let inCode = false;
		return lines.map(line => line.split('`').map((text, index) => ({ text, code: index > 0 ? (inCode = !inCode) : inCode })).filter(part => part.text));
	}
	// A closed bubble starts with "Kind:", shown in bold.
	const labelled = (bubble: Bubble, index: number, text: string) => {
		const label = `${flagLabels[bubble.flag.kind]}:`;
		return !bubble.open && index === 0 && text.startsWith(label) ? { label, rest: text.slice(label.length) } : { label: '', rest: text };
	};
	const width = $derived(cardWidth(data.card));
	// Bubbles keep their on-screen size while the graph zooms: each is scaled by 1/zoom around the point it points at.
	const viewport = useViewport();
	const zoom = $derived(viewport.current.zoom || 1);
	const unzoom = $derived(1 / zoom);
	const flagTitle = (flags: AgentFlag[]) => `${flags.length} review flag${flags.length === 1 ? '' : 's'}`;
</script>

{#snippet ports(key: string)}
	<Handle type="target" position={Position.Left} id="in-l:{key}" isConnectable={false} class="port" />
	<Handle type="target" position={Position.Right} id="in-r:{key}" isConnectable={false} class="port" />
	<Handle type="source" position={Position.Left} id="out-l:{key}" isConnectable={false} class="port" />
	<Handle type="source" position={Position.Right} id="out-r:{key}" isConnectable={false} class="port" />
{/snippet}

<div class="node">
<div class="card kind-{node.kind} change-{node.change}" class:selected={ui.selected === id} style:width="{width}px" style:height="{data.cardHeight}px">
	<!-- Flag attention is the only colour coding on cards and rows. -->
	<div class="head flag-{level(ownFlags)}" role="button" tabindex="0" onclick={() => ui.select(id)} onkeydown={(event) => { if (event.key === 'Enter') ui.select(id); }}>
		{@render ports('head')}
		<div class="title">
			{#if data.card.entries.length}
				<button type="button" class="chevron nodrag" class:open={data.open} aria-label={data.open ? 'Collapse symbols' : 'Expand symbols'}
					onclick={(event) => { event.stopPropagation(); ui.toggle(id); }}><ChevronRight size={13} /></button>
			{/if}
			<CardIcon size={14} class="card-icon" />
			<span class="name" title={node.path || '/'}>{title}</span>
			{#if allFlags.length}<span class="flag-count flag-{level(allFlags)}" title={flagTitle(allFlags)}><FlagIcon size={11} />{allFlags.length}</span>{/if}
			{#if node.change !== 'unchanged'}<span class="badge badge-{node.change}">{changeLabels[node.change]}</span>{/if}
		</div>
		<div class="crumb">{detail}</div>
	</div>
	{#if data.rows.length}
		<ul class="rows">
			{#each data.rows as row (row.id)}
				{#if row.type === 'symbol'}
					{@const glyph = symbolGlyph(row.node)}
					{@const SymbolIcon = symbolIcons[row.node.symbolKind ?? 'variable']}
					{@const rowFlags = ui.flags(row.id)}
					<li class="row change-{row.node.change} flag-{level(rowFlags)}" class:dim={!row.node.focus && row.node.change === 'unchanged'} class:selected={ui.selected === row.id}
						style:padding-left="{8 + row.depth * 16}px" title="{row.node.symbolKind} · lines {row.node.lines}{row.node.change === 'unchanged' ? '' : ` · ${changeLabels[row.node.change]}`}">
						{@render ports(row.id)}
						{#if row.toggle}
							<button type="button" class="chevron nodrag" class:open={row.open} aria-label={row.open ? 'Collapse members' : 'Expand members'}
								onclick={(event) => { event.stopPropagation(); ui.toggle(row.toggle!); }}><ChevronRight size={12} /></button>
						{:else}<span class="chevron-space"></span>{/if}
						<span class="glyph">{#if glyph}{glyph}{:else if SymbolIcon}<SymbolIcon size={13} />{/if}</span>
						<button type="button" class="label" onclick={() => ui.select(row.id)}>{symbolLabel(row.node, row.depth > 0)}</button>
						{#if rowFlags.length}<span class="flag-mark flag-{level(rowFlags)}" title={flagTitle(rowFlags)}><FlagIcon size={11} /></span>{/if}
						{#if row.node.change !== 'unchanged'}<span class="badge badge-{row.node.change}">{changeLabels[row.node.change]}</span>{/if}
					</li>
				{:else}
					<li class="row more">
						<button type="button" class="more-toggle nodrag" onclick={(event) => { event.stopPropagation(); ui.toggle(row.id); }}>
							<span class="chevron" class:open={row.open}><ChevronRight size={12} /></span>
							{row.open ? `Hide ${row.count} unrelated symbol${row.count === 1 ? '' : 's'}` : `${row.count} more symbol${row.count === 1 ? '' : 's'}`}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</div>
{#if data.bubbles.length}
	<!-- Review flags pop out of the card as speech bubbles pointing at their row. -->
	{#each data.bubbles as bubble (bubble.id)}
		{@const KindIcon = flagIcons[bubble.flag.kind]}
		{@const mode = bubbleMode(bubble.open, zoom)}
		<div class="bubble-group flag-{attention(bubble.flag)}" class:open={bubble.open} style:left="{width}px" style:top="{bubble.anchor}px" style:transform="scale({unzoom})">
		<button type="button" class="bubble nodrag flag-{attention(bubble.flag)} mode-{mode}" class:open={bubble.open} aria-expanded={bubble.open}
			aria-label={mode === 'icon' ? `${flagLabels[bubble.flag.kind]}: ${bubble.flag.reason}` : undefined}
			style:left="{bubbleGeometry.gutter}px" style:top="{bubble.top - bubble.anchor}px"
			style:width={mode === 'icon' ? undefined : `${bubbleGeometry.width}px`}
			style:height="{mode === 'icon' ? 2 * bubbleGeometry.pad + bubbleGeometry.line : bubble.height}px"
			title={bubble.open ? 'Close' : `${flagLabels[bubble.flag.kind]}: ${bubble.flag.reason}`}
			onclick={(event) => { event.stopPropagation(); ui.toggle(bubble.id); }}>
			<KindIcon size={bubbleGeometry.icon} />
			{#if mode === 'icon'}
				<!-- Zoomed out: just the kind and a chevron; clicking opens the whole comment, zooming in shows the preview. -->
				<span class="bubble-chevron"><ChevronRight size={12} /></span>
			{:else}
			<span class="bubble-text">
				{#each codeParts(bubble.lines) as parts, index (index)}
					<span class="bubble-line" class:bubble-head={bubble.open && index === 0}>{#each parts as part, partIndex (partIndex)}{@const split = partIndex === 0 && !part.code ? labelled(bubble, index, part.text) : { label: '', rest: part.text }}{#if split.label}<strong>{split.label}</strong>{/if}{#if part.code}<code>{split.rest}</code>{:else}{split.rest}{/if}{/each}</span>
				{/each}
			</span>
			{/if}
		</button>
		</div>
	{/each}
{/if}
</div>

<style>
	/* Heights mirror `geometry` in graph-layout.ts: 1px border, 50px head, 1px divider, 4px list padding, 24px rows. */
	.card { width: 100%; height: 100%; display: flex; flex-direction: column; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: 400 12px/1 var(--font-mono); overflow: hidden; }
	.card.selected { border-color: var(--text); }
	.card.change-deleted { border-style: dashed; }
	.kind-directory, .kind-others { background: var(--surface-raised); }
	.head { position: relative; flex: 0 0 50px; height: 50px; padding: 8px 10px; display: flex; flex-direction: column; justify-content: center; gap: 4px; cursor: pointer; }
	.title { display: flex; align-items: center; gap: 6px; min-width: 0; height: 18px; }
	.title :global(.card-icon) { flex-shrink: 0; color: var(--text-muted); }
	.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; font-size: 12.5px; }
	/* Only the badge carries the change colour; cards and rows stay neutral (colour there is reserved for confidence). */
	.badge { margin-left: auto; flex-shrink: 0; padding: 2px 4px; border: 1px solid currentColor; font: 600 9px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; }
	.badge-added { color: var(--added); background: var(--added-bg); }
	.badge-modified { color: var(--modified); background: var(--modified-bg); }
	.badge-deleted { color: var(--deleted); background: var(--deleted-bg); }
	.crumb { height: 14px; line-height: 14px; color: var(--text-subtle); font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.kind-file .crumb { padding-left: 20px; }
	.rows { list-style: none; margin: 0; padding: 4px 0; border-top: 1px solid var(--border); }
	.row { position: relative; height: 24px; display: flex; align-items: center; gap: 4px; padding-right: 10px; }
	.row.selected { background: var(--surface-hover); outline: 1px solid var(--border-strong); outline-offset: -1px; }
	.row.change-deleted .label { text-decoration: line-through; }
	.row.dim .label, .row.dim .glyph { color: var(--text-subtle); }
	.chevron { display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0; flex-shrink: 0; color: var(--text-subtle); transition: transform .12s ease; }
	.chevron:hover { color: var(--text); }
	.chevron.open { transform: rotate(90deg); }
	.chevron-space { width: 16px; flex-shrink: 0; }
	.glyph { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 16px; padding: 0 3px; flex-shrink: 0; border: 1px solid var(--border); color: var(--info); font: 500 9.5px/1 var(--font-mono); }
	.label { min-width: 0; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: var(--text); font: 400 12px/24px var(--font-mono); flex: 1; }
	/* Review flags: tint and left accent in one hue whose strength is the attention level. */
	.flag-high { --flag-tint: .2; --flag-accent: 1; }
	.flag-medium { --flag-tint: .12; --flag-accent: .7; }
	.flag-low { --flag-tint: .06; --flag-accent: .45; }
	.head:is(.flag-high, .flag-medium, .flag-low), .row:is(.flag-high, .flag-medium, .flag-low) {
		background: rgba(var(--flag-rgb), var(--flag-tint)); box-shadow: inset 2px 0 0 rgba(var(--flag-rgb), var(--flag-accent));
	}
	.flag-count { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; color: rgba(var(--flag-rgb), max(var(--flag-accent), .75)); font: 600 10px/1 var(--font-mono); }
	.badge + .flag-count, .flag-count + .badge { margin-left: 6px; }
	.title .flag-count { margin-left: auto; }
	.title .flag-count + .badge { margin-left: 6px; }
	.flag-mark { display: inline-flex; flex-shrink: 0; color: rgba(var(--flag-rgb), max(var(--flag-accent), .75)); }
	/* Flag bubbles: an opaque comment bubble beside the card pointing at its row; clicking opens the full text. */
	.node { position: relative; width: 100%; height: 100%; pointer-events: none; }
	.node > * { pointer-events: auto; }
	.bubble-group { position: absolute; width: 0; height: 0; transform-origin: 0 0; pointer-events: none !important; }
	/* Overlapping bubbles: the hovered or open one comes to the front. */
	.bubble-group:hover, .bubble-group.open { z-index: 2; }
	.bubble { pointer-events: auto; --bubble-fill: color-mix(in srgb, rgb(var(--flag-rgb)) calc(var(--flag-tint) * 100% + 10%), var(--bg)); }
	/* The notch: a right triangle continuing the top edge to the left, its tip at the row. The border layer sits under
	   a slightly smaller fill layer so the top edge and the slanted side keep the bubble's outline. */
	.bubble::before, .bubble::after { content: ''; position: absolute; clip-path: polygon(0 0, 100% 0, 100% 100%); }
	.bubble::before { left: -11px; top: -1px; width: 11px; height: 11px; background: rgba(var(--flag-rgb), var(--flag-accent)); }
	.bubble::after { left: -8.5px; top: 0; width: 9.5px; height: 8.5px; background: var(--bubble-fill); }
	.bubble { position: absolute; display: flex; align-items: flex-start; gap: 6px; padding: 6px 6px 6px 8px; text-align: left; cursor: pointer;
		background: var(--bubble-fill);
		border: 1px solid rgba(var(--flag-rgb), var(--flag-accent)); box-shadow: 0 6px 18px rgba(0, 0, 0, .55);
		color: var(--text); font: 400 11px/15px var(--font-mono); }
	.bubble:hover { --bubble-fill: color-mix(in srgb, rgb(var(--flag-rgb)) calc(var(--flag-tint) * 100% + 18%), var(--bg)); }
	.bubble :global(svg) { flex-shrink: 0; margin-top: 1.5px; color: rgb(var(--flag-rgb)); }
	.bubble.mode-icon { align-items: center; gap: 3px; padding: 0 5px 0 7px; }
	.bubble.mode-icon :global(svg) { margin-top: 0; }
	.bubble-chevron { display: inline-flex; color: var(--text-muted); }
	.bubble.mode-icon:hover .bubble-chevron { color: var(--text); }
	.bubble-text { display: flex; flex-direction: column; min-width: 0; }
	.bubble-line { height: 15px; white-space: pre; overflow: hidden; }
	.bubble-head, .bubble strong { color: rgb(var(--flag-rgb)); font-weight: 600; }
	.bubble code { padding: 0 1px; background: rgba(255, 255, 255, .1); color: var(--text); font: inherit; }
	.more-toggle { display: flex; align-items: center; gap: 4px; width: 100%; height: 24px; padding: 0; color: var(--text-subtle); font: 400 11px/1 var(--font-mono); text-align: left; }
	.more-toggle:hover { color: var(--text); }
	.more { padding-left: 8px; }
	@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
	.card :global(.port) { width: 4px; height: 4px; min-width: 0; min-height: 0; border: 0; background: transparent; }
</style>
