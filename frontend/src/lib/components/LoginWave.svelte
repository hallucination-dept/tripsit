<script lang="ts">
	import { onMount } from 'svelte';

	// A full-width version of the logo's wave (see Logo.svelte): a fixed colour field seen through a mask of bars
	// whose heights swell and settle one after another, so a slow wave travels rightwards across still colours.
	// Few, wide bars, like the logo's steps rather than an equaliser.
	const count = 10;
	const width = 1440, height = 320;
	const step = width / count;
	// The resting outline: two broad swells that rise towards the right, echoing the logo's climbing steps.
	const outline = (t: number) => 0.22 + 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (1.35 * t + 0.08))) * (0.55 + 0.45 * t);
	type Bar = { x: number; h: number; begin: string };
	const duration = 7;
	const bars: Bar[] = Array.from({ length: count }, (_, index) => {
		const t = index / (count - 1);
		// Each bar starts its cycle a little after its left neighbour; 1.5 wavelengths span the page.
		const begin = (index * duration * 1.5) / count - duration * 2;
		return { x: index * step, h: outline(t) * height, begin: `${begin.toFixed(3)}s` };
	});
	// The logo's colour fields, spread across the whole width instead of zoomed into its corner.
	const blobs = [
		{ x: 0.04, y: 1, r: 0.32, color: '#f97316' },
		{ x: 0.16, y: 0.7, r: 0.22, color: '#f0441f' },
		{ x: 0.3, y: 1, r: 0.26, color: '#ff1f5a' },
		{ x: 0.46, y: 0.75, r: 0.22, color: '#c0168c' },
		{ x: 0.64, y: 0.6, r: 0.24, color: '#2c1a96' },
		{ x: 0.82, y: 0.85, r: 0.26, color: '#3a6ec8' },
		{ x: 0.98, y: 0.2, r: 0.3, color: '#38bdf8' }
	];
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

<svg class="login-wave" viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
	<defs>
		{#each blobs as blob, index (index)}
			<radialGradient id="{id}-blob-{index}" cx={blob.x} cy={blob.y} r={blob.r}>
				<stop offset="0" stop-color={blob.color} />
				<stop offset="1" stop-color={blob.color} stop-opacity="0" />
			</radialGradient>
		{/each}
		<mask id="{id}-bars" maskUnits="userSpaceOnUse" x="0" y="0" {width} {height}>
			{#each bars as bar, index (index)}
				<!-- Bars touch; the extra half unit hides hairline seams where neighbours meet. -->
				<rect x={bar.x} y={height - bar.h} width={step + 0.5} height={bar.h} fill="#fff">
					{#if !still}
						<animate attributeName="height" values="{bar.h};{bar.h * 0.5};{bar.h}" dur="{duration}s" begin={bar.begin}
							repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
						<animate attributeName="y" values="{height - bar.h};{height - bar.h * 0.5};{height - bar.h}" dur="{duration}s" begin={bar.begin}
							repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
					{/if}
				</rect>
			{/each}
		</mask>
	</defs>
	<g mask="url(#{id}-bars)">
		<rect width={width} height={height} fill="#7c14c4" />
		{#each blobs as _, index (index)}<rect width={width} height={height} fill="url(#{id}-blob-{index})" />{/each}
	</g>
</svg>

<style>
	.login-wave { display: block; width: 100%; height: 100%; }
</style>
