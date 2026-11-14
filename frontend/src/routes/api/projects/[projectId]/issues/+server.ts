import { error, json } from '@sveltejs/kit';
import { githubInstallationRequest } from '#lib/github-app.js';
import { getProject } from '#lib/projects.js';

type GitHubIssue = {
	id: number;
	number: number;
	title: string;
	html_url: string;
	state: string;
	pull_request?: unknown;
};

export async function GET({ locals, params }) {
	if (!locals.user) throw error(401, 'Sign in before viewing issues.');
	const project = await getProject(locals.user.id, params.projectId);
	if (!project) throw error(404, 'Project not found.');

	const response = await githubInstallationRequest(
		project.githubInstallationId,
		`/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repository)}/issues?state=open&per_page=50`,
		undefined,
		project.githubRepositoryId
	);
	const issues = ((await response.json()) as GitHubIssue[])
		.filter((issue) => !issue.pull_request)
		.map(({ id, number, title, html_url, state }) => ({ id, number, title, htmlUrl: html_url, state }));

	return json({ issues });
}
