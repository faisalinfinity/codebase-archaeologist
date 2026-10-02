import { createHash } from 'node:crypto';
import { open, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  getIngestionLimits,
  isIgnoredDirectoryName,
  isIgnoredFilePath,
  type IngestionLimits,
} from '@archaeologist/shared';

import { detectLanguage, isProbablyBinary } from './binary';
import { IngestionError } from './errors';
import { isInsideRoot, toPosixRelative } from './path-safety';

export interface ScannedFile {
  path: string;
  sizeBytes: number;
  language: string | null;
  sha: string | null;
  isBinary: boolean;
  isGenerated: boolean;
  skipped: boolean;
  skipReason?: string;
}

export interface ScanResult {
  files: ScannedFile[];
  filesIndexed: number;
  filesSkipped: number;
  filesSeen: number;
  skippedReasons: Record<string, number>;
}

function bump(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

async function readSample(absolutePath: string, byteCount: number): Promise<Buffer> {
  const handle = await open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sha256File(absolutePath: string): Promise<string> {
  const handle = await open(absolutePath, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * Walk a cloned working tree. Read-only. Never executes files.
 * Skips ignored paths, binaries, oversize files, and symlink/path escapes.
 */
export async function scanRepositoryTree(
  rootDir: string,
  limits: IngestionLimits = getIngestionLimits(),
  startedAt = Date.now(),
): Promise<ScanResult> {
  const rootReal = await realpath(rootDir);
  const files: ScannedFile[] = [];
  const skippedReasons: Record<string, number> = {};
  let filesIndexed = 0;
  let filesSkipped = 0;
  let filesSeen = 0;
  let indexedBytes = 0;

  const visit = async (absoluteDir: string): Promise<void> => {
    if (Date.now() - startedAt > limits.scanTimeoutMs) {
      throw new IngestionError(
        'INDEX_TIMEOUT',
        `Scanning the repository timed out after ${limits.scanTimeoutMs}ms.`,
      );
    }

    let dirReal: string;
    try {
      dirReal = await realpath(absoluteDir);
    } catch {
      filesSkipped += 1;
      bump(skippedReasons, 'unreadable');
      return;
    }
    if (!isInsideRoot(rootReal, dirReal)) {
      filesSkipped += 1;
      bump(skippedReasons, 'path_escape');
      return;
    }

    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (Date.now() - startedAt > limits.scanTimeoutMs) {
        throw new IngestionError(
          'INDEX_TIMEOUT',
          `Scanning the repository timed out after ${limits.scanTimeoutMs}ms.`,
        );
      }

      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName(entry.name)) {
          continue;
        }
        await visit(absolutePath);
        continue;
      }

      filesSeen += 1;

      let relative: string;
      try {
        relative = toPosixRelative(rootReal, absolutePath);
      } catch {
        filesSkipped += 1;
        bump(skippedReasons, 'path_escape');
        continue;
      }

      if (entry.name.includes('\0') || relative.includes('\0')) {
        filesSkipped += 1;
        bump(skippedReasons, 'malicious_name');
        continue;
      }

      if (isIgnoredFilePath(relative)) {
        filesSkipped += 1;
        bump(skippedReasons, 'ignored');
        continue;
      }

      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          const raw = await readlink(absolutePath);
          target = path.resolve(path.dirname(absolutePath), raw);
        } catch {
          filesSkipped += 1;
          bump(skippedReasons, 'symlink');
          continue;
        }
        let targetReal: string;
        try {
          targetReal = await realpath(target);
        } catch {
          filesSkipped += 1;
          bump(skippedReasons, 'symlink');
          continue;
        }
        if (!isInsideRoot(rootReal, targetReal)) {
          filesSkipped += 1;
          bump(skippedReasons, 'symlink_escape');
          files.push({
            path: relative,
            sizeBytes: 0,
            language: null,
            sha: null,
            isBinary: false,
            isGenerated: false,
            skipped: true,
            skipReason: 'symlink_escape',
          });
          continue;
        }
        filesSkipped += 1;
        bump(skippedReasons, 'symlink');
        continue;
      } else if (!entry.isFile()) {
        filesSkipped += 1;
        bump(skippedReasons, 'unsupported_type');
        continue;
      }

      if (filesIndexed >= limits.maxFiles) {
        filesSkipped += 1;
        bump(skippedReasons, 'max_files');
        continue;
      }

      let stats;
      try {
        stats = await stat(absolutePath);
      } catch {
        filesSkipped += 1;
        bump(skippedReasons, 'unreadable');
        continue;
      }

      if (!stats.isFile()) {
        filesSkipped += 1;
        bump(skippedReasons, 'unsupported_type');
        continue;
      }

      if (stats.size > limits.maxFileSizeBytes) {
        filesSkipped += 1;
        bump(skippedReasons, 'file_too_large');
        files.push({
          path: relative,
          sizeBytes: stats.size,
          language: detectLanguage(entry.name),
          sha: null,
          isBinary: false,
          isGenerated: false,
          skipped: true,
          skipReason: 'file_too_large',
        });
        continue;
      }

      if (indexedBytes + stats.size > limits.maxRepositorySizeMb * 1024 * 1024) {
        filesSkipped += 1;
        bump(skippedReasons, 'repository_too_large');
        continue;
      }

      let sample: Buffer;
      try {
        sample = await readSample(absolutePath, 8000);
      } catch {
        filesSkipped += 1;
        bump(skippedReasons, 'unreadable');
        continue;
      }

      const binary = isProbablyBinary(entry.name, sample);
      if (binary) {
        filesSkipped += 1;
        bump(skippedReasons, 'binary');
        files.push({
          path: relative,
          sizeBytes: stats.size,
          language: null,
          sha: null,
          isBinary: true,
          isGenerated: false,
          skipped: true,
          skipReason: 'binary',
        });
        continue;
      }

      let sha: string | null = null;
      try {
        sha = await sha256File(absolutePath);
      } catch {
        filesSkipped += 1;
        bump(skippedReasons, 'unreadable');
        continue;
      }

      filesIndexed += 1;
      indexedBytes += stats.size;
      files.push({
        path: relative,
        sizeBytes: stats.size,
        language: detectLanguage(entry.name),
        sha,
        isBinary: false,
        isGenerated: false,
        skipped: false,
      });
    }
  };

  // Keep traversal and relative-path calculations on the same canonical root.
  // On macOS, /var resolves to /private/var; mixing them rejects valid files.
  await visit(rootReal);

  return {
    files,
    filesIndexed,
    filesSkipped,
    filesSeen,
    skippedReasons,
  };
}
