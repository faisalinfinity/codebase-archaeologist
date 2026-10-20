import { describe, expect, it, vi } from 'vitest';

import { OpenAIResponsesProvider } from './openai-responses-provider';

function eventStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('OpenAIResponsesProvider', () => {
  it('streams text and usage across split SSE frames without storing the provider response', async () => {
    const completed = JSON.stringify({
      type: 'response.completed',
      response: { usage: { input_tokens: 12, output_tokens: 5 } },
    });
    const fetcher = vi.fn(
      async () =>
        new Response(
          eventStream([
            'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","del',
            'ta":"Hello"}\r',
            `\n\r\nevent: response.completed\r\ndata: ${completed}\r\n\r\n`,
          ]),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const provider = new OpenAIResponsesProvider({ apiKey: 'test-secret', fetcher });
    const events = [];
    for await (const event of provider.stream({
      instructions: 'Use citations.',
      messages: [{ role: 'user', content: 'Explain this.' }],
      maxOutputTokens: 1200,
    }))
      events.push(event);
    expect(events).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'completed', usage: { inputTokens: 12, outputTokens: 5 } },
    ]);
    const [, options] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: 'gpt-4.1-mini',
      stream: true,
      store: false,
      max_output_tokens: 1200,
    });
  });

  it('does not expose provider error bodies', async () => {
    const fetcher = vi.fn(
      async () => new Response('secret account detail', { status: 401 }),
    ) as unknown as typeof fetch;
    const provider = new OpenAIResponsesProvider({ apiKey: 'test-secret', fetcher });
    const run = async () => {
      for await (const _event of provider.stream({
        instructions: 'test',
        messages: [],
        maxOutputTokens: 20,
      })) {
        // Consume the stream.
      }
    };
    await expect(run()).rejects.toThrow('HTTP 401');
    await expect(run()).rejects.not.toThrow('secret account detail');
  });
});
