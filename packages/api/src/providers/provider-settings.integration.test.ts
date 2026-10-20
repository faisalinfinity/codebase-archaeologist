import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDatabase, users } from '@archaeologist/db';
import { eq } from 'drizzle-orm';
import { ProviderSettingsService, DrizzleProviderSettingsStore } from './provider-settings';
import { DatabaseRateLimiter } from '../http/rate-limit';

const testWithDatabase = process.env.TEST_DATABASE_URL ? it : it.skip;
testWithDatabase(
  'persists encrypted keys per owner and enforces concurrent request limits',
  async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL!);
    const user = { id: randomUUID(), email: 'provider-test@localhost' };
    try {
      const service = new ProviderSettingsService(new DrizzleProviderSettingsStore(db), {
        ENCRYPTION_KEY: 'ab'.repeat(32),
      });
      await service.save(user, {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'private-api-key',
      });
      expect((await service.get(user.id)).settings?.provider).toBe('openai');
      expect((await service.get(randomUUID())).settings).toBeNull();
      const limiter = new DatabaseRateLimiter(db);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => limiter.consume(user.id, 'test', 3)),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
      await limiter.consume(user.id, 'test', 3, new Date(Date.now() + 3_600_000));
      await service.delete(user.id);
      expect((await service.get(user.id)).settings).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
      await db.$client.end();
    }
  },
);
