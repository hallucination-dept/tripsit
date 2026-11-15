import { redirect } from '@sveltejs/kit';

// The agent workspace moved to `/`. Keep `/agent?run=<id>` links from older pull request comments working.
export function GET({ url }) {
	redirect(307, `/${url.search}`);
}
