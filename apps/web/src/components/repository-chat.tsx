'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ChatCitationDto, ChatMessageDto, ChatSessionDto } from '@archaeologist/shared';

import { Button } from '@/components/ui/button';

type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; sessionId: string; answer: string; citations: ChatCitationDto[] }
  | { type: 'error'; message: string };

function answerParts(text: string, citations: ChatCitationDto[], repositoryId: string) {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  return text.split(/(\[[SHPI]\d+\])/g).map((part, index) => {
    const citation = part.match(/^\[([SHPI]\d+)\]$/)?.[1];
    const source = citation ? byId.get(citation) : null;
    if (!source) return part;
    if (source.kind && source.kind !== 'source') {
      return (
        <a
          key={`${source.id}-${index}`}
          className="text-primary underline underline-offset-2"
          href={source.githubUrl}
          target="_blank"
          rel="noreferrer"
        >
          {part}
        </a>
      );
    }
    return (
      <Link
        key={`${source.id}-${index}`}
        className="text-primary underline underline-offset-2"
        href={`/repositories/${repositoryId}/files/${source.filePath.split('/').map(encodeURIComponent).join('/')}#L${source.startLine}`}
        title={`${source.filePath}:${source.startLine}`}
      >
        {part}
      </Link>
    );
  });
}

export function RepositoryChat({
  repositoryId,
  initialSessionId,
  initialMessages,
  sessions,
  aiConfigured,
}: {
  repositoryId: string;
  initialSessionId: string | null;
  initialMessages: ChatMessageDto[];
  sessions: ChatSessionDto[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState(initialMessages);
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = question.trim();
    if (!submitted || pendingQuestion) return;
    setPendingQuestion(submitted);
    setQuestion('');
    setPartial('');
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submitted, ...(sessionId ? { sessionId } : {}) }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Could not start an answer.');
      }
      if (!response.body) throw new Error('Answer stream was unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim();
          if (data) {
            const item = JSON.parse(data) as StreamEvent;
            if (item.type === 'delta') setPartial((current) => current + item.text);
            if (item.type === 'error') throw new Error(item.message);
            if (item.type === 'done') {
              completed = true;
              const now = new Date().toISOString();
              setMessages((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  sessionId: item.sessionId,
                  role: 'user',
                  content: submitted,
                  citations: [],
                  provider: null,
                  model: null,
                  tokenUsage: null,
                  createdAt: now,
                },
                {
                  id: crypto.randomUUID(),
                  sessionId: item.sessionId,
                  role: 'assistant',
                  content: item.answer,
                  citations: item.citations,
                  provider: null,
                  model: null,
                  tokenUsage: null,
                  createdAt: now,
                },
              ]);
              setPartial('');
              setSessionId(item.sessionId);
              router.replace(`/repositories/${repositoryId}/chat?session=${item.sessionId}`, {
                scroll: false,
              });
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
      if (!completed) throw new Error('Answer stream ended early.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not answer the question.');
      setQuestion(submitted);
    } finally {
      setPendingQuestion(null);
      setPartial('');
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-3">
        <Button asChild variant="outline">
          <Link href={`/repositories/${repositoryId}/chat`}>New chat</Link>
        </Button>
        <h2 className="text-sm font-medium">Recent chats</h2>
        <nav className="flex flex-col gap-1 text-sm" aria-label="Chat sessions">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/repositories/${repositoryId}/chat?session=${session.id}`}
              className={`truncate rounded px-2 py-1.5 hover:bg-accent ${session.id === sessionId ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
            >
              {session.title ?? 'Untitled chat'}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-col gap-5">
        {!aiConfigured ? (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            Add your provider in{' '}
            <Link href="/settings/ai" className="underline">
              AI settings
            </Link>{' '}
            to enable answers. Source search remains available.
          </p>
        ) : null}
        <div className="flex min-h-80 flex-col gap-5" aria-live="polite">
          {messages.length === 0 && !pendingQuestion ? (
            <p className="text-sm text-muted-foreground">
              Ask how this repository works. Answers use evidence from its indexed source.
            </p>
          ) : null}
          {messages.map((message) => (
            <article
              key={message.id}
              className={`rounded-lg border border-border p-4 ${message.role === 'assistant' ? 'bg-card' : 'bg-accent/40'}`}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {message.role === 'assistant' ? 'Answer' : 'You'}
              </p>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {message.role === 'assistant'
                  ? answerParts(message.content, message.citations, repositoryId)
                  : message.content}
              </div>
              {message.role === 'assistant' && message.citations.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3 text-xs">
                  {message.citations.map((citation) => (
                    <a
                      key={citation.id}
                      href={citation.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      [{citation.id}]{' '}
                      {citation.kind && citation.kind !== 'source'
                        ? citation.kind.replace('_', ' ')
                        : `${citation.filePath}:${citation.startLine}`}
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {pendingQuestion ? (
            <article className="rounded-lg border border-border bg-accent/40 p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">You</p>
              {pendingQuestion}
            </article>
          ) : null}
          {pendingQuestion ? (
            <article className="rounded-lg border border-border bg-card p-4 text-sm whitespace-pre-wrap">
              {partial || 'Reading indexed source…'}
            </article>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <form onSubmit={(event) => void send(event)} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="chat-question">
            Question
          </label>
          <textarea
            id="chat-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            minLength={2}
            maxLength={2000}
            rows={3}
            required
            disabled={!aiConfigured || !!pendingQuestion}
            placeholder="How does indexing move from the API to the worker?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div>
            <Button
              type="submit"
              disabled={!aiConfigured || !!pendingQuestion || question.trim().length < 2}
            >
              {pendingQuestion ? 'Answering…' : 'Ask repository'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
