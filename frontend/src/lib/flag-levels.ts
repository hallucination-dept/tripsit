// Review flag types and attention levels, shared by the server, the interactive graph and the graph picture.
export const flagKinds = ['assumption', 'judgement_call', 'high_impact'] as const;
export const flagConfidences = ['low', 'medium', 'high'] as const;
export type FlagKind = typeof flagKinds[number];
export type FlagConfidence = typeof flagConfidences[number];
export type Attention = 'high' | 'medium' | 'low';
export type FlagInput = { path: string; symbol: string | null; kind: FlagKind; confidence: FlagConfidence; reason: string; alternatives: string | null };
export type AgentFlag = FlagInput & { id: string; nodeId: string | null };

export const flagLabels: Record<FlagKind, string> = { assumption: 'Assumption', judgement_call: 'Judgement call', high_impact: 'High impact' };
// One hue whose strength is the attention level, kept apart from the green/orange/red change badges.
export const flagRgb = '232, 121, 249';
export const attentionAlpha: Record<Attention, { tint: number; accent: number }> = {
	high: { tint: 0.2, accent: 1 }, medium: { tint: 0.12, accent: 0.7 }, low: { tint: 0.06, accent: 0.45 }
};

// Low confidence asks for the most attention; high-impact edits are raised one level.
export function attention(flag: Pick<FlagInput, 'kind' | 'confidence'>): Attention {
	const levels: Attention[] = ['low', 'medium', 'high'];
	const base = { low: 2, medium: 1, high: 0 }[flag.confidence];
	return levels[Math.min(2, base + (flag.kind === 'high_impact' ? 1 : 0))];
}

export function strongest(flags: Pick<FlagInput, 'kind' | 'confidence'>[]): Attention | null {
	const order: Attention[] = ['high', 'medium', 'low'];
	return order.find(level => flags.some(flag => attention(flag) === level)) ?? null;
}

export function byAttention<T extends Pick<FlagInput, 'kind' | 'confidence'>>(flags: T[]): T[] {
	const rank: Record<Attention, number> = { high: 0, medium: 1, low: 2 };
	return [...flags].sort((a, b) => rank[attention(a)] - rank[attention(b)]);
}

// Flags per graph node, and per card (a file card collects its own flags and its symbols' flags).
export function flagIndex(flags: AgentFlag[], owner: Map<string, string>, cards: Set<string>) {
	const byNode = new Map<string, AgentFlag[]>(), byCard = new Map<string, AgentFlag[]>();
	const push = (map: Map<string, AgentFlag[]>, key: string, flag: AgentFlag) => map.set(key, [...(map.get(key) ?? []), flag]);
	for (const flag of flags) {
		if (!flag.nodeId) continue;
		push(byNode, flag.nodeId, flag);
		const card = cards.has(flag.nodeId) ? flag.nodeId : owner.get(flag.nodeId);
		if (card) push(byCard, card, flag);
	}
	return { byNode, byCard };
}
