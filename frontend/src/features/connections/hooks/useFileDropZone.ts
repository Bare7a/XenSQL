import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';

const SQLITE_EXTENSIONS = /\.(sqlite3?|db|s3db|sl3)$/i;

// Wails drop handler for SQLite files; dispatches xensql:open-sqlite CustomEvent so connections layer
// can subscribe without coupling to drop state. Drag-over feedback is CSS-only: the Wails runtime
// toggles `file-drop-target-active` on <body> (the data-file-drop-target) while files hover.
export function useFileDropZone(): void {
  useEffect(() => {
    return Events.On('files-dropped', (e) => {
      const paths = (e.data as string[]) ?? [];
      const sqlitePaths = paths.filter((p) => SQLITE_EXTENSIONS.test(p));
      if (sqlitePaths.length === 0) return;
      const filePath = sqlitePaths[0];
      const fileName = filePath.split(/[/\\]/).pop() || '';
      const name = fileName.replace(/\.[^.]+$/, '');
      window.dispatchEvent(new CustomEvent('xensql:open-sqlite', { detail: { filePath, name } }));
    });
  }, []);
}
