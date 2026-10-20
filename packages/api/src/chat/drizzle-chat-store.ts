import { and, count, desc, eq, gte } from 'drizzle-orm';

import {
  chatMessages,
  chatSessions,
  getDatabase,
  usageEvents,
  type Database,
} from '@archaeologist/db';
import type { ChatCitationDto, ChatMessageDto, ChatSessionDto } from '@archaeologist/shared';

import { NotFoundError } from '../errors';
import type { ChatStore, SaveChatTurnInput } from './chat-store';

function toSession(row: typeof chatSessions.$inferSelect): ChatSessionDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    repositoryId: row.repositoryId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function citationsFromMetadata(value: Record<string, unknown> | null): ChatCitationDto[] {
  const items = value?.citations;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is ChatCitationDto =>
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.filePath === 'string' &&
      Number.isSafeInteger(item.startLine) &&
      Number.isSafeInteger(item.endLine) &&
      typeof item.commitSha === 'string' &&
      typeof item.githubUrl === 'string' &&
      (!('kind' in item) || ['source', 'commit', 'pull_request', 'issue'].includes(item.kind)),
  );
}

function toMessage(row: typeof chatMessages.$inferSelect): ChatMessageDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    citations: citationsFromMetadata(row.retrievalMetadataJson),
    provider: row.provider,
    model: row.model,
    tokenUsage: row.tokenUsage,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleChatStore implements ChatStore {
  constructor(private readonly db: Database = getDatabase()) {}

  async listSessions(
    ownerUserId: string,
    repositoryId: string,
    limit: number,
  ): Promise<ChatSessionDto[]> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(
        and(eq(chatSessions.ownerUserId, ownerUserId), eq(chatSessions.repositoryId, repositoryId)),
      )
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit);
    return rows.map(toSession);
  }

  async getSession(id: string): Promise<ChatSessionDto | null> {
    const rows = await this.db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async listMessages(sessionId: string, limit: number): Promise<ChatMessageDto[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  async countRecentTurns(ownerUserId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .where(
        and(
          eq(chatSessions.ownerUserId, ownerUserId),
          eq(chatMessages.role, 'user'),
          gte(chatMessages.createdAt, since),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  async saveTurn(input: SaveChatTurnInput): Promise<string> {
    return this.db.transaction(async (tx) => {
      let sessionId = input.sessionId;
      if (sessionId) {
        const rows = await tx
          .select({ id: chatSessions.id })
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.id, sessionId),
              eq(chatSessions.ownerUserId, input.ownerUserId),
              eq(chatSessions.repositoryId, input.repositoryId),
            ),
          )
          .limit(1);
        if (!rows[0]) throw new NotFoundError('Chat session not found.');
      } else {
        const rows = await tx
          .insert(chatSessions)
          .values({
            ownerUserId: input.ownerUserId,
            repositoryId: input.repositoryId,
            title: input.question.slice(0, 80),
          })
          .returning({ id: chatSessions.id });
        sessionId = rows[0]?.id ?? null;
        if (!sessionId) throw new Error('Could not create chat session.');
      }
      const now = new Date();
      await tx.insert(chatMessages).values([
        { sessionId, role: 'user', content: input.question, createdAt: now },
        {
          sessionId,
          role: 'assistant',
          content: input.answer,
          provider: input.provider,
          model: input.model,
          tokenUsage:
            input.tokensIn !== null && input.tokensOut !== null
              ? input.tokensIn + input.tokensOut
              : null,
          retrievalMetadataJson: { citations: input.citations },
          createdAt: new Date(now.getTime() + 1),
        },
      ]);
      await tx
        .update(chatSessions)
        .set({ updatedAt: new Date(now.getTime() + 1) })
        .where(eq(chatSessions.id, sessionId));
      if (input.tokensIn !== null || input.tokensOut !== null) {
        await tx.insert(usageEvents).values({
          userId: input.ownerUserId,
          repositoryId: input.repositoryId,
          eventType: 'chat_completion',
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          metadataJson: { provider: input.provider, model: input.model, sessionId },
        });
      }
      return sessionId;
    });
  }
}
