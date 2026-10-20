export interface IngestionLimits {
  maxRepositorySizeMb: number;
  maxFiles: number;
  maxFileSizeBytes: number;
  cloneTimeoutMs: number;
  scanTimeoutMs: number;
  maxEmbeddingChunks: number;
  embeddingTimeoutMs: number;
  maxHistoryCommits: number;
  fullHistory: boolean;
  historyTimeoutMs: number;
}

const DEFAULTS: IngestionLimits = {
  maxRepositorySizeMb: 500,
  maxFiles: 20_000,
  maxFileSizeBytes: 1 * 1024 * 1024,
  cloneTimeoutMs: 120_000,
  scanTimeoutMs: 120_000,
  maxEmbeddingChunks: 2_000,
  embeddingTimeoutMs: 600_000,
  maxHistoryCommits: 50,
  fullHistory: false,
  historyTimeoutMs: 120_000,
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Configurable ingestion guards. Values come from environment when present.
 * Do not hardcode commercial product limits into callers — read them here.
 */
export function getIngestionLimits(
  env: Record<string, string | undefined> = {},
  overrides: Partial<IngestionLimits> = {},
): IngestionLimits {
  const maxFileSizeMb = readPositiveInt(env.MAX_FILE_SIZE_MB, 1);
  return {
    maxRepositorySizeMb: readPositiveInt(env.MAX_REPOSITORY_SIZE_MB, DEFAULTS.maxRepositorySizeMb),
    maxFiles: readPositiveInt(env.MAX_FILES, DEFAULTS.maxFiles),
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    cloneTimeoutMs: readPositiveInt(env.CLONE_TIMEOUT_MS, DEFAULTS.cloneTimeoutMs),
    scanTimeoutMs: readPositiveInt(env.SCAN_TIMEOUT_MS, DEFAULTS.scanTimeoutMs),
    maxEmbeddingChunks: readPositiveInt(env.MAX_EMBED_CHUNKS, DEFAULTS.maxEmbeddingChunks),
    embeddingTimeoutMs: readPositiveInt(env.EMBED_TIMEOUT_MS, DEFAULTS.embeddingTimeoutMs),
    maxHistoryCommits: Math.min(
      100_000,
      readPositiveInt(
        env.MAX_HISTORY_COMMITS,
        env.HISTORY_MODE === 'full' ? 10_000 : DEFAULTS.maxHistoryCommits,
      ),
    ),
    fullHistory: env.HISTORY_MODE === 'full',
    historyTimeoutMs: readPositiveInt(env.HISTORY_TIMEOUT_MS, DEFAULTS.historyTimeoutMs),
    ...overrides,
  };
}
