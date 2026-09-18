import { describe, expect, it } from 'vitest';

import { isInsideRoot } from './path-safety';

describe('isInsideRoot', () => {
  it('accepts the root and nested paths', () => {
    expect(isInsideRoot('/tmp/repo', '/tmp/repo')).toBe(true);
    expect(isInsideRoot('/tmp/repo', '/tmp/repo/src/index.ts')).toBe(true);
  });

  it('rejects escapes and prefix siblings', () => {
    expect(isInsideRoot('/tmp/repo', '/tmp/repo/../secret')).toBe(false);
    expect(isInsideRoot('/tmp/repo', '/tmp/repo-evil/file')).toBe(false);
    expect(isInsideRoot('/tmp/repo', '/etc/passwd')).toBe(false);
  });
});
