import { DatabaseRateLimiter, requestLimit } from '@archaeologist/api';
import { requireDatabase } from './services';

export async function enforceRequestLimit(
  userId: string,
  action: string,
  envName: string,
  fallback: number,
): Promise<void> {
  requireDatabase();
  await new DatabaseRateLimiter().consume(
    userId,
    action,
    requestLimit(process.env[envName], fallback),
  );
}
