import path from 'node:path';

const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.rb',
];

export function resolveImport(
  sourcePath: string,
  specifier: string,
  availablePaths: ReadonlySet<string>,
  aliases: ReadonlyArray<{ pattern: string; targets: string[]; scope?: string }> = [],
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    const applicable = aliases
      .filter((alias) => !alias.scope || sourcePath.startsWith(alias.scope))
      .slice()
      .sort((a, b) => (b.scope?.length ?? 0) - (a.scope?.length ?? 0));
    for (const alias of applicable) {
      const [prefix, suffix = ''] = alias.pattern.split('*');
      const matches = alias.pattern.includes('*')
        ? specifier.startsWith(prefix!) && specifier.endsWith(suffix)
        : specifier === alias.pattern;
      if (!matches) continue;
      const matched = alias.pattern.includes('*')
        ? specifier.slice(prefix!.length, suffix ? -suffix.length : undefined)
        : '';
      for (const target of alias.targets) {
        const resolved = resolveImport(
          'index.ts',
          './' + target.replace('*', matched),
          availablePaths,
        );
        if (resolved) return resolved;
      }
    }
    if (/\.py$/.test(sourcePath)) {
      const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
      const base = dots ? '../'.repeat(Math.max(0, dots - 1)) + './' : '';
      const module = specifier.slice(dots).replaceAll('.', '/');
      const resolved = resolveImport(
        dots ? sourcePath : 'index.py',
        base + (dots ? '' : './') + module,
        availablePaths,
      );
      if (resolved) return resolved;
    }
    return null;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext)];
  if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  if (base.endsWith('.mjs')) candidates.push(base.slice(0, -4) + '.mts');
  if (base.endsWith('.cjs')) candidates.push(base.slice(0, -4) + '.cts');
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${base}/index${ext}`);
  candidates.push(`${base}/__init__.py`, `${base}/mod.rs`);
  return candidates.find((candidate) => availablePaths.has(candidate)) ?? null;
}
