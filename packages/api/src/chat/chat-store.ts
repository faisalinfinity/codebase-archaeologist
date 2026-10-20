import type { ChatCitationDto, ChatMessageDto, ChatSessionDto } from '@archaeologist/shared';

export interface SaveChatTurnInput {
  sessionId: string | null;
  ownerUserId: string;
  repositoryId: string;
  question: string;
  answer: string;
  citations: ChatCitationDto[];
  provider: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface ChatStore {
  listSessions(ownerUserId: string, repositoryId: string, limit: number): Promise<ChatSessionDto[]>;
  getSession(id: string): Promise<ChatSessionDto | null>;
  listMessages(sessionId: string, limit: number): Promise<ChatMessageDto[]>;
  countRecentTurns(ownerUserId: string, since: Date): Promise<number>;
  saveTurn(input: SaveChatTurnInput): Promise<string>;
}
