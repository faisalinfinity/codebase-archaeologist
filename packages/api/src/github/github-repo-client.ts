import { errorMessages, parseGitHubRepoInput } from '@archaeologist/shared';

import { errorFromCode, HttpError } from '../errors';

export interface GitHubRepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  private: boolean;
  sizeKb: number;
  htmlUrl: string;
}

export interface GitHubRepositoryReader {
  getRepository(owner: string, repo: string): Promise<GitHubRepoMetadata>;
}

interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

interface GitHubRepoJson {
  name?: string;
  owner?: { login?: string };
  default_branch?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  private?: boolean;
  size?: number;
  html_url?: string;
  message?: string;
}

function header(headers: Headers, name: string): string | null {
  return headers.get(name);
}

export class GitHubRepoClient implements GitHubRepositoryReader {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly token: string | undefined;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? 'codebase-archaeologist';
    this.token = options.token;
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepoMetadata> {
    const parsed = parseGitHubRepoInput(`${owner}/${repo}`);
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw errorFromCode('INDEX_TIMEOUT', 'Timed out while contacting GitHub.');
      }
      throw errorFromCode('INDEX_FAILED', 'Could not reach GitHub. Try again.');
    }

    const remaining = header(response.headers, 'x-ratelimit-remaining');
    if (response.status === 403 || response.status === 429) {
      if (remaining === '0' || response.status === 429) {
        throw errorFromCode('GITHUB_RATE_LIMITED');
      }
    }

    if (response.status === 404) {
      throw errorFromCode('REPOSITORY_NOT_FOUND');
    }

    if (response.status === 401) {
      throw errorFromCode(
        'GITHUB_RATE_LIMITED',
        'GitHub rejected the request. Check GITHUB_API_TOKEN or retry later.',
      );
    }

    if (!response.ok) {
      throw new HttpError(
        502,
        'INDEX_FAILED',
        'GitHub returned an unexpected error while loading repository metadata.',
      );
    }

    const body = (await response.json()) as GitHubRepoJson;
    if (body.private) {
      throw errorFromCode('PRIVATE_REPOSITORY');
    }

    return {
      owner: body.owner?.login ?? parsed.owner,
      repo: body.name ?? parsed.repo,
      defaultBranch: body.default_branch ?? 'HEAD',
      description: body.description ?? null,
      stars: body.stargazers_count ?? 0,
      forks: body.forks_count ?? 0,
      language: body.language ?? null,
      private: false,
      sizeKb: body.size ?? 0,
      htmlUrl: body.html_url ?? parsed.canonicalUrl,
    };
  }
}

export function assertPublicSize(sizeKb: number, maxRepositorySizeMb: number): void {
  const sizeMb = sizeKb / 1024;
  if (sizeMb > maxRepositorySizeMb) {
    throw errorFromCode(
      'REPOSITORY_TOO_LARGE',
      `${errorMessages.REPOSITORY_TOO_LARGE} (${Math.ceil(sizeMb)} MB > ${maxRepositorySizeMb} MB).`,
    );
  }
}
