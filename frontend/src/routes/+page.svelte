<script lang="ts">
	type Token = { token: string; probability_percent: number };

	let code = $state('');
	let tokens = $state<Token[]>([]);
	let review = $state('');
	let isLoading = $state(false);
	let message = $state('');

	function opacity(probability: number) {
		return Math.max(0.1, Math.min(0.9, probability / 100));
	}

	async function submitReview() {
		isLoading = true;
		message = '';
		tokens = [];
		review = '';

		try {
			const response = await fetch('/api/review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code })
			});
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
</script>

<svelte:head>
	<title>TripSitter</title>
	<meta name="description" content="Gemma 4 code review with per-token confidence" />
</svelte:head>

<main>
	<header>
		<p class="eyebrow">Gemma 4 on Modal</p>
		<h1>TripSitter</h1>
		<p class="intro">Code review with visible per-token confidence.</p>
	</header>

	<form onsubmit={(event) => { event.preventDefault(); submitReview(); }}>
		<label for="code">Code to review</label>
		<textarea id="code" bind:value={code} required spellcheck="false" placeholder="Paste code here..."></textarea>
		<button type="submit" disabled={isLoading || !code.trim()}>
			{isLoading ? 'Reviewing…' : 'Review code'}
		</button>
	</form>

	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}

	{#if tokens.length || review}
		<section aria-live="polite">
			<div class="section-heading">
				<h2>Review</h2>
				<p>Hover a token for its probability.</p>
			</div>
			<div class="review">
				{#if tokens.length}
					{#each tokens as item}
						<span
							class="token"
							style:background-color={`rgba(56, 189, 248, ${opacity(item.probability_percent)})`}
							title={`${item.probability_percent.toFixed(2)}% likely`}
						>{item.token}</span>
					{/each}
				{:else}
					{review}
				{/if}
			</div>
			<p class="legend"><span class="low"></span>lower confidence <span class="high"></span>higher confidence</p>
		</section>
	{/if}
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #09111f; color: #edf3ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	main { width: min(100% - 32px, 960px); margin: 0 auto; padding: 72px 0; }
	.eyebrow { margin: 0; color: #62d8ff; font-size: .78rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
	h1 { margin: 8px 0; font-size: clamp(2.6rem, 7vw, 4.8rem); letter-spacing: -.06em; }
	.intro { margin: 0 0 48px; color: #9badcb; font-size: 1.15rem; }
	form, section { padding: 24px; border: 1px solid #263958; border-radius: 16px; background: #101b30; }
	label { display: block; margin-bottom: 10px; color: #bdd1f3; font-size: .9rem; font-weight: 650; }
	textarea { display: block; width: 100%; min-height: 280px; padding: 16px; resize: vertical; border: 1px solid #30496f; border-radius: 9px; background: #091322; color: #edf3ff; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
	button { margin-top: 16px; padding: 11px 17px; border: 0; border-radius: 8px; background: #68d9ff; color: #06101c; font-weight: 800; cursor: pointer; }
	button:disabled { opacity: .5; cursor: wait; }
	.error { margin: 16px 0; color: #ff9fac; }
	section { margin-top: 28px; }
	.section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
	h2 { margin: 0; font-size: 1.2rem; } .section-heading p, .legend { color: #96aacc; font-size: .86rem; }
	.review { margin-top: 16px; white-space: pre-wrap; line-height: 1.7; }
	.token { border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
	.low, .high { display: inline-block; width: 12px; height: 12px; margin: 0 6px 0 12px; border-radius: 3px; background: #38bdf8; vertical-align: -1px; }
	.low { opacity: .18; margin-left: 0; } .high { opacity: .9; }
</style>
