import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { cloneGitRemote, clonePublicGitHubRepo } from './git-clone';
import { IngestionError } from './errors';

const execFileAsync = promisify(execFile);

async function initLocalGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-git-src-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'README.md'), '# fixture\n');
  await writeFile(path.join(dir, 'src', 'main.ts'), 'export const ok = true;\n');
  await execFileAsync('git', ['add', '.'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('cloneGitRemote', () => {
  it('clones a local git fixture with hooks disabled and returns HEAD sha', async () => {
    const source = await initLocalGitRepo();
    const dest = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-git-dest-'));
    await rm(dest, { recursive: true, force: true });

    const cloned = await cloneGitRemote({
      remoteUrl: source,
      destDir: dest,
      timeoutMs: 15_000,
      allowFileProtocol: true,
    });

    expect(cloned.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(cloned.branch).toBe('main');
    const readme = await readFile(path.join(dest, 'README.md'), 'utf8');
    expect(readme).toContain('fixture');
  });

  it('refuses non-github remotes unless explicitly allowed for tests', async () => {
    await expect(
      cloneGitRemote({
        remoteUrl: 'https://evil.example/repo.git',
        destDir: '/tmp/should-not-exist',
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(IngestionError);
  });
});

describe('clonePublicGitHubRepo', () => {
  it('rejects owner/repo names that are not canonical github identifiers', async () => {
    await expect(
      clonePublicGitHubRepo({
        owner: '../etc',
        repo: 'passwd',
        destDir: '/tmp/should-not-exist',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });
});
