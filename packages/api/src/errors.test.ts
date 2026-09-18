import { describe, expect, it, vi } from 'vitest';

import { errorFromCode, HttpError, RateLimitedError, toPublicError } from './errors';

describe('toPublicError', () => {
  it('maps HttpError without leaking extra fields', () => {
    const result = toPublicError(new HttpError(422, 'INVALID_GITHUB_URL', 'Invalid GitHub URL.'));
    expect(result).toEqual({
      status: 422,
      body: { error: 'Invalid GitHub URL.', code: 'INVALID_GITHUB_URL' },
    });
  });

  it('hides unknown errors behind a generic message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = toPublicError(new Error('secret internal details'));
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(result)).not.toContain('secret internal details');
    spy.mockRestore();
  });
});

describe('errorFromCode', () => {
  it('maps GitHub domain failures to stable public codes', () => {
    expect(errorFromCode('REPOSITORY_NOT_FOUND').status).toBe(404);
    expect(errorFromCode('PRIVATE_REPOSITORY').status).toBe(403);
    expect(errorFromCode('GITHUB_RATE_LIMITED')).toBeInstanceOf(HttpError);
    expect(errorFromCode('REPOSITORY_TOO_LARGE').status).toBe(413);
    expect(new RateLimitedError('slow down').status).toBe(429);
  });
});
