import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) return null;
  const requestedPage = Number(query.page ?? '1');
  let result;
  try {
    result = await createRepositoryService().listIndexedFiles(user, id, requestedPage);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
  const { files, total, page, snapshot } = result;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div>
        <Link
          href={`/repositories/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Repository
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Indexed files</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {snapshot
            ? `${total} files at ${snapshot.commitSha.slice(0, 12)}`
            : 'No ready source snapshot yet. Re-index this repository to add source content.'}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {files.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <Link
              className="min-w-0 break-all font-mono text-primary hover:underline"
              href={`/repositories/${id}/files/${file.path.split('/').map(encodeURIComponent).join('/')}`}
            >
              {file.path}
            </Link>
            <span className="shrink-0 text-muted-foreground">{file.language ?? 'text'}</span>
          </li>
        ))}
      </ul>
      {total > 100 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="File pages">
          {page > 1 ? (
            <Link href={`?page=${page - 1}`} className="text-primary hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page} of {Math.ceil(total / 100)}
          </span>
          {page * 100 < total ? (
            <Link href={`?page=${page + 1}`} className="text-primary hover:underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
