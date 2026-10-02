'use client';

import { useEffect, useState } from 'react';

import type { IndexStatusDto } from '@archaeologist/shared';

import { Button } from '@/components/ui/button';

interface IndexProgressProps {
  repositoryId: string;
  initial: IndexStatusDto;
}

const STAGE_COPY: Record<string, string> = {
  PENDING: 'Waiting for the index worker…',
  CLONING: 'Cloning repository (read-only git)…',
  SCANNING: 'Scanning files…',
  PARSING: 'Extracting source symbols, chunks, and imports…',
  ANALYZING: 'Saving source and dependency facts…',
  GITHUB_SYNC: 'Syncing GitHub metadata (later milestone)…',
  CHUNKING: 'Chunking (later milestone)…',
  EMBEDDING: 'Generating source embeddings…',
  FINALIZING: 'Saving snapshot…',
  READY: 'Index snapshot ready.',
  FAILED: 'Indexing failed.',
};

function isTerminal(status: string | undefined): boolean {
  return status === 'READY' || status === 'FAILED';
}

export function IndexProgress({ repositoryId, initial }: IndexProgressProps) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const stage = status.job?.stage ?? status.repository.status;
  const terminal = isTerminal(status.job?.status ?? status.repository.status);

  useEffect(() => {
    if (terminal) {
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/repositories/${repositoryId}/index/status`);
        const payload = (await response.json()) as IndexStatusDto & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load index status.');
        }
        if (!cancelled) {
          setStatus(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load index status.');
          console.error('[IndexProgress]', err);
        }
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [repositoryId, terminal]);

  async function reindex() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/index`, { method: 'POST' });
      const payload = (await response.json()) as IndexStatusDto & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Could not start indexing.');
        return;
      }
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start indexing.');
      console.error('[IndexProgress.reindex]', err);
    } finally {
      setPending(false);
    }
  }

  const copy = status.job?.progress?.message ?? STAGE_COPY[stage] ?? stage;
  const canReindex = terminal && !pending;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <span className="font-medium text-foreground">{status.repository.status}</span>
        {status.job ? ` · job ${status.job.stage}` : null}
      </p>
      <p className="text-muted-foreground">{copy}</p>
      {status.snapshot ? (
        <p className="text-muted-foreground">
          Snapshot{' '}
          <span className="font-mono text-foreground">
            {status.snapshot.commitSha.slice(0, 12)}
          </span>
          {' · '}
          branch {status.snapshot.branch}
          {' · '}
          {status.fileCount} files indexed
        </p>
      ) : null}
      {status.job?.errorMessage ? (
        <p className="text-destructive">{status.job.errorMessage}</p>
      ) : null}
      {error ? <p className="text-destructive">{error}</p> : null}
      {canReindex ? (
        <div>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void reindex()}>
            {pending
              ? 'Starting…'
              : status.repository.status === 'FAILED'
                ? 'Retry index'
                : 'Re-index'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
