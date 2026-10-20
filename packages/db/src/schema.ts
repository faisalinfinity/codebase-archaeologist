import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const repositoryStatusEnum = pgEnum('repository_status', [
  'PENDING',
  'CLONING',
  'PARSING',
  'EMBEDDING',
  'FINALIZING',
  'READY',
  'FAILED',
  'STALE',
]);

export const indexJobStageEnum = pgEnum('index_job_stage', [
  'PENDING',
  'CLONING',
  'SCANNING',
  'PARSING',
  'ANALYZING',
  'GITHUB_SYNC',
  'CHUNKING',
  'EMBEDDING',
  'FINALIZING',
  'READY',
  'FAILED',
]);

export const indexJobTypeEnum = pgEnum('index_job_type', [
  'repository:index',
  'repository:update',
  'repository:github-sync',
  'repository:embed',
  'repository:finalize',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  ...timestamps,
});

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubOwner: text('github_owner').notNull(),
    githubRepo: text('github_repo').notNull(),
    githubUrl: text('github_url').notNull(),
    defaultBranch: text('default_branch'),
    description: text('description'),
    stars: integer('stars'),
    forks: integer('forks'),
    language: text('language'),
    status: repositoryStatusEnum('status').notNull().default('PENDING'),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('repositories_owner_github_uidx').on(
      table.ownerUserId,
      table.githubOwner,
      table.githubRepo,
    ),
    index('repositories_owner_idx').on(table.ownerUserId),
  ],
);

export const repositoryMembers = pgTable(
  'repository_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('repository_members_repo_user_uidx').on(table.repositoryId, table.userId),
  ],
);

export const repositorySnapshots = pgTable(
  'repository_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    branch: text('branch').notNull(),
    indexVersion: integer('index_version').notNull().default(1),
    status: text('status').notNull().default('PENDING'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('repository_snapshots_repo_idx').on(table.repositoryId),
    uniqueIndex('repository_snapshots_repo_sha_uidx').on(table.repositoryId, table.commitSha),
  ],
);

export const indexJobs = pgTable(
  'index_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').references(() => repositorySnapshots.id, {
      onDelete: 'set null',
    }),
    jobType: indexJobTypeEnum('job_type').notNull().default('repository:index'),
    status: indexJobStageEnum('status').notNull().default('PENDING'),
    stage: indexJobStageEnum('stage').notNull().default('PENDING'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    progressJson: jsonb('progress_json').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('index_jobs_repository_idx').on(table.repositoryId),
    index('index_jobs_status_idx').on(table.status),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    language: text('language'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    sha: text('sha'),
    content: text('content'),
    isBinary: boolean('is_binary').notNull().default(false),
    isGenerated: boolean('is_generated').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('files_snapshot_path_uidx').on(table.snapshotId, table.path),
    index('files_repository_idx').on(table.repositoryId),
  ],
);

export const codeSymbols = pgTable(
  'code_symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: 'cascade' }),
    symbolType: text('symbol_type').notNull(),
    name: text('name').notNull(),
    qualifiedName: text('qualified_name'),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    startColumn: integer('start_column'),
    endColumn: integer('end_column'),
    parentSymbolId: uuid('parent_symbol_id').references((): AnyPgColumn => codeSymbols.id, {
      onDelete: 'set null',
    }),
    signature: text('signature'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('code_symbols_file_idx').on(table.fileId),
    index('code_symbols_repo_name_idx').on(table.repositoryId, table.name),
  ],
);

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    symbolId: uuid('symbol_id').references(() => codeSymbols.id, { onDelete: 'set null' }),
    chunkType: text('chunk_type').notNull(),
    content: text('content').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    language: text('language'),
    // Placeholder width — see DECISIONS.md. Not a frozen embedding contract.
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddingModel: text('embedding_model'),
    embeddingUpdatedAt: timestamp('embedding_updated_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('code_chunks_snapshot_idx').on(table.snapshotId),
    index('code_chunks_file_idx').on(table.fileId),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    title: text('title'),
    content: text('content').notNull(),
    docType: text('doc_type').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('documents_snapshot_idx').on(table.snapshotId)],
);

export const commits = pgTable(
  'commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    authorName: text('author_name'),
    authorEmailHash: text('author_email_hash'),
    message: text('message').notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    parentSha: text('parent_sha'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [uniqueIndex('commits_repo_sha_uidx').on(table.repositoryId, table.sha)],
);

export const commitFiles = pgTable(
  'commit_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commitId: uuid('commit_id')
      .notNull()
      .references(() => commits.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    changeType: text('change_type').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('commit_files_commit_idx').on(table.commitId),
    index('commit_files_path_idx').on(table.path, table.commitId),
  ],
);

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    author: text('author'),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('pull_requests_repo_number_uidx').on(table.repositoryId, table.number),
    index('pull_requests_repo_updated_idx').on(table.repositoryId, table.updatedAt),
  ],
);

export const pullRequestFiles = pgTable(
  'pull_request_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pullRequestId: uuid('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    changeType: text('change_type'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [index('pull_request_files_pr_idx').on(table.pullRequestId)],
);

export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    author: text('author'),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('issues_repo_number_uidx').on(table.repositoryId, table.number),
    index('issues_repo_updated_idx').on(table.repositoryId, table.updatedAt),
  ],
);

export const issueComments = pgTable(
  'issue_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    author: text('author'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [index('issue_comments_issue_idx').on(table.issueId)],
);

export const dependencies = pgTable(
  'dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: 'cascade' }),
    sourceSymbolId: uuid('source_symbol_id').references(() => codeSymbols.id, {
      onDelete: 'cascade',
    }),
    targetSymbolId: uuid('target_symbol_id').references(() => codeSymbols.id, {
      onDelete: 'cascade',
    }),
    sourceFileId: uuid('source_file_id').references(() => files.id, { onDelete: 'cascade' }),
    targetFileId: uuid('target_file_id').references(() => files.id, { onDelete: 'cascade' }),
    relationshipType: text('relationship_type').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  },
  (table) => [index('dependencies_snapshot_idx').on(table.snapshotId)],
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text('title'),
    ...timestamps,
  },
  (table) => [
    index('chat_sessions_owner_idx').on(table.ownerUserId),
    index('chat_sessions_repo_idx').on(table.repositoryId),
    index('chat_sessions_owner_repo_updated_idx').on(
      table.ownerUserId,
      table.repositoryId,
      table.updatedAt,
    ),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    provider: text('provider'),
    model: text('model'),
    tokenUsage: integer('token_usage'),
    retrievalMetadataJson: jsonb('retrieval_metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_messages_session_idx').on(table.sessionId),
    index('chat_messages_session_created_idx').on(table.sessionId, table.createdAt, table.id),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    keyLastFour: text('key_last_four'),
    ...timestamps,
  },
  (table) => [
    index('api_keys_user_idx').on(table.userId),
    uniqueIndex('api_keys_user_uidx').on(table.userId),
  ],
);

export const aiProviderConfigs = pgTable(
  'ai_provider_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    baseUrl: text('base_url'),
    model: text('model'),
    isCustom: boolean('is_custom').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('ai_provider_configs_user_idx').on(table.userId),
    uniqueIndex('ai_provider_configs_user_uidx').on(table.userId),
  ],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costCents: integer('cost_cents'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('usage_events_user_idx').on(table.userId)],
);
