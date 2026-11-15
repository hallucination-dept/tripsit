<script lang="ts">
	import { getContext, type Component } from 'svelte';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import Box from '@lucide/svelte/icons/box';
	import Braces from '@lucide/svelte/icons/braces';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CodeXml from '@lucide/svelte/icons/code-xml';
	import File from '@lucide/svelte/icons/file';
	import FileBraces from '@lucide/svelte/icons/file-braces';
	import FileCode from '@lucide/svelte/icons/file-code';
	import FileText from '@lucide/svelte/icons/file-text';
	import Files from '@lucide/svelte/icons/files';
	import Folder from '@lucide/svelte/icons/folder';
	import Type from '@lucide/svelte/icons/type';
	import Variable from '@lucide/svelte/icons/variable';
	import { changeLabels, symbolGlyph, symbolLabel, type CardFlowNode, type GraphUi } from '#lib/graph-layout.ts';
	import type { GraphNode } from '#lib/server/change-graph.ts';

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
</script>

{#snippet ports(key: string)}
	<Handle type="target" position={Position.Left} id="in-l:{key}" isConnectable={false} class="port" />
	<Handle type="target" position={Position.Right} id="in-r:{key}" isConnectable={false} class="port" />
	<Handle type="source" position={Position.Left} id="out-l:{key}" isConnectable={false} class="port" />
	<Handle type="source" position={Position.Right} id="out-r:{key}" isConnectable={false} class="port" />
{/snippet}

<div class="card kind-{node.kind} change-{node.change}" class:selected={ui.selected === id}>
	<div class="head" role="button" tabindex="0" onclick={() => ui.select(id)} onkeydown={(event) => { if (event.key === 'Enter') ui.select(id); }}>
		{@render ports('head')}
		<div class="title">
			{#if data.card.entries.length}
				<button type="button" class="chevron nodrag" class:open={data.open} aria-label={data.open ? 'Collapse symbols' : 'Expand symbols'}
					onclick={(event) => { event.stopPropagation(); ui.toggle(id); }}><ChevronRight size={13} /></button>
			{/if}
			<CardIcon size={14} class="card-icon" />
			<span class="name" title={node.path || '/'}>{title}</span>
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
					<li class="row change-{row.node.change}" class:dim={!row.node.focus && row.node.change === 'unchanged'} class:selected={ui.selected === row.id}
						style:padding-left="{8 + row.depth * 16}px" title="{row.node.symbolKind} · lines {row.node.lines}{row.node.change === 'unchanged' ? '' : ` · ${changeLabels[row.node.change]}`}">
						{@render ports(row.id)}
						{#if row.toggle}
							<button type="button" class="chevron nodrag" class:open={row.open} aria-label={row.open ? 'Collapse members' : 'Expand members'}
								onclick={(event) => { event.stopPropagation(); ui.toggle(row.toggle!); }}><ChevronRight size={12} /></button>
						{:else}<span class="chevron-space"></span>{/if}
						<span class="glyph">{#if glyph}{glyph}{:else if SymbolIcon}<SymbolIcon size={13} />{/if}</span>
						<button type="button" class="label" onclick={() => ui.select(row.id)}>{symbolLabel(row.node, row.depth > 0)}</button>
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
	.row.selected { background: var(--surface-hover); }
	.row.change-deleted .label { text-decoration: line-through; }
	.row.dim .label, .row.dim .glyph { color: var(--text-subtle); }
	.chevron { display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0; flex-shrink: 0; color: var(--text-subtle); transition: transform .12s ease; }
	.chevron:hover { color: var(--text); }
	.chevron.open { transform: rotate(90deg); }
	.chevron-space { width: 16px; flex-shrink: 0; }
	.glyph { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 16px; padding: 0 3px; flex-shrink: 0; border: 1px solid var(--border); color: var(--info); font: 500 9.5px/1 var(--font-mono); }
	.label { min-width: 0; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: var(--text); font: 400 12px/24px var(--font-mono); flex: 1; }
	.more-toggle { display: flex; align-items: center; gap: 4px; width: 100%; height: 24px; padding: 0; color: var(--text-subtle); font: 400 11px/1 var(--font-mono); text-align: left; }
	.more-toggle:hover { color: var(--text); }
	.more { padding-left: 8px; }
	@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
	.card :global(.port) { width: 4px; height: 4px; min-width: 0; min-height: 0; border: 0; background: transparent; }
</style>
