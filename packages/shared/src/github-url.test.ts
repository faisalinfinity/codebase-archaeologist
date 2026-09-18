import { describe, expect, it } from 'vitest';

import { GitHubUrlError, parseGitHubRepoInput } from './github-url';

describe('parseGitHubRepoInput', () => {
  it('normalizes https GitHub URLs and strips .git', () => {
    expect(parseGitHubRepoInput('https://github.com/vercel/next.js.git')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      canonicalUrl: 'https://github.com/vercel/next.js',
    });
  });

  it('accepts owner/repo shorthand', () => {
    expect(parseGitHubRepoInput('facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
      canonicalUrl: 'https://github.com/facebook/react',
    });
  });

  it('rejects credentials in the URL', () => {
    expect(() => parseGitHubRepoInput('https://user:git@github.com/vercel/next.js')).toThrow(
      GitHubUrlError,
    );
  });

  it('rejects non-GitHub hosts', () => {
    expect(() => parseGitHubRepoInput('https://gitlab.com/owner/repo')).toThrow(GitHubUrlError);
  });

  it('rejects empty input', () => {
    expect(() => parseGitHubRepoInput('  ')).toThrow(GitHubUrlError);
  });
});
