import { describe, expect, it, vi } from 'vitest';

import { HttpError, toPublicError } from './errors';

describe('toPublicError', () => {
  it('maps HttpError without leaking extra fields', () => {
    const result = toPublicError(new HttpError(422, 'validation_error', 'Invalid GitHub URL.'));
    expect(result).toEqual({
      status: 422,
      body: { error: 'Invalid GitHub URL.', code: 'validation_error' },
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
