<script lang="ts">
  import { onDestroy } from 'svelte';
  let { itemId, candidateId, baseSha, candidateDigest }: { itemId: string; candidateId: string; baseSha: string; candidateDigest: string } = $props();
  let packet = $state<{ id: string; packetDigest: string; packet: { candidateCommit: string; acceptanceReady: boolean; identity: { baseSha: string; candidateDigest: string }; gaps: Array<{kind:string;reference:string}>; requirementCoverage: Array<{id:string;criterion:string;status:string}> } } | null>(null);
  let history = $state<Array<{id:string;decision:string;inspection:string;uncheckedScope:string;residualRisk:string;createdAt:string}>>([]);
  let inspection = $state(''), uncheckedScope = $state(''), residualRisk = $state('');
  let decision = $state<'revise' | 'escalate'>('revise');
  let error = $state(''), success = $state(''), busy = $state(false);
  let publicationUrl = $state('');
  let requestId = $state(crypto.randomUUID());
  const controller = new AbortController();
  onDestroy(() => controller.abort());
  const path = $derived(`/api/work-items/${encodeURIComponent(itemId)}/candidates/${encodeURIComponent(candidateId)}`);
  async function post(url: string, value: unknown) {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result?.message === 'string' ? result.message : 'The request was unavailable.');
    return result;
  }
  async function loadHistory(id: string) {
    const response = await fetch(`${path}/packet/${encodeURIComponent(id)}/decisions`, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.decisions)) throw new Error('Decision history is unavailable.');
    history = data.decisions;
  }
  async function prepare() {
    busy = true; error = ''; success = ''; packet = null;
    try {
      const stage = await post(`${path}/stage`, {});
      const result = await post(`${path}/packet`, {});
      if (stage?.stage?.candidateCommit !== result?.packet?.candidateCommit || result?.packet?.identity?.baseSha !== baseSha
        || result?.packet?.identity?.candidateDigest !== candidateDigest || result?.packet?.acceptanceReady !== false
        || !Array.isArray(result?.packet?.gaps) || !Array.isArray(result?.packet?.requirementCoverage)) throw new Error('The frozen packet does not match the selected revision.');
      await loadHistory(result.id);
      packet = result; requestId = crypto.randomUUID();
    } catch (cause) { if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'The packet is unavailable.'; }
    finally { busy = false; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (!packet) return;
    busy = true; error = ''; success = '';
    try {
      const result = await post(`${path}/packet/${encodeURIComponent(packet.id)}/decisions`, { requestId, decision, inspection, uncheckedScope, residualRisk });
      if (result?.decision?.packetDigest !== packet.packetDigest || result?.decision?.candidateCommit !== packet.packet.candidateCommit
        || result?.decision?.decision !== decision) throw new Error('The recorded decision did not match the frozen packet.');
      await loadHistory(packet.id);
      success = `Recorded ${decision} for this frozen revision.`; requestId = crypto.randomUUID(); inspection = ''; uncheckedScope = ''; residualRisk = '';
    } catch (cause) { if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'The decision is unavailable.'; }
    finally { busy = false; }
  }
  async function publish() {
    if (!packet) return;
    busy = true; error = ''; publicationUrl = '';
    try {
      const result = await post(`${path}/packet/${encodeURIComponent(packet.id)}/publish`, {});
      if (result?.publication?.commit !== packet.packet.candidateCommit || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(result?.publication?.url)) throw new Error('Publication did not match the frozen revision.');
      publicationUrl = result.publication.url;
    } catch (cause) { if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'Publication is unavailable.'; }
    finally { busy = false; }
  }
</script>

<section class="human-decision" aria-label="Record human decision">
  <h3>Record a human decision</h3>
  <p>Acceptance is unavailable until required evidence and inspection are verified. You can request a revision or escalate.</p>
  <button type="button" onclick={prepare} disabled={busy}>Prepare frozen packet</button>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if success}<p role="status">{success}</p>{/if}
  {#if packet}
    <p>Frozen commit: <code>{packet.packet.candidateCommit}</code></p>
    <details open><summary>Requirements in this packet</summary>
      <ul>{#each packet.packet.requirementCoverage as requirement}<li>{requirement.criterion} — {requirement.status.replaceAll('_', ' ')}</li>{/each}</ul>
    </details>
    <details><summary>Evidence gaps ({packet.packet.gaps.length})</summary>
      <ul>{#each packet.packet.gaps as gap}<li>{gap.kind.replaceAll('_', ' ')}: {gap.reference}</li>{/each}</ul>
    </details>
    {#if history.length}<details><summary>Recorded decisions ({history.length})</summary><ul>{#each history as entry}
      <li><strong>{entry.decision}</strong> — {entry.createdAt}<p>Inspection: {entry.inspection}</p><p>Unchecked: {entry.uncheckedScope}</p><p>Residual risk: {entry.residualRisk}</p></li>
    {/each}</ul></details>{/if}
    <button type="button" onclick={publish} disabled={busy || !history.some(entry => entry.decision === 'accept')}>Publish implementation PR</button>
    {#if publicationUrl}<p>Pull request: <a href={publicationUrl} target="_blank" rel="noreferrer">Open on GitHub</a>. Merge protection remains unverified.</p>{/if}
    <form onsubmit={submit}>
      <label>Decision <select bind:value={decision}><option value="revise">Request revision</option><option value="escalate">Escalate</option></select></label>
      <label>Completed inspection <textarea bind:value={inspection} required maxlength="4096"></textarea></label>
      <label>Unchecked scope and why <textarea bind:value={uncheckedScope} required maxlength="4096"></textarea></label>
      <label>Residual risk <textarea bind:value={residualRisk} required maxlength="4096"></textarea></label>
      <button type="submit" disabled={busy}>Record decision</button>
    </form>
  {/if}
</section>

<style>
  .human-decision { margin-top: 1rem; padding: 1rem; border: 1px solid #cbd5e1; border-radius: .5rem; }
  form, label { display: grid; gap: .5rem; } form { margin-top: 1rem; } textarea { min-height: 4rem; width: 100%; } code { overflow-wrap: anywhere; }
</style>
