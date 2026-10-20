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
  commitsIndexed?: number;
  pullRequestsIndexed?: number;
  issuesIndexed?: number;
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

export interface ChatCitationDto {
  id: string;
  kind?: 'source' | 'commit' | 'pull_request' | 'issue';
  filePath: string;
  startLine: number;
  endLine: number;
  commitSha: string;
  githubUrl: string;
}

export interface ChatSessionDto {
  id: string;
  repositoryId: string;
  ownerUserId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitationDto[];
  provider: string | null;
  model: string | null;
  tokenUsage: number | null;
  createdAt: string;
}

export interface CommitSummaryDto {
  sha: string;
  parentSha: string | null;
  authorName: string | null;
  committedAt: string | null;
  message: string;
  files: Array<{ path: string; changeType: string }>;
}

export interface PullRequestSummaryDto {
  files?: Array<{ path: string; changeType: string }>;
  filesComplete?: boolean;
  relatedIssues?: number[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: string | null;
  mergedAt: string | null;
  updatedAt: string | null;
}

export interface IssueSummaryDto {
  filePaths?: string[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HistoryResponseDto {
  nextOffset?: number | null;
  repositoryId: string;
  githubUrl: string;
  commits: CommitSummaryDto[];
  pullRequests: PullRequestSummaryDto[];
  issues: IssueSummaryDto[];
}

export interface ImpactResponseDto {
  repositoryId: string;
  snapshotSha: string;
  path: string;
  dependents: Array<{ path: string; distance: number }>;
  coChanged: Array<{ path: string; commitCount: number }>;
  commits: CommitSummaryDto[];
  graphTruncated: boolean;
  symbolDependents: Array<{
    path: string;
    name: string;
    line: number;
    targetName: string;
    relationshipType: string;
  }>;
}

export interface AuthUserDto {
  id: string;
  email: string | null;
}
