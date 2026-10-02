export { requireUser, type UserLookup } from './auth/require-user';
export {
  HttpError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitedError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  errorFromCode,
  toPublicError,
} from './errors';
export { RepositoryService } from './repositories/repository-service';
export { DrizzleRepositoryStore } from './repositories/drizzle-repository-store';
export { InMemoryRepositoryStore } from './repositories/in-memory-repository-store';
export type { RepositoryStore } from './repositories/repository-store';
export { GitHubRepoClient, assertPublicSize } from './github/github-repo-client';
export type { GitHubRepositoryReader, GitHubRepoMetadata } from './github/github-repo-client';
export { NoopIndexQueue, INDEX_QUEUE_NAME, INDEX_JOB_NAME } from './queue/index-queue';
export type { IndexJobQueue, IndexJobPayload } from './queue/index-queue';
export { embedChunks, EMBEDDING_DIMENSIONS } from './embeddings/embedding-provider';
export type { EmbeddingProvider } from './embeddings/embedding-provider';
export {
  OpenAIEmbeddingProvider,
  configuredEmbeddingProvider,
} from './embeddings/openai-embedding-provider';
