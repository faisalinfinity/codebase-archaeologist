import {
  DrizzleRepositoryStore,
  GitHubRepoClient,
  HttpError,
  NoopIndexQueue,
  RepositoryService,
  ChatService,
  DrizzleChatStore,
  ProviderSettingsService,
  DrizzleProviderSettingsStore,
  configuredEmbeddingProvider,
} from '@archaeologist/api';

export function requireDatabase(): void {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(
      503,
      'database_unavailable',
      'Database is not configured. Set DATABASE_URL and run migrations.',
    );
  }
}

export function createChatService(): ChatService {
  return new ChatService(
    createRepositoryService(),
    new DrizzleChatStore(),
    (userId) => createProviderSettingsService().resolve(userId),
    process.env,
  );
}

export function createProviderSettingsService(): ProviderSettingsService {
  requireDatabase();
  return new ProviderSettingsService(new DrizzleProviderSettingsStore(), process.env);
}

export function createRepositoryService(): RepositoryService {
  requireDatabase();
  return new RepositoryService(
    new DrizzleRepositoryStore(),
    new GitHubRepoClient({ token: process.env.GITHUB_API_TOKEN }),
    new NoopIndexQueue(),
    process.env,
    configuredEmbeddingProvider(process.env),
  );
}
