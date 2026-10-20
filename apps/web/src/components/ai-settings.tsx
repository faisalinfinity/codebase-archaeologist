'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Provider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom';
interface SettingsState {
  settings: { provider: Provider; model: string; baseUrl: string | null; hasKey: boolean } | null;
  demoAvailable: boolean;
  byokEnabled: boolean;
}

export function AISettings({ initial }: { initial: SettingsState }) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>(initial.settings?.provider ?? 'openai');
  const [model, setModel] = useState(initial.settings?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(initial.settings?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(Boolean(initial.settings?.hasKey));
  const [savedProvider, setSavedProvider] = useState(initial.settings?.provider);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          ...(provider === 'custom' ? { baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save settings.');
      setApiKey('');
      setHasKey(true);
      setSavedProvider(provider);
      setMessage('Saved. New chat requests will use your provider.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/settings/ai', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove settings.');
      setApiKey('');
      setHasKey(false);
      setSavedProvider(undefined);
      setMessage('Personal key removed.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove settings.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="mt-8 flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {hasKey
          ? 'A personal API key is saved.'
          : initial.demoAvailable
            ? 'Server Demo AI is available while no personal key is saved.'
            : 'Add a personal key to enable chat.'}
      </p>
      {!initial.byokEnabled ? (
        <p role="status" className="text-sm">
          Personal keys are unavailable until the server administrator configures encryption.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="provider">Provider</Label>
        <select
          id="provider"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as Provider);
            setApiKey('');
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          <option value="openrouter">OpenRouter</option>
          <option value="custom">Custom OpenAI-compatible API</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="model">Model ID</Label>
        <Input
          id="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          required
          maxLength={200}
          placeholder="Enter a model available in your provider account"
        />
      </div>
      {provider === 'custom' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="base-url">API base URL</Label>
          <Input
            id="base-url"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            required
            placeholder="https://api.example.com/v1"
          />
          <p className="text-xs text-muted-foreground">
            The server administrator must enable this API origin.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="api-key">
          {hasKey && savedProvider === provider
            ? 'Replace API key (leave blank to keep saved key)'
            : 'API key'}
        </Label>
        <Input
          id="api-key"
          type="password"
          autoComplete="new-password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required={!hasKey || savedProvider !== provider}
          minLength={8}
          maxLength={4096}
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending || !initial.byokEnabled}>
          {pending ? 'Working…' : 'Save settings'}
        </Button>
        {hasKey ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void remove()}>
            Remove personal key
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
