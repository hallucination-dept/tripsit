import { error, redirect } from '@sveltejs/kit';

// Keep the externally configured setup URL; repository access is discovered on return.
export async function GET({ locals }) {
	if (!locals.user) throw error(401, 'Sign in before connecting a repository.');
	throw redirect(303, '/');
}
