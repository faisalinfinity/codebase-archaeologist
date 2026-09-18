import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That page or repository does not exist, or you do not have access.
      </p>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Back to dashboard
      </Link>
    </main>
  );
}
