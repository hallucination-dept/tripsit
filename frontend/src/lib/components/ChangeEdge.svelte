<script lang="ts">
	import { BaseEdge, Position, type EdgeProps } from '@xyflow/svelte';
	import { bezier, type CardEdgeData } from '#lib/graph-layout.ts';

	// The default bezier edge, with its badge placed at `labelT` so parallel connections keep their badges apart.
	let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, labelStyle, data }: EdgeProps = $props();
	const side = (position: Position) => position === Position.Left ? 'l' : 'r';
	const curve = $derived(bezier(sourceX, sourceY, side(sourcePosition), targetX, targetY, side(targetPosition)));
	const point = $derived(curve.at((data as CardEdgeData | undefined)?.labelT ?? 0.5));
</script>

<BaseEdge {id} path={curve.path} labelX={point.x} labelY={point.y} {label} {labelStyle} {markerEnd} {style} />
