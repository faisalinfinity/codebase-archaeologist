import type { ChatCitationDto, HistoryResponseDto, SearchResponseDto } from '@archaeologist/shared';

export interface Evidence extends ChatCitationDto {
  content: string;
}

export function evidenceFromSearch(search: SearchResponseDto, limit = 6): Evidence[] {
  if (!search.commitSha) return [];
  return search.results.slice(0, limit).map((result, index) => ({
    id: `S${index + 1}`,
    kind: 'source' as const,
    filePath: result.filePath,
    startLine: result.startLine,
    endLine: result.endLine,
    commitSha: search.commitSha ?? '',
    githubUrl: result.githubUrl,
    content: result.snippet.slice(0, 800),
  }));
}

function relevance(text: string, terms: string[]): number {
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

export function historyEvidenceFromHistory(
  history: HistoryResponseDto,
  question: string,
  snapshotSha: string,
): Evidence[] {
  const terms = [
    ...new Set(
      (question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(
        (word) =>
          word.length >= 4 &&
          !['what', 'when', 'where', 'which', 'with', 'this', 'that', 'from', 'have'].includes(
            word,
          ),
      ),
    ),
  ];
  const broadHistoryQuestion = /\b(why|changed|change|history|introduced|evolved)\b/i.test(
    question,
  );
  const rankedCommits = history.commits
    .map((commit, index) => ({
      commit,
      index,
      score: relevance(
        `${commit.message} ${commit.files.map((file) => file.path).join(' ')}`,
        terms,
      ),
    }))
    .filter((item) => item.score > 0 || broadHistoryQuestion)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3);
  const rankedPrs = history.pullRequests
    .map((pr, index) => ({
      pr,
      index,
      score: relevance(`${pr.title} ${pr.body ?? ''}`, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2);
  const rankedIssues = history.issues
    .map((issue, index) => ({
      issue,
      index,
      score: relevance(`${issue.title} ${issue.body ?? ''}`, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2);
  return [
    ...rankedCommits.map(({ commit }, index): Evidence => ({
      id: `H${index + 1}`,
      kind: 'commit',
      filePath: commit.files[0]?.path ?? '',
      startLine: 0,
      endLine: 0,
      commitSha: commit.sha,
      githubUrl: `${history.githubUrl}/commit/${commit.sha}`,
      content: `Commit ${commit.sha.slice(0, 12)}: ${commit.message}\nChanged: ${commit.files
        .slice(0, 12)
        .map((file) => file.path)
        .join(', ')}`.slice(0, 800),
    })),
    ...rankedPrs.map(({ pr }, index): Evidence => ({
      id: `P${index + 1}`,
      kind: 'pull_request',
      filePath: '',
      startLine: 0,
      endLine: 0,
      commitSha: snapshotSha,
      githubUrl: `${history.githubUrl}/pull/${pr.number}`,
      content: `PR #${pr.number} (${pr.state}): ${pr.title}\n${pr.body ?? ''}`.slice(0, 800),
    })),
    ...rankedIssues.map(({ issue }, index): Evidence => ({
      id: `I${index + 1}`,
      kind: 'issue',
      filePath: '',
      startLine: 0,
      endLine: 0,
      commitSha: snapshotSha,
      githubUrl: `${history.githubUrl}/issues/${issue.number}`,
      content: `Issue #${issue.number} (${issue.state}): ${issue.title}\n${issue.body ?? ''}`.slice(
        0,
        800,
      ),
    })),
  ];
}

export function validateAnswerCitations(
  rawAnswer: string,
  evidence: readonly Evidence[],
): { answer: string; citations: ChatCitationDto[] } {
  const allowed = new Map(
    evidence.map(({ content: _content, ...citation }) => [citation.id, citation]),
  );
  const used = new Set<string>();
  const answer = rawAnswer
    .replace(/\[([SHPI])(\d+)\]/g, (marker, prefix: string, number: string) => {
      const id = `${prefix}${number}`;
      if (!allowed.has(id)) return '';
      used.add(id);
      return marker;
    })
    .trim();
  return { answer, citations: [...used].map((id) => allowed.get(id)!).filter(Boolean) };
}
