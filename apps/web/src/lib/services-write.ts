import { RepositoryService, configuredEmbeddingProvider } from '@archaeologist/api';

import { createRepositoryService, requireDatabase } from '@/lib/services';

/** Create / re-index paths. Loads BullMQ only when REDIS_URL is set. */
export async function createRepositoryWriteService(): Promise<RepositoryService> {
  requireDatabase();
  if (!process.env.REDIS_URL) {
    return createRepositoryService();
  }
  const [{ DrizzleRepositoryStore, GitHubRepoClient }, { BullmqIndexQueue }] = await Promise.all([
    import('@archaeologist/api'),
    import('@archaeologist/api/queue'),
  ]);
  return new RepositoryService(
    new DrizzleRepositoryStore(),
    new GitHubRepoClient({ token: process.env.GITHUB_API_TOKEN }),
    new BullmqIndexQueue(process.env.REDIS_URL),
    process.env,
    configuredEmbeddingProvider(process.env),
  );
}
