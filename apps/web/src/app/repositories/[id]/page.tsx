import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, HttpError, NotFoundError } from '@archaeologist/api';

import { DeleteRepositoryButton } from '@/components/delete-repository-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export default async function RepositoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  try {
    const repo = await createRepositoryService().get(user, id);
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            {repo.githubOwner}/{repo.githubRepo}
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Index status</CardTitle>
            <CardDescription>
              {repo.status} — cloning and parsing are not implemented in Milestone 1.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Canonical URL:{' '}
              <a
                className="text-foreground underline-offset-4 hover:underline"
                href={repo.githubUrl}
              >
                {repo.githubUrl}
              </a>
            </p>
            <p>
              Chat, files, history, and dependencies routes will attach here in later milestones.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild variant="outline" disabled>
                <span>Chat (not yet)</span>
              </Button>
              <DeleteRepositoryButton repositoryId={repo.id} />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      notFound();
    }
    if (error instanceof HttpError) {
      return (
        <main className="mx-auto max-w-xl px-4 py-16 text-sm text-muted-foreground">
          {error.message}
        </main>
      );
    }
    throw error;
  }
}
