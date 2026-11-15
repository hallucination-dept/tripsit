<script lang="ts">
  import { projectImpactGraph, mentionsNode } from '#lib/impact-graph.ts';
  import type { ImpactGraph as Graph, ImpactNode } from '#lib/server/impact.ts';
  import type { PacketReview } from '#lib/server/packet.ts';

  let { graph, affected = [], claims = [], advice = [] }: {
    graph: Graph; affected?: Array<{ node: ImpactNode; distance: number }>;
    claims?: PacketReview[]; advice?: Array<{ id: string; text: string }>;
  } = $props();
  const componentId = $props.id();
  const marker = `${componentId}-arrow`;
  let revision = $state<'candidate' | 'base' | 'all'>('candidate');
  let affectedOnly = $state(true);
  let query = $state('');
  let selectedId = $state<string | null>(null);
  let currentRevision = $state('');
  const projection = $derived(projectImpactGraph(graph, affected, { revision, affectedOnly, query, selectedId }));
  const selected = $derived(projection.nodes.find(point => point.node.id === selectedId) ?? projection.nodes[0] ?? null);
  const nodesById = $derived(new Map(graph.nodes.map(node => [node.id, node])));
  const mentions = $derived(new Set(projection.nodes.filter(point => advice.some(review => mentionsNode(review.text, point.node))
    || claims.some(review => review.claims.some(claim => claim.nodeIds?.includes(point.node.id)))).map(point => point.node.id)));
  const linkedAdvice = $derived(selected ? advice.filter(review => mentionsNode(review.text, selected.node)) : []);
  const linkedClaims = $derived(selected ? claims.flatMap(review => review.claims.filter(claim => claim.nodeIds?.includes(selected.node.id))
    .map(claim => ({ ...claim, reviewId: review.id }))) : []);
  const dependencies = $derived(selected ? graph.edges.filter(edge => edge.from === selected.node.id) : []);
  const dependents = $derived(selected ? graph.edges.filter(edge => edge.to === selected.node.id) : []);
  const name = (node: ImpactNode) => node.source?.path.split('/').pop() ?? node.checkId ?? node.kind;
  const label = (text: string) => text.replaceAll('_', ' ');
  function reveal(id: string | null) {
    const node = id && nodesById.get(id);
    if (!node) return;
    selectedId = node.id; query = ''; affectedOnly = false;
    revision = node.source?.revision ?? 'all';
  }
  $effect(() => {
    const identity = `${graph.revision.baseSha}:${graph.revision.headSha ?? graph.revision.candidateDigest}`;
    if (identity !== currentRevision) {
      currentRevision = identity; selectedId = null; query = ''; affectedOnly = true;
      revision = graph.nodes.some(node => node.source?.revision === 'candidate') ? 'candidate' : 'base';
    }
  });
</script>

