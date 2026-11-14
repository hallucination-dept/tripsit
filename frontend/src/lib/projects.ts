import { database } from '#lib/auth.js';

export type Project = {
	id: string;
	githubInstallationId: number;
	githubRepositoryId: number;
	fullName: string;
	owner: string;
	repository: string;
	defaultBranch: string;
};

type GitHubRepository = {
	id: number;
	full_name: string;
	owner: { login: string };
	name: string;
	default_branch: string;
};

function projectFromRow(row: Record<string, unknown>): Project {
	return {
		id: String(row.id),
		githubInstallationId: Number(row.github_installation_id),
		githubRepositoryId: Number(row.github_repository_id),
		fullName: String(row.full_name),
		owner: String(row.repository_owner),
		repository: String(row.repository_name),
		defaultBranch: String(row.default_branch)
	};
}

export async function listProjects(userId: string) {
	const result = await database.query(
		`SELECT id, github_installation_id, github_repository_id, full_name, repository_owner, repository_name, default_branch
		 FROM github_project WHERE user_id = $1 ORDER BY full_name`,
		[userId]
	);
	return result.rows.map(projectFromRow);
}

export async function getProject(userId: string, projectId: string) {
	const result = await database.query(
		`SELECT id, github_installation_id, github_repository_id, full_name, repository_owner, repository_name, default_branch
		 FROM github_project WHERE user_id = $1 AND id = $2`,
		[userId, projectId]
	);
	return result.rows[0] ? projectFromRow(result.rows[0]) : null;
}

export async function upsertProjects(userId: string, installationId: number, repositories: GitHubRepository[]) {
	for (const repository of repositories) {
		await database.query(
			`INSERT INTO github_project (
				id, user_id, github_installation_id, github_repository_id, full_name,
				repository_owner, repository_name, default_branch
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (user_id, github_repository_id) DO UPDATE SET
				github_installation_id = EXCLUDED.github_installation_id,
				full_name = EXCLUDED.full_name,
				repository_owner = EXCLUDED.repository_owner,
				repository_name = EXCLUDED.repository_name,
				default_branch = EXCLUDED.default_branch`,
			[
				crypto.randomUUID(),
				userId,
				installationId,
				repository.id,
				repository.full_name,
				repository.owner.login,
				repository.name,
				repository.default_branch
			]
		);
	}
}
