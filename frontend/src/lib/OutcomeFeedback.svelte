<script lang="ts">
 let {itemId,candidateId,files,repository}:{itemId:string;candidateId:string;files:Array<{path:string}>;repository:string}=$props();
 let data=$state<{decisions:Array<{id:string;packet_id:string;commit_sha:string;decision:string}>;findings:Array<{area:string;kind:string;severity:string;evidence_issue:number;commit_sha:string}>;scrutiny:Array<{area:string;severity:string;evidence_issue:number;commit_sha:string}>;historyTruncated:boolean;areaCoverage:string}|null>(null);
 let decision=$state(''),area=$state(''),kind=$state('escape'),severity=$state('medium'),evidenceIssue=$state(1),error=$state(''),busy=$state(false);
 let requestId=$state('');
 const path=$derived(`/api/work-items/${encodeURIComponent(itemId)}/candidates/${encodeURIComponent(candidateId)}/outcomes`);
 $effect(()=>{const url=path;const controller=new AbortController();void fetch(url,{signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Outcome feedback is unavailable.');data=await r.json();}).catch(()=>{if(!controller.signal.aborted)error='Outcome feedback is unavailable.';});return()=>controller.abort();});
 async function submit(event:SubmitEvent){event.preventDefault();const selected=data?.decisions.find(row=>row.id===decision);if(!selected)return;busy=true;error='';
  try {if(!requestId)requestId=crypto.randomUUID();const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,packetId:selected.packet_id,decisionId:selected.id,area,kind,severity,evidenceIssue:Number(evidenceIssue)})});if(!response.ok)throw Error();requestId='';const updated=await fetch(path,{cache:'no-store'});if(!updated.ok)throw Error();data=await updated.json();}
  catch{error='Outcome could not be recorded or refreshed.';}finally{busy=false;}}
</script>
<section aria-label="Owner outcome feedback">
 <h3>Owner outcome feedback</h3>
 <p>Findings are owner reported. Matching is limited to exact changed file paths; other affected areas remain unresolved.</p>
 {#if error}<p role="alert">{error}</p>{/if}
 {#if data?.scrutiny.length}<ul>{#each data.scrutiny as finding}<li><strong>Increased inspection and regression follow-up required</strong>: {finding.area}, {finding.severity} · <a href={`https://github.com/${repository}/issues/${finding.evidence_issue}`}>owner-reported issue #{finding.evidence_issue}</a> · revision <code>{finding.commit_sha}</code></li>{/each}</ul>{:else}<p>No matching escaped defects were found. Unmatched areas still require inspection.</p>{/if}
 {#if data?.historyTruncated}<p>Recent outcome history is limited to 100 entries; escape alerts include older records.</p>{/if}
 {#if data?.decisions.length}<form onsubmit={submit}>
  <label>Prior decision <select bind:value={decision} required><option value="">Choose a decision</option>{#each data.decisions as entry}<option value={entry.id}>{entry.decision} · {entry.commit_sha}</option>{/each}</select></label>
  <label>Changed file <select bind:value={area} required><option value="">Choose an area</option>{#each files as file}<option value={file.path}>{file.path}</option>{/each}</select></label>
  <label>Outcome <select bind:value={kind}><option value="escape">Escaped defect</option><option value="spot_check">Spot-check</option></select></label>
  <label>Severity <select bind:value={severity}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
  <label>Evidence issue number <input type="number" min="1" step="1" bind:value={evidenceIssue} required /></label>
  <button type="submit" disabled={busy}>Record outcome</button>
 </form>{:else}<p>Record a human decision before adding outcome feedback.</p>{/if}
</section>
<style>section{margin:1rem 0;padding:1rem;border:1px solid #cbd5e1;border-radius:.5rem} form,label{display:grid;gap:.5rem}code{overflow-wrap:anywhere}</style>
