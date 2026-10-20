import { expect, it } from 'vitest';
import { AIProviderError, publicChatFailure } from './provider-error';

it('exposes only safe typed failures to the chat stream', () => {
  expect(publicChatFailure(new AIProviderError('token_limit', 'openrouter'))).toMatchObject({
    code: 'ai_token_limit',
    provider: 'openrouter',
  });
  const unexpected = publicChatFailure(
    new Error('Raw provider body with sk-or-private-key and source text'),
  );
  expect(unexpected).toEqual({
    code: 'ai_answer_failed',
    message: 'AI answer failed. Please try again.',
  });
});
