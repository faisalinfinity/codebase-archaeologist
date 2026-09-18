import { DrizzleRepositoryStore, HttpError, RepositoryService } from '@archaeologist/api';

export function createRepositoryService(): RepositoryService {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(
      503,
      'database_unavailable',
      'Database is not configured. Set DATABASE_URL and run migrations.',
    );
  }
  return new RepositoryService(new DrizzleRepositoryStore());
}
