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

export function searchExcerpt(
  content: string,
  query: string,
  sourceStartLine: number,
  maxChars = 600,
): { snippet: string; startLine: number; endLine: number } {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const lower = content.toLowerCase();
  const matches = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);
  const first = matches.length ? Math.min(...matches) : 0;
  const start = Math.max(0, first - Math.min(140, Math.floor(maxChars / 3)));
  const end = Math.min(content.length, start + maxChars);
  const excerpt = content.slice(start, end);
  const startLine = sourceStartLine + (content.slice(0, start).match(/\n/g) ?? []).length;
  const lineBreaks = (excerpt.match(/\n/g) ?? []).length;
  return {
    snippet: `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`,
    startLine,
    endLine: Math.max(startLine, startLine + lineBreaks - (excerpt.endsWith('\n') ? 1 : 0)),
  };
}
