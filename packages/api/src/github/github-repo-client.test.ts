import { describe, expect, it } from 'vitest';

import { errorFromCode } from '../errors';
import { GitHubRepoClient } from './github-repo-client';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('GitHubRepoClient', () => {
  it('returns public metadata', async () => {
    const client = new GitHubRepoClient({
      fetchImpl: async () =>
        jsonResponse(200, {
          name: 'Hello-World',
          owner: { login: 'octocat' },
          default_branch: 'master',
          description: 'demo',
          stargazers_count: 1,
          forks_count: 2,
          language: 'C',
          private: false,
          size: 1,
          html_url: 'https://github.com/octocat/Hello-World',
        }),
    });
    const meta = await client.getRepository('octocat', 'Hello-World');
    expect(meta.defaultBranch).toBe('master');
    expect(meta.private).toBe(false);
  });

  it('maps 404 to REPOSITORY_NOT_FOUND', async () => {
    const client = new GitHubRepoClient({
      fetchImpl: async () => jsonResponse(404, { message: 'Not Found' }),
    });
    await expect(client.getRepository('octocat', 'missing')).rejects.toMatchObject({
      code: 'REPOSITORY_NOT_FOUND',
    });
  });

  it('maps private repos', async () => {
    const client = new GitHubRepoClient({
      fetchImpl: async () => jsonResponse(200, { private: true, default_branch: 'main', size: 1 }),
    });
    await expect(client.getRepository('octocat', 'private-repo')).rejects.toMatchObject({
      code: 'PRIVATE_REPOSITORY',
    });
  });

  it('maps exhausted rate limits', async () => {
    const client = new GitHubRepoClient({
      fetchImpl: async () =>
        jsonResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
    });
    await expect(client.getRepository('octocat', 'Hello-World')).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
    });
  });

  it('does not include the token in thrown errors', async () => {
    const client = new GitHubRepoClient({
      token: 'ghs_secret_token_value',
      fetchImpl: async () => jsonResponse(500, { message: 'boom' }),
    });
    await expect(client.getRepository('octocat', 'Hello-World')).rejects.toBeInstanceOf(Error);
    try {
      await client.getRepository('octocat', 'Hello-World');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('ghs_secret_token_value');
      expect((error as Error).message).not.toContain('ghs_secret_token_value');
    }
  });
});

describe('errorFromCode coverage for github mapping', () => {
  it('keeps INDEX_TIMEOUT as a gateway timeout', () => {
    expect(errorFromCode('INDEX_TIMEOUT').status).toBe(504);
  });
});

describe('GitHub timeline metadata', () => {
  it('loads public PRs and excludes pull requests from the issues list', async () => {
    const requested: string[] = [];
    const client = new GitHubRepoClient({
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.includes('/pulls?'))
          return jsonResponse(200, [
            {
              number: 7,
              title: 'Improve auth',
              body: 'Explains the change',
              user: { login: 'octocat' },
              state: 'closed',
              created_at: '2025-01-01T00:00:00Z',
              merged_at: '2025-01-02T00:00:00Z',
              updated_at: '2025-01-02T00:00:00Z',
            },
          ]);
        return jsonResponse(200, [
          {
            number: 8,
            title: 'Auth bug',
            state: 'open',
            user: { login: 'tester' },
            created_at: '2025-01-03T00:00:00Z',
          },
          { number: 7, title: 'PR is also issue', state: 'closed', pull_request: { url: 'x' } },
        ]);
      },
    });
    const prs = await client.getPullRequests('octocat', 'Hello-World');
    const issues = await client.getIssues('octocat', 'Hello-World');
    expect(prs).toEqual([expect.objectContaining({ number: 7, author: 'octocat' })]);
    expect(prs[0]?.mergedAt?.toISOString()).toBe('2025-01-02T00:00:00.000Z');
    expect(issues).toEqual([expect.objectContaining({ number: 8, title: 'Auth bug' })]);
    expect(
      requested.every((url) => url.includes('state=all') && url.includes('per_page=100')),
    ).toBe(true);
  });
});
