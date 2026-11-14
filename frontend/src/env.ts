import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// These values are injected by Aiven when the container starts, after the
	// Docker image has been built. Returning undefined makes that absence valid
	// during `npm run build`; the review endpoint validates its required values.
	MODAL_API_URL: { schema: (value) => value },
	MODAL_PROXY_TOKEN: { schema: (value) => value },
	MODEL_ID: { schema: (value) => value },
	DATABASE_URL: { schema: (value) => value },
	BETTER_AUTH_SECRET: { schema: (value) => value },
	BETTER_AUTH_URL: { schema: (value) => value },
	GITHUB_CLIENT_ID: { schema: (value) => value },
	GITHUB_CLIENT_SECRET: { schema: (value) => value }
});
