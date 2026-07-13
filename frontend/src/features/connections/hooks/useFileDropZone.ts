import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';

const SQLITE_EXTENSIONS = /\.(sqlite3?|db|s3db|sl3)$/i;

const DROP_HOVER_CLASS = 'file-drop-target-active';

// Wails drop handler for SQLite files; dispatches xensql:open-sqlite CustomEvent so connections layer
// can subscribe without coupling to drop state. Drag-over feedback is CSS-only: the Wails runtime
// toggles `file-drop-target-active` on <body> (the data-file-drop-target) while files hover.
export function useFileDropZone(): void {
  useEffect(() => {
    const clearDropHover = () => {
      if (document.body.classList.contains(DROP_HOVER_CLASS)) {
        document.body.classList.remove(DROP_HOVER_CLASS);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) clearDropHover();
    };

    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('mousemove', clearDropHover);
    window.addEventListener('keydown', clearDropHover);

    const unsubDrop = Events.On('files-dropped', (e) => {
      const paths = (e.data as string[]) ?? [];
      const sqlitePaths = paths.filter((p) => SQLITE_EXTENSIONS.test(p));
      if (sqlitePaths.length === 0) return;
      const filePath = sqlitePaths[0];
      const fileName = filePath.split(/[/\\]/).pop() || '';
      const name = fileName.replace(/\.[^.]+$/, '');
      window.dispatchEvent(new CustomEvent('xensql:open-sqlite', { detail: { filePath, name } }));
    });

    return () => {
      unsubDrop();
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('mousemove', clearDropHover);
      window.removeEventListener('keydown', clearDropHover);
    };
  }, []);
}
