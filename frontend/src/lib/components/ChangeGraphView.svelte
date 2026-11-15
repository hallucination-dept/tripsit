<script lang="ts">
	import { setContext, untrack } from 'svelte';
	import { Background, Controls, SvelteFlow, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import FitOnReady from './FitOnReady.svelte';
	import ChangeEdge from './ChangeEdge.svelte';
	import GraphCard from './GraphCard.svelte';
	import Spinner from './Spinner.svelte';
	import {
		buildCardModel, changeLabels, describeSymbol, edgeStyle, layoutCards, relations, symbolLabel,
		type CardEdgeData, type CardFlowNode, type GraphUi
	} from '#lib/graph-layout.ts';
	import type { RunFile } from '#lib/server/agent-runs.ts';
	import type { ChangeGraph } from '#lib/server/change-graph.ts';

	let { graph, files }: { graph: ChangeGraph; files: RunFile[] } = $props();
	const nodeTypes = { card: GraphCard };
	const edgeTypes = { change: ChangeEdge };
	// A plain copy: Svelte Flow node data must not hold reactive proxies from the page's run state.
	const model = $derived(buildCardModel($state.snapshot(graph) as ChangeGraph));
	let open = $state<Set<string>>(new Set());
	let selected = $state<string | null>(null);
	let nodes = $state.raw<CardFlowNode[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let layoutError = $state('');
	let canvas = $state<HTMLElement>();

	const ui: GraphUi = {
		get selected() { return selected; },
		select: (id: string) => { selected = selected === id ? null : id; },
		toggle: (id: string) => {
			const next = new Set(open);
			if (next.has(id)) next.delete(id); else next.add(id);
			open = next;
		}
	};
	setContext('change-graph', ui);

	// A new graph starts with changed files and their edited classes open.
	$effect(() => {
		const current = model;
		untrack(() => { open = new Set(current.defaults); selected = null; });
	});

	// Folding changes card heights and where edges attach, so the layout is recomputed.
	$effect(() => {
		const current = model, expanded = open;
		let active = true;
		layoutChangeGraph();
		async function layoutChangeGraph() {
			try {
				const result = await layoutCards(current, expanded);
				if (!active) return;
				layoutError = '';
				nodes = result.nodes;
				edges = highlight(result.edges, untrack(() => selected));
			} catch { if (active) layoutError = 'The graph could not be laid out.'; }
		}
		return () => { active = false; };
	});

	// Selecting a card or symbol emphasizes the edges it takes part in.
	function highlight(list: Edge[], focus: string | null) {
		return list.map(edge => {
			const data = edge.data as CardEdgeData;
			return { ...edge, style: edgeStyle(data.changed, data.count, focus ? data.members.includes(focus) : null, data.change) };
		});
	}
	$effect(() => {
		const focus = selected;
		edges = highlight(untrack(() => edges), focus);
	});

	const byId = $derived(new Map(graph.nodes.map(node => [node.id, node])));
	const item = $derived(selected ? byId.get(selected) ?? null : null);
	const links = $derived(selected ? relations(model, selected) : null);
	const diff = $derived(!item ? '' : item.kind === 'symbol' ? graph.symbolDiffs[item.id] ?? ''
		: item.kind === 'file' ? files.find(file => file.path === item.path)?.diff ?? '' : '');
	const lineClass = (line: string) => line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add'
		: line.startsWith('-') && !line.startsWith('---') ? 'del' : '';
</script>

<div class="graph-shell">
	<div class="canvas" bind:this={canvas}>
		{#if layoutError}
			<p class="note">{layoutError}</p>
		{:else if nodes.length}
			<SvelteFlow bind:nodes bind:edges {nodeTypes} {edgeTypes} colorMode="dark" minZoom={0.05} maxZoom={2} zIndexMode="auto"
				nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} onpaneclick={() => { selected = null; }}>
				<FitOnReady container={canvas} />
				<Background gap={20} />
				<Controls showLock={false} />
			</SvelteFlow>
		{:else}
			<p class="note"><Spinner /> Laying out the graph…</p>
		{/if}
	</div>
	<aside class="details" aria-live="polite">
		{#if item}
			<p class="eyebrow">{item.kind === 'symbol' ? describeSymbol(item) : item.kind === 'others' ? 'other files' : item.kind}</p>
			<h3>{item.kind === 'symbol' ? symbolLabel(item, false) : item.kind === 'others' ? `${item.files} other files` : item.label}</h3>
			<p class="path"><code>{item.path || '/'}</code>{#if item.lines} · lines {item.lines}{/if}</p>
			{#if item.change !== 'unchanged'}<p class="change change-{item.change}">{changeLabels[item.change]}</p>{/if}
			{#if links && (links.uses.length || links.usedBy.length)}
				<dl class="relations">
					{#if links.uses.length}<dt>Uses</dt><dd>{#each links.uses as name (name)}<span>{name}</span>{/each}</dd>{/if}
					{#if links.usedBy.length}<dt>Used by</dt><dd>{#each links.usedBy as name (name)}<span>{name}</span>{/each}</dd>{/if}
				</dl>
			{/if}
			{#if diff}
				<pre class="diff">{#each diff.replace(/\n$/, '').split('\n') as line, index (index)}<span class={lineClass(line)}>{line}</span>{/each}</pre>
			{:else if item.kind === 'file' || item.kind === 'symbol'}
				<p class="note">{item.change === 'unchanged' ? 'Unchanged. It is shown because it uses, or is used by, an edited part.' : 'No text diff is available (binary or too large).'}</p>
			{/if}
		{:else}
			<p class="eyebrow">Details</p>
			<p class="note">Select a file or symbol to see its diff and what it is connected to. Code that uses something sits above it. Badges mark what the change added, modified or removed, including connections; removed connections are dashed.</p>
			<ul class="legend">
				<li><span class="glyph">fn</span>function or method</li>
				<li><span class="glyph">()=&gt;</span>arrow function</li>
				<li><span class="glyph">new</span>constructor</li>
				<li><span class="change change-added">added</span><span class="change change-modified">modified</span><span class="change change-deleted">removed</span></li>
			</ul>
		{/if}
	</aside>
</div>

<style>
	.graph-shell { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: min(80vh, 860px); min-height: 480px; border: 1px solid var(--border); overflow: hidden; background: var(--bg); }
	.canvas { position: relative; min-width: 0; height: 100%; }
	.canvas :global(.svelte-flow) {
		--xy-background-color: var(--bg); --xy-background-pattern-dots-color: #2b2b2b;
		--xy-controls-button-background-color: var(--bg); --xy-controls-button-background-color-hover: var(--surface-hover);
		--xy-controls-button-color: var(--text-muted); --xy-controls-button-color-hover: var(--text);
		--xy-controls-button-border-color: var(--border); --xy-controls-box-shadow: none;
		--xy-edge-label-background-color: var(--bg); --xy-edge-label-color: var(--text-muted);
		--xy-attribution-background-color: transparent;
		font-family: var(--font-mono);
	}
	.canvas :global(.svelte-flow__controls) { border: 1px solid var(--border); }
	.canvas :global(.svelte-flow__attribution a) { color: var(--text-subtle); }
	.details { border-left: 1px solid var(--border); padding: 16px; overflow: auto; background: var(--bg); }
	.eyebrow { margin: 0 0 6px; color: var(--text-subtle); font: 500 10.5px/1.4 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
	h3 { margin: 0 0 6px; color: var(--text); font: 600 15px/1.4 var(--font-sans); overflow-wrap: anywhere; }
	.path { margin: 0 0 10px; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); overflow-wrap: anywhere; }
	code { font: 11px var(--font-mono); color: var(--text-muted); }
	.change { display: inline-block; margin: 0 0 12px; padding: 1px 6px; border: 1px solid currentColor; font: 600 9.5px/1.6 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; }
	.change-added { color: var(--added); background: var(--added-bg); }
	.change-modified { color: var(--modified); background: var(--modified-bg); }
	.change-deleted { color: var(--deleted); background: var(--deleted-bg); }
	.legend .change { margin: 0; }
	.relations { margin: 0 0 14px; display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px 10px; font: 400 11px/1.5 var(--font-mono); }
	.relations dt { color: var(--text-subtle); }
	.relations dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
	.relations span { padding: 0 5px; border: 1px solid var(--border); color: var(--text-muted); overflow-wrap: anywhere; }
	.note { margin: 8px 0; color: var(--text-subtle); font: 400 11px/1.6 var(--font-mono); }
	.canvas > .note { padding: 20px; }
	.diff { margin: 0; padding: 10px 0; border: 1px solid var(--border); background: var(--bg); font: 11px/1.6 var(--font-mono); overflow: auto; white-space: pre; }
	.diff span { display: block; padding: 0 10px; min-height: 1.6em; color: var(--text-muted); }
	.diff .add { background: var(--added-bg); color: #bbf7d0; }
	.diff .del { background: var(--deleted-bg); color: #fecaca; }
	.diff .hunk { background: var(--info-bg); color: var(--info); }
	.legend { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; color: var(--text-muted); font: 400 11px/1.5 var(--font-mono); }
	.legend li { display: flex; align-items: center; gap: 8px; }
	.glyph { display: inline-flex; justify-content: center; min-width: 30px; padding: 0 3px; border: 1px solid var(--border); color: var(--info); font: 500 9.5px/16px var(--font-mono); }
	@media (max-width: 900px) {
		.graph-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(420px, 1fr) auto; height: auto; }
		.canvas { height: 64vh; }
		.details { border-left: 0; border-top: 1px solid var(--border); max-height: 50vh; }
	}
</style>
