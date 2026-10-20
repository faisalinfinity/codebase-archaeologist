import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError, ValidationError } from '@archaeologist/api';

import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function IndexedFilePage({
  params,
}: {
  params: Promise<{ id: string; path: string[] }>;
}) {
  const { id, path } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  let result;
  try {
    result = await createRepositoryService().getIndexedFile(user, id, path.join('/'));
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    )
      notFound();
    throw error;
  }
  const { file, repository, snapshot } = result;
  const lines = file.content?.split('\n') ?? [];
  if (file.content?.endsWith('\n')) lines.pop();
  const githubUrl = `${repository.githubUrl}/blob/${snapshot.commitSha}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10">
      <div>
        <Link
          href={`/repositories/${id}/files`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Indexed files
        </Link>
        <h1 className="mt-2 break-all font-mono text-2xl font-semibold">{file.path}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Snapshot {snapshot.commitSha.slice(0, 12)} · {file.language ?? 'text'} ·{' '}
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            View on GitHub
          </a>
        </p>
        <div className="mt-3 flex gap-4 text-sm">
          <Link
            className="text-primary hover:underline"
            href={`/repositories/${id}/history?path=${encodeURIComponent(file.path)}`}
          >
            File history
          </Link>
          <Link
            className="text-primary hover:underline"
            href={`/repositories/${id}/impact?path=${encodeURIComponent(file.path)}`}
          >
            Change impact
          </Link>
        </div>
      </div>
      {file.symbols.length > 0 ? (
        <section>
          <h2 className="font-medium">Symbols</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {file.symbols.map((symbol, index) => (
              <a
                key={`${symbol.name}-${symbol.startLine}-${index}`}
                href={`#L${symbol.startLine}`}
                className="rounded-md border border-border px-2 py-1 text-sm hover:text-primary"
              >
                {symbol.name} <span className="text-muted-foreground">:{symbol.startLine}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {file.imports.length > 0 ? (
        <section>
          <h2 className="font-medium">Imports</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {file.imports.map((item, index) => (
              <li key={`${item.specifier}-${index}`} className="font-mono">
                {item.targetPath ? (
                  <Link
                    className="text-primary hover:underline"
                    href={`/repositories/${id}/files/${item.targetPath.split('/').map(encodeURIComponent).join('/')}`}
                  >
                    {item.specifier}
                  </Link>
                ) : (
                  <span>{item.specifier}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {file.content === null ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          Source text is unavailable for this file. The stored file metadata remains available.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} id={`L${index + 1}`} className="target:bg-primary/10">
                  <td className="select-none border-r border-border px-3 text-right text-muted-foreground">
                    <a href={`#L${index + 1}`}>{index + 1}</a>
                  </td>
                  <td className="whitespace-pre px-3">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
