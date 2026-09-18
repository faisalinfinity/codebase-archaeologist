import { AddRepositoryForm } from '@/components/add-repository-form';

export default async function NewRepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const params = await searchParams;
  const initialUrl = params.url ?? '';

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Add repository</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Public GitHub repositories only. Submitting a URL validates it, queues a BullMQ job, and
          clones with read-only git. Repository code is never executed.
        </p>
      </div>
      <AddRepositoryForm initialUrl={initialUrl} />
    </main>
  );
}
