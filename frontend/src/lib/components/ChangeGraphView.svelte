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
	import { attention, byAttention, flagIndex, flagLabels, type AgentFlag } from '#lib/flag-levels.ts';
	import Split from '@lucide/svelte/icons/split';
	import { isUnusual, metricLabels, percent, ringBelow, tintAlpha, type NodeConfidence, type RunConfidence } from '#lib/edit-confidence.ts';

	let { graph, files, flags = [], confidence = null }: { graph: ChangeGraph; files: RunFile[]; flags?: AgentFlag[]; confidence?: RunConfidence | null } = $props();
	const nodeTypes = { card: GraphCard };
	const edgeTypes = { change: ChangeEdge };
	// A plain copy: Svelte Flow node data must not hold reactive proxies from the page's run state.
	const model = $derived(buildCardModel($state.snapshot(graph) as ChangeGraph, $state.snapshot(flags) as AgentFlag[], $state.snapshot(confidence) as RunConfidence | null));
	let open = $state<Set<string>>(new Set());
	let selected = $state<string | null>(null);
	let nodes = $state.raw<CardFlowNode[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let layoutError = $state('');
	let canvas = $state<HTMLElement>();

	const index = $derived(flagIndex(flags, model.owner, new Set(model.cards.keys())));
	const scores = $derived(new Map<string, NodeConfidence>(confidence?.status === 'scored' ? confidence.nodes.map(node => [node.nodeId, node]) : []));
	const ui: GraphUi = {
		get selected() { return selected; },
		flags: (id: string) => index.byNode.get(id) ?? [],
		cardFlags: (id: string) => index.byCard.get(id) ?? [],
		confidence: (id: string) => scores.get(id) ?? null,
		get confidenceMetric() { return confidence?.status === 'scored' ? confidence.metric : null; },
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
	const itemFlags = $derived(item ? byAttention(index.byNode.get(item.id) ?? []) : []);
	const itemScore = $derived(item ? scores.get(item.id) ?? null : null);
	// Lowest first; symbols when any were scored, otherwise files.
	const scored = $derived.by(() => {
		if (confidence?.status !== 'scored') return [];
		const symbols = confidence.nodes.filter(node => byId.get(node.nodeId)?.kind === 'symbol');
		return (symbols.length ? symbols : confidence.nodes.filter(node => byId.has(node.nodeId))).slice(0, 6);
	});
	const nodeName = (id: string) => { const node = byId.get(id); return !node ? id : node.kind === 'symbol' ? symbolLabel(node, false) : node.label; };
	const tokenText = (text: string) => text.trim() ? text : JSON.stringify(text);
	const flagPlace = (flag: AgentFlag) => flag.symbol ? `${flag.path} › ${flag.symbol}` : flag.path;
	const lineClass = (line: string) => line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add'
		: line.startsWith('-') && !line.startsWith('---') ? 'del' : '';
</script>

{#snippet flagEntry(flag: AgentFlag, linked: boolean)}
	<li class="flag flag-{attention(flag)}">
		<p class="flag-head"><span class="flag-kind">{flagLabels[flag.kind]}</span><span>{flag.confidence} confidence</span></p>
		{#if linked}
			{#if flag.nodeId}<button type="button" class="flag-place" onclick={() => { selected = flag.nodeId; }}>{flagPlace(flag)}</button>
			{:else}<p class="flag-place">{flagPlace(flag)}</p>{/if}
		{/if}
		<p class="flag-reason">{flag.reason}</p>
		{#if flag.alternatives}<p class="flag-alternatives">Alternatives: {flag.alternatives}</p>{/if}
	</li>
{/snippet}

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
			{#if itemFlags.length}
				<ul class="flags">
					{#each itemFlags as flag (flag.id)}{@render flagEntry(flag, false)}{/each}
				</ul>
			{/if}
			{#if itemScore}
				<div class="confidence" class:unusual={isUnusual(itemScore)}>
					<p class="confidence-head"><span>Edit confidence</span><strong>{percent(itemScore.confidence)}</strong></p>
					<p class="confidence-note">{confidence?.status === 'scored' ? metricLabels[confidence.metric] : ''} over {itemScore.tokens} token{itemScore.tokens === 1 ? '' : 's'}{#if itemScore.adjusted !== null} · {isUnusual(itemScore) ? 'unusually uncertain' : 'typical'} for its size ({percent(itemScore.adjusted)}){/if}</p>
					<p class="confidence-note">Least sure at line {itemScore.weakest.line}: <code>{tokenText(itemScore.weakest.text)}</code> at {percent(itemScore.weakest.probability)}</p>
					{#if itemScore.weakest.alternatives.length}
						<ul class="alternatives">
							{#each itemScore.weakest.alternatives as option, position (position)}<li><code>{tokenText(option.text)}</code><span>{percent(option.probability)}</span></li>{/each}
						</ul>
					{/if}
				</div>
			{/if}
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
			{#if flags.length}
				<p class="eyebrow">Review flags · {flags.length}</p>
				<ul class="flags">
					{#each byAttention(flags) as flag (flag.id)}{@render flagEntry(flag, true)}{/each}
				</ul>
			{/if}
			{#if scored.length}
				<p class="eyebrow">Edit confidence · least sure first</p>
				<ul class="confidence-list">
					{#each scored as score (score.nodeId)}
						<li><button type="button" class:unusual={isUnusual(score)} onclick={() => { selected = score.nodeId; }}><span>{nodeName(score.nodeId)}</span><strong>{percent(score.confidence)}</strong></button></li>
					{/each}
				</ul>
			{:else if confidence?.status === 'unavailable'}
				<p class="note">Edit confidence: {confidence.reason}</p>
			{/if}
			<p class="eyebrow">Details</p>
			<p class="note">Select a file or symbol to see its diff and what it is connected to. Code that uses something sits above it. Badges mark what the change added, modified or removed, including connections; removed connections are dashed.</p>
			<ul class="legend">
				<li><span class="glyph">fn</span>function or method</li>
				<li><span class="glyph">()=&gt;</span>arrow function</li>
				<li><span class="glyph">new</span>constructor</li>
				<li><span class="change change-added">added</span><span class="change change-modified">modified</span><span class="change change-deleted">removed</span></li>
				<li><span class="flag-swatch flag-high"></span><span class="flag-swatch flag-medium"></span><span class="flag-swatch flag-low"></span>review flag, stronger = needs more attention</li>
				<li>{#each [0.3, 0.6, 0.9] as level (level)}<span class="conf-swatch" style:--alpha={tintAlpha(level)}></span>{/each}edit confidence, stronger = less sure; rings on edits, classes and files (lowest of their edits)</li>
				<li><span class="conf-mark"><Split size={12} class="branching" /></span>low confidence: an edit below {percent(ringBelow)}, with its least sure token</li>
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
	/* Edit confidence: neutral by default; a node unusually uncertain for its size gets the modified hue. */
	.confidence { margin: 0 0 14px; padding: 8px 10px; border: 1px solid var(--border); font: 400 11px/1.5 var(--font-mono); }
	.confidence.unusual { border-color: var(--modified); }
	.confidence p { margin: 0; }
	.confidence-head { display: flex; justify-content: space-between; align-items: baseline; color: var(--text-muted); }
	.confidence-head strong { color: var(--text); font-size: 15px; font-weight: 600; }
	.confidence.unusual .confidence-head strong { color: var(--modified); }
	.confidence-note { margin-top: 4px !important; color: var(--text-subtle); overflow-wrap: anywhere; }
	.confidence code, .alternatives code { color: var(--text); white-space: pre; }
	.alternatives { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 2px; }
	.alternatives li { display: flex; justify-content: space-between; gap: 10px; color: var(--text-subtle); }
	.confidence-list { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 4px; }
	.confidence-list button { width: 100%; display: flex; justify-content: space-between; gap: 10px; padding: 6px 10px; border: 1px solid var(--border); text-align: left; font: 400 11px/1.4 var(--font-mono); color: var(--text-muted); }
	.confidence-list button:hover { border-color: var(--border-strong); color: var(--text); }
	.confidence-list span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.confidence-list strong { color: var(--text); font-weight: 600; }
	.confidence-list .unusual strong { color: var(--modified); }
	.canvas > .note { padding: 20px; }
	.diff { margin: 0; padding: 10px 0; border: 1px solid var(--border); background: var(--bg); font: 11px/1.6 var(--font-mono); overflow: auto; white-space: pre; }
	.diff span { display: block; padding: 0 10px; min-height: 1.6em; color: var(--text-muted); }
	.diff .add { background: var(--added-bg); color: #bbf7d0; }
	.diff .del { background: var(--deleted-bg); color: #fecaca; }
	.diff .hunk { background: var(--info-bg); color: var(--info); }
	.flags { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 8px; }
	.flag { padding: 8px 10px; background: rgba(var(--flag-rgb), var(--flag-tint)); box-shadow: inset 2px 0 0 rgba(var(--flag-rgb), var(--flag-accent)); }
	.flag-high { --flag-tint: .2; --flag-accent: 1; }
	.flag-medium { --flag-tint: .12; --flag-accent: .7; }
	.flag-low { --flag-tint: .06; --flag-accent: .45; }
	.flag p { margin: 0; }
	.flag-head { display: flex; justify-content: space-between; gap: 8px; color: var(--text-subtle); font: 400 10.5px/1.5 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; }
	.flag-kind { color: rgb(var(--flag-rgb)); font-weight: 600; }
	.flag-place { display: block; margin: 4px 0 0; padding: 0; color: var(--text-muted); font: 400 11px/1.5 var(--font-mono); text-align: left; overflow-wrap: anywhere; }
	button.flag-place { text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
	button.flag-place:hover { color: var(--text); }
	.flag-reason { margin-top: 6px !important; color: var(--text); font: 400 12.5px/1.5 var(--font-sans); }
	.flag-alternatives { margin-top: 4px !important; color: var(--text-muted); font: 400 11px/1.5 var(--font-mono); }
	.legend { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; color: var(--text-muted); font: 400 11px/1.5 var(--font-mono); }
	.legend li { display: flex; align-items: center; gap: 8px; }
	.flag-swatch { width: 14px; height: 14px; background: rgba(var(--flag-rgb), var(--flag-tint)); box-shadow: inset 2px 0 0 rgba(var(--flag-rgb), var(--flag-accent)); }
	.legend li .flag-swatch + .flag-swatch { margin-left: -6px; }
	.conf-swatch { flex-shrink: 0; width: 14px; height: 10px; border: 1px solid var(--border); background: rgba(var(--confidence-rgb), var(--alpha)); }
	.legend li .conf-swatch + .conf-swatch { margin-left: -6px; }
	.conf-mark :global(svg.branching) { transform: rotate(90deg); }
	.conf-mark { display: inline-flex; flex-shrink: 0; padding: 1px 3px; border: 1px solid rgb(var(--confidence-rgb)); background: color-mix(in srgb, rgb(var(--confidence-rgb)) 16%, var(--bg)); color: rgb(var(--confidence-rgb)); }
	.glyph { display: inline-flex; justify-content: center; min-width: 30px; padding: 0 3px; border: 1px solid var(--border); color: var(--info); font: 500 9.5px/16px var(--font-mono); }
	@media (max-width: 900px) {
		.graph-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(420px, 1fr) auto; height: auto; }
		.canvas { height: 64vh; }
		.details { border-left: 0; border-top: 1px solid var(--border); max-height: 50vh; }
	}
</style>
