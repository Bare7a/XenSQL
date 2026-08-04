import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { useAppStore } from '@/store/appStore';

// Normalises the CLI-arg pending file and the Wails open-sqlite event into one store request.
export function useOpenSqliteEvents(): void {
  useEffect(() => {
    void api.getPendingFile().then((data) => {
      if (data?.filePath) useAppStore.getState().requestOpenSqliteFile(data);
    });
  }, []);

  useEffect(() => {
    return Events.On('open-sqlite', (e) => {
      const data = e.data as { filePath: string; name: string };
      if (data?.filePath) useAppStore.getState().requestOpenSqliteFile(data);
    });
  }, []);
}
