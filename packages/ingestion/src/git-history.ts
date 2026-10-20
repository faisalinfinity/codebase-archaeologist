import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isIgnoredFilePath } from '@archaeologist/shared';

import { IngestionError } from './errors';
import { gitEnv } from './git-clone';

const execFileAsync = promisify(execFile);

export interface GitHistoryCommit {
  sha: string;
  parentSha: string | null;
  authorName: string | null;
  committedAt: Date | null;
  message: string;
  files: Array<{ path: string; changeType: string }>;
}

/** Read bounded commit metadata from a clone; no repository program is executed. */
export async function readGitHistory(
  repoDir: string,
  maxCommits: number,
  timeoutMs: number,
): Promise<GitHistoryCommit[]> {
  const startedAt = Date.now();
  const remaining = () => {
    const left = timeoutMs - (Date.now() - startedAt);
    if (left <= 0) throw new IngestionError('INDEX_TIMEOUT', 'Git history scan timed out.');
    return left;
  };
  const run = async (args: string[], maxBuffer = 4 * 1024 * 1024) => {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', repoDir, ...args],
      { env: gitEnv(), timeout: remaining(), maxBuffer },
    );
    return stdout;
  };

  const output = await run(
    [
      'log',
      `--max-count=${Math.min(Math.max(maxCommits, 1), 100_000)}`,
      '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%B%x1e',
    ],
    64 * 1024 * 1024,
  );
  const commits: GitHistoryCommit[] = [];
  for (const raw of output.split('\x1e')) {
    const record = raw.replace(/^\n+/, '').trimEnd();
    if (!record) continue;
    const fields = record.split('\x1f');
    const [sha, parents, authorName, date] = fields;
    if (!sha || !/^[0-9a-f]{40,64}$/i.test(sha)) continue;
    const message = fields.slice(4).join('\x1f').trim().slice(0, 4000);
    const changed = await run(
      [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-status',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
        '-r',
        '-z',
        sha,
      ],
      2 * 1024 * 1024,
    );
    const tokens = changed.split('\0').filter(Boolean);
    const files: GitHistoryCommit['files'] = [];
    for (let i = 0; i + 1 < tokens.length && files.length < 200; i += 2) {
      const status = tokens[i] ?? '';
      const filePath = tokens[i + 1] ?? '';
      if (!filePath || isIgnoredFilePath(filePath)) continue;
      files.push({ path: filePath, changeType: status.slice(0, 1) });
    }
    const timestamp = date ? new Date(date) : null;
    commits.push({
      sha,
      parentSha: parents?.split(' ')[0] || null,
      authorName: authorName?.slice(0, 200) || null,
      committedAt: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
      message,
      files,
    });
  }
  return commits;
}
