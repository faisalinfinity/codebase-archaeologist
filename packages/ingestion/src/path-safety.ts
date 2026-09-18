import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

export function toPosixRelative(fromRoot: string, absolutePath: string): string {
  const relative = path.relative(fromRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathEscapeError('Path escapes the repository root.');
  }
  return relative.split(path.sep).join('/');
}

export function isInsideRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
