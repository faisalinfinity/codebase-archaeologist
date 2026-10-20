import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { getDatabase, type Database } from '@archaeologist/db';
import { aiProviderConfigs, apiKeys, users } from '@archaeologist/db';
import type { AuthUserDto } from '@archaeologist/shared';

import { ValidationError } from '../errors';
import type { AIProvider } from '../chat/ai-provider';
import { configuredAIProvider } from '../chat/openai-responses-provider';
import { RoutedAIProvider, type ProviderName } from '../chat/multi-provider';
import { openRouterModelCatalog } from '../chat/openrouter-models';
import { KeyVault } from './key-vault';
import { validateCustomBaseUrl } from './secure-fetch';

const settingsSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic', 'gemini', 'openrouter', 'custom']),
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w./:@+-]+$/),
    baseUrl: z.string().trim().max(2048).optional(),
    apiKey: z
      .string()
      .trim()
      .min(8)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
  })
  .strict();

export interface SavedProviderSettings {
  provider: ProviderName;
  model: string;
  baseUrl: string | null;
  encryptedKey: string;
}
export interface ProviderSettingsStore {
  get(userId: string): Promise<SavedProviderSettings | null>;
  save(user: AuthUserDto, settings: SavedProviderSettings): Promise<void>;
  delete(userId: string): Promise<void>;
}

export class DrizzleProviderSettingsStore implements ProviderSettingsStore {
  constructor(private db: Database = getDatabase()) {}
  async get(userId: string): Promise<SavedProviderSettings | null> {
    const [row] = await this.db
      .select({
        provider: aiProviderConfigs.provider,
        model: aiProviderConfigs.model,
        baseUrl: aiProviderConfigs.baseUrl,
        encryptedKey: apiKeys.encryptedKey,
      })
      .from(aiProviderConfigs)
      .innerJoin(
        apiKeys,
        and(
          eq(apiKeys.userId, aiProviderConfigs.userId),
          eq(apiKeys.provider, aiProviderConfigs.provider),
        ),
      )
      .where(eq(aiProviderConfigs.userId, userId))
      .limit(1);
    return row ? { ...row, provider: row.provider as ProviderName, model: row.model ?? '' } : null;
  }
  async save(user: AuthUserDto, settings: SavedProviderSettings): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({ id: user.id, email: user.email ?? '' })
        .onConflictDoNothing();
      await tx
        .insert(aiProviderConfigs)
        .values({
          userId: user.id,
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl,
          isCustom: settings.provider === 'custom',
        })
        .onConflictDoUpdate({
          target: aiProviderConfigs.userId,
          set: {
            provider: settings.provider,
            model: settings.model,
            baseUrl: settings.baseUrl,
            isCustom: settings.provider === 'custom',
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(apiKeys)
        .values({
          userId: user.id,
          provider: settings.provider,
          encryptedKey: settings.encryptedKey,
        })
        .onConflictDoUpdate({
          target: apiKeys.userId,
          set: {
            provider: settings.provider,
            encryptedKey: settings.encryptedKey,
            keyLastFour: null,
            updatedAt: new Date(),
          },
        });
    });
  }
  async delete(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(aiProviderConfigs).where(eq(aiProviderConfigs.userId, userId));
      await tx.delete(apiKeys).where(eq(apiKeys.userId, userId));
    });
  }
}

export class ProviderSettingsService {
  constructor(
    private store: ProviderSettingsStore,
    private env: Record<string, string | undefined>,
  ) {}
  async get(userId: string) {
    const saved = await this.store.get(userId);
    return {
      settings: saved
        ? { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl, hasKey: true }
        : null,
      demoAvailable: Boolean(this.env.DEMO_AI_API_KEY),
      byokEnabled: /^[0-9a-f]{64}$/i.test(this.env.ENCRYPTION_KEY ?? ''),
    };
  }
  async save(user: AuthUserDto, body: unknown): Promise<void> {
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Enter a provider, model, and valid API key.');
    const input = parsed.data;
    const baseUrl =
      input.provider === 'custom'
        ? validateCustomBaseUrl(input.baseUrl ?? '', this.env.CUSTOM_AI_ALLOWED_ORIGINS)
        : null;
    if (input.provider !== 'custom' && input.baseUrl)
      throw new ValidationError('Only custom providers accept an API URL.');
    const vault = new KeyVault(this.env.ENCRYPTION_KEY);
    const previous = await this.store.get(user.id);
    if (!input.apiKey && previous?.provider !== input.provider)
      throw new ValidationError('Enter an API key for this provider.');
    const encryptedKey = input.apiKey
      ? vault.encrypt(input.apiKey, user.id)
      : previous!.encryptedKey;
    await this.store.save(user, {
      provider: input.provider,
      model: input.model,
      baseUrl,
      encryptedKey,
    });
  }
  async delete(userId: string): Promise<void> {
    await this.store.delete(userId);
  }
  async resolve(userId: string): Promise<AIProvider | null> {
    const saved = await this.store.get(userId);
    if (!saved) return configuredAIProvider(this.env);
    const baseUrl =
      saved.provider === 'custom'
        ? validateCustomBaseUrl(saved.baseUrl ?? '', this.env.CUSTOM_AI_ALLOWED_ORIGINS)
        : undefined;
    return new RoutedAIProvider({
      provider: saved.provider,
      model: saved.model,
      baseUrl,
      apiKey: new KeyVault(this.env.ENCRYPTION_KEY).decrypt(saved.encryptedKey, userId),
      openRouterPolicy:
        saved.provider === 'openrouter'
          ? await openRouterModelCatalog.policy(
              saved.model,
              Number(this.env.MAX_FREE_REASONING_TOKENS ?? 8192),
            )
          : undefined,
    });
  }
}
