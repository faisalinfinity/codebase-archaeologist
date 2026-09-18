import {
  createRepositoryBodySchema,
  GitHubUrlError,
  parseGitHubRepoInput,
  type AuthUserDto,
  type RepositoryDto,
} from '@archaeologist/shared';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { RepositoryStore } from './repository-store';

export class RepositoryService {
  constructor(private readonly store: RepositoryStore) {}

  async ensureUser(user: AuthUserDto): Promise<void> {
    await this.store.upsertUser({
      id: user.id,
      email: user.email ?? '',
    });
  }

  async list(user: AuthUserDto): Promise<RepositoryDto[]> {
    await this.ensureUser(user);
    return this.store.listByOwner(user.id);
  }

  async get(user: AuthUserDto, id: string): Promise<RepositoryDto> {
    await this.ensureUser(user);
    const repo = await this.store.getById(id);
    if (!repo) {
      throw new NotFoundError('Repository not found.');
    }
    if (repo.ownerUserId !== user.id) {
      throw new ForbiddenError();
    }
    return repo;
  }

  async create(user: AuthUserDto, body: unknown): Promise<RepositoryDto> {
    await this.ensureUser(user);
    const parsed = createRepositoryBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request.');
    }

    let github: ReturnType<typeof parseGitHubRepoInput>;
    try {
      github = parseGitHubRepoInput(parsed.data.githubUrl);
    } catch (error) {
      const message = error instanceof GitHubUrlError ? error.message : 'Invalid GitHub URL.';
      throw new ValidationError(message);
    }

    const existing = await this.store.findByOwnerAndGithub(user.id, github.owner, github.repo);
    if (existing) {
      throw new ConflictError('You already added this repository.');
    }

    return this.store.insertRepository({
      ownerUserId: user.id,
      githubOwner: github.owner,
      githubRepo: github.repo,
      githubUrl: github.canonicalUrl,
    });
  }

  async delete(user: AuthUserDto, id: string): Promise<void> {
    await this.ensureUser(user);
    const repo = await this.store.getById(id);
    if (!repo) {
      throw new NotFoundError('Repository not found.');
    }
    if (repo.ownerUserId !== user.id) {
      throw new ForbiddenError();
    }
    const deleted = await this.store.deleteByOwnerAndId(user.id, id);
    if (!deleted) {
      throw new NotFoundError('Repository not found.');
    }
  }
}
