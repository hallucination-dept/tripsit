<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	// Shown next to text that already says what is loading, so it is hidden from assistive technology unless labelled.
	let { size = 13, label = '' }: { size?: number; label?: string } = $props();
</script>

<span class="spinner" role={label ? 'status' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
	<LoaderCircle {size} strokeWidth={2.25} />
</span>

<style>
	.spinner { display: inline-flex; flex-shrink: 0; vertical-align: -0.15em; animation: spin .8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
</style>
