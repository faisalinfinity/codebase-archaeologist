'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPublicEnv } from '@/lib/env';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface LoginFormProps {
  nextPath: string;
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'password' | 'signup' | 'magic' | null>(null);

  const canSubmit = email.includes('@') && !pending;
  const canPassword = canSubmit && password.length >= 6;

  async function signInWithPassword() {
    setPending('password');
    setError(null);
    setMessage(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function signUp() {
    setPending('signup');
    setError(null);
    setMessage(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const env = getPublicEnv();
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      setMessage(
        'Check your email to confirm the account, or sign in if confirmation is disabled.',
      );
    } finally {
      setPending(null);
    }
  }

  async function sendMagicLink() {
    setPending('magic');
    setError(null);
    setMessage(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const env = getPublicEnv();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      setMessage('If that address is valid, a sign-in link is on its way.');
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canPassword) void signInWithPassword();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={!canPassword} aria-busy={pending === 'password'}>
          {pending === 'password' ? 'Signing in…' : 'Sign in'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canPassword}
          onClick={() => void signUp()}
        >
          {pending === 'signup' ? 'Creating account…' : 'Create account'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSubmit}
          onClick={() => void sendMagicLink()}
        >
          {pending === 'magic' ? 'Sending link…' : 'Email me a magic link'}
        </Button>
      </div>
    </form>
  );
}
