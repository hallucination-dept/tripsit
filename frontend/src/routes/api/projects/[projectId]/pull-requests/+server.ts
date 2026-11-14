import { error, json } from '@sveltejs/kit';
import { githubInstallationRequest } from '#lib/github-app.js';
import { getProject } from '#lib/projects.js';

export async function POST({ request, locals, params }) {
	if (!locals.user) throw error(401, 'Sign in before creating a pull request.');
	const project = await getProject(locals.user.id, params.projectId);
	if (!project) throw error(404, 'Project not found.');

	const body = (await request.json()) as { title?: string; body?: string; head?: string; base?: string };
	if (!body.title?.trim() || !body.head?.trim()) {
		throw error(400, 'A pull request title and source branch are required.');
	}

	const response = await githubInstallationRequest(
		project.githubInstallationId,
		`/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repository)}/pulls`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: body.title.trim(),
				body: body.body?.trim() || undefined,
				head: body.head.trim(),
				base: body.base?.trim() || project.defaultBranch
			})
		},
		project.githubRepositoryId
	);
	const pullRequest = (await response.json()) as { number: number; html_url: string };
	return json({ number: pullRequest.number, htmlUrl: pullRequest.html_url }, { status: 201 });
}
