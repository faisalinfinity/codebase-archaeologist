import type { AuthUserDto } from '@archaeologist/shared';

import { UnauthorizedError } from '../errors';

export type UserLookup = () => Promise<AuthUserDto | null>;

export async function requireUser(getUser: UserLookup): Promise<AuthUserDto> {
  const user = await getUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}
