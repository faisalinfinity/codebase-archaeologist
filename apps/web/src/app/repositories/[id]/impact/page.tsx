import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForbiddenError, NotFoundError, ValidationError } from '@archaeologist/api';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createRepositoryService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function RepositoryImpactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string; symbol?: string }>;
}) {
  const [{ id }, { path: filePath = '', symbol = '' }] = await Promise.all([params, searchParams]);
  const user = await getSessionUser();
  if (!user) return null;
  const service = createRepositoryService();
  let impact;
  let errorMessage: string | null = null;
  try {
    if (filePath) impact = await service.getImpact(user, id, filePath, symbol);
    else await service.get(user, id);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof NotFoundError && !filePath) notFound();
    if (error instanceof NotFoundError || error instanceof ValidationError)
      errorMessage = error.message;
    else throw error;
  }
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-10">
      <div>
        <Link
          href={`/repositories/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Repository
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Change impact</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inspect reverse imports and files changed alongside a path in recent commits.
        </p>
      </div>
      <form method="get" className="flex gap-2">
        <Input
          name="path"
          defaultValue={filePath}
          placeholder="src/lib/auth.ts"
          required
          aria-label="Indexed file path"
        />
        <Input
          name="symbol"
          defaultValue={symbol}
          placeholder="Symbol (optional)"
          aria-label="Symbol name"
        />
        <Button type="submit">Analyze</Button>
      </form>
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      {impact ? (
        <div className="flex flex-col gap-7">
          <p className="text-sm text-muted-foreground">
            Snapshot {impact.snapshotSha.slice(0, 12)} · {impact.path}
          </p>
          {impact.graphTruncated ? (
            <p className="text-sm text-amber-500">
              The dependency graph reached its configured edge cap; more dependents may exist.
            </p>
          ) : null}
          <section>
            <h2 className="font-serif text-xl font-semibold">Files that import this path</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {impact.dependents.map((item) => (
                <li key={item.path} className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <Link
                    className="break-all font-mono text-primary hover:underline"
                    href={`/repositories/${id}/files/${item.path.split('/').map(encodeURIComponent).join('/')}`}
                  >
                    {item.path}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">
                    {item.distance === 1 ? 'direct' : `${item.distance} hops`}
                  </span>
                </li>
              ))}
              {impact.dependents.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No indexed reverse imports found.
                </li>
              ) : null}
            </ul>
          </section>
          <section>
            <h2 className="font-serif text-xl font-semibold">Symbol references</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {impact.symbolDependents.map((item, index) => (
                <li key={index} className="px-4 py-3 text-sm">
                  <Link
                    className="font-mono text-primary hover:underline"
                    href={`/repositories/${id}/files/${item.path.split('/').map(encodeURIComponent).join('/')}#L${item.line}`}
                  >
                    {item.path}:{item.line} · {item.name}
                  </Link>
                  <span className="ml-2 text-muted-foreground">
                    {item.relationshipType} {item.targetName}
                  </span>
                </li>
              ))}
              {impact.symbolDependents.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No resolved symbol references found.
                </li>
              ) : null}
            </ul>
          </section>
          <section>
            <h2 className="font-serif text-xl font-semibold">Recently changed together</h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {impact.coChanged.map((item) => (
                <li key={item.path} className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <Link
                    className="break-all font-mono text-primary hover:underline"
                    href={`/repositories/${id}/history?path=${encodeURIComponent(item.path)}`}
                  >
                    {item.path}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{item.commitCount} commits</span>
                </li>
              ))}
              {impact.coChanged.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No co-change evidence in recent commits.
                </li>
              ) : null}
            </ul>
          </section>
          <p className="text-xs text-muted-foreground">
            Impact is evidence, not a guarantee: computed imports, ambiguous symbol targets, and
            runtime behavior may not appear in this graph.
          </p>
        </div>
      ) : null}
    </main>
  );
}
