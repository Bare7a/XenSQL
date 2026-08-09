import { Events } from '@wailsio/runtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, newTabId } from '@/shared/lib/api';
import { formatError } from '@/shared/lib/normalize';
import type {
  CSVImportRequest,
  ImportDonePayload,
  ImportProgressPayload,
  ImportResult,
  SQLImportRequest,
} from '@/types';

export interface ImportProgress {
  processed: number;
  inserted: number;
  skipped: number;
  bytesRead: number;
  totalBytes: number;
  totalRows: number;
}

// The frontend mints the id, so a cancelled run's events can't be mistaken for this one's.
export function useImportRun(connectionId: string | null) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const activeId = useRef<string | null>(null);

  useEffect(() => {
    const unsubProgress = Events.On('import:progress', (e) => {
      const p = e.data as ImportProgressPayload | undefined;
      if (!p || p.importId !== activeId.current) return;
      setProgress({
        processed: p.processed,
        inserted: p.inserted,
        skipped: p.skipped,
        bytesRead: p.bytesRead,
        totalBytes: p.totalBytes,
        totalRows: p.totalRows,
      });
    });
    const unsubDone = Events.On('import:done', (e) => {
      const d = e.data as ImportDonePayload | undefined;
      if (!d || d.importId !== activeId.current) return;
      activeId.current = null;
      setRunning(false);
      if (d.error) {
        setError(d.error);
        return;
      }
      setResult(d.result ?? null);
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
    setResult(null);
    setError('');
  }, []);

  const start = useCallback(
    async (run: (importId: string) => Promise<void>) => {
      if (!connectionId) return;
      reset();
      const importId = newTabId();
      activeId.current = importId;
      setRunning(true);
      try {
        await run(importId);
      } catch (err) {
        // Rejected outright (validation, read-only), so no done event will arrive.
        activeId.current = null;
        setRunning(false);
        setError(formatError(err));
      }
    },
    [connectionId, reset],
  );

  const startCSV = useCallback(
    (req: CSVImportRequest) => start((importId) => api.importCSV(connectionId as string, importId, req)),
    [connectionId, start],
  );

  const startSQL = useCallback(
    (req: SQLImportRequest) => start((importId) => api.importSQL(connectionId as string, importId, req)),
    [connectionId, start],
  );

  const cancel = useCallback(() => {
    if (connectionId) void api.cancelQuery(connectionId);
  }, [connectionId]);

  return { running, progress, result, error, startCSV, startSQL, cancel, reset };
}
