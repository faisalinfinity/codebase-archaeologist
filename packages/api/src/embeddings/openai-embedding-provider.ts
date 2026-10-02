import {
  assertEmbedding,
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
} from './embedding-provider';

const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const SUPPORTED_MODELS = new Set(['text-embedding-3-small', 'text-embedding-3-large']);

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor(options: OpenAIEmbeddingOptions) {
    if (!options.apiKey) throw new Error('OPENAI_API_KEY is required for semantic embeddings.');
    this.model = options.model ?? 'text-embedding-3-small';
    if (!SUPPORTED_MODELS.has(this.model)) throw new Error('Unsupported OpenAI embedding model.');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async embed(inputs: readonly string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    if (inputs.length > 32 || inputs.some((input) => !input || input.length > 4000)) {
      throw new Error(
        'Embedding batch must contain 1–32 nonempty texts of at most 4000 characters.',
      );
    }
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: inputs,
        model: this.model,
        dimensions: this.dimensions,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Provider bodies can contain account details. Keep them out of job and HTTP errors.
      throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('data' in payload) ||
      !Array.isArray(payload.data) ||
      !('model' in payload) ||
      payload.model !== this.model
    ) {
      throw new Error('Embedding provider returned an invalid response.');
    }
    const ordered: Array<number[] | undefined> = Array(inputs.length).fill(undefined);
    for (const item of payload.data) {
      if (
        !item ||
        typeof item !== 'object' ||
        !('index' in item) ||
        !('embedding' in item) ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= inputs.length ||
        !Array.isArray(item.embedding) ||
        ordered[item.index]
      ) {
        throw new Error('Embedding provider returned an invalid response.');
      }
      const vector = item.embedding as number[];
      assertEmbedding(vector, this.dimensions);
      ordered[item.index] = vector;
    }
    if (ordered.some((vector) => !vector))
      throw new Error('Embedding provider response is incomplete.');
    return ordered as number[][];
  }
}

export function configuredEmbeddingProvider(
  env: Record<string, string | undefined>,
): EmbeddingProvider | null {
  if (!env.OPENAI_API_KEY) return null;
  return new OpenAIEmbeddingProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_EMBEDDING_MODEL,
  });
}
