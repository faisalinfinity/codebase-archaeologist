'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function RepoUrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState('https://github.com/vercel/next.js');

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = `/repositories/new?url=${encodeURIComponent(url.trim())}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex min-h-10 w-full flex-1 flex-col gap-2">
        <Label htmlFor="github-url">GitHub repository URL</Label>
        <Input
          id="github-url"
          name="githubUrl"
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/vercel/next.js"
          autoComplete="off"
        />
      </div>
      <Button type="submit" size="lg">
        Continue
      </Button>
    </form>
  );
}
