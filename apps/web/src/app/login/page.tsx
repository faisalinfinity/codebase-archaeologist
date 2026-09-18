import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { isAuthConfigured } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = params.next && params.next.startsWith('/') ? params.next : '/dashboard';

  if (isAuthConfigured()) {
    const user = await getSessionUser();
    if (user) {
      redirect(nextPath);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use email and password, or a magic link. Public repository indexing does not need GitHub
          OAuth.
        </p>
      </div>
      {isAuthConfigured() ? (
        <LoginForm nextPath={nextPath} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Supabase Auth is not configured.</p>
          <p className="mt-2">
            Copy <code className="text-foreground">.env.example</code> to{' '}
            <code className="text-foreground">apps/web/.env.local</code> and set{' '}
            <code className="text-foreground">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Then enable
            Email auth and add redirect{' '}
            <code className="text-foreground">http://localhost:3000/auth/callback</code>.
          </p>
        </div>
      )}
    </main>
  );
}
