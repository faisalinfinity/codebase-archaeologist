import { describe, expect, it } from 'vitest';

import { getIngestionLimits } from './limits';

describe('getIngestionLimits', () => {
  it('uses documented defaults', () => {
    const limits = getIngestionLimits({});
    expect(limits.maxRepositorySizeMb).toBe(500);
    expect(limits.maxFiles).toBe(20_000);
    expect(limits.maxFileSizeBytes).toBe(1024 * 1024);
    expect(limits.cloneTimeoutMs).toBe(120_000);
    expect(limits.maxEmbeddingChunks).toBe(2_000);
    expect(limits.embeddingTimeoutMs).toBe(600_000);
  });

  it('reads positive integers from env', () => {
    const limits = getIngestionLimits({
      MAX_REPOSITORY_SIZE_MB: '12',
      MAX_FILE_SIZE_MB: '2',
      MAX_FILES: '50',
      MAX_EMBED_CHUNKS: '25',
      EMBED_TIMEOUT_MS: '1000',
    });
    expect(limits.maxRepositorySizeMb).toBe(12);
    expect(limits.maxFileSizeBytes).toBe(2 * 1024 * 1024);
    expect(limits.maxFiles).toBe(50);
    expect(limits.maxEmbeddingChunks).toBe(25);
    expect(limits.embeddingTimeoutMs).toBe(1000);
  });
});
