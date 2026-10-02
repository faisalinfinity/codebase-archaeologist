import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError, ValidationError } from '@archaeologist/api';
import type { SearchResponseDto } from '@archaeologist/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RepositorySearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = '' }] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) return null;
  const service = createRepositoryService();
  let result: SearchResponseDto | null = null;
  let errorMessage: string | null = null;
  try {
    if (q.trim()) result = await service.search(user, id, q);
    else await service.get(user, id);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    if (error instanceof ValidationError) errorMessage = error.message;
    else throw error;
  }
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-10">
      <div>
        <Link
          href={`/repositories/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Repository
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Search indexed source</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Results link to the exact indexed commit and source lines.
        </p>
      </div>
      <form method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          minLength={2}
          maxLength={200}
          required
          placeholder="Find authentication, queue setup, parser…"
          aria-label="Search query"
        />
        <Button type="submit">Search</Button>
      </form>
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      {result ? (
        <section className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {result.commitSha
              ? `${result.results.length} results · ${result.mode === 'hybrid' ? 'keyword and semantic' : 'keyword'} search · ${result.commitSha.slice(0, 12)}`
              : 'No ready source snapshot. Index the repository first.'}
          </p>
          <ol className="flex flex-col gap-4">
            {result.results.map((hit) => (
              <li key={hit.chunkId} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    className="break-all font-mono text-sm text-primary hover:underline"
                    href={`/repositories/${id}/files/${hit.filePath.split('/').map(encodeURIComponent).join('/')}#L${hit.startLine}`}
                  >
                    {hit.filePath}:{hit.startLine}–{hit.endLine}
                  </Link>
                  <a
                    className="text-xs text-muted-foreground hover:text-primary"
                    href={hit.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub source
                  </a>
                </div>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {hit.snippet}
                </pre>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
