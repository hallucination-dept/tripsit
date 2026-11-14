import { error, json } from '@sveltejs/kit';
import { MODAL_API_URL, MODAL_PROXY_TOKEN, MODEL_ID } from '$app/env/private';

export async function POST({ request, fetch }) {
	const { code } = (await request.json()) as { code?: string };

	if (!code?.trim()) {
		throw error(400, 'Paste code before requesting a review.');
	}

	if (!MODAL_API_URL || !MODAL_PROXY_TOKEN) {
		throw error(500, 'Set MODAL_API_URL and MODAL_PROXY_TOKEN in frontend/.env.');
	}

	let response: Response;
	try {
		response = await fetch(`${MODAL_API_URL.replace(/\/$/, '')}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${MODAL_PROXY_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: MODEL_ID || 'google/gemma-4-31B-it',
				messages: [
					{
						role: 'system',
						content:
							'You are a precise code reviewer. Explain bugs, risks, and concrete improvements.'
					},
					{ role: 'user', content: `Review this code:\n\n\`\`\`\n${code}\n\`\`\`` }
				],
				temperature: 0,
				max_tokens: 700
			})
		});
	} catch (cause) {
		throw error(502, `Could not reach the Modal API: ${cause instanceof Error ? cause.message : cause}`);
	}

	const payload = await response.json();
	if (!response.ok) {
		throw error(response.status, payload?.detail ?? 'The Modal API rejected the review request.');
	}

	const choice = payload.choices?.[0];
	return json({
		review: choice?.message?.content ?? '',
		tokens: choice?.token_probabilities ?? []
	});
}
