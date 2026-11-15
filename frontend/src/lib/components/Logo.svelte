<script lang="ts">
	import { onMount } from 'svelte';

	// The wave from the TripSit logo (shape.svg): bar heights in a 240×80 box, bottom-aligned.
	const bars = [10, 20, 30, 50, 70, 80, 60, 30];
	// Soft colour fields over a purple base approximate the brand's mesh gradient. They follow the wave's outline,
	// so the low left steps show orange and pink, the middle purple, and the right indigo, blue and a cyan crest.
	const blobs = [
		{ x: 0.1, y: 0.9, r: 0.4, color: '#f97316' },
		{ x: 0, y: 0.55, r: 0.22, color: '#f0441f' },
		{ x: 0.3, y: 1, r: 0.3, color: '#ff1f5a' },
		{ x: 0.46, y: 0.8, r: 0.24, color: '#c0168c' },
		{ x: 0.68, y: 0.5, r: 0.28, color: '#2c1a96' },
		{ x: 0.96, y: 0.75, r: 0.3, color: '#3a6ec8' },
		{ x: 0.8, y: 0, r: 0.36, color: '#38bdf8' }
	];
	// The wave shows a close-up of that field: 3× around its lower left, so broad bands run from warm red at the
	// foot through hot pink and magenta to a violet crest.
	const zoom = 3, focus = { x: 72, y: 68 };
	const id = $props.id();
	let still = $state(false);

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => { still = motion.matches; };
		update();
		motion.addEventListener('change', update);
		return () => motion.removeEventListener('change', update);
	});
</script>

<a class="logo" href="/" aria-label="tripsit.dev home">
	<svg class="wave" viewBox="0 0 240 80" aria-hidden="true" focusable="false">
		<defs>
			{#each blobs as blob, index (index)}
				<radialGradient id="{id}-blob-{index}" cx={blob.x} cy={blob.y} r={blob.r}>
					<stop offset="0" stop-color={blob.color} />
					<stop offset="1" stop-color={blob.color} stop-opacity="0" />
				</radialGradient>
			{/each}
			<!-- Each bar swells from its base, one second behind its left neighbour, so a slow wave travels rightwards
			     across a gradient that stays in place. -->
			<mask id="{id}-bars" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="80">
				{#each bars as height, index (index)}
					<rect x={index * 30} y={80 - height} width="30" {height} fill="#fff">
						{#if !still}
							<animate attributeName="height" values="{height};{height * 0.6};{height}" dur="8s" begin="{index - 8}s"
								repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
							<animate attributeName="y" values="{80 - height};{80 - height * 0.6};{80 - height}" dur="8s" begin="{index - 8}s"
								repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
						{/if}
					</rect>
				{/each}
			</mask>
		</defs>
		<g mask="url(#{id}-bars)">
			<g transform="translate({focus.x} {focus.y}) scale({zoom}) translate({-focus.x} {-focus.y})">
				<rect width="240" height="80" fill="#7c14c4" />
				{#each blobs as _, index (index)}<rect width="240" height="80" fill="url(#{id}-blob-{index})" />{/each}
			</g>
		</g>
	</svg>
	<span class="wordmark">tripsit.dev</span>
</a>

<style>
	/* The wave keeps the 3:1 shape of shape.svg and sits just below the baseline of a smaller wordmark. */
	.logo { display: inline-flex; align-items: baseline; gap: 10px; color: var(--text); text-decoration: none; font: 400 15px/1 var(--font-mono); letter-spacing: -0.01em; }
	.wave { width: 48px; height: 16px; position: relative; top: 2px; }
</style>
