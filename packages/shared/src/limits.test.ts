import { describe, expect, it } from 'vitest';

import { getIngestionLimits } from './limits';

describe('getIngestionLimits', () => {
  it('allows a larger bounded history window in full-history mode', () => {
    expect(getIngestionLimits({ HISTORY_MODE: 'full' })).toMatchObject({
      fullHistory: true,
      maxHistoryCommits: 10_000,
    });
    expect(
      getIngestionLimits({ HISTORY_MODE: 'full', MAX_HISTORY_COMMITS: '999999' }).maxHistoryCommits,
    ).toBe(100_000);
  });
  it('uses documented defaults', () => {
    const limits = getIngestionLimits({});
    expect(limits.maxRepositorySizeMb).toBe(500);
    expect(limits.maxFiles).toBe(20_000);
    expect(limits.maxFileSizeBytes).toBe(1024 * 1024);
    expect(limits.cloneTimeoutMs).toBe(120_000);
    expect(limits.maxEmbeddingChunks).toBe(2_000);
    expect(limits.embeddingTimeoutMs).toBe(600_000);
    expect(limits.maxHistoryCommits).toBe(50);
    expect(limits.historyTimeoutMs).toBe(120_000);
  });

  it('reads positive integers from env', () => {
    const limits = getIngestionLimits({
      MAX_REPOSITORY_SIZE_MB: '12',
      MAX_FILE_SIZE_MB: '2',
      MAX_FILES: '50',
      MAX_EMBED_CHUNKS: '25',
      EMBED_TIMEOUT_MS: '1000',
      MAX_HISTORY_COMMITS: '10',
      HISTORY_TIMEOUT_MS: '2000',
    });
    expect(limits.maxRepositorySizeMb).toBe(12);
    expect(limits.maxFileSizeBytes).toBe(2 * 1024 * 1024);
    expect(limits.maxFiles).toBe(50);
    expect(limits.maxEmbeddingChunks).toBe(25);
    expect(limits.embeddingTimeoutMs).toBe(1000);
    expect(limits.maxHistoryCommits).toBe(10);
    expect(limits.historyTimeoutMs).toBe(2000);
  });
});
