import { describe, expect, it } from 'vitest';

import { NoopIndexQueue } from '../queue/index-queue';
import { InMemoryRepositoryStore } from '../repositories/in-memory-repository-store';
import { RepositoryService } from '../repositories/repository-service';
import type { AIProvider } from './ai-provider';
import { ChatService } from './chat-service';
import { InMemoryChatStore } from './in-memory-chat-store';

const owner = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' };
const other = { id: '22222222-2222-2222-2222-222222222222', email: 'other@example.com' };

async function fixture(provider: AIProvider | null, env: Record<string, string> = {}) {
  const repositories = new InMemoryRepositoryStore();
  const inserted = await repositories.insertRepository({
    ownerUserId: owner.id,
    githubOwner: 'octocat',
    githubRepo: 'code',
    githubUrl: 'https://github.com/octocat/code',
  });
  const snapshot = await repositories.upsertSnapshot({
    repositoryId: inserted.repository.id,
    commitSha: 'abc123',
    branch: 'main',
    status: 'READY',
    completedAt: new Date(),
  });
  await repositories.replaceSnapshotFiles(snapshot.id, [
    {
      repositoryId: inserted.repository.id,
      snapshotId: snapshot.id,
      path: 'src/auth.ts',
      language: 'typescript',
      sizeBytes: 40,
      sha: 'sha',
      content: 'export function authenticate() { return true; }',
      isBinary: false,
      isGenerated: false,
      symbols: [],
      imports: [],
      chunks: [
        { content: 'export function authenticate() { return true; }', startLine: 1, endLine: 1 },
      ],
    },
  ]);
  const repositoryService = new RepositoryService(
    repositories,
    {
      async getRepository() {
        throw new Error('GitHub should not be called.');
      },
    },
    new NoopIndexQueue(),
  );
  const chats = new InMemoryChatStore();
  return {
    repositoryId: inserted.repository.id,
    service: new ChatService(repositoryService, chats, provider, env),
    chats,
    repositories,
  };
}

describe('ChatService', () => {
  it('streams a grounded answer and persists only validated citations', async () => {
    const provider: AIProvider = {
      name: 'fake',
      model: 'fake-model',
      async *stream(input) {
        expect(input.instructions).toContain('untrusted data');
        expect(input.messages.at(-1)?.content).toContain('"id":"S1"');
        yield { type: 'delta', text: 'The function returns true [S1]. ' };
        yield { type: 'delta', text: 'Unsupported [S99].' };
        yield { type: 'completed', usage: { inputTokens: 40, outputTokens: 12 } };
      },
    };
    const { service, chats, repositoryId } = await fixture(provider, {
      MAX_CHAT_REQUESTS_PER_HOUR: '1',
    });
    const prepared = await service.prepare(owner, repositoryId, {
      question: 'How does authenticate work?',
    });
    const events = [];
    for await (const event of prepared.stream()) events.push(event);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      citations: [expect.objectContaining({ id: 'S1' })],
    });
    if (!done || done.type !== 'done') throw new Error('Missing completion event.');
    expect(done.answer).not.toContain('[S99]');
    const saved = await service.getSession(owner, repositoryId, done.sessionId);
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[1]).toMatchObject({ role: 'assistant', tokenUsage: 52 });
    expect(chats.sessions.size).toBe(1);
    await expect(
      service.prepare(owner, repositoryId, { question: 'Ask again?' }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(service.getSession(other, repositoryId, done.sessionId)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects chat when the provider is missing and source evidence exists', async () => {
    const { service, repositoryId } = await fixture(null);
    await expect(
      service.prepare(owner, repositoryId, { question: 'Explain authenticate.' }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('does not save a partial answer when generation fails', async () => {
    const provider: AIProvider = {
      name: 'fake',
      model: 'fake-model',
      async *stream() {
        yield { type: 'delta', text: 'Partial' };
        throw new Error('provider unavailable');
      },
    };
    const { service, chats, repositoryId } = await fixture(provider);
    const prepared = await service.prepare(owner, repositoryId, {
      question: 'Explain authenticate.',
    });
    const consume = async () => {
      for await (const _event of prepared.stream()) {
        /* Consume. */
      }
    };
    await expect(consume()).rejects.toThrow('provider unavailable');
    expect(chats.sessions.size).toBe(0);
  });

  it('uses indexed commit evidence for why questions', async () => {
    const provider: AIProvider = {
      name: 'fake',
      model: 'fake-model',
      async *stream(input) {
        expect(input.messages.at(-1)?.content).toContain('"id":"H1"');
        yield { type: 'delta', text: 'Authentication was introduced in this commit [H1].' };
        yield { type: 'completed', usage: { inputTokens: 25, outputTokens: 12 } };
      },
    };
    const { service, repositories, repositoryId } = await fixture(provider);
    await repositories.replaceCommitHistory(repositoryId, [
      {
        sha: 'a'.repeat(40),
        parentSha: null,
        authorName: 'Test',
        committedAt: new Date(),
        message: 'introduce authentication',
        files: [{ path: 'src/auth.ts', changeType: 'A' }],
      },
    ]);
    const prepared = await service.prepare(owner, repositoryId, {
      question: 'Why authentication?',
    });
    const events = [];
    for await (const event of prepared.stream()) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      citations: [expect.objectContaining({ kind: 'commit' })],
    });
  });
});
