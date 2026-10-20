export type ProviderFailure =
  | 'authentication'
  | 'account_limit'
  | 'privacy'
  | 'unavailable'
  | 'rate_limit'
  | 'token_limit'
  | 'timeout'
  | 'connection'
  | 'invalid_stream'
  | 'incomplete_stream';

const MESSAGES: Record<ProviderFailure, string> = {
  authentication: 'The AI provider rejected your API key. Update it in AI settings.',
  account_limit:
    'The AI provider rejected this request because of account credits or request limits. Check your provider account or choose an available free model.',
  privacy:
    'OpenRouter could not route this model with your account’s privacy or provider settings. Check those settings in OpenRouter.',
  unavailable:
    'The selected AI model is unavailable. Check the exact model ID in AI settings, or try again shortly.',
  rate_limit:
    'The AI provider’s rate limit was reached. Wait and try again, or choose another available model.',
  token_limit:
    'The model reached its token limit before finishing an answer. Try a shorter question or a model with lower reasoning requirements.',
  timeout: 'The AI provider took too long to answer. Try again or choose a faster model.',
  connection: 'Could not connect to the AI provider. Please try again.',
  invalid_stream: 'The AI provider returned an invalid response. Please try again.',
  incomplete_stream: 'The AI provider stopped before completing an answer. Please try again.',
};

export class AIProviderError extends Error {
  readonly code: string;
  constructor(
    readonly reason: ProviderFailure,
    readonly provider: string,
    readonly upstreamStatus?: number,
  ) {
    super(MESSAGES[reason]);
    this.name = 'AIProviderError';
    this.code = `ai_${reason}`;
  }
}

/** Classify provider text without echoing it: upstream messages can contain credentials or prompts. */
export function classifyProviderError(
  provider: string,
  status?: number,
  error?: unknown,
): AIProviderError {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const message = typeof value.message === 'string' ? value.message.slice(0, 4000) : '';
  const code = typeof value.code === 'number' ? value.code : status;
  if (
    provider === 'openrouter' &&
    /privacy|data policy|data policies|data collection|data training/i.test(message)
  )
    return new AIProviderError('privacy', provider, code);
  if (code === 401) return new AIProviderError('authentication', provider, code);
  if (code === 402) return new AIProviderError('account_limit', provider, code);
  if (code === 429) return new AIProviderError('rate_limit', provider, code);
  if (/token.*(?:limit|budget)|context.*length/i.test(message))
    return new AIProviderError('token_limit', provider, code);
  return new AIProviderError('unavailable', provider, code);
}

export async function responseProviderError(
  provider: string,
  response: Response,
): Promise<AIProviderError> {
  const reader = response.body?.getReader();
  let text = '';
  try {
    const decoder = new TextDecoder();
    let size = 0;
    if (reader)
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) break;
        text += decoder.decode(value, { stream: true });
      }
    const body = JSON.parse(text) as { error?: unknown };
    return classifyProviderError(provider, response.status, body.error);
  } catch {
    return classifyProviderError(provider, response.status);
  } finally {
    await reader?.cancel().catch(() => undefined);
  }
}

export function publicChatFailure(error: unknown) {
  if (error instanceof AIProviderError)
    return {
      code: error.code,
      message: error.message,
      provider: error.provider,
      upstreamStatus: error.upstreamStatus,
    };
  return { code: 'ai_answer_failed', message: 'AI answer failed. Please try again.' };
}
