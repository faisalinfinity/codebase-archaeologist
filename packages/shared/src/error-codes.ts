export const errorCodes = [
  'INVALID_GITHUB_URL',
  'REPOSITORY_NOT_FOUND',
  'PRIVATE_REPOSITORY',
  'GITHUB_RATE_LIMITED',
  'REPOSITORY_TOO_LARGE',
  'UNSUPPORTED_REPOSITORY',
  'INDEX_FAILED',
  'INDEX_TIMEOUT',
  'REDIS_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorMessages: Record<ErrorCode, string> = {
  INVALID_GITHUB_URL: 'Enter a valid GitHub URL such as https://github.com/owner/repo.',
  REPOSITORY_NOT_FOUND:
    'GitHub could not find that repository. It may be private, or the URL is wrong.',
  PRIVATE_REPOSITORY: 'This repository is private. Only public GitHub repositories can be indexed.',
  GITHUB_RATE_LIMITED:
    'GitHub rate limit reached while fetching repository metadata. Retry later or set GITHUB_API_TOKEN.',
  REPOSITORY_TOO_LARGE: 'This repository exceeds the configured size limit for indexing.',
  UNSUPPORTED_REPOSITORY: 'This GitHub URL is not a supported public repository.',
  INDEX_FAILED: 'Indexing failed. See the job error for details.',
  INDEX_TIMEOUT: 'Indexing timed out while cloning or scanning the repository.',
  REDIS_UNAVAILABLE: 'The index queue is unavailable. Start Redis and retry.',
};
