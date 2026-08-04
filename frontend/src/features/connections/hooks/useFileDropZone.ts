import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';

const SQLITE_EXTENSIONS = /\.(sqlite3?|db|s3db|sl3)$/i;

export function useFileDropZone(): void {
  useEffect(() => {
    return Events.On('files-dropped', (e) => {
      const paths = (e.data as string[]) ?? [];
      const sqlitePaths = paths.filter((p) => SQLITE_EXTENSIONS.test(p));
      if (sqlitePaths.length === 0) return;
      const filePath = sqlitePaths[0];
      const fileName = filePath.split(/[/\\]/).pop() || '';
      const name = fileName.replace(/\.[^.]+$/, '');
      useAppStore.getState().requestOpenSqliteFile({ filePath, name });
    });
  }, []);
}
