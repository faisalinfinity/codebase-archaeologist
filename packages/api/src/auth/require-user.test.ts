import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../errors';
import { requireUser } from './require-user';

describe('requireUser', () => {
  it('returns the authenticated user', async () => {
    const user = await requireUser(async () => ({ id: 'user-a', email: 'a@example.com' }));
    expect(user.id).toBe('user-a');
  });

  it('rejects a missing session', async () => {
    await expect(requireUser(async () => null)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
