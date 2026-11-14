import { error, json } from '@sveltejs/kit';
import { listProjects } from '#lib/projects.js';

export async function GET({ locals }) {
	if (!locals.user) throw error(401, 'Sign in before viewing projects.');
	return json({ projects: await listProjects(locals.user.id) });
}
