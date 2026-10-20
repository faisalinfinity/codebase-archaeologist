import {
  createRepositoryBodySchema,
  getIngestionLimits,
  GitHubUrlError,
  parseGitHubRepoInput,
  type AuthUserDto,
  type IndexStatusDto,
  type RepositoryDto,
  type SearchResponseDto,
  type HistoryResponseDto,
  type ImpactResponseDto,
} from '@archaeologist/shared';

import { errorFromCode, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { assertPublicSize, type GitHubRepositoryReader } from '../github/github-repo-client';
import type { IndexJobQueue } from '../queue/index-queue';
import { normalizeEmbedding, type EmbeddingProvider } from '../embeddings/embedding-provider';
import { fuseResults, searchExcerpt } from './hybrid-ranking';
import type { RepositoryStore } from './repository-store';

const ACTIVE_STAGES = new Set([
  'PENDING',
  'CLONING',
  'SCANNING',
  'PARSING',
  'ANALYZING',
  'GITHUB_SYNC',
  'CHUNKING',
  'EMBEDDING',
  'FINALIZING',
]);

export class RepositoryService {
  constructor(
    private readonly store: RepositoryStore,
    private readonly github: GitHubRepositoryReader,
    private readonly queue: IndexJobQueue,
    private readonly env: Record<string, string | undefined> = {},
    private readonly embeddingProvider: EmbeddingProvider | null = null,
  ) {}

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

  async create(
    user: AuthUserDto,
    body: unknown,
  ): Promise<{ repository: RepositoryDto; alreadyExists: boolean }> {
    await this.ensureUser(user);
    const parsed = createRepositoryBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request.');
    }

    let github: ReturnType<typeof parseGitHubRepoInput>;
    try {
      github = parseGitHubRepoInput(parsed.data.githubUrl);
    } catch (error) {
      const message =
        error instanceof GitHubUrlError
          ? error.message
          : 'Enter a valid GitHub URL such as https://github.com/owner/repo.';
      throw errorFromCode('INVALID_GITHUB_URL', message);
    }

    const existing = await this.store.findByOwnerAndGithub(user.id, github.owner, github.repo);
    if (existing) {
      return { repository: existing, alreadyExists: true };
    }

    const limits = getIngestionLimits(this.env);
    const meta = await this.github.getRepository(github.owner, github.repo);
    if (meta.private) {
      throw errorFromCode('PRIVATE_REPOSITORY');
    }
    assertPublicSize(meta.sizeKb, limits.maxRepositorySizeMb);

    const inserted = await this.store.insertRepository({
      ownerUserId: user.id,
      githubOwner: github.owner,
      githubRepo: github.repo,
      githubUrl: github.canonicalUrl,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      stars: meta.stars,
      forks: meta.forks,
      language: meta.language,
    });

    await this.enqueue(inserted.repository.id, inserted.job.id);

    return { repository: inserted.repository, alreadyExists: false };
  }

  async getIndexStatus(user: AuthUserDto, id: string): Promise<IndexStatusDto> {
    const repository = await this.get(user, id);
    const job = await this.store.getLatestJob(repository.id);
    const snapshot = job?.snapshotId
      ? await this.store.getSnapshot(job.snapshotId)
      : await this.store.getLatestSnapshot(repository.id);
    const fileCount = snapshot ? await this.store.countFiles(snapshot.id) : 0;
    return {
      repository,
      job,
      snapshot,
      alreadyIndexed: repository.status === 'READY',
      fileCount,
    };
  }

  async listIndexedFiles(user: AuthUserDto, id: string, page = 1) {
    const repository = await this.get(user, id);
    const snapshot = await this.store.getLatestReadySnapshot(repository.id);
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    if (!snapshot) return { snapshot: null, files: [], total: 0, page: safePage };
    const [files, total] = await Promise.all([
      this.store.listFiles(snapshot.id, 100, (safePage - 1) * 100),
      this.store.countFiles(snapshot.id),
    ]);
    return { snapshot, files, total, page: safePage };
  }

  async getIndexedFile(user: AuthUserDto, id: string, filePath: string) {
    const repository = await this.get(user, id);
    if (!isSafeFilePath(filePath)) {
      throw new ValidationError('Invalid file path.');
    }
    const snapshot = await this.store.getLatestReadySnapshot(repository.id);
    if (!snapshot) throw new NotFoundError('No indexed snapshot is ready.');
    const file = await this.store.getFile(snapshot.id, filePath);
    if (!file) throw new NotFoundError('File not found in the indexed snapshot.');
    return { repository, snapshot, file };
  }

  async search(user: AuthUserDto, id: string, rawQuery: string): Promise<SearchResponseDto> {
    const repository = await this.get(user, id);
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 200) {
      throw new ValidationError('Search query must be between 2 and 200 characters.');
    }
    const snapshot = await this.store.getLatestReadySnapshot(repository.id);
    if (!snapshot) return { repositoryId: id, commitSha: null, mode: 'lexical', results: [] };

    const lexical = await this.store.searchLexical(snapshot.id, query, 40);
    let semantic: Awaited<ReturnType<RepositoryStore['searchSemantic']>> = [];
    if (
      this.embeddingProvider &&
      (await this.store.hasEmbeddings(snapshot.id, this.embeddingProvider.model))
    ) {
      try {
        const vectors = await this.embeddingProvider.embed([query]);
        const vector = vectors[0];
        if (!vector) throw new Error('Embedding response is empty.');
        semantic = await this.store.searchSemantic(
          snapshot.id,
          this.embeddingProvider.model,
          normalizeEmbedding(vector),
          40,
        );
      } catch {
        console.warn('[search] Semantic retrieval unavailable.');
      }
    }
    const results = fuseResults(lexical, semantic).map((candidate) => {
      const excerpt = searchExcerpt(candidate.content, query, candidate.startLine);
      return {
        chunkId: candidate.chunkId,
        filePath: candidate.filePath,
        ...excerpt,
        githubUrl: `${repository.githubUrl}/blob/${snapshot.commitSha}/${candidate.filePath.split('/').map(encodeURIComponent).join('/')}#L${excerpt.startLine}`,
        score: candidate.fusedScore,
      };
    });
    return {
      repositoryId: id,
      commitSha: snapshot.commitSha,
      mode: semantic.length ? 'hybrid' : 'lexical',
      results,
    };
  }

  async getHistory(
    user: AuthUserDto,
    id: string,
    filePath?: string,
    offset = 0,
  ): Promise<HistoryResponseDto> {
    const repository = await this.get(user, id);
    if (filePath && !isSafeFilePath(filePath)) throw new ValidationError('Invalid file path.');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
      throw new ValidationError('Invalid history offset.');
    const [allCommits, pullRequests, issues] = await Promise.all([
      this.store.listCommits(repository.id, 51, offset, filePath),
      this.store.listPullRequests(repository.id, 50),
      this.store.listIssues(repository.id, 50),
    ]);
    return {
      repositoryId: repository.id,
      githubUrl: repository.githubUrl,
      commits: allCommits.slice(0, 50),
      nextOffset: allCommits.length > 50 ? offset + 50 : null,
      pullRequests: filePath
        ? pullRequests.filter((pr) => pr.files?.some((file) => file.path === filePath))
        : pullRequests,
      issues: filePath ? issues.filter((issue) => issue.filePaths?.includes(filePath)) : issues,
    };
  }

  async getImpact(
    user: AuthUserDto,
    id: string,
    filePath: string,
    symbolName?: string,
  ): Promise<ImpactResponseDto> {
    const repository = await this.get(user, id);
    if (!isSafeFilePath(filePath)) throw new ValidationError('Invalid file path.');
    const snapshot = await this.store.getLatestReadySnapshot(repository.id);
    if (!snapshot || !(await this.store.getFile(snapshot.id, filePath))) {
      throw new NotFoundError('File not found in a ready snapshot.');
    }
    if (symbolName && symbolName.length > 200) throw new ValidationError('Invalid symbol name.');
    const [edges, history, symbolEdges] = await Promise.all([
      this.store.listImportEdges(snapshot.id),
      this.store.listCommits(repository.id, 50),
      this.store.listSymbolEdges(snapshot.id),
    ]);
    const reverse = new Map<string, Set<string>>();
    for (const edge of edges) {
      const sources = reverse.get(edge.targetPath) ?? new Set<string>();
      sources.add(edge.sourcePath);
      reverse.set(edge.targetPath, sources);
    }
    const dependents: ImpactResponseDto['dependents'] = [];
    const visited = new Set([filePath]);
    const queue: Array<{ path: string; distance: number }> = [{ path: filePath, distance: 0 }];
    for (let i = 0; i < queue.length && dependents.length < 100; i += 1) {
      const current = queue[i];
      if (!current || current.distance >= 3) continue;
      for (const source of reverse.get(current.path) ?? []) {
        if (visited.has(source)) continue;
        visited.add(source);
        const item = { path: source, distance: current.distance + 1 };
        dependents.push(item);
        queue.push(item);
        if (dependents.length >= 100) break;
      }
    }
    const relevant = history.filter((commit) =>
      commit.files.some((file) => file.path === filePath),
    );
    const counts = new Map<string, number>();
    for (const commit of relevant) {
      for (const file of commit.files) {
        if (file.path !== filePath) counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
      }
    }
    return {
      repositoryId: repository.id,
      snapshotSha: snapshot.commitSha,
      path: filePath,
      dependents,
      coChanged: [...counts]
        .map(([path, commitCount]) => ({ path, commitCount }))
        .sort((a, b) => b.commitCount - a.commitCount || a.path.localeCompare(b.path))
        .slice(0, 20),
      commits: relevant.slice(0, 10),
      graphTruncated: edges.length >= 10_000 || symbolEdges.length >= 10_000,
      symbolDependents: symbolEdges
        .filter(
          (edge) => edge.targetPath === filePath && (!symbolName || edge.targetName === symbolName),
        )
        .slice(0, 100)
        .map((edge) => ({
          path: edge.sourcePath,
          name: edge.sourceName,
          line: edge.sourceLine,
          targetName: edge.targetName,
          relationshipType: edge.relationshipType,
        })),
    };
  }

  async startIndex(user: AuthUserDto, id: string): Promise<IndexStatusDto> {
    const repository = await this.get(user, id);
    const latest = await this.store.getLatestJob(repository.id);
    if (latest && ACTIVE_STAGES.has(latest.status)) {
      if (latest.status === 'PENDING') await this.enqueue(repository.id, latest.id);
      return this.getIndexStatus(user, id);
    }

    const job = await this.store.createIndexJob(repository.id);
    await this.store.updateRepository(repository.id, { status: 'PENDING' });
    await this.enqueue(repository.id, job.id);
    return this.getIndexStatus(user, id);
  }

  private async enqueue(repositoryId: string, jobId: string): Promise<void> {
    try {
      await this.queue.enqueueIndex({ repositoryId, jobId });
    } catch (error) {
      await this.store.updateJob(jobId, {
        status: 'FAILED',
        stage: 'FAILED',
        errorCode: 'REDIS_UNAVAILABLE',
        errorMessage: 'The index queue is unavailable. Retry after Redis is connected.',
        completedAt: new Date(),
      });
      await this.store.updateRepository(repositoryId, { status: 'FAILED' });
      throw error;
    }
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

function isSafeFilePath(filePath: string): boolean {
  return Boolean(
    filePath &&
    !filePath.startsWith('/') &&
    !filePath.includes('\0') &&
    !filePath.split('/').some((part) => part === '..' || part === '.'),
  );
}
