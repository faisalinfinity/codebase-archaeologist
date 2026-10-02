import { describe, expect, it } from 'vitest';

import { resolveImport } from './resolve-import';

describe('resolveImport', () => {
  const paths = new Set(['src/helper.ts', 'src/ui/index.tsx', 'src/app.ts']);

  it('resolves relative modules and index files', () => {
    expect(resolveImport('src/app.ts', './helper', paths)).toBe('src/helper.ts');
    expect(resolveImport('src/app.ts', './helper.js', paths)).toBe('src/helper.ts');
    expect(resolveImport('src/app.ts', './ui', paths)).toBe('src/ui/index.tsx');
  });

  it('leaves external and escaping imports unresolved', () => {
    expect(resolveImport('src/app.ts', 'react', paths)).toBeNull();
    expect(resolveImport('src/app.ts', '../../private', paths)).toBeNull();
  });
});
