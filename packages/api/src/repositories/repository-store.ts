import type {
  IndexJobDto,
  IndexJobProgress,
  RepositoryDto,
  SnapshotDto,
} from '@archaeologist/shared';

export interface UpsertUserInput {
  id: string;
  email: string | null;
}

export interface InsertRepositoryInput {
  ownerUserId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  defaultBranch?: string | null;
  description?: string | null;
  stars?: number | null;
  forks?: number | null;
  language?: string | null;
}

export interface InsertedRepository {
  repository: RepositoryDto;
  job: IndexJobDto;
}

export interface RepositoryPatch {
  status?: string;
  defaultBranch?: string | null;
  description?: string | null;
  stars?: number | null;
  forks?: number | null;
  language?: string | null;
  lastIndexedAt?: Date | null;
}

export interface IndexJobPatch {
  status?: string;
  stage?: string;
  snapshotId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
  progress?: IndexJobProgress | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface UpsertSnapshotInput {
  repositoryId: string;
  commitSha: string;
  branch: string;
  status: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
}

export interface InsertFileInput {
  repositoryId: string;
  snapshotId: string;
  path: string;
  language: string | null;
  sizeBytes: number;
  sha: string | null;
  isBinary: boolean;
  isGenerated: boolean;
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
  insertRepository(input: InsertRepositoryInput): Promise<InsertedRepository>;
  updateRepository(id: string, patch: RepositoryPatch): Promise<RepositoryDto | null>;
  deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean>;
  getLatestJob(repositoryId: string): Promise<IndexJobDto | null>;
  getJob(jobId: string): Promise<IndexJobDto | null>;
  createIndexJob(repositoryId: string): Promise<IndexJobDto>;
  updateJob(jobId: string, patch: IndexJobPatch): Promise<IndexJobDto | null>;
  upsertSnapshot(input: UpsertSnapshotInput): Promise<SnapshotDto>;
  getSnapshot(id: string): Promise<SnapshotDto | null>;
  getLatestSnapshot(repositoryId: string): Promise<SnapshotDto | null>;
  replaceSnapshotFiles(snapshotId: string, files: InsertFileInput[]): Promise<void>;
  countFiles(snapshotId: string): Promise<number>;
}
