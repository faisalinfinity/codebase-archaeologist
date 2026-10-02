export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(inputs: readonly string[]): Promise<number[][]>;
}

export function assertEmbedding(
  vector: readonly number[],
  dimensions = EMBEDDING_DIMENSIONS,
): void {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding must contain ${dimensions} finite numbers.`);
  }
}

export function normalizeEmbedding(vector: readonly number[]): number[] {
  const length = Math.hypot(...vector);
  if (length === 0) throw new Error('Embedding cannot have zero magnitude.');
  return vector.map((value) => value / length);
}

/** Existing Phase 3 chunks can exceed one provider request; average their bounded segments. */
export async function embedChunks(
  provider: EmbeddingProvider,
  chunks: readonly string[],
  maxSegmentChars = 4000,
): Promise<number[][]> {
  if (chunks.length === 0) return [];
  if (!Number.isSafeInteger(maxSegmentChars) || maxSegmentChars < 1 || maxSegmentChars > 4000) {
    throw new Error('Embedding segment size must be between 1 and 4000 characters.');
  }
  const segments: string[] = [];
  const counts: number[] = [];
  for (const chunk of chunks) {
    if (!chunk) throw new Error('Cannot embed an empty chunk.');
    const count = Math.ceil(chunk.length / maxSegmentChars);
    counts.push(count);
    for (let i = 0; i < chunk.length; i += maxSegmentChars) {
      segments.push(chunk.slice(i, i + maxSegmentChars));
    }
  }
  const vectors = await provider.embed(segments);
  if (vectors.length !== segments.length) throw new Error('Embedding response count mismatch.');
  const output: number[][] = [];
  let cursor = 0;
  for (const count of counts) {
    const sum = Array<number>(provider.dimensions).fill(0);
    for (let i = 0; i < count; i += 1) {
      const vector = vectors[cursor++];
      if (!vector) throw new Error('Embedding response is incomplete.');
      assertEmbedding(vector, provider.dimensions);
      for (let j = 0; j < sum.length; j += 1) sum[j] = (sum[j] ?? 0) + (vector[j] ?? 0);
    }
    output.push(normalizeEmbedding(sum));
  }
  return output;
}
