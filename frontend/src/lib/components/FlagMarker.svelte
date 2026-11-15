<script lang="ts">
	import type { Component } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MessageCircleQuestionMark from '@lucide/svelte/icons/message-circle-question-mark';
	import Scale from '@lucide/svelte/icons/scale';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Attention, FlagKind } from '#lib/flag-levels.ts';

	// A collapsed review-flag bubble (kind icon and chevron) like the graph shows when zoomed out, for decorative use.
	// The right-triangle notch at its top-left corner points left (as in the graph) or up at what it marks.
	let { kind, level = 'high', size = 12, point = 'left' }: { kind: FlagKind; level?: Attention; size?: number; point?: 'left' | 'up' } = $props();
	const icons: Record<FlagKind, Component> = { assumption: MessageCircleQuestionMark, judgement_call: Scale, high_impact: TriangleAlert };
	const Icon = $derived(icons[kind]);
</script>

<span class="marker flag-{level} point-{point}" style:--unit="{size / 12}px" aria-hidden="true">
	<Icon size={size} />
	<span class="chevron"><ChevronRight size={size} /></span>
</span>

<style>
	.marker { --fill: color-mix(in srgb, rgb(var(--flag-rgb)) calc(var(--flag-tint) * 100% + 10%), var(--bg));
		position: relative; display: inline-flex; align-items: center; gap: calc(3 * var(--unit)); height: calc(27 * var(--unit));
		padding: 0 calc(5 * var(--unit)) 0 calc(7 * var(--unit)); background: var(--fill);
		border: 1px solid rgba(var(--flag-rgb), var(--flag-accent)); box-shadow: 0 6px 18px rgba(0, 0, 0, .55); color: rgb(var(--flag-rgb)); }
	.flag-high { --flag-tint: .2; --flag-accent: 1; }
	.flag-medium { --flag-tint: .12; --flag-accent: .7; }
	.flag-low { --flag-tint: .06; --flag-accent: .45; }
	.marker :global(svg) { flex-shrink: 0; }
	.chevron { display: inline-flex; color: var(--text-muted); }
	/* Same notch as the graph's bubbles: a right triangle at the top-left corner, continuing the top edge to the left
	   (point left) or the left edge upwards (point up). The border layer sits under a slightly smaller fill layer. */
	.marker::before, .marker::after { content: ''; position: absolute; }
	.marker::before { background: rgba(var(--flag-rgb), var(--flag-accent)); width: calc(11 * var(--unit)); height: calc(11 * var(--unit)); }
	.point-left::before, .point-left::after { clip-path: polygon(0 0, 100% 0, 100% 100%); }
	.point-left::before { left: calc(-11 * var(--unit)); top: -1px; }
	.point-left::after { left: calc(-8.5 * var(--unit)); top: 0; width: calc(9.5 * var(--unit)); height: calc(8.5 * var(--unit)); background: var(--fill); }
	.point-up::before, .point-up::after { clip-path: polygon(0 0, 0 100%, 100% 100%); }
	.point-up::before { left: -1px; top: calc(-11 * var(--unit)); }
	.point-up::after { left: 0; top: calc(-8.5 * var(--unit)); width: calc(8.5 * var(--unit)); height: calc(9.5 * var(--unit)); background: var(--fill); }
</style>
