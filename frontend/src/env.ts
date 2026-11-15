import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// These values are injected by Aiven when the container starts, after the
	// Docker image has been built. Returning undefined makes that absence valid
	// during `npm run build`; the review endpoint validates its required values.
	MODAL_API_URL: { schema: (value) => value },
	MODAL_PROXY_TOKEN: { schema: (value) => value },
	MODEL_ID: { schema: (value) => value },
	RUNNER_API_URL: { schema: (value) => value },
	RUNNER_API_KEY: { schema: (value) => value },
	REQUIRED_CHECK_MANIFEST_JSON: { schema: (value) => value },
	TRUSTED_CHECKS_JSON: { schema: (value) => value },
	REVIEWER_API_URL: { schema: (value) => value },
	REVIEWER_API_KEY: { schema: (value) => value },
	REVIEWER_MODEL: { schema: (value) => value },
	REVIEWER_RETENTION_DISCLOSURE: { schema: (value) => value },
	DATABASE_URL: { schema: (value) => value },
	BETTER_AUTH_SECRET: { schema: (value) => value },
	BETTER_AUTH_URL: { schema: (value) => value },
	GITHUB_CLIENT_ID: { schema: (value) => value },
	GITHUB_CLIENT_SECRET: { schema: (value) => value },
	GITHUB_APP_CLIENT_ID: { schema: (value) => value },
	GITHUB_APP_CLIENT_SECRET: { schema: (value) => value },
	GITHUB_APP_ID: { schema: (value) => value },
	GITHUB_APP_SLUG: { schema: (value) => value },
	GITHUB_APP_PRIVATE_KEY: { schema: (value) => value }
});
