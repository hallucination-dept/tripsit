<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '#lib/auth-client.js';

	type Token = { token: string; probability_percent: number };
	type Project = { id: string; fullName: string; owner: string; repository: string; defaultBranch: string };
	type Issue = { id: number; number: number; title: string; htmlUrl: string; state: string };

	const session = authClient.useSession();
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
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state('');
	let projectMessage = $state('');
	let issues = $state<Issue[]>([]);
	let issuesError = $state('');
	let issuesLoading = $state(false);
	let pullRequestTitle = $state('');
	let pullRequestBranch = $state('');
	let pullRequestBody = $state('');
	let isCreatingPullRequest = $state(false);
	let loadedUserId = '';

	const selectedProject = $derived(projects.find((project) => project.id === selectedProjectId));

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

	async function loadProjects() {
		try {
			const response = await fetch('/api/projects');
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? 'Could not load projects.');
			projects = payload.projects;
			const savedProjectId = localStorage.getItem('tripsitter-project-id');
			selectedProjectId = projects.some((project) => project.id === savedProjectId) ? savedProjectId! : projects[0]?.id ?? '';
		} catch (error) {
			projectMessage = error instanceof Error ? error.message : 'Could not load projects.';
		}
	}

	async function loadIssues(projectId: string) {
		issuesLoading = true;
		issuesError = '';
		issues = [];
		try {
			const response = await fetch(`/api/projects/${projectId}/issues`);
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? 'Could not load issues.');
			issues = payload.issues;
		} catch (error) {
			issuesError = error instanceof Error ? error.message : 'Could not load issues.';
		} finally {
			issuesLoading = false;
		}
	}

	function selectProject(projectId: string) {
		selectedProjectId = projectId;
		localStorage.setItem('tripsitter-project-id', projectId);
	}

	function connectProject() {
		window.location.assign('/api/github/connect');
	}

	async function createPullRequest() {
		if (!selectedProject) return;
		isCreatingPullRequest = true;
		projectMessage = '';
		try {
			const response = await fetch(`/api/projects/${selectedProject.id}/pull-requests`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: pullRequestTitle, head: pullRequestBranch, body: pullRequestBody, base: selectedProject.defaultBranch })
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? 'Could not create the pull request.');
			projectMessage = `Pull request #${payload.number} created.`;
			pullRequestTitle = '';
			pullRequestBranch = '';
			pullRequestBody = '';
		} catch (error) {
			projectMessage = error instanceof Error ? error.message : 'Could not create the pull request.';
		} finally {
			isCreatingPullRequest = false;
		}
	}

	onMount(() => {
		const connected = new URLSearchParams(window.location.search).get('github_project_connected');
		if (connected) {
			projectMessage = `Connected ${connected} GitHub ${connected === '1' ? 'repository' : 'repositories'}.`;
			window.history.replaceState({}, '', window.location.pathname);
		}
	});

	$effect(() => {
		const userId = $session.data?.user.id;
		if (userId && userId !== loadedUserId) {
			loadedUserId = userId;
			void loadProjects();
		}
		if (!userId) {
			loadedUserId = '';
			projects = [];
			selectedProjectId = '';
			issues = [];
		}
	});

	$effect(() => {
		if (selectedProjectId) void loadIssues(selectedProjectId);
	});
</script>

<svelte:head>
	<title>tripsit.dev</title>
	<meta name="description" content="Gemma 4 code review with per-token confidence" />
</svelte:head>

