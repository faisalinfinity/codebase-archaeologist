import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getIngestionLimits } from '@archaeologist/shared';

import { scanRepositoryTree } from './scanner';

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `archaeologist-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return realpath(dir);
}

describe('scanRepositoryTree', () => {
  it('indexes source and docs, skips ignore rules, binaries, secrets, and oversize files', async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const n = 1;\n');
    await writeFile(path.join(root, 'README.md'), '# demo\n');
    await writeFile(path.join(root, '.env.example'), 'API_KEY=\n');
    await writeFile(path.join(root, '.env'), 'SECRET=dont-index\n');
    await writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await writeFile(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
    await writeFile(path.join(root, 'huge.txt'), 'x'.repeat(2048));

    const result = await scanRepositoryTree(
      root,
      getIngestionLimits(
        {},
        {
          maxFileSizeBytes: 1024,
          maxFiles: 50,
          maxRepositorySizeMb: 10,
          scanTimeoutMs: 10_000,
          cloneTimeoutMs: 10_000,
        },
      ),
    );

    const indexed = result.files
      .filter((file) => !file.skipped)
      .map((file) => file.path)
      .sort();
    expect(indexed).toEqual(['.env.example', 'README.md', 'src/index.ts']);
    expect(result.filesSkipped).toBeGreaterThan(0);
    expect(result.skippedReasons.ignored).toBeGreaterThan(0);
    expect(result.skippedReasons.file_too_large).toBeGreaterThan(0);
    expect(result.files.find((file) => file.path === '.env')).toBeUndefined();
    expect(result.files.find((file) => file.path.includes('node_modules'))).toBeUndefined();
  });

  it('skips symlinks that escape the clone root', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'ok.ts'), 'export {}\n');
    await symlink('/etc/passwd', path.join(root, 'escape.ts'));

    const result = await scanRepositoryTree(
      root,
      getIngestionLimits({}, { scanTimeoutMs: 10_000 }),
    );
    const escape = result.files.find((file) => file.path === 'escape.ts');
    expect(escape?.skipped).toBe(true);
    expect(escape?.skipReason).toBe('symlink_escape');
    expect(result.files.find((file) => file.path === 'ok.ts')?.skipped).toBe(false);
  });

  it('detects NUL-byte binaries even with a code-like extension', async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, 'payload.ts'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await scanRepositoryTree(root);
    expect(result.files[0]?.isBinary).toBe(true);
    expect(result.files[0]?.skipped).toBe(true);
  });
});
