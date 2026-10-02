import { z } from 'zod';

export const createRepositoryBodySchema = z.object({
  githubUrl: z.string().min(1, 'Repository URL is required.'),
});

export type CreateRepositoryBody = z.infer<typeof createRepositoryBodySchema>;

export interface RepositoryDto {
  id: string;
  ownerUserId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  defaultBranch: string | null;
  description: string | null;
  stars: number | null;
  forks: number | null;
  language: string | null;
  status: string;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IndexJobProgress {
  message?: string;
  filesIndexed?: number;
  filesSkipped?: number;
  filesSeen?: number;
  chunksEmbedded?: number;
  skippedReasons?: Record<string, number>;
}

export interface IndexJobDto {
  id: string;
  repositoryId: string;
  snapshotId: string | null;
  jobType: string;
  status: string;
  stage: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  progress: IndexJobProgress | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotDto {
  id: string;
  repositoryId: string;
  commitSha: string;
  branch: string;
  indexVersion: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface IndexStatusDto {
  repository: RepositoryDto;
  job: IndexJobDto | null;
  snapshot: SnapshotDto | null;
  alreadyIndexed: boolean;
  fileCount: number;
}

export interface SearchResultDto {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  githubUrl: string;
  score: number;
}

export interface SearchResponseDto {
  repositoryId: string;
  commitSha: string | null;
  mode: 'lexical' | 'hybrid';
  results: SearchResultDto[];
}

export interface AuthUserDto {
  id: string;
  email: string | null;
}
