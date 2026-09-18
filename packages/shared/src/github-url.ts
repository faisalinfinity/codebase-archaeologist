export const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

export class GitHubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubUrlError';
  }
}

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
  canonicalUrl: string;
  cloneUrl: string;
}

const OWNER_REPO = /^[A-Za-z0-9_.-]+$/;

/**
 * Validate and normalize a public GitHub repository URL or `owner/repo` shorthand.
 * Does not hit the network. Rejects git protocol, credentials, extra paths, and non-GitHub hosts.
 */
export function parseGitHubRepoInput(input: string): ParsedGitHubRepo {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new GitHubUrlError('Repository URL is required.');
  }

  if (/^git@/i.test(trimmed) || /^ssh:\/\//i.test(trimmed) || /^git:\/\//i.test(trimmed)) {
    throw new GitHubUrlError('Only http(s) GitHub URLs are supported.');
  }

  const withoutScheme = trimmed.match(
    /^(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  if (withoutScheme?.[1] && withoutScheme[2] && !trimmed.includes('://')) {
    return canonicalize(withoutScheme[1], withoutScheme[2]);
  }

  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (shorthand?.[1] && shorthand[2] && !trimmed.includes('://') && !trimmed.includes(' ')) {
    return canonicalize(shorthand[1], shorthand[2]);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitHubUrlError('Enter a valid GitHub URL such as https://github.com/owner/repo.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitHubUrlError('Only http(s) GitHub URLs are supported.');
  }

  if (url.username || url.password) {
    throw new GitHubUrlError('Repository URLs must not include credentials.');
  }

  const host = url.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(host)) {
    throw new GitHubUrlError('Only github.com repositories are supported.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repoRaw = parts[1];
  if (!owner || !repoRaw) {
    throw new GitHubUrlError(
      'URL must include owner and repository, e.g. https://github.com/owner/repo.',
    );
  }

  if (parts.length > 2) {
    throw new GitHubUrlError(
      'URL must point at a repository root, e.g. https://github.com/owner/repo.',
    );
  }

  return canonicalize(owner, repoRaw.replace(/\.git$/i, ''));
}

export function assertSafeOwnerRepo(owner: string, repo: string): ParsedGitHubRepo {
  return canonicalize(owner, repo);
}

function canonicalize(owner: string, repo: string): ParsedGitHubRepo {
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repo)) {
    throw new GitHubUrlError('Owner or repository name contains unsupported characters.');
  }
  if (
    owner === '.' ||
    owner === '..' ||
    repo === '.' ||
    repo === '..' ||
    owner.startsWith('-') ||
    repo.startsWith('-')
  ) {
    throw new GitHubUrlError('Owner or repository name is invalid.');
  }
  return {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}
