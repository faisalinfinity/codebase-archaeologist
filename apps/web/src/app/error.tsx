'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This section failed to load. You can try again without reloading the whole app.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
