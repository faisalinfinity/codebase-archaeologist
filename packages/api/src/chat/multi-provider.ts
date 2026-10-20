import type { AIProvider, AIStreamEvent, AIUsage } from './ai-provider';
import { readSSE } from './sse';
import { secureProviderFetch } from '../providers/secure-fetch';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom';
export const PROVIDER_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
};

type StreamInput = Parameters<AIProvider['stream']>[0];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function token(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export class RoutedAIProvider implements AIProvider {
  readonly name: ProviderName;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    private options: {
      provider: ProviderName;
      model: string;
      apiKey: string;
      baseUrl?: string;
      fetcher?: typeof fetch;
    },
  ) {
    this.name = options.provider;
    this.model = options.model;
    this.baseUrl =
      options.baseUrl ?? (options.provider === 'custom' ? '' : PROVIDER_URLS[options.provider]);
    if (!this.baseUrl || !options.apiKey)
      throw new Error('AI provider configuration is incomplete.');
    this.fetcher = options.fetcher ?? secureProviderFetch;
  }

  async *stream(input: StreamInput): AsyncIterable<AIStreamEvent> {
    const anthropic = this.name === 'anthropic';
    const signal = AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(input.signal ? [input.signal] : []),
    ]);
    const response = await this.fetcher(
      `${this.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`,
      {
        method: 'POST',
        headers: anthropic
          ? {
              'x-api-key': this.options.apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            }
          : { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          anthropic
            ? {
                model: this.model,
                system: input.instructions,
                messages: input.messages,
                max_tokens: input.maxOutputTokens,
                stream: true,
              }
            : {
                model: this.model,
                messages: [{ role: 'system', content: input.instructions }, ...input.messages],
                ...(this.name === 'openai'
                  ? { max_completion_tokens: input.maxOutputTokens }
                  : { max_tokens: input.maxOutputTokens }),
                stream: true,
                stream_options: { include_usage: true },
              },
        ),
        signal,
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`AI provider returned HTTP ${response.status}.`);
    }
    let finished = false;
    let terminal = false;
    let usage: AIUsage = { inputTokens: null, outputTokens: null };
    for await (const data of readSSE(response.body)) {
      if (data === '[DONE]') {
        terminal = true;
        break;
      }
      const event = record(JSON.parse(data));
      if (event.error || event.type === 'error')
        throw new Error('AI provider reported a stream error.');
      if (anthropic) {
        if (event.type === 'message_start')
          usage.inputTokens = token(record(record(event.message).usage).input_tokens);
        if (event.type === 'content_block_delta') {
          const delta = record(event.delta);
          if (delta.type === 'text_delta' && typeof delta.text === 'string')
            yield { type: 'delta', text: delta.text };
        }
        if (event.type === 'message_delta') {
          usage.outputTokens = token(record(event.usage).output_tokens);
          if (
            record(event.delta).stop_reason !== 'end_turn' &&
            record(event.delta).stop_reason !== 'stop_sequence'
          )
            throw new Error('AI provider did not finish the answer.');
          finished = true;
        }
        if (event.type === 'message_stop') {
          terminal = true;
          break;
        }
      } else {
        const choice = record(Array.isArray(event.choices) ? event.choices[0] : null);
        const delta = record(choice.delta);
        if (typeof delta.content === 'string') yield { type: 'delta', text: delta.content };
        if (choice.finish_reason) {
          if (choice.finish_reason !== 'stop')
            throw new Error('AI provider did not finish the answer.');
          finished = true;
        }
        if (event.usage)
          usage = {
            inputTokens: token(record(event.usage).prompt_tokens),
            outputTokens: token(record(event.usage).completion_tokens),
          };
      }
    }
    if (!finished || !terminal) throw new Error('AI stream ended before completion.');
    yield { type: 'completed', usage };
  }
}
