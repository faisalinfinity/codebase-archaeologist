import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { assertSafeOwnerRepo, type ParsedGitHubRepo } from '@archaeologist/shared';

import { IngestionError } from './errors';

const execFileAsync = promisify(execFile);

export interface CloneOptions {
  owner: string;
  repo: string;
  destDir: string;
  timeoutMs: number;
  branch?: string;
}

export interface CloneResult extends ParsedGitHubRepo {
  commitSha: string;
  branch: string;
  destDir: string;
}

export interface CloneRemoteOptions {
  remoteUrl: string;
  destDir: string;
  timeoutMs: number;
  branch?: string;
  allowFileProtocol?: boolean;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    // Prevent credential helpers from prompting or sending secrets.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
  };
}

function mapGitError(error: unknown, timeoutMs: number): never {
  const err = error as {
    killed?: boolean;
    signal?: string;
    message?: string;
    stderr?: string;
    stdout?: string;
  };
  const detail = `${err.stderr ?? ''} ${err.message ?? ''}`.toLowerCase();

  if (err.killed || err.signal === 'SIGTERM') {
    throw new IngestionError(
      'INDEX_TIMEOUT',
      `Cloning the repository timed out after ${timeoutMs}ms.`,
    );
  }
  if (detail.includes('authentication failed') || detail.includes('could not read username')) {
    throw new IngestionError(
      'PRIVATE_REPOSITORY',
      'This repository is private. Only public GitHub repositories can be indexed.',
    );
  }
  if (
    detail.includes('repository not found') ||
    detail.includes('not found') ||
    detail.includes('remote: 404')
  ) {
    throw new IngestionError(
      'REPOSITORY_NOT_FOUND',
      'GitHub could not find that repository. It may be private, or the URL is wrong.',
    );
  }
  throw new IngestionError('INDEX_FAILED', 'Read-only git clone failed.');
}

/**
 * Low-level read-only clone. Production code must call `clonePublicGitHubRepo`,
 * which only clones https://github.com/{owner}/{repo}.git after validating names.
 */
export async function cloneGitRemote(options: CloneRemoteOptions): Promise<{
  commitSha: string;
  branch: string;
  destDir: string;
}> {
  if (!options.allowFileProtocol && !/^https:\/\/github\.com\//i.test(options.remoteUrl)) {
    throw new IngestionError(
      'INVALID_GITHUB_URL',
      'Clone URL is not a public github.com HTTPS URL.',
    );
  }

  const args = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--no-tags',
    '--no-recurse-submodules',
  ];

  if (!options.allowFileProtocol) {
    args.unshift('-c', 'protocol.file.allow=never');
  }

  if (options.branch) {
    args.push('--branch', options.branch);
  }

  args.push('--', options.remoteUrl, options.destDir);

  try {
    await execFileAsync('git', args, {
      env: gitEnv(),
      timeout: options.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    mapGitError(error, options.timeoutMs);
  }

  const { stdout: shaOut } = await execFileAsync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-C', options.destDir, 'rev-parse', 'HEAD'],
    { env: gitEnv(), timeout: 15_000, maxBuffer: 1024 * 1024 },
  );

  let branch = options.branch ?? '';
  if (!branch) {
    const { stdout: branchOut } = await execFileAsync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-C',
        options.destDir,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ],
      { env: gitEnv(), timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    branch = branchOut.trim();
  }

  return {
    commitSha: shaOut.trim(),
    branch: branch || 'HEAD',
    destDir: options.destDir,
  };
}

/**
 * Clone a validated public GitHub repository with read-only git.
 * Never interpolates owner/repo into a shell string. Never runs repository hooks.
 */
export async function clonePublicGitHubRepo(options: CloneOptions): Promise<CloneResult> {
  const parsed = assertSafeOwnerRepo(options.owner, options.repo);
  const cloned = await cloneGitRemote({
    remoteUrl: parsed.cloneUrl,
    destDir: options.destDir,
    timeoutMs: options.timeoutMs,
    branch: options.branch,
    allowFileProtocol: false,
  });
  return {
    ...parsed,
    ...cloned,
  };
}
