import { AISettings } from '@/components/ai-settings';
import { createProviderSettingsService } from '@/lib/services';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AISettingsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const initial = await createProviderSettingsService().get(user.id);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="font-serif text-3xl font-semibold">AI settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use your own provider for repository chat. Your API key is encrypted and is never shown
        again.
      </p>
      <AISettings initial={initial} />
    </main>
  );
}
