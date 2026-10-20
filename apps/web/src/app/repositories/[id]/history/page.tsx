import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError, ValidationError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RepositoryHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string; offset?: string }>;
}) {
  const [{ id }, { path: filePath, offset = '0' }] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) return null;
  let history;
  try {
    history = await createRepositoryService().getHistory(user, id, filePath, Number(offset));
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    )
      notFound();
    throw error;
  }
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <div>
        <Link
          href={`/repositories/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Repository
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Repository history</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {filePath
            ? `Commits, pull requests, and linked issues touching ${filePath}.`
            : 'Commits from the indexed branch, plus recent public PRs and issues. History depth follows the indexing configuration.'}
        </p>
      </div>
      <section>
        <h2 className="font-serif text-xl font-semibold">Commits</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {history.commits.map((commit) => (
            <li key={commit.sha} className="rounded-lg border border-border bg-card p-4">
              <a
                href={`${history.githubUrl}/commit/${commit.sha}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-primary hover:underline"
              >
                {commit.sha.slice(0, 12)}
              </a>
              <p className="mt-2 whitespace-pre-wrap text-sm">{commit.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {commit.authorName ?? 'Unknown author'} ·{' '}
                {commit.committedAt
                  ? new Date(commit.committedAt).toLocaleDateString()
                  : 'Unknown date'}{' '}
                · {commit.files.length} changed paths
              </p>
              {commit.files.length > 0 ? (
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                  {commit.files
                    .slice(0, 8)
                    .map((file) => file.path)
                    .join(' · ')}
                  {commit.files.length > 8 ? ' …' : ''}
                </p>
              ) : null}
            </li>
          ))}
          {history.commits.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              No indexed commits for this view. Re-index to load recent history.
            </li>
          ) : null}
        </ol>
        <nav className="mt-4 flex gap-4 text-sm" aria-label="History pages">
          {Number(offset) > 0 ? (
            <Link
              className="text-primary hover:underline"
              href={`?offset=${Math.max(0, Number(offset) - 50)}${filePath ? `&path=${encodeURIComponent(filePath)}` : ''}`}
            >
              Newer commits
            </Link>
          ) : null}
          {history.nextOffset != null ? (
            <Link
              className="text-primary hover:underline"
              href={`?offset=${history.nextOffset}${filePath ? `&path=${encodeURIComponent(filePath)}` : ''}`}
            >
              Older commits
            </Link>
          ) : null}
        </nav>
      </section>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="font-serif text-xl font-semibold">Pull requests</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {history.pullRequests.map((pr) => (
              <li key={pr.number} className="rounded-lg border border-border bg-card p-4 text-sm">
                <a
                  href={`${history.githubUrl}/pull/${pr.number}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  #{pr.number} {pr.title}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pr.state}
                  {pr.mergedAt ? ' · merged' : ''} · {pr.author ?? 'Unknown author'}
                </p>
                {pr.files?.length ? (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {pr.files
                      .slice(0, 8)
                      .map((file) => file.path)
                      .join(' · ')}
                  </p>
                ) : null}
                {!pr.filesComplete ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    File context is incomplete or unavailable.
                  </p>
                ) : null}
                {pr.body ? (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{pr.body}</p>
                ) : null}
              </li>
            ))}
            {history.pullRequests.length === 0 ? (
              <li className="text-sm text-muted-foreground">No recent pull requests indexed.</li>
            ) : null}
          </ul>
        </section>
        <section>
          <h2 className="font-serif text-xl font-semibold">Issues</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {history.issues.map((issue) => (
              <li
                key={issue.number}
                className="rounded-lg border border-border bg-card p-4 text-sm"
              >
                <a
                  href={`${history.githubUrl}/issues/${issue.number}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  #{issue.number} {issue.title}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {issue.state} · {issue.author ?? 'Unknown author'}
                </p>
                {issue.filePaths?.length ? (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {issue.filePaths.join(' · ')}
                  </p>
                ) : null}
                {issue.body ? (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{issue.body}</p>
                ) : null}
              </li>
            ))}
            {history.issues.length === 0 ? (
              <li className="text-sm text-muted-foreground">No recent issues indexed.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </main>
  );
}
