<script lang="ts">
	import { untrack } from 'svelte';
	import { authClient } from '#lib/auth-client.js';
	import { createIssueDiscovery } from '#lib/issue-discovery.ts';
	import ChangeGraphView from '#lib/components/ChangeGraphView.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import type { RunDetail, RunStatus, RunSummary } from '#lib/server/agent-runs.ts';

	const session = authClient.useSession();
	const discoveryController = createIssueDiscovery({ onChange: next => { discovery = next; } });
	let discovery = $state(discoveryController.state);
	let instruction = $state('');
	let runs = $state<RunSummary[]>([]);
	let run = $state<RunDetail | null>(null);
	let starting = $state(false);
	let issueLoading = $state(0);
	let error = $state('');
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let owner = '';

	const finished = (status: RunStatus) => status === 'done' || status === 'failed' || status === 'cancelled';
	const statusLabel: Record<RunStatus, string> = { preparing: 'Preparing', running: 'Agent working', analyzing: 'Building graph', publishing: 'Opening PR', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
	const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

	$effect(() => {
		const current = $session.data?.user.id ?? '';
		untrack(() => {
			owner = current;
			clearTimeout(pollTimer);
			run = null; runs = []; error = '';
			void discoveryController.start(current);
			if (current) void loadRuns();
		});
		return () => untrack(() => { clearTimeout(pollTimer); discoveryController.stop(); });
	});

	async function api(path: string, init?: RequestInit) {
		const response = await fetch(path, { cache: 'no-store', ...init, signal: AbortSignal.timeout(30_000) });
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'The request failed.');
		return data;
	}
	const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The request failed.';

	async function loadRuns() {
		const requester = owner;
		try {
			const data = await api('/api/agent-runs');
			if (requester === owner) runs = data.runs;
		} catch (cause) { if (requester === owner) error = message(cause); }
	}

	function poll() {
		clearTimeout(pollTimer);
		if (!run || finished(run.status)) return;
		const id = run.id;
		pollTimer = setTimeout(async () => {
			try {
				const data = await api(`/api/agent-runs/${id}`);
				if (run?.id !== id) return;
				run = data.run;
				if (finished(data.run.status)) void loadRuns();
			} catch (cause) { if (run?.id === id) error = message(cause); }
			if (run?.id === id) poll();
		}, 2000);
	}

	async function openRun(id: string) {
		error = '';
		try { run = (await api(`/api/agent-runs/${id}`)).run; poll(); }
		catch (cause) { error = message(cause); }
	}

	async function startRun() {
		starting = true; error = '';
		try {
			const data = await api('/api/agent-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repository: discovery.repository, instruction }) });
			run = data.run;
			poll();
			void loadRuns();
		} catch (cause) { error = message(cause); }
		finally { starting = false; }
	}

	async function cancelRun() {
		if (!run) return;
		try { run = (await api(`/api/agent-runs/${run.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).run; }
		catch (cause) { error = message(cause); }
	}

	async function useIssue(number: number) {
		const repository = discovery.repository;
		issueLoading = number; error = '';
		try {
			const { issue } = await api(`/api/github/issue?repository=${encodeURIComponent(repository)}&number=${number}`);
			if (repository === discovery.repository) instruction = `Resolve GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body}`.trim();
		} catch (cause) { error = message(cause); }
		finally { issueLoading = 0; }
	}
</script>

<svelte:head><title>Agent runs · tripsit.dev</title></svelte:head>

<header class="appbar"><div class="appbar-inner">
	<Logo />
	{#if $session.data}
		<nav aria-label="Workspace"><a href="/">Workspace</a><a href="/agent" aria-current="page">Agent runs</a></nav>
		<div class="account-bar"><strong title={$session.data.user.email}>{$session.data.user.name || $session.data.user.email}</strong></div>
	{:else}<span class="appbar-caption">Agent runs</span>{/if}
</div></header>

<main>
	{#if $session.isPending}
		<p class="note">Loading your session…</p>
	{:else if !$session.data}
		<section class="panel signed-out">
			<h1>Agent runs</h1>
			<p class="note">Sign in on the <a href="/">workspace page</a> to let the agent change a repository.</p>
		</section>
	{:else}
		<div class="page-heading">
			<div>
				<p class="eyebrow">pi agent · Gemma 4</p>
				<h1>Change a repository</h1>
				<p class="intro">The agent edits a fresh copy of the default branch. Nothing is committed or pushed; the result is a dependency graph of what changed.</p>
			</div>
		</div>

		<div class="setup-grid">
			<section class="panel form-panel" aria-labelledby="new-run-heading">
				<h2 id="new-run-heading">New run</h2>
				<label for="repository">Repository</label>
				<select id="repository" value={discovery.repository} disabled={discovery.loading && !discovery.repositories.length}
					onchange={(event) => discoveryController.selectRepository(event.currentTarget.value)}>
					{#if !discovery.repositories.length}<option value="">{discovery.loading ? 'Loading repositories…' : 'No repositories available'}</option>{/if}
					{#each discovery.repositories as repository (repository.id)}
						<option value={repository.fullName}>{repository.fullName}{repository.private ? ' (private)' : ''}</option>
					{/each}
				</select>
				{#if discovery.issues.length}
					<p class="field-label">Open issues <span class="hint">pick one to fill in the instruction</span></p>
					<ul class="issue-shortcuts">
						{#each discovery.issues.slice(0, 8) as issue (issue.id)}
							<li><button type="button" class="shortcut" disabled={issueLoading !== 0} onclick={() => useIssue(issue.number)}>
								<span class="number">#{issue.number}</span> {issue.title}{issueLoading === issue.number ? ' …' : ''}
							</button></li>
						{/each}
					</ul>
				{/if}
				<label for="instruction">Instruction</label>
				<textarea id="instruction" bind:value={instruction} maxlength="8000" placeholder="Describe the change the agent should make."></textarea>
				<div class="form-footer">
					<span class="hint">{instruction.trim().length}/8000</span>
					<button class="button-primary" disabled={starting || !discovery.repository || !instruction.trim() || (run !== null && !finished(run.status))} onclick={startRun}>
						{starting ? 'Starting…' : 'Run agent'}
					</button>
				</div>
				{#if discovery.error}<p class="error">{discovery.error}</p>{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</section>

			<section class="panel runs-panel" aria-labelledby="runs-heading">
				<div class="panel-heading"><h2 id="runs-heading">Recent runs</h2><button class="button-quiet" onclick={loadRuns}>Refresh</button></div>
				{#if runs.length}
					<ul class="run-list">
						{#each runs as item (item.id)}
							<li><button type="button" class:active={run?.id === item.id} onclick={() => openRun(item.id)}>
								<span class="run-title">{item.instruction.split('\n')[0]}</span>
								<span class="run-meta">{item.repository} · <span class="status status-{item.status}">{statusLabel[item.status]}</span>{item.changedFiles !== null ? ` · ${item.changedFiles} files` : ''}{item.pullRequest ? ` · PR #${item.pullRequest.number}` : ''}</span>
							</button></li>
						{/each}
					</ul>
				{:else}
					<p class="note">No runs yet. Runs are kept in server memory for a few hours.</p>
				{/if}
			</section>
		</div>

		{#if run}
			<section class="run-section" aria-labelledby="run-heading">
				<div class="run-heading">
					<div>
						<p class="eyebrow">{run.repository} · {run.branch} · <code>{run.sha.slice(0, 7)}</code></p>
						<h2 id="run-heading">{run.instruction.split('\n')[0]}</h2>
					</div>
					<div class="run-actions">
						{#if run.pullRequest}<a class="pull-request" href={run.pullRequest.url} target="_blank" rel="noopener noreferrer">Pull request #{run.pullRequest.number} ↗</a>{/if}
						<span class="status status-{run.status}">{statusLabel[run.status]}</span>
						{#if !finished(run.status)}<button class="button-quiet" onclick={cancelRun}>Cancel</button>{/if}
					</div>
				</div>
				{#if run.error}<p class="error">{run.error}</p>{/if}
				{#if run.result?.publishNote}<p class="note">{run.result.publishNote}</p>{/if}

				<details class="panel events" open={!finished(run.status)}>
					<summary>Agent log ({run.events.length})</summary>
					<ol>
						{#each run.events as event, index (index)}
							<li class="event event-{event.kind}"><time>{time(event.at)}</time><span>{event.text}</span></li>
						{/each}
					</ol>
				</details>

				{#if run.result}
					{#if run.result.summary}
						<div class="panel summary"><h3>Agent summary</h3><p>{run.result.summary}</p></div>
					{/if}
					<p class="graph-caption">
						{run.result.files.length} changed file{run.result.files.length === 1 ? '' : 's'} ·
						{run.result.graph.stats.files} files in the repository ·
						{run.result.graph.stats.symbols} symbols shown{run.result.graph.stats.hiddenNeighbors ? ` · ${run.result.graph.stats.hiddenNeighbors} more neighbors collapsed` : ''}
						{#if run.result.truncated} · some diffs were truncated{/if}
					</p>
					{#if run.result.files.length}
						{#key run.id}<ChangeGraphView graph={run.result.graph} files={run.result.files} />{/key}
					{:else}
						<p class="note">The agent did not change any files.</p>
					{/if}
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main { width: min(100%, 1400px); padding: 34px 28px 64px; margin: auto; }
	.page-heading { margin-bottom: 26px; }
	.intro { max-width: 760px; }
	h3 { margin: 0 0 8px; color: var(--text-muted); font: 500 11px/1.5 var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
	.setup-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); gap: 18px; align-items: start; }
	.panel { padding: 20px; }
	.panel-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
	.field-label { display: block; margin: 16px 0 7px; color: var(--text-muted); font: 500 11px/1.5 var(--font-mono); letter-spacing: 0.02em; }
	textarea { min-height: 150px; resize: vertical; font: 12.5px/1.7 var(--font-mono); }
	.hint { color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); letter-spacing: 0; }
	.issue-shortcuts { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 200px; overflow: auto; }
	.shortcut { width: 100%; padding: 6px 9px; text-align: left; background: var(--surface-raised); border-color: var(--border); color: var(--text-muted); overflow-wrap: anywhere; font-weight: 500; }
	.shortcut:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
	.number { color: var(--text-subtle); font-family: var(--font-mono); }
	.form-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
	.run-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 420px; overflow: auto; }
	.run-list button { width: 100%; text-align: left; padding: 8px 10px; display: grid; gap: 2px; background: var(--surface-raised); border-color: var(--border); color: var(--text); }
	.run-list button:hover { border-color: var(--border-strong); }
	.run-list button.active { border-color: var(--text); }
	.run-title { font: 600 13px/1.5 var(--font-sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.run-meta { color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.status { font: 500 11px/1.5 var(--font-mono); text-transform: uppercase; letter-spacing: 0.04em; }
	.status-done { color: var(--added); }
	.status-failed, .status-cancelled { color: var(--deleted); }
	.status-preparing, .status-running, .status-analyzing, .status-publishing { color: var(--modified); }
	.pull-request { padding: 4px 10px; border: 1px solid var(--border); color: var(--text); text-decoration: none; font: 500 12px/1.5 var(--font-mono); }
	.pull-request:hover { border-color: var(--text); }
	.run-section { margin-top: 30px; display: grid; gap: 14px; }
	.run-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
	.run-actions { display: flex; align-items: center; gap: 14px; white-space: nowrap; }
	.events { padding: 12px 16px; }
	.events summary { cursor: pointer; color: var(--text-muted); font: 500 11px/1.5 var(--font-mono); }
	.events summary:hover { color: var(--text); }
	.events ol { list-style: none; margin: 10px 0 0; padding: 0; max-height: 300px; overflow: auto; display: grid; gap: 3px; font: 400 11.5px/1.55 var(--font-mono); }
	.event { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 10px; padding: 3px 0; border-top: 1px solid var(--border); }
	.event time { color: var(--text-subtle); font-variant-numeric: tabular-nums; }
	.event span { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-muted); }
	.event-tool span { font-family: var(--font-mono); }
	.event-error span { color: var(--deleted); }
	.event-assistant span { color: var(--text); font: 400 13px/1.6 var(--font-sans); }
	.summary p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; color: var(--text-muted); }
	.graph-caption { margin: 0; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.note { color: var(--text-subtle); font: 400 11px/1.6 var(--font-mono); }
	.error { margin: 12px 0 0; }
	code { font-size: 12px; }
	.signed-out { max-width: 520px; margin: 40px auto; }
	@media (max-width: 900px) {
		main { padding: 26px 16px 40px; }
		.setup-grid { grid-template-columns: minmax(0, 1fr); }
		.run-heading { flex-direction: column; }
	}
</style>
