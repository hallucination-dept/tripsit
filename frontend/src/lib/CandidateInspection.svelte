<script lang="ts">
  import { untrack } from 'svelte';
  import { createCandidateInspection } from '#lib/candidate-inspection.ts';

  let { owner, itemId, candidateId, baseSha, candidateDigest }: {
    owner: string; itemId: string; candidateId: string; baseSha: string; candidateDigest: string;
  } = $props();
  const controller = createCandidateInspection({ onChange: next => { inspection = next; } });
  let inspection = $state(controller.state);
  const matches = $derived(Boolean(owner && itemId && candidateId && baseSha && candidateDigest) && inspection.owner === owner && inspection.itemId === itemId
    && inspection.candidateId === candidateId && inspection.baseSha === baseSha && inspection.candidateDigest === candidateDigest);
  const view = $derived(matches ? inspection.assessment : null);
  const label = (value: unknown) => typeof value === 'string' ? value.replaceAll('_', ' ') : 'unavailable';

  $effect(() => {
    const selected = { owner, itemId, candidateId, baseSha, candidateDigest };
    untrack(() => { void controller.select(selected.owner, selected.itemId, selected.candidateId, selected.baseSha, selected.candidateDigest); });
    return () => untrack(() => controller.stop());
  });
</script>

<section class="inspection" aria-label="Candidate inspection">
  <header class="intro">
    <div><p class="eyebrow">Candidate inspection</p><h2>Impact, review &amp; evidence</h2></div>
    <span class="tag">Human inspection required</span>
  </header>
  <p class="notice">Trusted checks run only in an admitted disposable environment. Model proposals, static analysis and passing checks do not establish overall correctness or authorize a merge.</p>
  <p class="status" role="status" aria-live="polite">
    {#if !owner || !itemId || !candidateId || !baseSha || !candidateDigest}Select a candidate to inspect its frozen revision.
    {:else if !matches || inspection.loading}Loading candidate assessment…
    {:else if inspection.verifying}Running trusted checks in the admitted disposable runner…
    {:else if inspection.reviewing}Requesting independent proposals and refreshing the packet…
    {:else if view}Assessment loaded for the selected candidate.{/if}
  </p>
  {#if matches && inspection.error}<p class="error" role="alert">{inspection.error}</p>{/if}

  <section class="panel" aria-label="Downstream impact">
    <header class="panel-heading"><div><p class="eyebrow">01 · Impact</p><h3>Downstream context</h3></div>
      {#if view}<span class="count">{view.impact.impact.affected.length} affected nodes</span>{/if}
    </header>
    {#if view}
      <p class="muted">JavaScript and TypeScript static imports and validated lexical calls. Dynamic dispatch and unsupported languages remain explicit gaps.</p>
      {#if view.impact.coverage.languages}<details><summary>Language coverage</summary><ul class="items compact">{#each view.impact.coverage.languages as coverage}<li><strong>{coverage.language}</strong><p class="meta">Extraction: {coverage.extraction} · Resolution: {coverage.resolution} · Checks: {coverage.executableChecks}</p></li>{/each}</ul></details>{/if}
      <p class="meta">{view.impact.coverage.complete ? 'Supplied repository context loaded' : 'Partial repository context'} · TypeScript {view.impact.coverage.typescriptVersion} · execution not run</p>
      {#if view.impact.impact.affected.length}
        <div class="scroll">
          <ul class="items">
            {#each view.impact.impact.affected as affected}
              <li><div class="row"><code class="path">{affected.node.source?.path ?? affected.node.id}</code>
                <span class="tag">{affected.node.source?.revision ?? affected.node.kind}</span></div>
                <p class="meta">{affected.distance === 0 ? 'Changed node' : `Downstream distance ${affected.distance}`} · {affected.node.extraction}</p>
                <details><summary>Source and dependency references</summary>
                  <dl>
                    <dt>Node</dt><dd><code>{affected.node.id}</code></dd>
                    {#if affected.node.source}<dt>Frozen source</dt><dd>{affected.node.source.revision} bytes {affected.node.source.start}–{affected.node.source.end} of {affected.node.source.byteLength}<br /><code>{affected.node.source.blobSha}</code></dd>{/if}
                    <dt>Dependency</dt><dd><code>{affected.dependency ?? 'Changed origin'}</code></dd>
                    <dt>Traversal edge</dt><dd><code>{affected.viaEdge ?? 'No upstream edge at origin'}</code></dd>
                  </dl>
                </details>
              </li>
            {/each}
          </ul>
        </div>
      {:else}<p class="empty">No affected nodes were resolved from the supplied context. This leaves an inspection gap.</p>{/if}
      <details><summary>Import references ({view.impact.imports.length})</summary>
        {#if view.impact.imports.length}<ul class="items compact">
          {#each view.impact.imports as reference}<li><code>{reference.source.path}</code><p class="meta">{reference.source.revision} bytes {reference.source.start}–{reference.source.end} · {label(reference.reason)}</p>
            <p class="preserve">{reference.specifier ?? 'Dynamic or unresolved module reference'}</p><code class="meta">{reference.edgeId}</code></li>{/each}
        </ul>{:else}<p class="empty">No import references were extracted.</p>{/if}
      </details>
      <details><summary>Extraction and traversal gaps ({view.impact.gaps.length + view.impact.impact.gaps.length})</summary>
        <ul class="items compact">{#each view.impact.gaps as gap}<li><strong>{label(gap.kind)}</strong><p class="meta">{gap.path || 'Repository scope'}{gap.revision ? ` · ${gap.revision}` : ''}</p><p>{gap.detail}</p></li>{/each}
          {#each view.impact.impact.gaps as gap}<li><strong>{label(gap.kind)}</strong><p class="meta">{gap.reference}</p></li>{/each}</ul>
      </details>
    {:else}<p class="empty">Impact details appear after the selected assessment loads.</p>{/if}
  </section>

  <section class="panel" aria-label="Independent review">
    <header class="panel-heading"><div><p class="eyebrow">02 · Independent review</p><h3>Claims &amp; counterexamples</h3></div>
      <button type="button" onclick={() => void controller.review()} disabled={!view?.reviewerConfigured || !matches || inspection.loading || inspection.reviewing || inspection.verifying}>
        {matches && inspection.reviewing ? 'Reviewing…' : 'Request independent review'}
      </button>
    </header>
    <p class="muted">A review is requested only when you press the button. Claims and suggested checks are model proposals, not execution evidence.</p>
    {#if view && !view.reviewerConfigured}<p class="empty">Independent reviewer unavailable. A provider and model must be configured on the server.</p>
    {:else if view}<p class="meta">Reviewer configured. A request sends this candidate’s context to the configured provider.</p>{/if}
    {#if matches && inspection.reviewError}<p class="error" role="alert">{inspection.reviewError}</p>{/if}
    {#if view?.reviews.length}
      <div class="review-history">
        {#each [...view.reviews].reverse() as review}
          <article class="review-entry">
            <header class="row"><strong>Review · {new Date(review.createdAt).toLocaleString()}</strong><span class="tag">{review.result.status === 'completed' ? 'Model proposals' : 'Unavailable'}</span></header>
            {#if review.result.status === 'unavailable'}<p class="empty">{review.result.reason}</p>
            {:else}
              <p class="meta">{review.result.model} · {review.result.destination}</p><p class="meta">Retention disclosure: {review.result.retentionDisclosure}</p>
              {#if review.result.claims.length}<ul class="items">
                {#each review.result.claims as claim}<li>
                  <div class="row"><strong>{claim.id}</strong><span class="tag" class:contradicts={claim.stance === 'contradicts'}>{claim.stance}</span></div>
                  <p class="preserve">{claim.statement}</p>
                  {#if claim.counterexample}<p class="counterexample preserve"><strong>Counterexample</strong><br />{claim.counterexample}</p>{/if}
                  <p class="meta">Requirements: {claim.requirementIds.join(', ') || 'None linked'}<br />Nodes: {claim.nodeIds.join(', ') || 'No specific node linked'}</p>
                </li>{/each}
              </ul>{:else}<p class="empty">This model response proposed no claims.</p>{/if}
              <details><summary>Suggested checks ({review.result.checks.length}) · not executed</summary>
                <ul class="items compact">{#each review.result.checks as check}<li><strong>{check.id}</strong><p class="preserve">{check.description}</p>
                  <p class="meta">Requirements: {check.requirementIds.join(', ')}<br />Nodes: {check.nodeIds.join(', ') || 'No specific node linked'}</p></li>{/each}</ul>
                {#if !review.result.checks.length}<p class="empty">No checks were proposed.</p>{/if}
              </details>
            {/if}
            <details><summary>Review identity and digests</summary><dl><dt>Artifact</dt><dd><code>{review.id}</code></dd><dt>Digest</dt><dd><code>{review.digest}</code></dd>
              {#if review.result.status === 'completed'}<dt>Prompt</dt><dd><code>{review.result.promptDigest}</code></dd><dt>Response</dt><dd><code>{review.result.responseDigest}</code></dd>{/if}</dl></details>
          </article>
        {/each}
      </div>
    {:else}<p class="empty">No stored independent review for this candidate.</p>{/if}
  </section>

  <section class="panel" aria-label="Review packet">
    <header class="panel-heading"><div><p class="eyebrow">03 · Evidence packet</p><h3>Requirements &amp; remaining gaps</h3></div><button type="button" onclick={() => void controller.verify()} disabled={!view?.verificationConfigured || !matches || inspection.loading || inspection.reviewing || inspection.verifying}>{matches && inspection.verifying ? 'Running checks…' : 'Run trusted checks'}</button></header>
    {#if view}
      <p class="muted">{view.packet.impact.summary}</p>
      <p class="notice">{view.packet.tokenSignal.reason} · {view.packet.tokenSignal.observedTokens} observed tokens. Token observations are not correctness evidence.</p>
      {#if !view.verificationConfigured}<p class="empty">Controlled verification requires an admitted runner and trusted checks pinned to this repository and base revision.</p>{/if}
      {#if view.packet.executions.length}<div class="executions"><h4>Recorded check executions</h4><ul class="items">{#each view.packet.executions as execution}<li><div class="row"><strong>{execution.checkId}</strong><span class="tag" class:contradicts={execution.result === 'failed'}>{label(execution.result)} · {label(execution.evidenceStatus)}</span></div><p class="meta">{label(execution.status)} · {execution.executedTests} exercised cases · exit {execution.exitCode ?? 'unavailable'}</p><details><summary>Requirement and source trace</summary><p class="meta">Execution: {execution.id}<br />Runner: {execution.runnerId}</p>{#each view.packet.checkDefinitions.filter(check => check.id === execution.checkId && ['definitionDigest', 'oracleDigest', 'environmentDigest', 'dependencyDigest'].every(key => check[key as keyof typeof check] === execution[key as keyof typeof execution])) as check}<p class="meta">Requirements: {check.requirementIds.join(', ')}<br />Nodes: {check.nodeIds.join(', ') || 'No resolved node'}</p>{#each view.impact.graph.nodes.filter(node => check.nodeIds.includes(node.id)) as node}<p class="meta">{node.source?.path} · {node.source?.revision} bytes {node.source?.start}–{node.source?.end}<br /><code>{node.source?.blobSha}</code></p>{/each}{/each}<p class="meta">Recorded check: {execution.definitionDigest}<br />Recorded oracle: {execution.oracleDigest}<br />Recorded environment: {execution.environmentDigest}<br />Recorded dependencies: {execution.dependencyDigest}</p></details></li>{/each}</ul></div>{/if}
      {#if view.dispatchPlan}<details><summary>Last dispatched plan</summary><p class="meta">Mandatory: {view.dispatchPlan.mandatory.map(check => check.id).join(', ') || 'None'}<br />Optional: {view.dispatchPlan.selected.map(check => check.id).join(', ') || 'None'}<br />Omitted: {view.dispatchPlan.omitted.map(check => check.id).join(', ') || 'None'}</p></details>{/if}
      {#if view.packet.evidenceReuse.length}<details><summary>Evidence reuse assessment</summary><ul class="items compact">{#each view.packet.evidenceReuse as reuse}<li><strong>{reuse.executionId} · {reuse.status}</strong><p>{reuse.reason}</p></li>{/each}</ul></details>{/if}
      {#if !view.packet.executions.length}<p class="empty">Verification unavailable: no controlled check execution is recorded. Suggested checks have not been run.</p>{/if}
      {#if view.packet.requirementCoverage.length}<ul class="items">
        {#each view.packet.requirementCoverage as requirement}<li>
          <div class="row"><strong>{requirement.id}</strong><span class="tag">{label(requirement.status)}</span></div>
          <p class="preserve">{requirement.criterion}</p>
          <p class="meta">{requirement.mandatory ? 'Mandatory' : 'Expectation'} · {label(requirement.provenance)} · {label(requirement.applicability)}</p>
          <details><summary>Applicability and verification</summary><p>{requirement.reason}</p><p>{requirement.verification}</p>
            <p class="meta">Source: {requirement.source.name} {requirement.source.version}<br />{requirement.source.url}</p>
            <p class="meta">Checks: {requirement.checkIds.join(', ') || 'Missing'}<br />Executions: {requirement.executionIds.join(', ') || 'Unavailable'}</p>
          </details>
        </li>{/each}
      </ul>{:else}<p class="empty">Requirement coverage is unavailable.</p>{/if}
      {#if view.packet.conflicts.length}<div class="conflicts"><h4>Conflicting evidence remains open</h4><ul>{#each view.packet.conflicts as conflict}<li><strong>{conflict.requirementId}</strong><p class="meta">Claims: {conflict.claimIds.join(', ')}<br />Executions: {conflict.executionIds.join(', ') || 'None recorded'}</p></li>{/each}</ul></div>{/if}
      <details><summary>Next verification plan · {view.packet.checkPlan.mandatory.length} mandatory, {view.packet.checkPlan.selected.length} optional, {view.packet.checkPlan.omitted.length} omitted</summary>
        <p class="meta">Optional cap: {view.packet.checkPlan.budget.optionalChecks} checks · {view.packet.checkPlan.budget.perCheckMs / 1000}s per check · {view.packet.checkPlan.budget.totalMs / 1000}s total. Mandatory checks are outside this budget.</p>
        <ul class="items compact">{#each [...view.packet.checkPlan.mandatory, ...view.packet.checkPlan.selected, ...view.packet.checkPlan.omitted] as check}<li><strong>{check.id}</strong><p class="meta">{check.reasons.map(label).join(' · ')}</p></li>{/each}</ul>
      </details>
      <details open><summary>Packet gaps ({view.packet.gaps.length})</summary><ul class="items compact">{#each view.packet.gaps as gap}<li><strong>{label(gap.kind)}</strong><p class="meta">{gap.reference}</p></li>{/each}</ul>
        {#if !view.packet.gaps.length}<p class="empty">No listed gaps; this is still not a human acceptance decision.</p>{/if}
      </details>
      <div class="human"><h4>Human inspection</h4><ul>{#each view.packet.humanInspection.reasons as reason}<li>{reason}</li>{/each}</ul><p class="meta">This packet is not acceptance-ready and does not approve a merge.</p></div>
      <details><summary>Frozen packet identity</summary><dl><dt>Base</dt><dd><code>{view.identity.baseSha}</code></dd><dt>Candidate digest</dt><dd><code>{view.identity.candidateDigest}</code></dd><dt>Snapshot digest</dt><dd><code>{view.identity.snapshotDigest}</code></dd><dt>Policy</dt><dd>{view.identity.policyVersion}</dd><dt>Packet digest</dt><dd><code>{view.packet.packetDigest}</code></dd></dl></details>
    {:else}<p class="empty">The packet appears after this candidate’s assessment loads.</p>{/if}
  </section>
</section>

<style>
  .inspection { min-width: 0; display: grid; gap: 14px; color: #243247; font: inherit; }
  .intro, .panel-heading, .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .intro { padding-top: 10px; }
  h2, h3, h4, p { margin: 0; } h2 { font-size: 19px; line-height: 1.4; } h3 { font-size: 16px; } h4 { font-size: 14px; }
  .eyebrow { color: #657187; font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; margin-bottom: 4px; }
  .panel { background: #fff; border: 1px solid #dce2ea; border-radius: 10px; padding: 18px; display: grid; gap: 12px; min-width: 0; }
  .tag, .count { font-size: 11px; line-height: 1.5; color: #3158bd; background: #f0f4ff; border: 1px solid #dbe4fb; border-radius: 5px; padding: 3px 7px; max-width: 100%; overflow-wrap: anywhere; }
  .count { border: 0; background: #f4f6f9; color: #657187; }
  .tag.contradicts { color: #845718; background: #fff8eb; border-color: #ebd8ad; }
  .notice, .human, .conflicts { background: #f4f6f9; padding: 12px 14px; border-radius: 6px; border-left: 3px solid #3158bd; font-size: 12px; line-height: 1.65; }
  .conflicts { border-left-color: #b1813a; }
  .muted, .empty, .status { color: #657187; font-size: 12px; line-height: 1.7; }
  .meta { color: #657187; font-size: 11px; line-height: 1.7; margin-top: 4px; }
  .error { padding: 10px 12px; border: 1px solid #ebc5c5; background: #fff6f6; color: #983d3d; font-size: 12px; border-radius: 6px; }
  button { border: 1px solid #3158bd; background: #3158bd; color: #fff; border-radius: 6px; padding: 9px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; max-width: 100%; }
  button:hover:not(:disabled) { background: #274ba8; } button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #9db5ef; outline-offset: 3px; }
  details { min-width: 0; border-top: 1px solid #e8ecf2; padding-top: 10px; font-size: 12px; line-height: 1.7; }
  summary { cursor: pointer; color: #3158bd; font-size: 12px; padding: 2px 0; } details[open] > summary { margin-bottom: 10px; }
  .items { list-style: none; padding: 0; margin: 0; display: grid; min-width: 0; }
  .items > li { padding: 12px 0; border-bottom: 1px solid #e8ecf2; min-width: 0; font-size: 12px; line-height: 1.7; }
  .items > li:last-child { border-bottom: 0; } .compact > li { padding: 9px 0; }
  .review-history { display: grid; gap: 14px; min-width: 0; } .review-entry { padding: 12px; background: #fafbfe; border: 1px solid #e3e8f0; border-radius: 7px; min-width: 0; }
  .review-entry > details { margin-top: 10px; } .review-entry > header { font-size: 12px; }
  .counterexample { padding: 9px 12px; background: #f4f6f9; border-left: 2px solid #c9d5eb; margin-top: 8px; }
  .preserve { white-space: pre-wrap; } .scroll { max-height: 360px; overflow: auto; min-width: 0; padding: 0 4px; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; } .path { color: #293b5d; }
  p, code, dd, li, summary, strong { overflow-wrap: anywhere; } dl { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 8px; margin: 0; font-size: 11px; }
  dt { color: #657187; } dd { margin: 0; min-width: 0; } .human ul, .conflicts ul { margin: 8px 0 0; padding-left: 18px; }
  @media (max-width: 480px) { .panel { padding: 14px; } .panel-heading { align-items: flex-start; } .panel-heading button { width: 100%; } dl { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 7px; } }
</style>
