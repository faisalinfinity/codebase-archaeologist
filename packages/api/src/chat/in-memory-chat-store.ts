import type { ChatMessageDto, ChatSessionDto } from '@archaeologist/shared';

import { NotFoundError } from '../errors';
import type { ChatStore, SaveChatTurnInput } from './chat-store';

export class InMemoryChatStore implements ChatStore {
  readonly sessions = new Map<string, ChatSessionDto>();
  readonly messages = new Map<string, ChatMessageDto[]>();

  async listSessions(
    ownerUserId: string,
    repositoryId: string,
    limit: number,
  ): Promise<ChatSessionDto[]> {
    return [...this.sessions.values()]
      .filter(
        (session) => session.ownerUserId === ownerUserId && session.repositoryId === repositoryId,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async getSession(id: string): Promise<ChatSessionDto | null> {
    return this.sessions.get(id) ?? null;
  }

  async listMessages(sessionId: string, limit: number): Promise<ChatMessageDto[]> {
    return (this.messages.get(sessionId) ?? []).slice(-limit);
  }

  async countRecentTurns(ownerUserId: string, since: Date): Promise<number> {
    let count = 0;
    for (const [sessionId, messages] of this.messages) {
      if (this.sessions.get(sessionId)?.ownerUserId !== ownerUserId) continue;
      count += messages.filter(
        (message) => message.role === 'user' && new Date(message.createdAt) >= since,
      ).length;
    }
    return count;
  }

  async saveTurn(input: SaveChatTurnInput): Promise<string> {
    const now = new Date();
    let session = input.sessionId ? this.sessions.get(input.sessionId) : null;
    if (
      input.sessionId &&
      (!session ||
        session.ownerUserId !== input.ownerUserId ||
        session.repositoryId !== input.repositoryId)
    ) {
      throw new NotFoundError('Chat session not found.');
    }
    if (!session) {
      session = {
        id: crypto.randomUUID(),
        ownerUserId: input.ownerUserId,
        repositoryId: input.repositoryId,
        title: input.question.slice(0, 80),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    }
    const userMessage: ChatMessageDto = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: input.question,
      citations: [],
      provider: null,
      model: null,
      tokenUsage: null,
      createdAt: now.toISOString(),
    };
    const assistantMessage: ChatMessageDto = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'assistant',
      content: input.answer,
      citations: input.citations,
      provider: input.provider,
      model: input.model,
      tokenUsage:
        input.tokensIn !== null && input.tokensOut !== null
          ? input.tokensIn + input.tokensOut
          : null,
      createdAt: new Date(now.getTime() + 1).toISOString(),
    };
    this.sessions.set(session.id, { ...session, updatedAt: assistantMessage.createdAt });
    this.messages.set(session.id, [
      ...(this.messages.get(session.id) ?? []),
      userMessage,
      assistantMessage,
    ]);
    return session.id;
  }
}
