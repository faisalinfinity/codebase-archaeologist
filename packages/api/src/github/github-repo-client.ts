import { errorMessages, parseGitHubRepoInput, isIgnoredFilePath } from '@archaeologist/shared';

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

export interface GitHubPullRequestSummary {
  files?: Array<{ path: string; changeType: string }>;
  filesComplete?: boolean;
  relatedIssues?: number[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: Date | null;
  mergedAt: Date | null;
  updatedAt: Date | null;
}

export interface GitHubIssueSummary {
  filePaths?: string[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface GitHubTimelineReader {
  getPullRequests(owner: string, repo: string): Promise<GitHubPullRequestSummary[]>;
  getIssues(owner: string, repo: string): Promise<GitHubIssueSummary[]>;
}

interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  maxPullRequestDetails?: number;
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
  private readonly maxPullRequestDetails: number;

  constructor(options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? 'codebase-archaeologist';
    this.token = options.token;
    this.maxPullRequestDetails = Math.min(20, Math.max(0, options.maxPullRequestDetails ?? 10));
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepoMetadata> {
    const parsed = parseGitHubRepoInput(`${owner}/${repo}`);
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2026-03-10',
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

  private async timelineRequest(
    owner: string,
    repo: string,
    kind: 'pulls' | 'issues' | `pulls/${number}/files`,
    page = 1,
  ): Promise<unknown[]> {
    const parsed = parseGitHubRepoInput(`${owner}/${repo}`);
    const url = new URL(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/${kind}`);
    url.search = new URLSearchParams({
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: '100',
      page: String(page),
    }).toString();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2026-03-10',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HttpError(502, 'GITHUB_CONTEXT_FAILED', 'Could not load GitHub history context.');
    }
    if (response.status === 403 || response.status === 429) {
      throw errorFromCode('GITHUB_RATE_LIMITED');
    }
    if (!response.ok) {
      throw new HttpError(502, 'GITHUB_CONTEXT_FAILED', 'Could not load GitHub history context.');
    }
    const value: unknown = await response.json();
    if (!Array.isArray(value))
      throw new HttpError(502, 'GITHUB_CONTEXT_FAILED', 'GitHub returned invalid history context.');
    return value;
  }

  async getPullRequests(owner: string, repo: string): Promise<GitHubPullRequestSummary[]> {
    const values = await this.timelineRequest(owner, repo, 'pulls');
    const summaries: GitHubPullRequestSummary[] = values.flatMap((item) => {
      if (!isTimelineItem(item)) return [];
      return [
        {
          number: item.number,
          title: item.title.slice(0, 500),
          body: typeof item.body === 'string' ? item.body.slice(0, 4000) : null,
          author: authorOf(item),
          state: item.state,
          createdAt: dateOf(item.created_at),
          mergedAt: dateOf(item.merged_at),
          updatedAt: dateOf(item.updated_at),
          relatedIssues: [
            ...(typeof item.body === 'string' ? item.body : '').matchAll(
              /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi,
            ),
          ].map((match) => Number(match[1])),
        },
      ];
    });
    // Two concurrent detail requests keep GitHub API fan-out bounded.
    for (
      let start = 0;
      start < Math.min(summaries.length, this.maxPullRequestDetails);
      start += 2
    ) {
      await Promise.all(
        summaries.slice(start, Math.min(start + 2, this.maxPullRequestDetails)).map(async (pr) => {
          try {
            const files: NonNullable<GitHubPullRequestSummary['files']> = [];
            let complete = false;
            for (let page = 1; page <= 3; page++) {
              const rows = await this.timelineRequest(
                owner,
                repo,
                `pulls/${pr.number}/files`,
                page,
              );
              for (const raw of rows) {
                if (
                  !raw ||
                  typeof raw !== 'object' ||
                  !('filename' in raw) ||
                  typeof raw.filename !== 'string' ||
                  isIgnoredFilePath(raw.filename)
                )
                  continue;
                files.push({
                  path: raw.filename,
                  changeType:
                    'status' in raw && typeof raw.status === 'string' ? raw.status : 'modified',
                });
                if (
                  'previous_filename' in raw &&
                  typeof raw.previous_filename === 'string' &&
                  !isIgnoredFilePath(raw.previous_filename)
                )
                  files.push({ path: raw.previous_filename, changeType: 'renamed-from' });
              }
              if (rows.length < 100) {
                complete = true;
                break;
              }
            }
            pr.files = files;
            pr.filesComplete = complete;
          } catch {
            pr.filesComplete = false;
          }
        }),
      );
    }
    return summaries;
  }

  async getIssues(owner: string, repo: string): Promise<GitHubIssueSummary[]> {
    const values = await this.timelineRequest(owner, repo, 'issues');
    return values.flatMap((item) => {
      if (!isTimelineItem(item) || 'pull_request' in item) return [];
      return [
        {
          number: item.number,
          title: item.title.slice(0, 500),
          body: typeof item.body === 'string' ? item.body.slice(0, 4000) : null,
          author: authorOf(item),
          state: item.state,
          createdAt: dateOf(item.created_at),
          updatedAt: dateOf(item.updated_at),
        },
      ];
    });
  }
}

function isTimelineItem(value: unknown): value is Record<string, unknown> & {
  number: number;
  title: string;
  state: string;
} {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'number' in value &&
    typeof value.number === 'number' &&
    Number.isSafeInteger(value.number) &&
    value.number > 0 &&
    'title' in value &&
    typeof value.title === 'string' &&
    'state' in value &&
    typeof value.state === 'string',
  );
}

function authorOf(item: Record<string, unknown>): string | null {
  const user = item.user;
  return user && typeof user === 'object' && 'login' in user && typeof user.login === 'string'
    ? user.login.slice(0, 200)
    : null;
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