<div class="impact-map">
  <header class="map-heading"><h4>Dependency map</h4><span class="static-tag">Static relationships</span></header>
  <p class="description">Arrows point from a caller or importer to its dependency. Select a node to inspect its source and review advice.</p>
  <div class="toolbar">
    <label class="search">Find source <input type="search" bind:value={query} placeholder="Path, node or byte offset" /></label>
    <label>Revision <select bind:value={revision}><option value="candidate">Candidate</option><option value="base">Base</option><option value="all">Both</option></select></label>
    <label class="toggle"><input type="checkbox" bind:checked={affectedOnly} /> Affected only</label>
  </div>
  <div class="legend" aria-label="Graph legend"><span><i class="changed-key"></i>Changed</span><span><i class="downstream-key"></i>Downstream</span><span><i class="mention-key"></i>Mentioned in review</span><span><i class="call-key"></i>Lexical call</span><span><i class="import-key"></i>Import / other</span><span><i class="uncertain-key"></i>Inferred / unresolved</span></div>
  <p class="counts" role="status">{projection.nodes.length} shown · {projection.totalNodes} supplied · {projection.omittedNodes} omitted by display limit · {projection.hiddenNodes} filtered out</p>
  {#if projection.nodes.length}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable graph region needs a keyboard scroll target.) -->
    <div class="viewport" role="region" aria-label="Scrollable dependency graph. Tab to a node and press Enter to inspect it." tabindex="0">
      <div class="canvas" style:width={`${projection.width}px`} style:height={`${projection.height}px`}>
        <svg width={projection.width} height={projection.height} aria-hidden="true">
          <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#8496a9" /></marker></defs>
          {#each projection.edges as relationship (relationship.edge.id)}
            <path d={relationship.path} marker-end={`url(#${marker})`} class="edge"
              class:call={relationship.edge.relationship.includes('call')}
              class:uncertain={relationship.edge.resolution !== 'observed'}
              class:connected={relationship.edge.from === selected?.node.id || relationship.edge.to === selected?.node.id}
              class:dimmed={selected && relationship.edge.from !== selected.node.id && relationship.edge.to !== selected.node.id} />
          {/each}
        </svg>
        {#each projection.columns as column}<span class="column-label" style:left={`${column.x}px`}>{column.label}</span>{/each}
        {#each projection.nodes as point (point.node.id)}
          <button type="button" class="node" class:changed={point.status === 'changed'} class:downstream={point.status === 'downstream'}
            class:selected={point.node.id === selected?.node.id} class:mentioned={mentions.has(point.node.id)}
            style:left={`${point.x}px`} style:top={`${point.y}px`} onclick={() => { selectedId = point.node.id; }}
            aria-pressed={point.node.id === selected?.node.id} aria-label={`${point.node.source?.path ?? point.node.id}, ${point.node.kind}, ${point.status}, ${point.node.source?.revision ?? 'no source revision'}${mentions.has(point.node.id) ? ', mentioned in review' : ''}`}
            title={point.node.source?.path ?? point.node.id} data-node-id={point.node.id}>
            <strong>{name(point.node)}</strong><span class="node-meta">{point.node.kind} · {point.node.source?.revision ?? 'context'}{point.node.source ? ` · ${point.node.source.start}–${point.node.source.end}` : ''}</span>
            {#if mentions.has(point.node.id)}<span class="mention-label">Mentioned in review</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {:else}<p class="empty">No nodes match these filters. Clear the search or include other context to explore the supplied graph.</p>{/if}
  <p class="counts">{projection.edges.length} of {projection.totalEdges} relationships drawn · {projection.unresolvedEdges} unresolved. Display omissions do not reduce the assessment’s reported impact.</p>
  {#if selected}
    <section class="node-details" aria-label="Selected graph node">
      <header><div><p class="eyebrow">Selected {selected.node.kind}</p><h5>{selected.node.source?.path ?? selected.node.id}</h5></div><span class="status-tag">{selected.status}{selected.distance !== null && selected.distance > 0 ? ` · distance ${selected.distance}` : ''}</span></header>
      <p class="sr-only" role="status" aria-live="polite">Inspecting {selected.node.source?.path ?? selected.node.id}, {selected.node.source?.revision ?? selected.node.kind}.</p>
      <dl>
        {#if selected.node.source}<dt>Frozen source</dt><dd>{selected.node.source.revision} · UTF-8 bytes {selected.node.source.start}–{selected.node.source.end} of {selected.node.source.byteLength}</dd><dt>Blob</dt><dd><code>{selected.node.source.blobSha}</code></dd>{/if}
        <dt>Extraction</dt><dd>{selected.node.extraction}</dd><dt>Node</dt><dd><code>{selected.node.id}</code></dd>
      </dl>
      <div class="relationships">
        <details><summary>Dependencies ({dependencies.length})</summary><ul>{#each dependencies.slice(0, 12) as edge}<li>{#if edge.to && nodesById.has(edge.to)}<button type="button" class="text-button" onclick={() => reveal(edge.to)}>{nodesById.get(edge.to)?.source?.path ?? edge.to}</button>{:else}<span>Unresolved target</span>{/if}<small>{label(edge.relationship)} · {edge.resolution}</small></li>{/each}</ul>{#if dependencies.length > 12}<p class="counts">{dependencies.length - 12} further relationships omitted from this list.</p>{/if}</details>
        <details><summary>Dependents ({dependents.length})</summary><ul>{#each dependents.slice(0, 12) as edge}<li><button type="button" class="text-button" onclick={() => reveal(edge.from)}>{nodesById.get(edge.from)?.source?.path ?? edge.from}</button><small>{label(edge.relationship)} · {edge.resolution}</small></li>{/each}</ul>{#if dependents.length > 12}<p class="counts">{dependents.length - 12} further relationships omitted from this list.</p>{/if}</details>
      </div>
      {#if linkedAdvice.length || linkedClaims.length}<div class="linked-advice"><h5>Review references</h5><p class="description">These references associate advice with a source location; they are model suggestions.</p>
        {#each linkedAdvice as review}<p class="advice-text">{review.text}</p>{/each}
        {#each linkedClaims as claim}<article><p><strong>{claim.id} · {claim.verdict}</strong></p><p class="advice-text">{claim.proposition}</p>{#if claim.counterexample}<p class="advice-text">Counterexample: {claim.counterexample}</p>{/if}</article>{/each}
      </div>{:else}<p class="description">No review advice explicitly references this node or its path.</p>{/if}
    </section>
  {/if}
  {#if advice.length}<details class="general-advice"><summary>General review advice ({advice.length})</summary><p class="description">Advice without an explicit source reference applies to the candidate as a whole.</p>{#each advice as review}<p class="advice-text">{review.text}</p>{/each}</details>{/if}
</div>

<style>
  .impact-map { min-width: 0; display: grid; gap: 10px; color: #243247; }
  .map-heading, .node-details header { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
  h4, h5, p { margin: 0; } h4 { font-size: 14px; } h5 { font-size: 12px; line-height: 1.6; }
  .description, .counts { color: #657187; font-size: 11px; line-height: 1.65; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
  label { display: grid; gap: 5px; font-size: 11px; font-weight: 600; color: #657187; }
  .search { flex: 1 1 180px; min-width: 0; }
  input[type='search'], select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #dce2ea; border-radius: 5px; background: #fff; color: #243247; padding: 8px 10px; font: inherit; font-size: 12px; height: 34px; }
  .toggle { display: flex; align-items: center; gap: 6px; min-height: 34px; white-space: nowrap; }
  .toggle input { accent-color: #3158bd; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 10px; color: #657187; }
  .legend span { display: inline-flex; gap: 5px; align-items: center; } .legend i { width: 8px; height: 8px; display: inline-block; border-radius: 2px; }
  .changed-key { background: #3158bd; } .downstream-key { background: #43817e; } .mention-key { background: #b1813a; }
  .legend .call-key, .legend .import-key { width: 15px; height: 0; border-top: 2px solid #527dc4; border-radius: 0; } .legend .import-key { border-color: #8496a9; } .legend .uncertain-key { width: 15px; height: 0; border-top: 2px dashed #8496a9; border-radius: 0; }
  .static-tag, .status-tag { font-size: 10px; background: #f0f4ff; color: #3158bd; border-radius: 4px; padding: 3px 7px; }
  .viewport { max-width: 100%; max-height: 390px; overflow: auto; border: 1px solid #dce2ea; border-radius: 7px; background: #f8fafc; overscroll-behavior: contain; }
  .canvas { position: relative; min-width: 100%; }
  svg { position: absolute; inset: 0; pointer-events: none; }
  .column-label { position: absolute; top: 13px; color: #718096; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  .edge { fill: none; stroke: #8496a9; stroke-width: 1.4; } .edge.call { stroke: #527dc4; } .edge.uncertain { stroke-dasharray: 4 3; } .edge.connected { stroke-width: 2.2; } .edge.dimmed { opacity: .3; }
  .node { position: absolute; box-sizing: border-box; width: 188px; height: 64px; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 8px 10px; border: 1px solid #dce2ea; border-left: 3px solid #a9b3c1; border-radius: 6px; background: #fff; color: #243247; font: inherit; cursor: pointer; box-shadow: 0 1px 2px #24324708; }
  .node strong { display: block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
  .node.changed { border-left-color: #3158bd; } .node.downstream { border-left-color: #43817e; } .node.selected { border-color: #3158bd; background: #f0f4ff; box-shadow: 0 0 0 1px #3158bd; }
  .node.mentioned:not(.selected) { border-top-color: #b1813a; } .node:hover { background: #f0f4ff; }
  .node-meta { font-size: 9px; color: #657187; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mention-label { color: #845718; font-size: 8px; line-height: 1; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .viewport:focus-visible { outline: 3px solid #9db5ef; outline-offset: 3px; }
  .node-details { border: 1px solid #dce2ea; border-radius: 7px; padding: 14px; min-width: 0; display: grid; gap: 10px; background: #fff; }
  .eyebrow { color: #657187; font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 3px; }
  dl { display: grid; grid-template-columns: 85px minmax(0, 1fr); gap: 6px; font-size: 11px; line-height: 1.6; margin: 0; } dt { color: #657187; } dd { margin: 0; min-width: 0; }
  code { font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; }
  .relationships { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  details { font-size: 11px; min-width: 0; border-top: 1px solid #e8ecf2; padding-top: 9px; } summary { color: #3158bd; cursor: pointer; line-height: 1.7; } details[open] summary { margin-bottom: 8px; }
  ul { list-style: none; margin: 0; padding: 0; } li { padding: 6px 0; font-size: 11px; } small { display: block; color: #657187; font-size: 10px; margin-top: 3px; }
  .text-button { font: inherit; color: #3158bd; padding: 0; border: 0; text-align: left; background: transparent; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .linked-advice { padding: 10px; background: #fafbfe; border-left: 2px solid #b1813a; display: grid; gap: 8px; min-width: 0; }
  .advice-text { white-space: pre-wrap; font-size: 11px; line-height: 1.8; margin-top: 8px; }
  .empty { border: 1px dashed #dce2ea; border-radius: 7px; padding: 20px; color: #657187; font-size: 12px; line-height: 1.7; }
  p, h5, code, dd, li, summary, .text-button { overflow-wrap: anywhere; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  @media (max-width: 480px) { .relationships { grid-template-columns: 1fr; } .node-details { padding: 11px; } dl { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 5px; } .viewport { max-height: 320px; } }
</style>
