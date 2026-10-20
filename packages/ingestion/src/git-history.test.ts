import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { readGitHistory } from './git-history';

const execFileAsync = promisify(execFile);

describe('readGitHistory', () => {
  it('reads recent commit messages and changed paths without secret env files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-history-'));
    try {
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await mkdir(path.join(dir, 'src'));
      await writeFile(path.join(dir, 'src', 'auth.ts'), 'export const auth = true;\n');
      await writeFile(path.join(dir, '.env'), 'SECRET=hidden\n');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'add authentication'], { cwd: dir });
      await writeFile(path.join(dir, 'src', 'auth.ts'), 'export const auth = false;\n');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'change auth behavior'], { cwd: dir });

      const history = await readGitHistory(dir, 10, 10_000);
      expect(history.map((commit) => commit.message)).toEqual([
        'change auth behavior',
        'add authentication',
      ]);
      expect(history[0]?.files).toEqual([{ path: 'src/auth.ts', changeType: 'M' }]);
      expect(history[1]?.files).toEqual([{ path: 'src/auth.ts', changeType: 'A' }]);
      expect(history[0]?.parentSha).toBe(history[1]?.sha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
