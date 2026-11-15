<script lang="ts">
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Plus from '@lucide/svelte/icons/plus';
	import { authClient } from '#lib/auth-client.js';
	import { createIssueDiscovery } from '#lib/issue-discovery.ts';
	import ChangeGraphView from '#lib/components/ChangeGraphView.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import LoginWave from '#lib/components/LoginWave.svelte';
	import FlagMarker from '#lib/components/FlagMarker.svelte';
	import Spinner from '#lib/components/Spinner.svelte';
	import type { RunDetail, RunStatus, RunSummary } from '#lib/server/agent-runs.ts';

	const session = authClient.useSession();
	const discoveryController = createIssueDiscovery({ onChange: next => { discovery = next; } });
	let discovery = $state(discoveryController.state);
	let instruction = $state('');
	let runs = $state<RunSummary[]>([]);
	let run = $state<RunDetail | null>(null);
	let starting = $state(false);
	let runsLoading = $state(false);
	let opening = $state('');
	let issueLoading = $state(0);
	let error = $state('');
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	// Picked once per page load, so the heading varies between visits but not while you work.
	const headline = Math.random() < 0.5 ? "Let's ship some features in" : "Let's fix some bugs in";
	let owner = '';
	// Onboarding: a new user first links GitHub, then installs the Tripsit agent (the GitHub App) on some repositories.
	let githubLinked = $state<boolean | null>(null);
	let linking = $state(false);
	let linkError = $state(page.url.searchParams.get('github') === 'link-failed'
		? 'GitHub could not be linked. Use a GitHub account with the same email as this Tripsit account, or sign out and continue with GitHub instead.' : '');
	const onboarding = $derived(githubLinked === false ? 'connect'
		: githubLinked && discovery.owner && !discovery.loading && !discovery.error && !discovery.repositories.length ? 'install' : null);

	let authError = $state('');
	let isAuthenticating = $state(false);

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
			void checkGitHub(current);
			// Links from pull request comments open a run directly: /?run=<id>.
			const linked = page.url.searchParams.get('run');
			if (current && linked) void openRun(linked);
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

	async function checkGitHub(requester: string) {
		githubLinked = null;
		if (!requester) return;
		const { data } = await authClient.listAccounts();
		// If the account list is unavailable, fall back to the workspace and its discovery errors.
		if (requester === owner) githubLinked = data ? data.some(account => account.providerId === 'github') : true;
	}

	async function connectGitHub() {
		linking = true; linkError = '';
		const result = await authClient.linkSocial({ provider: 'github', callbackURL: '/', errorCallbackURL: '/?github=link-failed' });
		if (result.error) { linkError = result.error.message ?? 'Could not start GitHub linking.'; linking = false; }
	}

	// Opens the GitHub App installation in a popup over the workspace. When the popup returns to
	// Tripsit (the setup callback) or is closed, it is dismissed and repositories are reloaded.
	// If the browser blocks the popup, the link navigates normally.
	let installPopupTimer: ReturnType<typeof setInterval> | undefined;
	function installInPopup(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const width = 1020, height = 760;
		const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
		const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
		const popup = window.open('/api/github/connect', 'tripsit-github-install', `popup,width=${width},height=${height},left=${left},top=${top}`);
		if (!popup) return;
		event.preventDefault();
		popup.focus();
		clearInterval(installPopupTimer);
		installPopupTimer = setInterval(() => {
			let returned = false;
			// Reading the location throws while the popup is on github.com.
			try { returned = popup.location.origin === window.location.origin && popup.location.pathname === '/'; } catch { /* still on GitHub */ }
			if (!popup.closed && !returned) return;
			clearInterval(installPopupTimer);
			if (!popup.closed) popup.close();
			void discoveryController.refresh();
		}, 500);
	}
	$effect(() => () => clearInterval(installPopupTimer));

	async function loadRuns() {
		const requester = owner;
		runsLoading = true;
		try {
			const data = await api('/api/agent-runs');
			if (requester === owner) runs = data.runs;
		} catch (cause) { if (requester === owner) error = message(cause); }
		finally { if (requester === owner) runsLoading = false; }
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
		error = ''; opening = id;
		try {
			run = (await api(`/api/agent-runs/${id}`)).run;
			replaceState(`?run=${encodeURIComponent(id)}`, {});
			poll();
		}
		catch (cause) { error = message(cause); }
		finally { if (opening === id) opening = ''; }
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

	async function signInWithGitHub() {
		authError = '';
		isAuthenticating = true;
		const result = await authClient.signIn.social({ provider: 'github', callbackURL: '/' });
		if (result.error) {
			authError = result.error.message ?? 'Could not start GitHub sign-in.';
			isAuthenticating = false;
		}
	}
</script>

<svelte:head>
	<title>tripsit.dev</title>
	<meta name="description" content="Pick an issue or describe a feature, and the TripSit agent makes the pull request." />
</svelte:head>

<header class="appbar"><div class="appbar-inner">
	<Logo />
	{#if $session.data}
		{#if githubLinked && onboarding !== 'install'}<div class="repo-picker">
			<label for="repository">Repository{#if discovery.loading && !discovery.repositories.length} <Spinner size={11} />{/if}</label>
			<div class="select-wrap">
				<select id="repository" value={discovery.repository} disabled={discovery.loading && !discovery.repositories.length}
					onchange={(event) => discoveryController.selectRepository(event.currentTarget.value)}>
					{#if !discovery.repositories.length}<option value="">{discovery.loading ? 'Loading repositories…' : 'No repositories available'}</option>{/if}
					{#each discovery.repositories as repository (repository.id)}
						<option value={repository.fullName}>{repository.fullName}{repository.private ? ' (private)' : ''}</option>
					{/each}
				</select>
				<ChevronDown class="chevron" size={14} aria-hidden="true" />
			</div>
			<a class="add-repos" href="/api/github/connect" onclick={installInPopup} title="Install the Tripsit agent on more repositories or organizations"><Plus size={13} aria-hidden="true" /> Add repos</a>
		</div>{/if}
		<div class="account-bar"><strong title={$session.data.user.email}>{$session.data.user.name || $session.data.user.email}</strong><button class="button-quiet" onclick={() => authClient.signOut()}>Sign out</button></div>
	{:else if !$session.isPending}<span class="appbar-caption">Coding ticket agent</span>{/if}
</div></header>

<main class:auth-layout={!$session.isPending && !$session.data}>
	{#if $session.isPending}
		<p class="note"><Spinner /> Loading your session…</p>
	{:else if !$session.data}
		<div class="login">
			<section class="login-intro" aria-labelledby="auth-heading">
				<h1 id="auth-heading"><span>Your agent writes the <code class="title-code">code</code>.</span> <span>We <span class="flagged-word">show<span class="title-flag"><FlagMarker kind="judgement_call" size={15} point="up" /></span></span> you where it
					<!-- Drawn like an LLM's top next-token choices: the chosen word, then fainter alternatives on a branch. -->
					<span class="branch">
						<span class="option"><span class="twig"></span><span class="word">guessed.</span><small class="chance">61%</small></span>
						<span class="option" aria-hidden="true"><span class="twig"></span><span class="word">assumed.</span><small class="chance">24%</small></span>
						<span class="option" aria-hidden="true"><span class="twig"></span><span class="word">hallucinated.</span><small class="chance">8%</small></span>
					</span></span></h1>
				<p class="login-lede">tripsit turns your GitHub issues into pull requests and maps every change across your dependency
					graph, with confidence scored on each node and every assumption flagged. Your review starts where the agent was
					unsure.</p>
				<ul class="login-points">
					<li><span>01</span>Pick an issue or describe a feature</li>
					<li><span>02</span>The agent writes the code and opens a PR</li>
					<li><span>03</span>You review the change graph and merge</li>
				</ul>
			</section>
			<section class="auth-card" aria-label="Sign in">
				<h2>Get started</h2>
				<p class="auth-intro">Sign in with the GitHub account that can see your repositories.</p>
				<button class="github" onclick={signInWithGitHub} disabled={isAuthenticating}>
					{#if isAuthenticating}<Spinner />{:else}<svg class="github-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>{/if}
					Continue with GitHub
				</button>
				{#if authError}<p class="error" role="alert">{authError}</p>{/if}
				<p class="auth-note">New here? Continuing with GitHub creates your account. You choose which repositories the agent can work on.</p>
			</section>
		</div>
		<div class="login-wave"><LoginWave /></div>
	{:else if onboarding}
		<section class="onboarding" aria-labelledby="onboarding-heading">
			<p class="eyebrow">Welcome to Tripsit</p>
			<h1 id="onboarding-heading">{onboarding === 'connect' ? 'Connect your GitHub account' : 'Add the Tripsit agent to your GitHub'}</h1>
			<p class="intro">{onboarding === 'connect'
				? 'Tripsit works on GitHub repositories. Link your GitHub account so it can see the repositories you can work on.'
				: 'Install the Tripsit agent on your account or an organization, and pick which repositories it may work on. You can change this at any time.'}</p>
			<ol class="steps">
				<li class:done={onboarding !== 'connect'} class:current={onboarding === 'connect'}>
					<span class="step-mark">{#if onboarding !== 'connect'}<Check size={13} aria-label="Done" />{:else}1{/if}</span>
					<div><strong>Connect GitHub</strong><p>Lets Tripsit list the repositories you have access to.</p></div>
				</li>
				<li class:current={onboarding === 'install'}>
					<span class="step-mark">2</span>
					<div><strong>Install the Tripsit agent</strong><p>Choose all repositories or only selected ones. For an organization, an owner may need to approve it.</p></div>
				</li>
				<li>
					<span class="step-mark">3</span>
					<div><strong>Ship it</strong><p>Pick an issue or describe a feature, and the agent opens a pull request for you to review.</p></div>
				</li>
			</ol>
			<div class="onboarding-actions">
				{#if onboarding === 'connect'}
					<button class="button-primary" onclick={connectGitHub} disabled={linking}>{#if linking}<Spinner /> {/if}Connect GitHub</button>
				{:else}
					<a class="button-primary button-link" href="/api/github/connect">Install the Tripsit agent</a>
					<button class="button-quiet" onclick={() => discoveryController.refresh()} disabled={discovery.loading}>{#if discovery.loading}<Spinner /> {/if}Installed it? Check again</button>
				{/if}
			</div>
			{#if linkError}<p class="error" role="alert">{linkError}</p>{/if}
		</section>
	{:else}
		<div class="page-heading">
			<div>
				<p class="eyebrow">pi agent · Gemma 4</p>
				<h1>{headline} <span class="repo-name">{discovery.repository || 'your repository'}</span></h1>
				<p class="intro">Pick an issue or describe the feature, and the Tripsit agent will make the PR.</p>
			</div>
		</div>

		<div class="setup-grid">
			<section class="panel form-panel" aria-labelledby="new-run-heading">
				<h2 id="new-run-heading">New run</h2>
				{#if discovery.issues.length}
					<p class="field-label">Open issues <span class="hint">pick one to fill in the instruction</span></p>
					<ul class="issue-shortcuts">
						{#each discovery.issues.slice(0, 8) as issue (issue.id)}
							<li><button type="button" class="shortcut" disabled={issueLoading !== 0} onclick={() => useIssue(issue.number)}>
								<span class="number">#{issue.number}</span> {issue.title}{#if issueLoading === issue.number} <Spinner />{/if}
							</button></li>
						{/each}
					</ul>
				{:else if discovery.loading && discovery.repository}
					<p class="note"><Spinner /> Loading open issues…</p>
				{/if}
				<label for="instruction">Instruction</label>
				<textarea id="instruction" bind:value={instruction} maxlength="8000" placeholder="Describe the feature or change the agent should make."></textarea>
				<div class="form-footer">
					<span class="hint">{instruction.trim().length}/8000</span>
					<button class="button-primary" disabled={starting || !discovery.repository || !instruction.trim() || (run !== null && !finished(run.status))} onclick={startRun}>
						{#if starting}<Spinner /> Starting…{:else}Run agent{/if}
					</button>
				</div>
				{#if discovery.error}<p class="error">{discovery.error}</p>{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</section>

			<section class="panel runs-panel" aria-labelledby="runs-heading">
				<div class="panel-heading"><h2 id="runs-heading">Recent runs</h2><button class="button-quiet" onclick={loadRuns} disabled={runsLoading}>{#if runsLoading}<Spinner /> {/if}Refresh</button></div>
				{#if runs.length}
					<ul class="run-list">
						{#each runs as item (item.id)}
							<li><button type="button" class:active={run?.id === item.id} onclick={() => openRun(item.id)}>
								<span class="run-title">{item.instruction.split('\n')[0]}</span>
								<span class="run-meta">{item.repository} · <span class="status status-{item.status}">{#if !finished(item.status)}<Spinner size={11} /> {/if}{statusLabel[item.status]}</span>{#if opening === item.id} <Spinner size={11} />{/if}{item.changedFiles !== null ? ` · ${item.changedFiles} files` : ''}{item.pullRequest ? ` · PR #${item.pullRequest.number}` : ''}</span>
							</button></li>
						{/each}
					</ul>
				{:else}
					<p class="note">{#if runsLoading}<Spinner /> Loading runs…{:else}No runs yet. Runs are kept for seven days.{/if}</p>
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
						<span class="status status-{run.status}">{#if !finished(run.status)}<Spinner size={12} /> {/if}{statusLabel[run.status]}</span>
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
						{#if run.result.confidence?.status === 'scored'} · edit confidence from {run.result.confidence.tokens} tokens{/if}
						{#if run.result.truncated} · some diffs were truncated{/if}
					</p>
					{#if run.result.files.length}
						{#key run.id}<ChangeGraphView graph={run.result.graph} files={run.result.files} flags={run.result.flags ?? []} confidence={run.result.confidence ?? null} />{/key}
					{:else}
						<p class="note">The agent did not change any files.</p>
					{/if}
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main { width: min(100%, 1400px); padding: 34px 44px 64px; margin: auto; }
	/* The picker sits on the right, just before the account controls. */
	.repo-picker { margin-left: auto; display: flex; align-items: center; gap: 10px; min-width: 0; }
	.repo-picker + .account-bar { margin-left: 0; padding-left: 20px; border-left: 1px solid var(--border); align-self: stretch; }
	.repo-picker label { margin: 0; color: var(--text-subtle); white-space: nowrap; }
	/* Native arrows sit flush with the edge; a drawn chevron gets the same 12px inset as the text on the left. */
	.select-wrap { position: relative; min-width: 0; color: var(--text-muted); }
	.select-wrap:hover { color: var(--text); }
	.repo-picker select { appearance: none; -webkit-appearance: none; width: auto; max-width: 340px; height: 34px; padding: 5px 38px 5px 12px; background: var(--surface); cursor: pointer; font: 500 12px/1.5 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
	.repo-picker select:disabled { cursor: default; }
	.select-wrap :global(.chevron) { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }
	.page-heading { padding: 36px 0 44px; }
	.onboarding { max-width: 620px; margin: 0 auto 30px; padding: 44px 0 0; }
	.steps { list-style: none; margin: 28px 0 0; padding: 0; border: 1px solid var(--border); background: var(--surface); }
	.steps li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 14px; padding: 16px 18px; color: var(--text-subtle); }
	.steps li + li { border-top: 1px solid var(--border); }
	.steps strong { display: block; font: 600 14px/1.5 var(--font-sans); color: var(--text-muted); }
	.steps p { margin: 3px 0 0; font: 400 12px/1.6 var(--font-mono); }
	.steps li.current strong, .steps li.done strong { color: var(--text); }
	.step-mark { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--border-strong); font: 500 12px/1 var(--font-mono); }
	.steps li.current .step-mark { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
	.steps li.done .step-mark { border-color: var(--added); color: var(--added); }
	.onboarding-actions { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-top: 22px; }
	.button-link { display: inline-block; padding: 9px 16px; text-decoration: none; font: 500 12px/1.5 var(--font-mono); }
	.add-repos { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); text-decoration: none; white-space: nowrap; font: 500 12px/1.5 var(--font-mono); }
	.add-repos:hover { color: var(--text); }
	.page-heading h1 { line-height: 1.25; }
	/* The repository goes on its own line under the opening phrase. */
	.repo-name { display: block; font-family: var(--font-mono); font-weight: 500; letter-spacing: -0.02em; overflow-wrap: anywhere; }
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
	/* Sign-in: introduction on the left, card on the right, the logo's wave running along the bottom. */
	.auth-layout { --wave: clamp(170px, 34vh, 340px); position: relative; width: 100%; min-height: calc(100svh - 65px); padding: 0 0 var(--wave); display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
	.login { position: relative; z-index: 1; width: min(100%, 1400px); margin: 0 auto; padding: 56px 44px 40px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); gap: 64px; align-items: center; }
	.login-intro h1 { font-size: clamp(34px, 4.2vw, 56px); line-height: 1.18; letter-spacing: -0.045em; text-wrap: balance; }
	.login-intro h1 > span { text-wrap: balance; }
	/* "code" is set in mono, slightly smaller so it sits level with the Geist words around it. */
	/* "code" is set like inline code: mono, on a raised chip with a hairline border. */
	.title-code { font-family: var(--font-mono); font-size: 0.82em; font-weight: 500; letter-spacing: -0.03em; color: inherit; padding: 0 .16em; margin: 0 .04em; background: var(--surface-hover); border: 1px solid var(--border-strong); }
	/* One sentence per line on wide screens; on phones they wrap naturally. */
	.login-intro h1 > span { display: block; }
	/* The branch: tree lines from "it" to each option. The stem runs into the chosen word; the trunk curves off it and
	   each alternative leaves the trunk on a rounded elbow. These are the one place the square-corner rule is lifted,
	   so the radius needs !important to beat the global reset. */
	.branch { display: inline-flex; flex-direction: column; vertical-align: baseline; --trunk: .16em; --bend: .2em; }
	.option { display: flex; align-items: center; }
	.twig { position: relative; align-self: stretch; flex: none; width: .5em; margin-right: .14em; }
	.twig::before, .twig::after { content: ''; position: absolute; border: 0 solid var(--text-subtle); }
	/* Chosen row: the stem straight into the word, and the trunk bending down off it. */
	.option:first-child .twig::before { left: -.12em; right: 0; top: calc(50% + .06em); border-top-width: 2px; }
	.option:first-child .twig::after { top: calc(50% + .06em); bottom: 0; left: calc(var(--trunk) - var(--bend)); width: calc(var(--bend) + 2px);
		border-top-width: 2px; border-right-width: 2px; border-top-right-radius: var(--bend) !important; }
	/* Alternatives: a rounded elbow from the trunk into the word, and the trunk carrying on to the next row. */
	.option + .option .twig::after { left: var(--trunk); right: 0; top: 0; height: calc(50% + 1px);
		border-left-width: 2px; border-bottom-width: 2px; border-bottom-left-radius: var(--bend) !important; }
	.option + .option:not(:last-child) .twig::before { left: var(--trunk); top: 50%; bottom: 0; border-left-width: 2px; }
	.word { padding: .02em 0; }
	.option + .option .word { font-size: .5em; padding: .12em 0; }
	.option:nth-child(2) .word { opacity: .42; }
	.option:nth-child(3) .word { opacity: .2; }
	.chance { margin-left: .7rem; color: var(--text-subtle); font: 400 12px/1 var(--font-mono); letter-spacing: 0; }
	.option + .option .chance { opacity: .7; }
	/* A collapsed judgement-call flag, as on the graph, hanging below the second line and pointing up at "show". */
	.flagged-word { position: relative; }
	.title-flag { position: absolute; left: .08em; top: calc(100% + 12px); display: flex; font-size: 16px; line-height: 1; letter-spacing: 0; }
	.login-lede { max-width: 600px; margin: clamp(32px, 4.2vw, 56px) 0 0; color: var(--text-muted); font-size: 17px; line-height: 1.65; }
	.login-points { list-style: none; margin: 30px 0 0; padding: 0; display: grid; gap: 10px; }
	.login-points li { display: flex; align-items: baseline; gap: 14px; color: var(--text); font: 400 13px/1.5 var(--font-mono); }
	.login-points span { color: var(--text-subtle); }
	.login-wave { position: absolute; left: 0; right: 0; bottom: 0; height: var(--wave); pointer-events: none; }
	.auth-card { width: 100%; padding: 30px; background: var(--surface); border: 1px solid var(--border); }
	.auth-intro { color: var(--text-muted); font: 400 12px/1.6 var(--font-mono); margin: 8px 0 22px; }
	.github { width: 100%; padding: 11px 16px; display: flex; align-items: center; justify-content: center; gap: 10px; background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-size: 13px; }
	.github-mark { width: 16px; height: 16px; }
	.github:hover:not(:disabled) { background: var(--bg); color: var(--accent); }
	.auth-note { margin: 18px 0 0; color: var(--text-subtle); font: 400 11px/1.6 var(--font-mono); text-align: center; }
	@media (max-width: 900px) {
		main { padding: 26px 16px 40px; }
		.setup-grid { grid-template-columns: minmax(0, 1fr); }
		.page-heading { padding: 20px 0 30px; }
		.onboarding { padding-top: 20px; }
		.run-heading { flex-direction: column; }
	}
	@media (max-width: 760px) {
		.repo-picker { order: 3; width: 100%; margin-left: 0; }
		.repo-picker + .account-bar { margin-left: auto; padding-left: 0; border-left: 0; }
		.select-wrap { flex: 1; }
		.repo-picker select { width: 100%; max-width: none; }
		.login { grid-template-columns: minmax(0, 1fr); gap: 32px; padding: 36px 20px 32px; }
		.login-lede { font-size: 15px; }
		.login-intro h1 > span { display: inline; }
		/* The title wraps freely on phones, so the hanging flag would cover the next line. */
		.title-flag { display: none; }
	}
	@media (max-width: 420px) {
		.auth-card { padding: 24px 20px; }
		.login { padding-left: 16px; padding-right: 16px; }
	}
</style>
