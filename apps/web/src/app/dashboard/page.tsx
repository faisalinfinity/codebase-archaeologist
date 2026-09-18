import Link from 'next/link';

import { HttpError } from '@archaeologist/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isDatabaseConfigured } from '@/lib/env';
import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  let dbMessage: string | null = null;
  let repositories: Awaited<ReturnType<ReturnType<typeof createRepositoryService>['list']>> = [];

  if (!isDatabaseConfigured()) {
    dbMessage =
      'DATABASE_URL is not set. Auth works; repository records need Postgres and pnpm db:migrate.';
  } else {
    try {
      repositories = await createRepositoryService().list(user);
    } catch (error) {
      if (error instanceof HttpError) {
        dbMessage = error.message;
      } else {
        dbMessage = 'Could not load repositories.';
        console.error('[dashboard]', error instanceof Error ? error.message : 'unknown');
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Repositories</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Indexing, chat, and impact analysis land in later milestones. You can already record a
            public GitHub URL.
          </p>
        </div>
        <Button asChild>
          <Link href="/repositories/new">Add repository</Link>
        </Button>
      </div>

      {dbMessage ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {dbMessage}
        </p>
      ) : null}

      {!dbMessage && repositories.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No repositories yet</CardTitle>
            <CardDescription>
              Add a public GitHub URL to create a PENDING index job stub.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2">
        {repositories.map((repo) => (
          <li key={repo.id}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Link href={`/repositories/${repo.id}`} className="hover:text-primary">
                    {repo.githubOwner}/{repo.githubRepo}
                  </Link>
                </CardTitle>
                <CardDescription>{repo.status}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="truncate text-sm text-muted-foreground">{repo.githubUrl}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
