export type GitHubAccount = { id: string; userId: string; providerId: string; accountId: string };

export function githubAccount(accounts: GitHubAccount[], owner: string): GitHubAccount {
  const linked = accounts.filter((account) => account.userId === owner && account.providerId === 'github');
  if (linked.length !== 1) throw new Error('Sign in with one linked GitHub account before selecting an issue.');
  return linked[0];
}
