<script lang="ts">
	import { untrack } from 'svelte';
	import Spinner from '#lib/components/Spinner.svelte';
	import { createIssueDiscovery } from '#lib/issue-discovery.ts';
	import { createCandidateWorkspace } from '#lib/candidate-workspace.ts';
	import CandidateInspection from '#lib/CandidateInspection.svelte';
	import OutcomeFeedback from '#lib/OutcomeFeedback.svelte';
	import { authClient } from '#lib/auth-client.js';
	import { selectedAfterReload } from '#lib/issue-selection.ts';
	import Logo from '#lib/components/Logo.svelte';

	type Token = { token: string; probability_percent: number };

	const session = authClient.useSession();
	type IssueItem = { id: string; createdAt: string; expiresAt: string; snapshot: {
		repositoryId: number; repository: string; private: boolean; issueNumber: number; baseSha: string;
		supplied: { title: string; body: string }; inferred: string[]; ownerConfirmed: string[];
	} };
	let issueItems = $state<IssueItem[]>([]);
	let selectedIssue = $state<IssueItem | null>(null);
	let intakeOwner = $state('');
	let issueBusy = $state(false);
	let issueError = $state('');
	let code = $state('');
	let tokens = $state<Token[]>([]);
	let review = $state('');
	let isLoading = $state(false);
	let message = $state('');
	let authMode = $state<'sign-in' | 'sign-up'>('sign-in');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let authError = $state('');
	let isAuthenticating = $state(false);

	let intakeRequest = 0;
	let intakeAbort: AbortController | undefined;
	const discoveryController = createIssueDiscovery({ onChange: next => {
		discovery = next;
		const accessible = (item: IssueItem) => Date.parse(item.expiresAt) > Date.now() && next.repositories.some(repo => repo.id === item.snapshot.repositoryId && repo.fullName === item.snapshot.repository);
		issueItems = issueItems.filter(accessible);
		if (selectedIssue && !accessible(selectedIssue)) selectedIssue = null;
	} });
	let discovery = $state(discoveryController.state);
	const candidateController = createCandidateWorkspace({ onChange: next => { candidateWorkspace = next; } });
	let candidateWorkspace = $state(candidateController.state);

	$effect(() => {
		const owner = $session.data?.user.id ?? '';
		const itemId = selectedIssue?.id ?? '';
		const baseSha = selectedIssue?.snapshot.baseSha ?? '';
		untrack(() => { void candidateController.select(owner, itemId, baseSha); });
		return () => untrack(() => candidateController.stop());
	});

	$effect(() => {
		const owner = $session.data?.user.id ?? '';
		untrack(() => {
			intakeRequest++;
			intakeAbort?.abort();
			issueItems = []; selectedIssue = null; issueError = ''; issueBusy = false; intakeOwner = '';
			void discoveryController.start(owner);
		});
		return () => untrack(() => { intakeRequest++; intakeAbort?.abort(); discoveryController.stop(); });
	});

	async function issueRequest(action: 'create' | 'list' | 'detail', id?: string) {
		const owner = $session.data?.user.id;
		if (!owner) return;
		const requestId = ++intakeRequest;
		intakeAbort?.abort();
		intakeAbort = new AbortController();
		const repository = discovery.repository;
		const issueNumber = discovery.issueNumber;
		issueBusy = true;
		issueError = '';
		try {
			const response = await fetch(`/api/work-items${action === 'detail' ? `/${id}` : ''}`, {
				...(action === 'create' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, issueNumber }) } : {}),
				signal: AbortSignal.any([intakeAbort.signal, AbortSignal.timeout(30_000)])
			});
			const data = await response.json();
			if ($session.data?.user.id !== owner || requestId !== intakeRequest || (action === 'create' && repository !== discovery.repository)) return;
			intakeOwner = owner;
			if (!response.ok) throw new Error(data.message ?? 'Issue intake failed.');
			if (action === 'list') {
				issueItems = data.items.filter((item: IssueItem) => discovery.repositories.some(repo => repo.id === item.snapshot.repositoryId && repo.fullName === item.snapshot.repository));
				selectedIssue = selectedAfterReload(selectedIssue, issueItems);
			}
			else selectedIssue = discovery.repositories.some(repo => repo.id === data.item.snapshot.repositoryId && repo.fullName === data.item.snapshot.repository) ? data.item : null;
		} catch (error) {
			if ($session.data?.user.id === owner && requestId === intakeRequest) {
				issueError = error instanceof Error ? error.message : 'Issue intake failed.';
				selectedIssue = null;
				issueItems = [];
			}
		} finally { if (requestId === intakeRequest) issueBusy = false; }
	}

	function opacity(probability: number) {
		return Math.max(0.1, Math.min(0.9, probability / 100));
	}

	async function submitReview() {
		isLoading = true;
		message = '';
		tokens = [];
		review = '';
		try {
			const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
			const data = await response.json();
			if (!response.ok) throw new Error(data.message ?? data.detail ?? 'Review failed.');
			tokens = data.tokens;
			review = data.review;
		} catch (error) {
			message = error instanceof Error ? error.message : 'Review failed.';
		} finally {
			isLoading = false;
		}
	}

	async function submitEmailAuth() {
		isAuthenticating = true;
		authError = '';
		const result = authMode === 'sign-in'
			? await authClient.signIn.email({ email, password })
			: await authClient.signUp.email({ name, email, password });
		if (result.error) authError = result.error.message ?? 'Authentication failed.';
		isAuthenticating = false;
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
	<title>TripSit — Review workspace</title>
	<meta name="description" content="GitHub issue snapshots and code review with visible token likelihood." />
</svelte:head>

<header class="appbar"><div class="appbar-inner">
	<Logo />
	{#if $session.data}
		<nav aria-label="Workspace"><a href="#issue-heading">Issues</a><a href="#code-review">Code review</a><a href="/agent">Agent runs</a></nav>
		<div class="account-bar"><strong title={$session.data.user.email}>{$session.data.user.name || $session.data.user.email}</strong><button class="button-quiet" onclick={() => authClient.signOut()}>Sign out</button></div>
	{:else}<span class="appbar-caption">Code review workspace</span>{/if}
</div></header>

<main class:auth-layout={!$session.data}>
	{#if $session.data}
		<div class="page-heading"><div><p class="eyebrow">Workspace</p><h1>Review workspace</h1><p class="intro">Capture a GitHub issue or take a closer look at a code change.</p></div></div>

		<section aria-labelledby="issue-heading">
			<div class="section-heading"><div><h2 id="issue-heading">GitHub issues</h2><p>Keep the problem and its code revision together.</p></div><a class="section-label" href="/api/github/connect">Install GitHub App</a></div>
			<div class="intake-grid">
				<div class="panel ticket-panel">
					<div class="panel-heading"><p class="panel-title">Select an issue</p><span class="sync-state" aria-live="polite">{#if discovery.loading}<Spinner /> Refreshing…{:else}Refreshes every minute{/if}</span></div>
					{#if discovery.owner === $session.data.user.id}
						<form onsubmit={(event) => { event.preventDefault(); issueRequest('create'); }}>
							<label for="repository">Repository{#if discovery.loading && !discovery.repositories.length} <Spinner />{/if}</label>
							<select id="repository" value={discovery.repository} onchange={event => discoveryController.selectRepository(event.currentTarget.value)} required disabled={issueBusy || !discovery.repositories.length}>
								<option value="" disabled>{discovery.loading ? 'Discovering repositories…' : 'No accessible repositories'}</option>
								{#each discovery.repositories as repo (repo.id)}<option value={repo.fullName}>{repo.fullName}{repo.private ? ' (private)' : ''}</option>{/each}
							</select>
							<label for="issue-number">Open issue{#if discovery.loading && discovery.repository && !discovery.issues.length} <Spinner />{/if}</label>
							<select id="issue-number" value={discovery.issueNumber || ''} onchange={event => discoveryController.selectIssue(Number(event.currentTarget.value))} required disabled={issueBusy || !discovery.issues.length}>
								<option value="" disabled>{discovery.loading ? 'Loading issues…' : 'No open issues'}</option>
								{#each discovery.issues as issue (issue.id)}<option value={issue.number}>#{issue.number} — {issue.title}</option>{/each}
							</select>
							<button class="button-primary capture-button" type="submit" disabled={issueBusy || !discovery.repository || !discovery.issueNumber}>{#if issueBusy}<Spinner /> Loading…{:else}Snapshot issue{/if}</button>
						</form>
						{#if discovery.error}<p class="error" role="alert">{discovery.error}</p>{/if}
						{#if !discovery.loading && !discovery.error && !discovery.repositories.length}<p class="empty-note">No repositories found. Check the App installation and your repository access.</p>{/if}
						{#if !discovery.loading && discovery.repository && !discovery.error && !discovery.issues.length}<p class="empty-note">No open issues in this repository.</p>{/if}
						{#if !discovery.repositoriesComplete || !discovery.issuesComplete}<p class="notice">This is a partial list. Automatic refresh will check again.</p>{/if}
						<div class="panel-footer"><span>No work starts automatically.</span><button class="button-quiet" type="button" onclick={() => discoveryController.refresh()} disabled={discovery.loading}>Refresh tickets now</button></div>
					{:else}<p class="empty-note" aria-live="polite"><Spinner /> Discovering repositories and issues…</p>{/if}
					<p class="privacy-note">Snapshots save issue text and its code revision for seven days.</p>
				</div>
				<div class="panel snapshot-panel">
					<div class="panel-heading"><p class="panel-title">Snapshots</p><button class="button-quiet" type="button" onclick={() => issueRequest('list')} disabled={issueBusy}>Reload my snapshots</button></div>
					{#if issueError}<p class="error" role="alert">{issueError}</p>{/if}
					{#if intakeOwner === $session.data.user.id && issueItems.length}
						<ul class="snapshot-list">{#each issueItems as item (item.id)}<li><button class:active={selectedIssue?.id === item.id} type="button" disabled={issueBusy} onclick={() => issueRequest('detail', item.id)}>{item.snapshot.repository} #{item.snapshot.issueNumber}</button></li>{/each}</ul>
					{/if}
					{#if intakeOwner === $session.data.user.id && selectedIssue}
						<div class="snapshot-content" aria-live="polite">
							<p class="snapshot-reference">{selectedIssue.snapshot.repository} <span>#{selectedIssue.snapshot.issueNumber}</span></p>
							<h3>{selectedIssue.snapshot.supplied.title}</h3>
							<div class="commit-reference"><span>Base commit</span><code>{selectedIssue.snapshot.baseSha}</code></div>
							<h4>Supplied issue text (unconfirmed)</h4>
							<p class="issue-body">{selectedIssue.snapshot.supplied.body || 'No issue body supplied.'}</p>
							<details class="snapshot-details"><summary>Provenance & retention</summary><p>Inferred expectations: {selectedIssue.snapshot.inferred.length}. Owner-confirmed criteria: {selectedIssue.snapshot.ownerConfirmed.length}. Formal criteria are not required for intake.</p><p>Snapshot expires {new Date(selectedIssue.expiresAt).toLocaleString()}. Expired source is unavailable.</p></details>
						</div>
					{:else}<div class="snapshot-empty"><p class="empty-title">No snapshot selected</p><p>Choose an issue and capture its current code revision, or reload your saved snapshots.</p></div>{/if}
				</div>
			</div>
		</section>

		{#if selectedIssue && intakeOwner === $session.data.user.id && candidateWorkspace.itemId === selectedIssue.id && candidateWorkspace.owner === $session.data.user.id}
			<section class="review-section" aria-labelledby="implementation-heading">
				<div class="section-heading"><div><h2 id="implementation-heading">Issue implementation</h2><p>The agent investigates the issue, implements changes and builds the review evidence.</p></div><span class="section-label">Agent driven · human in the loop</span></div>
				<div class="intake-grid">
					<div class="panel ticket-panel">
						<h3>Requirements to verify</h3>
						{#if candidateWorkspace.loading}<p class="empty-note" aria-live="polite"><Spinner /> Loading requirements and repository files…</p>{/if}
						{#if candidateWorkspace.policyError}<p class="error" role="alert">{candidateWorkspace.policyError}</p>{/if}
						{#if candidateWorkspace.policy}
							<p class="empty-note">{candidateWorkspace.policy.version} · Unverified</p>
							<ul class="requirements-list">{#each candidateWorkspace.policy.requirements as requirement (requirement.id)}<li>
								<strong>{requirement.criterion}</strong><span class="requirement-state">{requirement.provenance === 'trusted_baseline' ? 'Trusted baseline' : 'Supplied intent'} · {requirement.applicability.replaceAll('_', ' ')}</span>
								<p>{requirement.reason}</p>
								<details><summary>Verification and source</summary><p>{requirement.verification}</p><p>{requirement.source.name} {requirement.source.version}</p></details>
							</li>{/each}</ul>
							<details class="snapshot-details"><summary>Open requirements gaps ({candidateWorkspace.policy.gaps.length})</summary><ul>{#each candidateWorkspace.policy.gaps as gap}<li>{gap.reason}</li>{/each}</ul></details>
						{/if}
					</div>
					<form id="implementation-form" class="panel ticket-panel" onsubmit={(event) => { event.preventDefault(); candidateController.generate(); }}>
						<h3>Implement this issue</h3>
						<p class="empty-note">Gemma chooses the files to inspect, requests more context when needed, and generates the implementation against the captured revision.</p>
						{#if candidateWorkspace.generationError}<p class="error" role="alert">{candidateWorkspace.generationError}</p>{/if}
						<button id="implement-issue" class="button-primary capture-button" type="submit" disabled={candidateWorkspace.loading || candidateWorkspace.generating}>{#if candidateWorkspace.generating}<Spinner /> Agent investigating and implementing…{:else}Implement issue{/if}</button>
						<p class="privacy-note">The resulting changes, impact graph and assessments guide your review. You can steer revisions before making a final decision.</p>
					</form>
				</div>
				{#if candidateWorkspace.candidate}
					<div class="panel candidate-preview" aria-live="polite">
						<div class="section-heading"><div><h3>Agent implementation</h3><p>{candidateWorkspace.candidate.candidate.model} · Not executed or published</p></div></div>
						<p class="empty-note">Candidate {candidateWorkspace.candidate.id} · Expires {new Date(candidateWorkspace.candidate.candidate.expiresAt).toLocaleString()}</p>
						{#each candidateWorkspace.candidate.candidate.files as file (file.path)}<details open class="candidate-file"><summary>{file.path}</summary><p class="empty-note">Blob {file.blobSha}</p><pre><code>{file.content}</code></pre></details>{/each}
					</div>
					<CandidateInspection owner={$session.data.user.id} itemId={selectedIssue.id}
						candidateId={candidateWorkspace.candidate.id} baseSha={selectedIssue.snapshot.baseSha}
						candidateDigest={candidateWorkspace.candidate.candidate.outputDigest} />
					{#key `${$session.data.user.id}:${selectedIssue.id}:${candidateWorkspace.candidate.id}`}
						<OutcomeFeedback itemId={selectedIssue.id} candidateId={candidateWorkspace.candidate.id} files={candidateWorkspace.candidate.candidate.files} repository={selectedIssue.snapshot.repository} />
					{/key}
				{/if}
			</section>
		{/if}

		<section id="code-review" class="review-section" aria-labelledby="code-review-heading">
			<div class="section-heading"><div><h2 id="code-review-heading">Code review</h2><p>Inspect a change with model-generated feedback.</p></div><span class="section-label">Gemma</span></div>
			<form class="panel editor-panel" onsubmit={(event) => { event.preventDefault(); submitReview(); }}>
				<label for="code">Code to review</label>
				<textarea id="code" bind:value={code} required spellcheck="false" placeholder="Paste the code you want reviewed…"></textarea>
				<div class="editor-footer"><span>Token likelihood is a model signal, not a correctness score.</span><button class="button-primary" type="submit" disabled={isLoading || !code.trim()}>{#if isLoading}<Spinner /> Reviewing…{:else}Review code{/if}</button></div>
			</form>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			{#if tokens.length || review}
				<section class="panel review-result" aria-live="polite">
					<div class="panel-heading"><h2>Review</h2><p>Hover a token for its probability.</p></div>
					<div class="review">{#if tokens.length}{#each tokens as item}<span class="token" style:background-color={`rgba(59, 130, 246, ${opacity(item.probability_percent)})`} title={`${item.probability_percent.toFixed(2)}% likely`}>{item.token}</span>{/each}{:else}{review}{/if}</div>
					<p class="legend"><span class="low"></span>lower likelihood <span class="high"></span>higher likelihood</p>
				</section>
			{/if}
		</section>
	{:else}
		<section class="auth-card" aria-labelledby="auth-heading">
			<p class="eyebrow">Your review workspace</p><h1 id="auth-heading">{authMode === 'sign-in' ? 'Sign in to TripSit' : 'Create your account'}</h1>
			<p class="auth-intro">Connect your repositories. Keep code reviews in context.</p>
			<button class="github" onclick={signInWithGitHub} disabled={isAuthenticating}>{#if isAuthenticating}<Spinner /> {/if}Continue with GitHub</button>
			<div class="divider"><span>or use email</span></div>
			<form onsubmit={(event) => { event.preventDefault(); submitEmailAuth(); }}>
				{#if authMode === 'sign-up'}<label for="name">Name</label><input id="name" bind:value={name} required autocomplete="name" />{/if}
				<label for="email">Email</label><input id="email" bind:value={email} required type="email" autocomplete="email" />
				<label for="password">Password</label><input id="password" bind:value={password} required type="password" minlength="8" autocomplete={authMode === 'sign-in' ? 'current-password' : 'new-password'} />
				<button class="button-primary email-submit" type="submit" disabled={isAuthenticating}>{#if isAuthenticating}<Spinner /> Working…{:else}{authMode === 'sign-in' ? 'Sign in with email' : 'Create account'}{/if}</button>
			</form>
			{#if authError}<p class="error" role="alert">{authError}</p>{/if}
			<button class="auth-switch" onclick={() => { authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in'; authError = ''; }}>{authMode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button>
		</section>
	{/if}
</main>

<style>
	main { width: min(100%, 1232px); padding: 34px 28px 64px; margin: auto; }
	.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 32px; }
	.section-heading { display: flex; justify-content: space-between; gap: 20px; align-items: center; margin-bottom: 14px; }
	.section-heading p { margin: 4px 0 0; color: var(--text-muted); font: 400 12px/1.5 var(--font-mono); }
	.section-label { padding: 3px 8px; border: 1px solid var(--border); color: var(--text-muted); font: 500 11px/1.5 var(--font-mono); white-space: nowrap; text-decoration: none; }
	a.section-label:hover { color: var(--text); border-color: var(--text); }
	.intake-grid { display: grid; grid-template-columns: minmax(300px, .88fr) minmax(0, 1.3fr); gap: 18px; align-items: start; }
	.ticket-panel, .snapshot-panel { padding: 20px; }
	.panel-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-width: 0; margin-bottom: 19px; }
	.panel-title { margin: 0; color: var(--text); font: 500 12px/1.5 var(--font-mono); }
	.sync-state { color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); text-align: right; }
	.capture-button { width: 100%; margin-top: 18px; }
	.panel-footer { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.privacy-note, .empty-note, .notice { margin: 14px 0 0; color: var(--text-subtle); font: 400 11px/1.6 var(--font-mono); }
	.snapshot-list { list-style: none; margin: -4px 0 16px; padding: 0 0 12px; border-bottom: 1px solid var(--border); }
	.snapshot-list button { width: 100%; padding: 8px 9px; margin-bottom: 4px; background: var(--surface-raised); border-color: var(--border); color: var(--text-muted); text-align: left; overflow-wrap: anywhere; }
	.snapshot-list button:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
	.snapshot-list button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
	.snapshot-empty { min-height: 238px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 18px 24px 30px; color: var(--text-subtle); }
	.snapshot-empty p { max-width: 300px; margin: 5px 0 0; font: 400 11px/1.6 var(--font-mono); }
	.snapshot-empty .empty-title { color: var(--text-muted); font: 500 13px/1.5 var(--font-sans); }
	.snapshot-reference { margin: 0 0 7px; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); overflow-wrap: anywhere; }
	.snapshot-reference span { margin-left: 6px; }
	h3 { margin: 0 0 16px; color: var(--text); font-size: 18px; font-weight: 600; line-height: 1.4; letter-spacing: -.3px; overflow-wrap: anywhere; }
	.commit-reference { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; padding-bottom: 18px; margin-bottom: 17px; border-bottom: 1px solid var(--border); color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	code { font-size: 12px; line-height: 1.7; color: var(--text-muted); overflow-wrap: anywhere; }
	h4 { margin: 0 0 8px; color: var(--text-muted); font: 500 11px/1.5 var(--font-mono); }
	.issue-body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-muted); font-size: 13px; line-height: 1.8; }
	.snapshot-details { margin-top: 21px; padding-top: 13px; border-top: 1px solid var(--border); color: var(--text-subtle); font: 400 11px/1.6 var(--font-mono); }
	summary { color: var(--text-muted); cursor: pointer; }
	summary:hover { color: var(--text); }
	.snapshot-details p { margin: 8px 0 0; }
	.review-section { margin-top: 30px; }
	.editor-panel { overflow: hidden; }
	.editor-panel label { margin: 0; padding: 12px 17px; border-bottom: 1px solid var(--border); }
	textarea { min-height: 228px; resize: vertical; border: 0; padding: 17px; font: 12px/1.8 var(--font-mono); }
	.editor-footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 12px 16px; border-top: 1px solid var(--border); color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.editor-footer button { flex-shrink: 0; }
	.review-result { margin-top: 16px; padding: 20px; }
	.review-result .panel-heading { margin-bottom: 14px; }
	.review-result .panel-heading p { color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); margin: 0; }
	.review { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.8; color: var(--text); }
	.token { box-decoration-break: clone; -webkit-box-decoration-break: clone; }
	.legend { margin: 16px 0 0; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.low, .high { display: inline-block; width: 9px; height: 9px; margin: 0 5px 0 12px; background: rgb(var(--token-rgb)); vertical-align: 0; }
	.low { opacity: .18; margin-left: 0; }
	.high { opacity: .9; }
	.auth-layout { display: flex; justify-content: center; padding-top: 70px; }
	.auth-card { width: 100%; max-width: 400px; padding: 31px; background: var(--surface); border: 1px solid var(--border); }
	.auth-card h1 { font-size: 25px; }
	.auth-intro { color: var(--text-muted); font: 400 12px/1.6 var(--font-mono); margin: 12px 0 25px; }
	.github { width: 100%; padding: 10px 16px; background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
	.github:hover:not(:disabled) { background: var(--bg); color: var(--accent); }
	.divider { display: flex; align-items: center; gap: 12px; margin: 23px 0 0; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); }
	.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
	.email-submit { width: 100%; margin-top: 21px; background: transparent; border-color: var(--border); color: var(--text); }
	.email-submit:hover:not(:disabled) { border-color: var(--text); }
	.auth-switch { width: 100%; margin-top: 20px; padding: 0; color: var(--text-muted); font-size: 11px; }
	.auth-switch:hover { color: var(--text); }
	.requirements-list { list-style: none; padding: 0; margin: 18px 0 0; }
	.requirements-list > li { padding: 14px 0; border-top: 1px solid var(--border); font-size: 13px; }
	.requirements-list strong { display: block; font-weight: 600; line-height: 1.6; }
	.requirement-state { display: block; color: var(--text-subtle); font: 400 11px/1.5 var(--font-mono); margin-top: 5px; }
	.requirements-list p, .requirements-list summary { color: var(--text-muted); font: 400 11px/1.6 var(--font-mono); }
	.candidate-preview { margin-top: 18px; padding: 20px; }
	.candidate-preview p { overflow-wrap: anywhere; }
	.candidate-file { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
	.candidate-file summary { overflow-wrap: anywhere; font: 500 12px/1.5 var(--font-mono); }
	.candidate-file pre { overflow: auto; max-height: 420px; padding: 14px; background: var(--surface-raised); border: 1px solid var(--border); font-size: 12px; line-height: 1.7; }
	@media (max-width: 760px) {
		main { padding: 26px 20px 40px; }
		.page-heading { margin-bottom: 26px; }
		.intake-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
		.ticket-panel, .snapshot-panel { padding: 18px; }
		.snapshot-empty { min-height: 190px; }
		.auth-layout { padding-top: 40px; }
	}
	@media (max-width: 420px) {
		main { padding-left: 16px; padding-right: 16px; }
		.panel-heading { align-items: flex-start; }
		.editor-footer { flex-wrap: wrap; gap: 12px; }
		.editor-footer button { width: 100%; }
		.auth-card { padding: 25px 22px; }
		.panel-footer { gap: 8px; flex-wrap: wrap; }
	}
</style>
