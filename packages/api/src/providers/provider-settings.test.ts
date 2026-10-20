import { expect, it } from 'vitest';
import { KeyVault } from './key-vault';
import { isPublicAddress, validateCustomBaseUrl } from './secure-fetch';
import {
  ProviderSettingsService,
  type ProviderSettingsStore,
  type SavedProviderSettings,
} from './provider-settings';

const key = 'ab'.repeat(32);
it('authenticates ciphertext and binds it to its owner', () => {
  const vault = new KeyVault(key);
  const encrypted = vault.encrypt('private-provider-key', 'alice');
  expect(encrypted).not.toContain('private-provider-key');
  expect(vault.decrypt(encrypted, 'alice')).toBe('private-provider-key');
  expect(() => vault.decrypt(encrypted, 'bob')).toThrow();
  expect(() => new KeyVault('bad')).toThrow();
  expect(vault.encrypt('private-provider-key', 'alice')).not.toBe(encrypted);
});

it('saves encrypted personal settings, isolates users, and never returns keys', async () => {
  const records = new Map<string, SavedProviderSettings>();
  const store: ProviderSettingsStore = {
    get: async (id) => records.get(id) ?? null,
    save: async (user, value) => {
      records.set(user.id, value);
    },
    delete: async (id) => {
      records.delete(id);
    },
  };
  const service = new ProviderSettingsService(store, { ENCRYPTION_KEY: key });
  const alice = { id: 'alice', email: 'alice@example.com' };
  await service.save(alice, { provider: 'anthropic', model: 'my-model', apiKey: 'secret-api-key' });
  expect(JSON.stringify(await service.get('alice'))).not.toMatch(/secret-api-key|encryptedKey/);
  expect((await service.get('bob')).settings).toBeNull();
  expect((await service.resolve('alice'))?.name).toBe('anthropic');
  await service.save(alice, { provider: 'anthropic', model: 'another-model' });
  expect((await service.resolve('alice'))?.model).toBe('another-model');
  await expect(service.save(alice, { provider: 'gemini', model: 'test' })).rejects.toThrow(
    'Enter an API key',
  );
  await service.delete('alice');
  expect(await service.resolve('alice')).toBeNull();
});

it('rejects private endpoints, credentials, redirects origins, and mapped IPv6', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2002:7f00:1::',
  ])
    expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  for (const url of [
    'http://api.example.com/v1',
    'https://other.example.com/v1',
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?key=abc',
  ])
    expect(() => validateCustomBaseUrl(url, 'https://api.example.com')).toThrow();
  expect(validateCustomBaseUrl('https://api.example.com/v1/', 'https://api.example.com')).toBe(
    'https://api.example.com/v1',
  );
});
