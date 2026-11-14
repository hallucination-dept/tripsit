import { building } from '$app/env';
import { auth, missingAuthEnvironment } from '#lib/auth.js';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export async function handle({ event, resolve }) {
	if (!building && missingAuthEnvironment.length) {
		throw new Error(`Authentication is not configured. Set: ${missingAuthEnvironment.join(', ')}`);
	}

	const currentSession = await auth.api.getSession({
		headers: event.request.headers
	});

	if (currentSession) {
		event.locals.session = currentSession.session;
		event.locals.user = currentSession.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
}
