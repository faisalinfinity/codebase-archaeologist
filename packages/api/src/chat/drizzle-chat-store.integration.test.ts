import { randomUUID } from 'node:crypto';

import * as schema from '@archaeologist/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { expect, it } from 'vitest';

import { DrizzleRepositoryStore } from '../repositories/drizzle-repository-store';
import { DrizzleChatStore } from './drizzle-chat-store';

const testWithDatabase = process.env.TEST_DATABASE_URL ? it : it.skip;

testWithDatabase(
  'Postgres saves complete chat turns, usage, and owner-scoped sessions',
  async () => {
    const client = postgres(process.env.TEST_DATABASE_URL ?? '', { max: 1 });
    const db = drizzle(client, { schema });
    const repositories = new DrizzleRepositoryStore(db);
    const chats = new DrizzleChatStore(db);
    const userId = randomUUID();
    try {
      await repositories.upsertUser({ id: userId, email: 'chat-test@localhost' });
      const inserted = await repositories.insertRepository({
        ownerUserId: userId,
        githubOwner: 'integration',
        githubRepo: `chat-${randomUUID()}`,
        githubUrl: 'https://github.com/integration/chat',
      });
      const repositoryId = inserted.repository.id;
      const citation = {
        id: 'S1',
        filePath: 'src/auth.ts',
        startLine: 2,
        endLine: 5,
        commitSha: 'abc123',
        githubUrl: 'https://github.com/integration/chat/blob/abc123/src/auth.ts#L2',
      };
      const sessionId = await chats.saveTurn({
        sessionId: null,
        ownerUserId: userId,
        repositoryId,
        question: 'How does auth work?',
        answer: 'The function checks a token [S1].',
        citations: [citation],
        provider: 'fake',
        model: 'fake-model',
        tokensIn: 20,
        tokensOut: 8,
      });
      await chats.saveTurn({
        sessionId,
        ownerUserId: userId,
        repositoryId,
        question: 'Why was it added?',
        answer: 'It was introduced here [H1].',
        citations: [
          {
            id: 'H1',
            kind: 'commit',
            filePath: 'src/auth.ts',
            startLine: 0,
            endLine: 0,
            commitSha: 'a'.repeat(40),
            githubUrl: `https://github.com/integration/chat/commit/${'a'.repeat(40)}`,
          },
        ],
        provider: 'fake',
        model: 'fake-model',
        tokensIn: null,
        tokensOut: null,
      });
      expect(await chats.listSessions(userId, repositoryId, 10)).toHaveLength(1);
      expect(await chats.listSessions(randomUUID(), repositoryId, 10)).toEqual([]);
      const messages = await chats.listMessages(sessionId, 10);
      expect(messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(messages[1]?.citations).toEqual([citation]);
      expect(messages[3]?.citations[0]?.kind).toBe('commit');
      expect(await chats.countRecentTurns(userId, new Date(Date.now() - 60_000))).toBe(2);
      const usage = await db
        .select()
        .from(schema.usageEvents)
        .where(eq(schema.usageEvents.userId, userId));
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ tokensIn: 20, tokensOut: 8 });
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await client.end();
    }
  },
);
