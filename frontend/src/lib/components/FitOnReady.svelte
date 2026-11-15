<script lang="ts">
	import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';

	// The fitView prop can run before the canvas has its final size, which leaves the graph at
	// minimum zoom. Fit once nodes are measured and the canvas is visible.
	let { container }: { container: HTMLElement | undefined } = $props();
	const flow = useSvelteFlow();
	const initialized = useNodesInitialized();
	let fitted = false;

	function fit() {
		if (fitted || !initialized.current || !container || !container.clientWidth || !container.clientHeight) return;
		fitted = true;
		requestAnimationFrame(() => { void flow.fitView({ padding: 0.06 }); });
	}

	$effect(() => { if (initialized.current) fit(); });
	$effect(() => {
		if (!container) return;
		const observer = new ResizeObserver(fit);
		observer.observe(container);
		return () => observer.disconnect();
	});
</script>
