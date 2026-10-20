import type { AIProvider, AIStreamEvent } from './ai-provider';

const ENDPOINT = 'https://api.openai.com/v1/responses';

async function* responseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending = (pending + decoder.decode(value, { stream: !done })).replaceAll('\r\n', '\n');
      let boundary = pending.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data) as unknown;
          } catch {
            throw new Error('AI provider returned an invalid event.');
          }
        }
        boundary = pending.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class OpenAIResponsesProvider implements AIProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { apiKey: string; model?: string; fetcher?: typeof fetch }) {
    if (!options.apiKey) throw new Error('DEMO_AI_API_KEY is required for chat.');
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4.1-mini';
    this.fetcher = options.fetcher ?? fetch;
  }

  async *stream(input: {
    instructions: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutputTokens: number;
    signal?: AbortSignal;
  }): AsyncIterable<AIStreamEvent> {
    const timeout = AbortSignal.timeout(60_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        instructions: input.instructions,
        input: input.messages,
        max_output_tokens: input.maxOutputTokens,
        stream: true,
        store: false,
      }),
      signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`AI provider returned HTTP ${response.status}.`);
    let completed = false;
    for await (const raw of responseEvents(response.body)) {
      if (!raw || typeof raw !== 'object' || !('type' in raw)) continue;
      if (
        raw.type === 'response.output_text.delta' &&
        'delta' in raw &&
        typeof raw.delta === 'string'
      ) {
        yield { type: 'delta', text: raw.delta };
      } else if (raw.type === 'response.completed') {
        const responseValue =
          'response' in raw && raw.response && typeof raw.response === 'object'
            ? raw.response
            : null;
        const usage =
          responseValue &&
          'usage' in responseValue &&
          responseValue.usage &&
          typeof responseValue.usage === 'object'
            ? responseValue.usage
            : null;
        const inputTokens =
          usage && 'input_tokens' in usage && Number.isSafeInteger(usage.input_tokens)
            ? (usage.input_tokens as number)
            : null;
        const outputTokens =
          usage && 'output_tokens' in usage && Number.isSafeInteger(usage.output_tokens)
            ? (usage.output_tokens as number)
            : null;
        completed = true;
        yield { type: 'completed', usage: { inputTokens, outputTokens } };
        break;
      } else if (
        raw.type === 'response.failed' ||
        raw.type === 'response.incomplete' ||
        raw.type === 'error'
      ) {
        throw new Error('AI provider did not complete the response.');
      }
    }
    if (!completed) throw new Error('AI provider stream ended before completion.');
  }
}

export function configuredAIProvider(env: Record<string, string | undefined>): AIProvider | null {
  if (!env.DEMO_AI_API_KEY) return null;
  if (env.DEMO_AI_PROVIDER && env.DEMO_AI_PROVIDER !== 'openai') {
    throw new Error('Unsupported Demo AI provider.');
  }
  return new OpenAIResponsesProvider({ apiKey: env.DEMO_AI_API_KEY, model: env.DEMO_AI_MODEL });
}
