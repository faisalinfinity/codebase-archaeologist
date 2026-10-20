import { expect, it, vi } from 'vitest';
import { RoutedAIProvider } from './multi-provider';

function response(events: unknown[]) {
  return new Response(
    events
      .map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
const input = {
  instructions: 'Cite evidence.',
  messages: [{ role: 'user' as const, content: 'Question' }],
  maxOutputTokens: 100,
};

it.each(['openai', 'gemini', 'openrouter', 'custom'] as const)(
  'streams %s with usage and rejects incomplete answers',
  async (provider) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([
          { choices: [{ delta: { content: 'Answer [S1]' }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
          '[DONE]',
        ]),
      );
    const adapter = new RoutedAIProvider({
      provider,
      model: 'model',
      apiKey: 'secret-key',
      baseUrl: provider === 'custom' ? 'https://custom.example.com/v1' : undefined,
      fetcher,
    });
    const events = [];
    for await (const event of adapter.stream(input)) events.push(event);
    expect(events).toEqual([
      { type: 'delta', text: 'Answer [S1]' },
      { type: 'completed', usage: { inputTokens: 10, outputTokens: 4 } },
    ]);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages[0].role).toBe('system');
    fetcher.mockResolvedValue(
      response([{ choices: [{ delta: {}, finish_reason: 'length' }] }, '[DONE]']),
    );
    await expect(async () => {
      for await (const event of adapter.stream(input)) void event;
    }).rejects.toMatchObject({ code: 'ai_token_limit' });
    fetcher.mockResolvedValue(response([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]));
    await expect(async () => {
      for await (const event of adapter.stream(input)) void event;
    }).rejects.toMatchObject({ code: 'ai_incomplete_stream' });
  },
);

it('streams Anthropic native events and captures token usage', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      response([
        { type: 'message_start', message: { usage: { input_tokens: 12 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]),
    );
  const provider = new RoutedAIProvider({
    provider: 'anthropic',
    model: 'model',
    apiKey: 'secret-key',
    fetcher,
  });
  const events = [];
  for await (const event of provider.stream(input)) events.push(event);
  expect(events.at(-1)).toEqual({ type: 'completed', usage: { inputTokens: 12, outputTokens: 5 } });
  expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ 'x-api-key': 'secret-key' });
});

it('reserves a bounded combined token budget for mandatory free reasoning models', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    response([
      {
        choices: [
          { delta: { reasoning: 'Private reasoning is not answer text.' }, finish_reason: null },
        ],
      },
      { choices: [{ delta: { content: 'Grounded answer [S1]' }, finish_reason: 'stop' }] },
      '[DONE]',
    ]),
  );
  const provider = new RoutedAIProvider({
    provider: 'openrouter',
    model: 'minimax/minimax-m3.1-flash:free',
    apiKey: 'secret-key',
    fetcher,
    openRouterPolicy: {
      reasoning: { effort: 'low', exclude: true },
      minimumCompletionTokens: 8192,
    },
  });
  const events = [];
  for await (const event of provider.stream(input)) events.push(event);
  const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({
    model: 'minimax/minimax-m3.1-flash:free',
    max_tokens: 8192,
    reasoning: { effort: 'low', exclude: true },
  });
  expect(events.filter((event) => event.type === 'delta')).toEqual([
    { type: 'delta', text: 'Grounded answer [S1]' },
  ]);
});

it.each([401, 402, 429, 503])('reports a safe provider error for HTTP %s', async (status) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: status,
          message: 'Sensitive sk-or-private-key prompt text',
          metadata: { raw: 'private prompt' },
        },
      }),
      { status },
    ),
  );
  const provider = new RoutedAIProvider({
    provider: 'openrouter',
    model: 'test',
    apiKey: 'secret-key',
    fetcher,
  });
  try {
    for await (const event of provider.stream(input)) void event;
    throw new Error('Expected provider failure.');
  } catch (error) {
    expect(error).toMatchObject({ code: expect.stringMatching(/^ai_/), upstreamStatus: status });
    expect(JSON.stringify(error)).not.toMatch(/sk-or-private-key|private prompt/);
    expect((error as Error).message).not.toMatch(/sk-or-private-key|private prompt/);
  }
});

it('recognizes OpenRouter privacy routing and midstream rate-limit errors', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: 'No endpoints found matching your data policy. Sensitive upstream text.',
        },
      }),
      { status: 404 },
    ),
  );
  const provider = new RoutedAIProvider({
    provider: 'openrouter',
    model: 'test',
    apiKey: 'secret-key',
    fetcher,
  });
  await expect(async () => {
    for await (const event of provider.stream(input)) void event;
  }).rejects.toMatchObject({ code: 'ai_privacy' });
  fetcher.mockResolvedValue(
    response([
      {
        error: { code: 429, message: 'Raw upstream details' },
        choices: [{ finish_reason: 'error' }],
      },
    ]),
  );
  await expect(async () => {
    for await (const event of provider.stream(input)) void event;
  }).rejects.toMatchObject({ code: 'ai_rate_limit' });
});
