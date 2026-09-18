import type { RepositoryDto } from '@archaeologist/shared';

export interface UpsertUserInput {
  id: string;
  email: string | null;
}

export interface InsertRepositoryInput {
  ownerUserId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
}

export interface RepositoryStore {
  upsertUser(input: UpsertUserInput): Promise<void>;
  listByOwner(ownerUserId: string): Promise<RepositoryDto[]>;
  getById(id: string): Promise<RepositoryDto | null>;
  findByOwnerAndGithub(
    ownerUserId: string,
    githubOwner: string,
    githubRepo: string,
  ): Promise<RepositoryDto | null>;
  insertRepository(input: InsertRepositoryInput): Promise<RepositoryDto>;
  deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean>;
}
