import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	MODAL_API_URL: {},
	MODAL_PROXY_TOKEN: {},
	MODEL_ID: {}
});