<main>
	<header class:signed-in={$session.data}>
		<div>
			<p class="eyebrow">Gemma 4 on Modal</p>
			<h1>tripsit.dev</h1>
			<p class="intro">Code review with visible per-token confidence.</p>
		</div>
		{#if $session.data}
			<div class="project-controls">
				<label for="project-switcher">Project</label>
				<select id="project-switcher" value={selectedProjectId} onchange={(event) => selectProject(event.currentTarget.value)}>
					<option value="">No connected project</option>
					{#each projects as project}<option value={project.id}>{project.fullName}</option>{/each}
				</select>
				<button class="add-project" onclick={connectProject}>Add project</button>
			</div>
		{/if}
	</header>

	{#if $session.data}
		<div class="account-bar">
			<span>Signed in as <strong>{$session.data.user.name || $session.data.user.email}</strong></span>
			<button class="quiet" onclick={() => authClient.signOut()}>Sign out</button>
		</div>
		{#if projectMessage}<p class="notice" role="status">{projectMessage}</p>{/if}

		{#if selectedProject}
			<section class="project-panel">
				<div class="section-heading">
					<div><p class="eyebrow">Connected repository</p><h2>{selectedProject.fullName}</h2></div>
					<a href={`https://github.com/${selectedProject.fullName}`} target="_blank" rel="noreferrer">Open on GitHub ↗</a>
				</div>
				<div class="project-grid">
					<div>
						<h3>Open issues</h3>
						{#if issuesLoading}<p class="muted">Loading issues…</p>{/if}
						{#if issuesError}<p class="error" role="alert">{issuesError}</p>{/if}
						{#if !issuesLoading && !issuesError && !issues.length}<p class="muted">No open issues.</p>{/if}
						<ul class="issue-list">{#each issues as issue}<li><a href={issue.htmlUrl} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a></li>{/each}</ul>
					</div>
					<form class="pull-request-form" onsubmit={(event) => { event.preventDefault(); createPullRequest(); }}>
						<h3>Create pull request</h3>
						<label for="pr-title">Title</label><input id="pr-title" bind:value={pullRequestTitle} required placeholder="Fix issue #123" />
						<label for="pr-branch">Source branch</label><input id="pr-branch" bind:value={pullRequestBranch} required placeholder="fix/issue-123" />
						<label for="pr-body">Description</label><textarea id="pr-body" bind:value={pullRequestBody} placeholder="What changed and why?"></textarea>
						<button type="submit" disabled={isCreatingPullRequest}>{isCreatingPullRequest ? 'Creating…' : `Create PR into ${selectedProject.defaultBranch}`}</button>
					</form>
				</div>
			</section>
		{:else}
			<section class="empty-projects"><h2>Connect a GitHub repository</h2><p>Select exactly the repositories tripsit.dev may read, inspect for issues, and create pull requests in.</p><button onclick={connectProject}>Add project</button></section>
		{/if}

		<form onsubmit={(event) => { event.preventDefault(); submitReview(); }}>
			<label for="code">Code to review</label>
			<textarea id="code" bind:value={code} required spellcheck="false" placeholder="Paste code here..."></textarea>
			<button type="submit" disabled={isLoading || !code.trim()}>{isLoading ? 'Reviewing…' : 'Review code'}</button>
		</form>
		{#if message}<p class="error" role="alert">{message}</p>{/if}
		{#if tokens.length || review}
			<section aria-live="polite">
				<div class="section-heading"><h2>Review</h2><p>Hover a token for its probability.</p></div>
				<div class="review">{#if tokens.length}{#each tokens as item}<span class="token" style:background-color={`rgba(56, 189, 248, ${opacity(item.probability_percent)})`} title={`${item.probability_percent.toFixed(2)}% likely`}>{item.token}</span>{/each}{:else}{review}{/if}</div>
				<p class="legend"><span class="low"></span>lower confidence <span class="high"></span>higher confidence</p>
			</section>
		{/if}
	{:else}
		<section class="auth-card">
			<h2>{authMode === 'sign-in' ? 'Sign in to review code' : 'Create your account'}</h2>
			<p>Use GitHub or an email address and password.</p>
			<button class="github" onclick={signInWithGitHub} disabled={isAuthenticating}>Continue with GitHub</button>
			<div class="divider"><span>or</span></div>
			<form onsubmit={(event) => { event.preventDefault(); submitEmailAuth(); }}>
				{#if authMode === 'sign-up'}<label for="name">Name</label><input id="name" bind:value={name} required autocomplete="name" />{/if}
				<label for="email">Email</label><input id="email" bind:value={email} required type="email" autocomplete="email" />
				<label for="password">Password</label><input id="password" bind:value={password} required type="password" minlength="8" autocomplete={authMode === 'sign-in' ? 'current-password' : 'new-password'} />
				<button type="submit" disabled={isAuthenticating}>{isAuthenticating ? 'Working…' : authMode === 'sign-in' ? 'Sign in with email' : 'Create account'}</button>
			</form>
			{#if authError}<p class="error" role="alert">{authError}</p>{/if}
			<button class="text-button" onclick={() => { authMode = authMode === 'sign-in' ? 'sign-up' : 'sign-in'; authError = ''; }}>{authMode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button>
		</section>
	{/if}
</main>

<style>
	:global(*) { box-sizing: border-box; } :global(body) { margin: 0; background: #09111f; color: #edf3ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	main { width: min(100% - 32px, 960px); margin: 0 auto; padding: 56px 0 72px; } header { margin-bottom: 36px; } header.signed-in { display: flex; justify-content: space-between; align-items: end; gap: 24px; }
	.eyebrow { margin: 0; color: #62d8ff; font-size: .78rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; } h1 { margin: 8px 0; font-size: clamp(2.6rem, 7vw, 4.8rem); letter-spacing: -.06em; } .intro { margin: 0; color: #9badcb; font-size: 1.15rem; }
	.project-controls { display: flex; align-items: end; gap: 8px; } .project-controls label { margin: 0 0 8px; position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } .project-controls select { width: min(240px, 42vw); }
	form, section, .account-bar { padding: 24px; border: 1px solid #263958; border-radius: 16px; background: #101b30; } .account-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding: 14px 18px; color: #bed1ef; }
	label { display: block; margin: 14px 0 8px; color: #bdd1f3; font-size: .9rem; font-weight: 650; } textarea, input, select { display: block; width: 100%; padding: 12px 14px; border: 1px solid #30496f; border-radius: 9px; background: #091322; color: #edf3ff; } textarea { min-height: 280px; resize: vertical; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; } .pull-request-form textarea { min-height: 92px; }
	button { margin-top: 16px; padding: 11px 17px; border: 0; border-radius: 8px; background: #68d9ff; color: #06101c; font-weight: 800; cursor: pointer; } .project-controls button { margin-top: 0; white-space: nowrap; } button:disabled { opacity: .5; cursor: wait; } .quiet, .text-button { margin: 0; color: #b9d2fa; background: transparent; font-weight: 650; }
	.error { margin: 16px 0; color: #ff9fac; } .notice { margin: 0 0 18px; color: #84f0b0; } section { margin-bottom: 28px; } .auth-card { width: min(100%, 480px); margin: 0 auto; } .auth-card h2 { margin-top: 0; } .auth-card > p, .muted { color: #9badcb; } .github { width: 100%; background: #edf3ff; color: #0b1424; }
	.divider { display: flex; align-items: center; gap: 12px; margin: 20px 0 6px; color: #8fa4c7; font-size: .85rem; } .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #30496f; } .text-button { width: 100%; margin-top: 18px; text-align: center; } .section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; } h2 { margin: 0; font-size: 1.2rem; } h3 { margin: 0 0 8px; font-size: 1rem; } .section-heading p, .legend { color: #96aacc; font-size: .86rem; } .section-heading a, .issue-list a { color: #80dbff; }
	.project-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 22px; } .issue-list { margin: 12px 0 0; padding-left: 20px; } .issue-list li { margin: 8px 0; } .pull-request-form { padding: 0; border: 0; background: none; } .empty-projects p { color: #9badcb; max-width: 580px; } .review { margin-top: 16px; white-space: pre-wrap; line-height: 1.7; } .token { border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; } .low, .high { display: inline-block; width: 12px; height: 12px; margin: 0 6px 0 12px; border-radius: 3px; background: #38bdf8; vertical-align: -1px; } .low { opacity: .18; margin-left: 0; } .high { opacity: .9; }
	@media (max-width: 680px) { main { width: min(100% - 24px, 960px); padding-top: 32px; } header.signed-in, .project-grid { display: block; } .project-controls { margin-top: 22px; } .project-grid > * + * { margin-top: 28px; } .section-heading { align-items: start; flex-direction: column; } }
</style>
