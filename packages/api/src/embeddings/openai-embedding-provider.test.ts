import { describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIMENSIONS } from './embedding-provider';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider';

describe('OpenAIEmbeddingProvider', () => {
  it('sends a bounded server-side request and restores response order', async () => {
    const first = Array<number>(EMBEDDING_DIMENSIONS).fill(0.1);
    const second = Array<number>(EMBEDDING_DIMENSIONS).fill(0.2);
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'text-embedding-3-small',
            data: [
              { index: 1, embedding: second },
              { index: 0, embedding: first },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-secret', fetcher });
    expect(await provider.embed(['one', 'two'])).toEqual([first, second]);
    const [url, options] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
      input: ['one', 'two'],
    });
  });

  it('does not leak provider response bodies on failure', async () => {
    const fetcher = vi.fn(
      async () => new Response('private provider details', { status: 429 }),
    ) as unknown as typeof fetch;
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-secret', fetcher });
    await expect(provider.embed(['hello'])).rejects.toThrow('HTTP 429');
    await expect(provider.embed(['hello'])).rejects.not.toThrow('private provider details');
  });
});
