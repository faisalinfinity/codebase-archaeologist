import {
  DrizzleRepositoryStore,
  GitHubRepoClient,
  HttpError,
  NoopIndexQueue,
  RepositoryService,
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
