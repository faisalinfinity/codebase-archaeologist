import type {
  IndexJobDto,
  IndexJobProgress,
  RepositoryDto,
  SnapshotDto,
  CommitSummaryDto,
  PullRequestSummaryDto,
  IssueSummaryDto,
} from '@archaeologist/shared';

export interface InsertCommitInput {
  sha: string;
  parentSha: string | null;
  authorName: string | null;
  committedAt: Date | null;
  message: string;
  files: Array<{ path: string; changeType: string }>;
}

export interface InsertPullRequestInput {
  files?: Array<{ path: string; changeType: string }>;
  filesComplete?: boolean;
  relatedIssues?: number[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: Date | null;
  mergedAt: Date | null;
  updatedAt: Date | null;
}

export interface InsertIssueInput {
  filePaths?: string[];
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  state: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

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
  content: string | null;
  isBinary: boolean;
  isGenerated: boolean;
  symbols: Array<{
    name: string;
    symbolType: string;
    startLine: number;
    endLine: number;
    signature: string | null;
  }>;
  chunks: Array<{ content: string; startLine: number; endLine: number }>;
  imports: string[];
  aliases?: Array<{ pattern: string; targets: string[]; scope?: string }>;
  references?: Array<{
    sourceName: string;
    sourceStartLine: number;
    targetName: string;
    targetModule: string | null;
    line: number;
    relationshipType: 'calls' | 'constructs' | 'extends';
  }>;
}

export interface IndexedFile {
  id: string;
  path: string;
  language: string | null;
  sizeBytes: number;
  content: string | null;
  symbols: InsertFileInput['symbols'];
  imports: Array<{ specifier: string; targetPath: string | null }>;
}

export interface IndexedChunk {
  id: string;
  snapshotId: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding: number[] | null;
  embeddingModel: string | null;
}

export interface SearchCandidate {
  chunkId: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
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
  getLatestReadySnapshot(repositoryId: string): Promise<SnapshotDto | null>;
  replaceSnapshotFiles(
    snapshotId: string,
    files: AsyncIterable<InsertFileInput> | Iterable<InsertFileInput>,
  ): Promise<void>;
  countFiles(snapshotId: string): Promise<number>;
  countChunks(snapshotId: string): Promise<number>;
  listFiles(
    snapshotId: string,
    limit: number,
    offset: number,
  ): Promise<Array<Pick<IndexedFile, 'id' | 'path' | 'language' | 'sizeBytes'>>>;
  getFile(snapshotId: string, path: string): Promise<IndexedFile | null>;
  getChunksForEmbedding(
    snapshotId: string,
    afterId: string | null,
    limit: number,
  ): Promise<Array<Pick<IndexedChunk, 'id' | 'content'>>>;
  updateChunkEmbeddings(
    snapshotId: string,
    model: string,
    items: Array<{ id: string; embedding: number[] }>,
  ): Promise<void>;
  hasEmbeddings(snapshotId: string, model: string): Promise<boolean>;
  searchLexical(snapshotId: string, query: string, limit: number): Promise<SearchCandidate[]>;
  searchSemantic(
    snapshotId: string,
    model: string,
    vector: number[],
    limit: number,
  ): Promise<SearchCandidate[]>;
  replaceCommitHistory(repositoryId: string, commits: InsertCommitInput[]): Promise<void>;
  replacePullRequests(repositoryId: string, pullRequests: InsertPullRequestInput[]): Promise<void>;
  replaceIssues(repositoryId: string, issues: InsertIssueInput[]): Promise<void>;
  listCommits(
    repositoryId: string,
    limit: number,
    offset?: number,
    filePath?: string,
  ): Promise<CommitSummaryDto[]>;
  listPullRequests(repositoryId: string, limit: number): Promise<PullRequestSummaryDto[]>;
  listIssues(repositoryId: string, limit: number): Promise<IssueSummaryDto[]>;
  listImportEdges(snapshotId: string): Promise<Array<{ sourcePath: string; targetPath: string }>>;
  listSymbolEdges(snapshotId: string): Promise<SymbolEdge[]>;
}

export interface SymbolEdge {
  sourcePath: string;
  sourceName: string;
  sourceLine: number;
  targetPath: string;
  targetName: string;
  targetLine: number;
  relationshipType: string;
}
