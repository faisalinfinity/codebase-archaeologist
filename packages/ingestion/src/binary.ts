const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.woff',
  '.woff2',
  '.ttf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.mp4',
  '.mp3',
  '.mov',
  '.wav',
]);

export function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return lower.slice(dot);
}

/**
 * Treat as binary when the extension is known-binary or the sample contains a NUL byte.
 * Only the first chunk should be passed — do not load unbounded files.
 */
export function isProbablyBinary(fileName: string, sample: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(extensionOf(fileName))) {
    return true;
  }
  const length = Math.min(sample.byteLength, 8000);
  for (let i = 0; i < length; i += 1) {
    if (sample[i] === 0) {
      return true;
    }
  }
  return false;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
  '.sh': 'shell',
  '.css': 'css',
  '.html': 'html',
  '.xml': 'xml',
};

export function detectLanguage(fileName: string): string | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(fileName)] ?? null;
}
