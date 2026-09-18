import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=auth`, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
