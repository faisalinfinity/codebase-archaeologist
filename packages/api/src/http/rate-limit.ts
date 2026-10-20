import { sql } from 'drizzle-orm';
import { getDatabase, type Database } from '@archaeologist/db';
import { HttpError } from '../errors';

export class DatabaseRateLimiter {
  constructor(private db: Database = getDatabase()) {}
  async consume(userId: string, action: string, limit: number, now = new Date()): Promise<void> {
    const bucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const rows = await this.db.execute(sql`
      INSERT INTO request_limits (user_id, action, bucket, requests)
      VALUES (${userId}::uuid, ${action}, ${bucket.toISOString()}::timestamptz, 1)
      ON CONFLICT (user_id, action) DO UPDATE
      SET bucket = EXCLUDED.bucket,
          requests = CASE WHEN request_limits.bucket = EXCLUDED.bucket THEN request_limits.requests + 1 ELSE 1 END
      RETURNING requests
    `);
    if (Number(rows[0]?.requests) > limit)
      throw new HttpError(429, 'rate_limited', 'Request limit reached. Try again next hour.');
  }
}

export function requestLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : fallback;
}
