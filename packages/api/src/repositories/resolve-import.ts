import path from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function resolveImport(
  sourcePath: string,
  specifier: string,
  availablePaths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext)];
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  if (base.endsWith('.mjs')) candidates.push(base.slice(0, -4) + '.mts');
  if (base.endsWith('.cjs')) candidates.push(base.slice(0, -4) + '.cts');
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${base}/index${ext}`);
  return candidates.find((candidate) => availablePaths.has(candidate)) ?? null;
}
