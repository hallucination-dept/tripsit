// Edit confidence per graph node: uqlm's min_token_negentropy (min_probability when top-k data is missing) over the
// tokens that wrote the node's changed lines, plus a length-adjusted score. See specs/EDIT_CONFIDENCE_PLAN.md.
// Shared by the server, which computes it, and the browser, which shows it.

export type ConfidenceMetric = 'negentropy' | 'probability';
export type WeakestToken = {
	text: string; probability: number; negentropy: number | null; line: number;
	// The most likely tokens at that position, including the one written, when the position was uncertain.
	alternatives: { text: string; probability: number }[];
};
export type NodeConfidence = {
	nodeId: string; tokens: number;
	// The node's lowest token score under the run's metric (1 = certain), and its lowest token probability.
	confidence: number; minProbability: number;
	// 1 - (1 - F)^n: the chance that n tokens of this run would include one this uncertain. Low = unusual for its size.
	adjusted: number | null;
	weakest: WeakestToken;
};
export type RunConfidence =
	| { status: 'scored'; metric: ConfidenceMetric; tokens: number; files: number; scoredFiles: number; nodes: NodeConfidence[] }
	| { status: 'unavailable'; reason: string };

// Nodes whose length-adjusted score is below this are marked unusual for their size.
export const unusualBelow = 0.1;
// Every scored edit gets a progress ring in the graph; rings below this confidence are highlighted.
export const ringBelow = 0.7;
// Background tint over the confidence hue: nearly transparent when certain, strongest when unsure.
export const tintAlpha = (confidence: number) => Math.round(0.5 * Math.max(0, Math.min(1, 1 - confidence)) ** 0.8 * 1000) / 1000;
export const isUnusual = (node: NodeConfidence) => node.adjusted !== null && node.adjusted < unusualBelow;
export const percent = (value: number) => `${Math.round(value * 100)}%`;
// Labels for uqlm's two scorers (min_token_negentropy, min_probability), shown so reviewers can see what the number is.
export const metricLabels: Record<ConfidenceMetric, string> = { negentropy: 'Min. token negentropy', probability: 'Min. token probability' };
