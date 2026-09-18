import { describe, expect, it } from 'vitest';

import { GitHubUrlError, parseGitHubRepoInput } from './github-url';

describe('parseGitHubRepoInput', () => {
  it('normalizes https GitHub URLs and strips .git', () => {
    expect(parseGitHubRepoInput('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      canonicalUrl: 'https://github.com/vercel/next.js',
      cloneUrl: 'https://github.com/vercel/next.js.git',
    });
  });

  it('accepts trailing slashes and www', () => {
    expect(parseGitHubRepoInput('https://www.github.com/octocat/Hello-World/')).toMatchObject({
      owner: 'octocat',
      repo: 'Hello-World',
      canonicalUrl: 'https://github.com/octocat/Hello-World',
    });
  });

  it('accepts owner/repo shorthand', () => {
    expect(parseGitHubRepoInput('facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
      canonicalUrl: 'https://github.com/facebook/react',
      cloneUrl: 'https://github.com/facebook/react.git',
    });
  });

  it('accepts github.com/owner/repo without a scheme', () => {
    expect(parseGitHubRepoInput('github.com/octocat/Hello-World')).toMatchObject({
      owner: 'octocat',
      repo: 'Hello-World',
    });
  });

  it('rejects credentials in the URL', () => {
    expect(() => parseGitHubRepoInput('https://user:git@github.com/vercel/next.js')).toThrow(
      GitHubUrlError,
    );
  });

  it('rejects extra path segments', () => {
    expect(() => parseGitHubRepoInput('https://github.com/vercel/next.js/issues/1')).toThrow(
      GitHubUrlError,
    );
  });

  it('rejects SSH and git protocol URLs', () => {
    expect(() => parseGitHubRepoInput('git@github.com:vercel/next.js.git')).toThrow(GitHubUrlError);
    expect(() => parseGitHubRepoInput('ssh://git@github.com/vercel/next.js.git')).toThrow(
      GitHubUrlError,
    );
    expect(() => parseGitHubRepoInput('git://github.com/vercel/next.js.git')).toThrow(
      GitHubUrlError,
    );
  });

  it('rejects non-GitHub hosts', () => {
    expect(() => parseGitHubRepoInput('https://gitlab.com/owner/repo')).toThrow(GitHubUrlError);
  });

  it('rejects empty input', () => {
    expect(() => parseGitHubRepoInput('  ')).toThrow(GitHubUrlError);
  });

  it('rejects owner names that look like git flags', () => {
    expect(() => parseGitHubRepoInput('https://github.com/--upload-pack/repo')).toThrow(
      GitHubUrlError,
    );
  });
});
