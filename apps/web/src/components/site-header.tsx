import Link from 'next/link';

import { isAuthConfigured } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';

import { SignOutButton } from './sign-out-button';

export async function SiteHeader() {
  const configured = isAuthConfigured();
  const user = configured ? await getSessionUser() : null;

  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-serif text-lg tracking-tight text-foreground">
          Codebase Archaeologist
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Dashboard
              </Link>
              <Link
                href="/repositories/new"
                className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Add repository
              </Link>
              <Link href="/settings/ai" className="hover:text-foreground">
                AI settings
              </Link>
              <span className="hidden text-xs sm:inline">{user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
