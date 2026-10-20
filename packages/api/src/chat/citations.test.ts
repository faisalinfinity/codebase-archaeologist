import { describe, expect, it } from 'vitest';

import {
  evidenceFromSearch,
  historyEvidenceFromHistory,
  validateAnswerCitations,
} from './citations';

describe('citation validation', () => {
  it('links only source records returned by retrieval', () => {
    const evidence = evidenceFromSearch({
      repositoryId: 'repo',
      commitSha: 'abc123',
      mode: 'lexical',
      results: [
        {
          chunkId: 'chunk',
          filePath: 'src/auth.ts',
          startLine: 3,
          endLine: 8,
          snippet: 'export function authenticate() {}',
          githubUrl: 'https://github.com/owner/repo/blob/abc123/src/auth.ts#L3',
          score: 1,
        },
      ],
    });
    const result = validateAnswerCitations(
      'Authentication lives here [S1]. Another claim [S99].',
      evidence,
    );
    expect(result.answer).toBe('Authentication lives here [S1]. Another claim .');
    expect(result.citations).toEqual([
      expect.objectContaining({ id: 'S1', filePath: 'src/auth.ts', startLine: 3 }),
    ]);
  });

  it('validates commit, PR, and issue markers against indexed context', () => {
    const evidence = historyEvidenceFromHistory(
      {
        repositoryId: 'repo',
        githubUrl: 'https://github.com/owner/repo',
        commits: [
          {
            sha: 'a'.repeat(40),
            parentSha: null,
            authorName: 'Test',
            committedAt: null,
            message: 'introduce authentication',
            files: [{ path: 'src/auth.ts', changeType: 'A' }],
          },
        ],
        pullRequests: [
          {
            number: 4,
            title: 'Improve authentication',
            body: null,
            author: 'test',
            state: 'closed',
            createdAt: null,
            mergedAt: null,
            updatedAt: null,
          },
        ],
        issues: [
          {
            number: 5,
            title: 'Authentication bug',
            body: null,
            author: 'test',
            state: 'open',
            createdAt: null,
            updatedAt: null,
          },
        ],
      },
      'Why authentication changed?',
      'snapshot-sha',
    );
    const result = validateAnswerCitations(
      'Introduced [H1], reviewed [P1], tracked [I1], invented [H9].',
      evidence,
    );
    expect(result.citations.map((citation) => citation.kind)).toEqual([
      'commit',
      'pull_request',
      'issue',
    ]);
    expect(result.answer).not.toContain('[H9]');
  });
});
