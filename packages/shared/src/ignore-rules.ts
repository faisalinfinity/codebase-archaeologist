/**
 * Paths the indexer must skip. Configuration that explains architecture
 * (Dockerfile, tsconfig, .env.example, CI yaml) is NOT ignored.
 */
export const ignoredDirectoryNames = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'coverage',
  'vendor',
  'target',
  'venv',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'Pods',
]);

const ignoredExactFiles = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'poetry.lock',
  'gemfile.lock',
  '.ds_store',
  'thumbs.db',
]);

const ignoredExtensions = new Set([
  '.lock',
  '.min.js',
  '.min.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tif',
  '.tiff',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.7z',
  '.rar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pdf',
  '.psd',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
]);

export function normalizeRelativePath(posixPath: string): string {
  return posixPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function fileName(posixPath: string): string {
  const parts = normalizeRelativePath(posixPath).split('/');
  return parts[parts.length - 1] ?? posixPath;
}

function extensionOf(file: string): string {
  const name = fileName(file).toLowerCase();
  if (name.endsWith('.min.js')) {
    return '.min.js';
  }
  if (name.endsWith('.min.css')) {
    return '.min.css';
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return name.slice(dot);
}

/**
 * Secret env files are never indexed. `.env.example` / `.env.sample` / `.env.template` are docs.
 */
export function isSecretEnvFile(posixPath: string): boolean {
  const name = fileName(posixPath);
  if (!name.startsWith('.env')) {
    return false;
  }
  return !/^\.env\.(example|sample|template)$/i.test(name);
}

export function isIgnoredDirectoryName(name: string): boolean {
  return ignoredDirectoryNames.has(name.toLowerCase());
}

export function pathHasIgnoredDirectory(posixPath: string): boolean {
  const segments = normalizeRelativePath(posixPath).split('/').filter(Boolean);
  return segments.some((segment) => isIgnoredDirectoryName(segment));
}

export function isIgnoredFilePath(posixPath: string): boolean {
  const relative = normalizeRelativePath(posixPath);
  if (!relative || relative === '.') {
    return true;
  }
  if (pathHasIgnoredDirectory(relative)) {
    return true;
  }
  if (isSecretEnvFile(relative)) {
    return true;
  }
  const name = fileName(relative).toLowerCase();
  if (ignoredExactFiles.has(name)) {
    return true;
  }
  const ext = extensionOf(relative);
  if (ext && ignoredExtensions.has(ext)) {
    return true;
  }
  return false;
}

export function isMediaOrArchiveExtension(posixPath: string): boolean {
  return ignoredExtensions.has(extensionOf(posixPath));
}
