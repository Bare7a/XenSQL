import { Events } from '@wailsio/runtime';
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
    return Events.On('open-sqlite', (e) => {
      const data = e.data as { filePath: string; name: string };
      if (data?.filePath) {
        window.dispatchEvent(new CustomEvent('xensql:open-sqlite', { detail: data }));
      }
    });
  }, []);
}
