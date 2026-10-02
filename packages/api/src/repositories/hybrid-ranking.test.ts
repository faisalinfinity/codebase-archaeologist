import { describe, expect, it } from 'vitest';

import { fuseResults, searchSnippet } from './hybrid-ranking';

const candidate = (chunkId: string) => ({
  chunkId,
  filePath: `${chunkId}.ts`,
  content: chunkId,
  startLine: 1,
  endLine: 2,
  score: 1,
});

describe('hybrid ranking', () => {
  it('promotes evidence found by both methods', () => {
    const results = fuseResults([candidate('a'), candidate('b')], [candidate('b'), candidate('c')]);
    expect(results.map((item) => item.chunkId)).toEqual(['b', 'a', 'c']);
  });

  it('shows matching text near the query', () => {
    const snippet = searchSnippet(
      `${'x'.repeat(500)}authentication works here`,
      'authentication',
      100,
    );
    expect(snippet).toContain('authentication');
    expect(snippet.startsWith('…')).toBe(true);
  });
});
