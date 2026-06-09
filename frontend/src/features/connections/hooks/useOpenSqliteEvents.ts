import { EventsOn } from '@wails/runtime/runtime';
import { useEffect } from 'react';
import { api } from '@/shared/lib/api';

// Normalises CLI-arg pending file and Wails open-sqlite event into one xensql:open-sqlite CustomEvent.
export function useOpenSqliteEvents(): void {
  useEffect(() => {
    void api.getPendingFile().then((data) => {
      if (data?.filePath) {
        window.dispatchEvent(new CustomEvent('xensql:open-sqlite', { detail: data }));
      }
    });
  }, []);

  useEffect(() => {
    return EventsOn('open-sqlite', (data: { filePath: string; name: string }) => {
      if (data?.filePath) {
        window.dispatchEvent(new CustomEvent('xensql:open-sqlite', { detail: data }));
      }
    });
  }, []);
}
