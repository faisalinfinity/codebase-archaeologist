import { describe, expect, it } from 'vitest';

import { embedChunks, EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './embedding-provider';

describe('embedChunks', () => {
  it('embeds bounded segments and returns one normalized vector per chunk', async () => {
    const batches: string[][] = [];
    const provider: EmbeddingProvider = {
      model: 'fake',
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(inputs) {
        batches.push([...inputs]);
        return inputs.map((input) => {
          const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
          vector[input.startsWith('a') ? 0 : 1] = 1;
          return vector;
        });
      },
    };
    const vectors = await embedChunks(provider, ['a'.repeat(4500), 'b']);
    expect(batches[0]?.map((input) => input.length)).toEqual([4000, 500, 1]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[1]?.[1]).toBe(1);
  });
});
