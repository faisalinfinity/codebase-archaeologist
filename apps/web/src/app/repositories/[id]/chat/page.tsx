import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError } from '@archaeologist/api';

import { RepositoryChat } from '@/components/repository-chat';
import { createChatService, createProviderSettingsService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RepositoryChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const [{ id }, { session: sessionId }] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) return null;
  const service = createChatService();
  try {
    const ai = await createProviderSettingsService().get(user.id);
    const [sessions, selected] = await Promise.all([
      service.listSessions(user, id),
      sessionId ? service.getSession(user, id, sessionId) : Promise.resolve(null),
    ]);
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
        <div>
          <Link
            href={`/repositories/${id}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Repository
          </Link>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Repository chat</h1>
        </div>
        <RepositoryChat
          key={selected?.session.id ?? 'new'}
          repositoryId={id}
          initialSessionId={selected?.session.id ?? null}
          initialMessages={selected?.messages ?? []}
          sessions={sessions}
          aiConfigured={Boolean(ai.settings) || ai.demoAvailable}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}
