import { describe, expect, it } from 'vitest';

import { fuseResults, searchExcerpt } from './hybrid-ranking';

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
    const excerpt = searchExcerpt(
      `${'x'.repeat(500)}authentication works here`,
      'authentication',
      10,
      100,
    );
    expect(excerpt.snippet).toContain('authentication');
    expect(excerpt.snippet.startsWith('…')).toBe(true);
  });

  it('anchors citations to the displayed source lines', () => {
    const excerpt = searchExcerpt(
      `before\n${'x'.repeat(500)}\nauthenticate()\nafter`,
      'authenticate',
      20,
      100,
    );
    expect(excerpt.startLine).toBe(21);
    expect(excerpt.endLine).toBe(23);
  });
});
