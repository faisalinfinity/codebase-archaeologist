import type { SearchCandidate } from './repository-store';

export interface RankedCandidate extends SearchCandidate {
  fusedScore: number;
}

/** Reciprocal rank fusion combines different scoring scales without calibrating them. */
export function fuseResults(
  lexical: readonly SearchCandidate[],
  semantic: readonly SearchCandidate[],
  limit = 10,
): RankedCandidate[] {
  const result = new Map<string, RankedCandidate>();
  for (const candidates of [lexical, semantic]) {
    candidates.forEach((candidate, index) => {
      const existing = result.get(candidate.chunkId);
      const fusedScore = (existing?.fusedScore ?? 0) + 1 / (60 + index + 1);
      result.set(candidate.chunkId, { ...candidate, fusedScore });
    });
  }
  return [...result.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || a.filePath.localeCompare(b.filePath))
    .slice(0, limit);
}

export function searchSnippet(content: string, query: string, maxChars = 600): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const lower = content.toLowerCase();
  const matches = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);
  const first = matches.length ? Math.min(...matches) : 0;
  const start = Math.max(0, first - Math.min(140, Math.floor(maxChars / 3)));
  const end = Math.min(content.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}
